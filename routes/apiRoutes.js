const express = require('express');
const router = express.Router();
const db = require('../config/db');
const fs = require('fs');
const path = require('path');

// Cargar examen por ID
function loadExamData(examId) {
  const file = `test${examId}.json`;
  const p = path.join(__dirname, `../data/exams/${file}`);
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return null;
}

// GET /api/students/list - Roster de alumnos de 4A y 4B
router.get('/students/list', async (req, res) => {
  try {
    const store = await db.fetchStore();
    res.json({ success: true, students: store.students });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/students/login - Login de estudiante
router.post('/students/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Ingresa tu usuario y contraseña.' });
    }

    const cleanUser = username.trim().toLowerCase();
    const cleanPass = password.trim().toLowerCase();

    const store = await db.fetchStore();
    const student = store.students.find(s => s.username === cleanUser);

    if (!student || cleanUser !== cleanPass) {
      return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos.' });
    }

    // Actualizar última conexión en Turso si está activo
    const turso = await db.getTursoClient();
    const nowIso = new Date().toISOString();
    if (turso) {
      try {
        await turso.execute({
          sql: 'UPDATE students SET last_login_at = ? WHERE username = ?',
          args: [nowIso, cleanUser]
        });
      } catch (e) {}
    } else {
      student.lastLogin = nowIso;
      await db.saveStore(store);
    }

    res.json({
      success: true,
      student: {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        fullName: `${student.firstName} ${student.lastName}`,
        grade: student.grade,
        username: student.username,
        assignedExamId: student.assignedExamId || 1
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/exams/:id - Obtener preguntas de un examen (1, 2 o 3)
router.get('/exams/:id', (req, res) => {
  const examId = parseInt(req.params.id) || 1;
  const exam = loadExamData(examId);
  if (!exam) {
    return res.status(404).json({ success: false, message: 'Examen no encontrado.' });
  }
  res.json({ success: true, exam });
});

// GET /api/progress/:username/:examId - Obtener progreso guardado
router.get('/progress/:username/:examId', async (req, res) => {
  try {
    const { username, examId } = req.params;
    const key = `${username.toLowerCase()}_${examId}`;

    const turso = await db.getTursoClient();
    if (turso) {
      const resProg = await turso.execute({
        sql: 'SELECT * FROM progress WHERE username = ? AND exam_id = ?',
        args: [username.toLowerCase(), parseInt(examId)]
      });
      if (resProg.rows.length > 0) {
        const row = resProg.rows[0];
        let answers = {};
        try { answers = JSON.parse(row.raw_answers_json || '{}'); } catch (e) {}
        return res.json({
          success: true,
          hasProgress: true,
          progress: {
            answers,
            updatedAt: row.updated_at,
            status: row.status
          }
        });
      }
    }

    const store = await db.fetchStore();
    const savedProgress = store.progress ? store.progress[key] : null;
    res.json({
      success: true,
      hasProgress: !!savedProgress,
      progress: savedProgress || null
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/progress/save - GUARDAR PROGRESO (Turso + Local)
router.post('/progress/save', async (req, res) => {
  try {
    const { username, examId, answers } = req.body;
    if (!username || !examId) {
      return res.status(400).json({ success: false, message: 'Datos insuficientes para guardar progreso.' });
    }

    const cleanUser = username.trim().toLowerCase();
    const eId = parseInt(examId);
    const answersJson = JSON.stringify(answers || {});
    const nowIso = new Date().toISOString();

    const turso = await db.getTursoClient();
    if (turso) {
      await turso.execute({
        sql: `
          INSERT INTO progress (username, exam_id, raw_answers_json, status, updated_at)
          VALUES (?, ?, ?, 'in_progress', ?)
          ON CONFLICT(username, exam_id) DO UPDATE SET
            raw_answers_json = excluded.raw_answers_json,
            status = 'in_progress',
            updated_at = excluded.updated_at
        `,
        args: [cleanUser, eId, answersJson, nowIso]
      });
    }

    // Guardar también en respaldo local
    const key = `${cleanUser}_${eId}`;
    await db.withLock(async () => {
      const store = await db.fetchStore();
      if (!store.progress) store.progress = {};
      store.progress[key] = {
        answers: answers || {},
        updatedAt: nowIso,
        status: 'in_progress'
      };
      await db.saveStore(store);
    });

    res.json({ success: true, message: 'Progreso guardado exitosamente.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/exams/submit - ENTREGAR EXAMEN (Turso + Local)
router.post('/exams/submit', async (req, res) => {
  try {
    const { username, examId, answers } = req.body;
    if (!username || !examId || !answers) {
      return res.status(400).json({ success: false, message: 'Faltan respuestas para entregar el examen.' });
    }

    const exam = loadExamData(examId);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Examen no encontrado.' });
    }

    // Evaluación automática
    let autoScore = 0;
    let maxAutoScore = 0;

    // Parte 1
    if (exam.parts.part1 && exam.parts.part1.questions) {
      exam.parts.part1.questions.forEach(q => {
        maxAutoScore++;
        const userAns = (answers[q.id] || '').trim().toLowerCase();
        if (userAns === q.answer.toLowerCase()) autoScore++;
      });
    }

    // Parte 2
    if (exam.parts.part2 && exam.parts.part2.questions) {
      exam.parts.part2.questions.forEach(q => {
        maxAutoScore++;
        const userAns = (answers[q.id] || '').trim().toLowerCase();
        if (userAns === q.answer.toLowerCase()) autoScore++;
      });
    }

    // Parte 3
    if (exam.parts.part3 && exam.parts.part3.questions) {
      exam.parts.part3.questions.forEach(q => {
        maxAutoScore++;
        const userAns = (answers[q.id] || '').trim().toLowerCase();
        if (userAns === q.answer.toLowerCase()) autoScore++;
      });
      if (exam.parts.part3.titleQuestion) {
        maxAutoScore++;
        const userAns = (answers[exam.parts.part3.titleQuestion.id] || '').trim().toLowerCase();
        if (userAns === exam.parts.part3.titleQuestion.answer.toLowerCase()) autoScore++;
      }
    }

    // Parte 4
    if (exam.parts.part4 && exam.parts.part4.questions) {
      exam.parts.part4.questions.forEach(q => {
        maxAutoScore++;
        const userAns = (answers[q.id] || '').trim().toLowerCase();
        if (userAns === q.answer.toLowerCase()) autoScore++;
      });
      if (exam.parts.part4.titleQuestion) {
        maxAutoScore++;
        const userAns = (answers[exam.parts.part4.titleQuestion.id] || '').trim().toLowerCase();
        if (userAns === exam.parts.part4.titleQuestion.answer.toLowerCase()) autoScore++;
      }
    }

    // Parte 5
    if (exam.parts.part5 && exam.parts.part5.questions) {
      exam.parts.part5.questions.forEach(q => {
        maxAutoScore++;
        const userAns = (answers[q.id] || '').trim().toLowerCase();
        const acceptable = (q.acceptableAnswers || []).map(a => a.toLowerCase());
        if (acceptable.includes(userAns)) autoScore++;
      });
    }

    // Parte 6 (si es MCQ)
    if (exam.parts.part6 && exam.parts.part6.questions && exam.parts.part6.questions[0].options) {
      exam.parts.part6.questions.forEach(q => {
        maxAutoScore++;
        const userAns = (answers[q.id] || '').trim().toLowerCase();
        if (userAns === q.answer.toLowerCase()) autoScore++;
      });
    }

    const cleanUser = username.trim().toLowerCase();
    const eId = parseInt(examId);
    const answersJson = JSON.stringify(answers || {});
    const nowIso = new Date().toISOString();

    const turso = await db.getTursoClient();
    if (turso) {
      await turso.execute({
        sql: 'DELETE FROM submissions WHERE username = ? AND exam_id = ?',
        args: [cleanUser, eId]
      });
      await turso.execute({
        sql: `
          INSERT INTO submissions (username, exam_id, auto_score, max_auto_score, raw_answers_json, status, submitted_at)
          VALUES (?, ?, ?, ?, ?, 'submitted', ?)
        `,
        args: [cleanUser, eId, autoScore, maxAutoScore, answersJson, nowIso]
      });
      await turso.execute({
        sql: `
          INSERT INTO progress (username, exam_id, raw_answers_json, status, updated_at)
          VALUES (?, ?, ?, 'submitted', ?)
          ON CONFLICT(username, exam_id) DO UPDATE SET
            raw_answers_json = excluded.raw_answers_json,
            status = 'submitted',
            updated_at = excluded.updated_at
        `,
        args: [cleanUser, eId, answersJson, nowIso]
      });
    }

    // Guardar en almacenamiento local
    const key = `${cleanUser}_${eId}`;
    const submissionId = Date.now();

    await db.withLock(async () => {
      const store = await db.fetchStore();
      if (!store.submissions) store.submissions = [];

      store.submissions = store.submissions.filter(s => !(s.username === cleanUser && s.examId === eId));

      store.submissions.push({
        id: submissionId,
        username: cleanUser,
        examId: eId,
        autoScore,
        maxAutoScore,
        answers,
        submittedAt: nowIso,
        status: 'submitted'
      });

      if (!store.progress) store.progress = {};
      store.progress[key] = {
        answers,
        updatedAt: nowIso,
        status: 'submitted'
      };

      await db.saveStore(store);
    });

    res.json({
      success: true,
      autoScore,
      maxAutoScore,
      message: 'Examen entregado exitosamente.'
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/admin/submissions - Panel docente
router.get('/admin/submissions', async (req, res) => {
  try {
    const pin = req.query.pin;
    if (pin !== 'movers2026') {
      return res.status(401).json({ success: false, message: 'PIN docente incorrecto.' });
    }

    const store = await db.fetchStore();

    const studentOverview = store.students.map(st => {
      const assignedId = st.assignedExamId || 1;
      const key = `${st.username}_${assignedId}`;
      const prog = store.progress ? store.progress[key] : null;
      const sub = (store.submissions || []).find(s => s.username === st.username && s.examId === assignedId);

      let status = 'not_started';
      if (sub) status = 'submitted';
      else if (prog && prog.status === 'in_progress') status = 'in_progress';

      return {
        ...st,
        assignedExamId: assignedId,
        examStatus: status,
        updatedAt: sub ? sub.submittedAt : (prog ? prog.updatedAt : null),
        autoScore: sub ? sub.autoScore : null,
        maxAutoScore: sub ? sub.maxAutoScore : null,
        answers: sub ? sub.answers : (prog ? prog.answers : null)
      };
    });

    res.json({
      success: true,
      students: studentOverview,
      totalSubmissions: (store.submissions || []).length
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
