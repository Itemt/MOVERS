const express = require('express');
const router = express.Router();
const db = require('../config/db');
const fs = require('fs');
const path = require('path');

// Cachear exámenes en memoria para evitar lecturas de disco repetidas
function loadExamData(examId) {
  const p = path.join(__dirname, `../data/exams/test${examId}.json`);
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return null;
}

// ────────────────────────────────────────────────────────
// GET /api/students/list
// ────────────────────────────────────────────────────────
router.get('/students/list', async (req, res) => {
  try {
    const store = await db.fetchStore();
    res.json({ success: true, students: store.students });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error al cargar lista de alumnos.' });
  }
});

// ────────────────────────────────────────────────────────
// POST /api/students/login
// ────────────────────────────────────────────────────────
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

    // La contraseña de cada alumno es su propio username (por diseño del examen)
    if (!student || cleanPass !== student.username) {
      return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos.' });
    }

    // Actualizar último login
    const nowIso = new Date().toISOString();
    const turso = await db.getTursoClient().catch(() => null);
    if (turso) {
      await turso.execute({
        sql: 'UPDATE students SET last_login_at = ? WHERE username = ?',
        args: [nowIso, cleanUser]
      }).catch(e => console.error('Error actualizando last_login:', e.message));
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
    console.error('Error en login:', err.message);
    res.status(500).json({ success: false, message: 'Error en el servidor al iniciar sesión.' });
  }
});

// ────────────────────────────────────────────────────────
// GET /api/exams/:id
// ────────────────────────────────────────────────────────
router.get('/exams/:id', (req, res) => {
  const examId = parseInt(req.params.id) || 1;
  if (examId < 1 || examId > 3) {
    return res.status(400).json({ success: false, message: 'ID de examen inválido.' });
  }
  const exam = loadExamData(examId);
  if (!exam) {
    return res.status(404).json({ success: false, message: 'Examen no encontrado.' });
  }
  res.json({ success: true, exam });
});

// ────────────────────────────────────────────────────────
// GET /api/progress/:username/:examId
// Retorna el progreso guardado o el estado de submitted
// ────────────────────────────────────────────────────────
router.get('/progress/:username/:examId', async (req, res) => {
  try {
    const username = req.params.username.trim().toLowerCase();
    const examId = parseInt(req.params.examId);

    const turso = await db.getTursoClient().catch(() => null);

    if (turso) {
      // Verificar primero si ya fue entregado
      const resSub = await turso.execute({
        sql: 'SELECT * FROM submissions WHERE username = ? AND exam_id = ? LIMIT 1',
        args: [username, examId]
      });
      if (resSub.rows.length > 0) {
        const row = resSub.rows[0];
        let answers = {};
        try { answers = JSON.parse(row.raw_answers_json || '{}'); } catch (e) {}
        return res.json({
          success: true,
          hasProgress: true,
          status: 'submitted',
          progress: {
            answers,
            updatedAt: row.submitted_at,
            status: 'submitted',
            autoScore: Number(row.auto_score),
            maxAutoScore: Number(row.max_auto_score)
          }
        });
      }

      // Buscar progreso en curso
      const resProg = await turso.execute({
        sql: 'SELECT * FROM progress WHERE username = ? AND exam_id = ? LIMIT 1',
        args: [username, examId]
      });
      if (resProg.rows.length > 0) {
        const row = resProg.rows[0];
        let answers = {};
        try { answers = JSON.parse(row.raw_answers_json || '{}'); } catch (e) {}
        return res.json({
          success: true,
          hasProgress: Object.keys(answers).length > 0,
          status: 'in_progress',
          progress: {
            answers,
            updatedAt: row.updated_at,
            status: row.status
          }
        });
      }

      return res.json({ success: true, hasProgress: false, status: 'new', progress: null });
    }

    // Fallback local
    const store = await db.fetchStore();
    const key = `${username}_${examId}`;
    const sub = (store.submissions || []).find(s => s.username === username && s.examId === examId);
    if (sub) {
      return res.json({
        success: true, hasProgress: true, status: 'submitted',
        progress: { answers: sub.answers, updatedAt: sub.submittedAt, status: 'submitted', autoScore: sub.autoScore, maxAutoScore: sub.maxAutoScore }
      });
    }
    const prog = store.progress ? store.progress[key] : null;
    res.json({
      success: true,
      hasProgress: !!prog && Object.keys(prog.answers || {}).length > 0,
      status: prog ? 'in_progress' : 'new',
      progress: prog || null
    });
  } catch (err) {
    console.error('Error obteniendo progreso:', err.message);
    res.status(500).json({ success: false, message: 'Error al obtener progreso.' });
  }
});

// ────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────
// Normalización y tolerancia avanzada para respuestas escritas
// ────────────────────────────────────────────────────────
function normalizeAnswer(str) {
  if (!str) return '';
  let clean = String(str).trim().toLowerCase();
  clean = clean.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // quitar tildes
  clean = clean.replace(/[\s.,!?;:'"/\-\\_()+]+/g, ' ').trim(); // quitar puntuación
  clean = clean.replace(/\b(a|an|the|to|of|in|on|at|by|with|for|it|is|are)\b/gi, '').replace(/\s+/g, ' ').trim();
  return clean;
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b ? b.length : 0;
  if (!b) return a ? a.length : 0;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function stripPlural(str) {
  if (!str || str.length <= 3) return str;
  if (str.endsWith('ies') && str.length > 4) return str.slice(0, -3) + 'y';
  if (str.endsWith('es') && str.length > 4) return str.slice(0, -2);
  if (str.endsWith('s') && !str.endsWith('ss')) return str.slice(0, -1);
  return str;
}

function checkAnswer(userAns, expectedAns, acceptableAnswers = []) {
  if (!userAns) return false;
  const normUser = normalizeAnswer(userAns);
  const rawUser = String(userAns).trim().toLowerCase();
  if (!normUser && !rawUser) return false;

  const targets = [expectedAns, ...(acceptableAnswers || [])].filter(Boolean);
  return targets.some(target => {
    const normTarget = normalizeAnswer(target);
    const rawTarget = String(target).trim().toLowerCase();

    // 1. Coincidencia exacta o normalizada
    if (rawUser === rawTarget || normUser === normTarget) return true;

    // 2. Coincidencia de plurales ('s' / 'es')
    if (normUser && normTarget && stripPlural(normUser) === stripPlural(normTarget)) return true;

    // 3. Tolerancia a errores de tipeo (Levenshtein)
    if (normUser && normTarget) {
      const dist = levenshteinDistance(normUser, normTarget);
      const maxAllowedDist = normTarget.length >= 7 ? 2 : (normTarget.length >= 4 ? 1 : 0);
      if (dist <= maxAllowedDist) return true;
    }

    return false;
  });
}

// ────────────────────────────────────────────────────────
// POST /api/progress/save
// ────────────────────────────────────────────────────────
router.post('/progress/save', async (req, res) => {
  try {
    const { username, examId, answers } = req.body;
    if (!username || !examId) {
      return res.status(400).json({ success: false, message: 'Datos insuficientes.' });
    }

    const cleanUser = username.trim().toLowerCase();
    const eId = parseInt(examId);
    const answersJson = JSON.stringify(answers || {});
    const nowIso = new Date().toISOString();

    const turso = await db.getTursoClient().catch(() => null);
    if (turso) {
      // No sobreescribir si ya fue entregado
      const resSub = await turso.execute({
        sql: 'SELECT id FROM submissions WHERE username = ? AND exam_id = ? LIMIT 1',
        args: [cleanUser, eId]
      });
      if (resSub.rows.length > 0) {
        return res.json({ success: false, alreadySubmitted: true, message: 'Este examen ya fue entregado.' });
      }

      await turso.execute({
        sql: `INSERT INTO progress (username, exam_id, raw_answers_json, status, updated_at)
              VALUES (?, ?, ?, 'in_progress', ?)
              ON CONFLICT(username, exam_id) DO UPDATE SET
                raw_answers_json = excluded.raw_answers_json,
                status = excluded.status,
                updated_at = excluded.updated_at`,
        args: [cleanUser, eId, answersJson, nowIso]
      });
    } else {
      // Fallback local
      const key = `${cleanUser}_${eId}`;
      const store = await db.fetchStore();
      if (!store.progress) store.progress = {};
      store.progress[key] = { answers: answers || {}, updatedAt: nowIso, status: 'in_progress' };
      await db.saveStore(store);
    }

    res.json({ success: true, message: 'Progreso guardado.' });
  } catch (err) {
    console.error('Error guardando progreso:', err.message);
    res.status(500).json({ success: false, message: 'Error al guardar progreso.' });
  }
});

// ────────────────────────────────────────────────────────
// POST /api/exams/submit
// ────────────────────────────────────────────────────────
router.post('/exams/submit', async (req, res) => {
  try {
    const { username, examId, answers } = req.body;
    if (!username || !examId || !answers) {
      return res.status(400).json({ success: false, message: 'Datos incompletos para entregar.' });
    }

    const cleanUser = username.trim().toLowerCase();
    const eId = parseInt(examId);

    // Verificar que no haya entregado ya
    const turso = await db.getTursoClient().catch(() => null);
    if (turso) {
      const resSub = await turso.execute({
        sql: 'SELECT id FROM submissions WHERE username = ? AND exam_id = ? LIMIT 1',
        args: [cleanUser, eId]
      });
      if (resSub.rows.length > 0) {
        return res.json({ success: false, alreadySubmitted: true, message: 'Este examen ya fue entregado anteriormente.' });
      }
    }

    const exam = loadExamData(eId);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Examen no encontrado.' });
    }

    // ── Autocalificación con tolerancia ──────────────
    let autoScore = 0;
    let maxAutoScore = 0;

    // Sección Listening (Partes 1–3)
    (exam.listening?.parts || []).forEach(part => {
      (part.questions || []).forEach(q => {
        maxAutoScore++;
        const userVal = (answers[q.id] || '').trim();
        if (checkAnswer(userVal, q.answer, q.acceptableAnswers)) autoScore++;
      });
    });

    // Parte 1 — completar palabra del banco
    (exam.parts.part1?.questions || []).forEach(q => {
      maxAutoScore++;
      if (checkAnswer(answers[q.id], q.answer)) autoScore++;
    });

    // Parte 2 — MCQ diálogo
    (exam.parts.part2?.questions || []).forEach(q => {
      maxAutoScore++;
      if ((answers[q.id] || '').trim().toUpperCase() === q.answer.toUpperCase()) autoScore++;
    });

    // Parte 3 — completar historia + título
    (exam.parts.part3?.questions || []).forEach(q => {
      maxAutoScore++;
      if (checkAnswer(answers[q.id], q.answer)) autoScore++;
    });
    if (exam.parts.part3?.titleQuestion) {
      const tq = exam.parts.part3.titleQuestion;
      maxAutoScore++;
      if (checkAnswer(answers[tq.id], tq.answer)) autoScore++;
    }

    // Parte 4 — texto factual MCQ
    (exam.parts.part4?.questions || []).forEach(q => {
      maxAutoScore++;
      if (checkAnswer(answers[q.id], q.answer)) autoScore++;
    });

    // Parte 5 — completar oraciones (respuestas aceptables)
    (exam.parts.part5?.questions || []).forEach(q => {
      maxAutoScore++;
      if (checkAnswer(answers[q.id], q.answer, q.acceptableAnswers)) autoScore++;
    });

    // Parte 6 — producción escrita (no se autocalifica, queda para el docente)

    const nowIso = new Date().toISOString();
    const answersJson = JSON.stringify(answers || {});

    let _debug = { tursoNull: !turso, insertResult: null, insertError: null };

    if (turso) {
      // ── Paso 1: Insertar submission (usa INSERT OR IGNORE para proteger el índice único)
      try {
        const insertRes = await turso.execute({
          sql: `INSERT OR IGNORE INTO submissions
                (username, exam_id, auto_score, max_auto_score, raw_answers_json, status, submitted_at)
                VALUES (?, ?, ?, ?, ?, 'submitted', ?)`,
          args: [cleanUser, eId, autoScore, maxAutoScore, answersJson, nowIso]
        });
        _debug.insertResult = { rowsAffected: insertRes.rowsAffected, lastInsertRowid: String(insertRes.lastInsertRowid) };
      } catch (insertErr) {
        _debug.insertError = insertErr.message;
        throw insertErr; // re-lanzar para que el catch externo devuelva 500
      }

      // ── Paso 2: Actualizar progress a 'submitted'
      try {
        await turso.execute({
          sql: `INSERT INTO progress (username, exam_id, raw_answers_json, status, updated_at)
                VALUES (?, ?, ?, 'submitted', ?)
                ON CONFLICT(username, exam_id) DO UPDATE SET
                  raw_answers_json = excluded.raw_answers_json,
                  status = excluded.status,
                  updated_at = excluded.updated_at`,
          args: [cleanUser, eId, answersJson, nowIso]
        });
      } catch (progressErr) {
        console.warn('⚠️ No se pudo actualizar progress tras submit (no crítico):', progressErr.message);
      }
    } else {
      // Fallback local
      await db.withLock(async () => {
        const store = await db.fetchStore();
        const alreadyExists = (store.submissions || []).some(
          s => s.username === cleanUser && s.examId === eId
        );
        if (!alreadyExists) {
          store.submissions = store.submissions || [];
          store.submissions.push({ id: Date.now(), username: cleanUser, examId: eId, autoScore, maxAutoScore, answers, submittedAt: nowIso, status: 'submitted' });
        }
        if (!store.progress) store.progress = {};
        store.progress[`${cleanUser}_${eId}`] = { answers, updatedAt: nowIso, status: 'submitted' };
        await db.saveStore(store);
      });
    }

    res.json({ success: true, autoScore, maxAutoScore, message: '¡Examen entregado exitosamente!', _debug });
  } catch (err) {
    console.error('Error al entregar examen:', err.message);
    res.status(500).json({ success: false, message: 'Error al entregar el examen. Intenta de nuevo.' });
  }
});

// ────────────────────────────────────────────────────────
// GET /api/admin/submissions?pin=xxx
// ────────────────────────────────────────────────────────
router.get('/admin/submissions', async (req, res) => {
  try {
    if (req.query.pin !== 'movers2026') {
      return res.status(401).json({ success: false, message: 'PIN incorrecto.' });
    }

    const store = await db.fetchStore();

    const studentOverview = store.students.map(st => {
      const assignedId = st.assignedExamId || 1;
      const key = `${st.username}_${assignedId}`;
      const prog = store.progress?.[key];
      const sub = (store.submissions || []).find(s => s.username === st.username && s.examId === assignedId);

      let status = 'not_started';
      if (sub) status = 'submitted';
      else if (prog?.answers && Object.keys(prog.answers).length > 0) status = 'in_progress';

      return {
        ...st,
        assignedExamId: assignedId,
        examStatus: status,
        updatedAt: sub?.submittedAt || prog?.updatedAt || null,
        autoScore: sub?.autoScore ?? null,
        maxAutoScore: sub?.maxAutoScore ?? null,
        answers: sub?.answers || prog?.answers || null
      };
    });

    res.json({
      success: true,
      students: studentOverview,
      totalSubmissions: (store.submissions || []).length
    });
  } catch (err) {
    console.error('Error en panel admin:', err.message);
    res.status(500).json({ success: false, message: 'Error al cargar datos de administración.' });
  }
});

// ────────────────────────────────────────────────────────
// POST /api/admin/reset-student
// Borra las entregas y progreso de un alumno en la base de datos
// ────────────────────────────────────────────────────────
router.post('/admin/reset-student', async (req, res) => {
  try {
    const { pin, username, examId } = req.body;
    if (pin !== 'movers2026') {
      return res.status(401).json({ success: false, message: 'PIN incorrecto.' });
    }
    if (!username) {
      return res.status(400).json({ success: false, message: 'Se requiere username.' });
    }

    const cleanUser = username.trim().toLowerCase();
    const eId = examId ? parseInt(examId) : null;

    const turso = await db.getTursoClient().catch(() => null);
    if (turso) {
      if (eId) {
        await turso.execute({ sql: 'DELETE FROM submissions WHERE username = ? AND exam_id = ?', args: [cleanUser, eId] });
        await turso.execute({ sql: 'DELETE FROM progress WHERE username = ? AND exam_id = ?', args: [cleanUser, eId] });
      } else {
        await turso.execute({ sql: 'DELETE FROM submissions WHERE username = ?', args: [cleanUser] });
        await turso.execute({ sql: 'DELETE FROM progress WHERE username = ?', args: [cleanUser] });
      }
    } else {
      await db.withLock(async () => {
        const store = await db.fetchStore();
        if (eId) {
          store.submissions = (store.submissions || []).filter(s => !(s.username === cleanUser && s.examId === eId));
          if (store.progress) delete store.progress[`${cleanUser}_${eId}`];
        } else {
          store.submissions = (store.submissions || []).filter(s => s.username !== cleanUser);
          if (store.progress) {
            Object.keys(store.progress).forEach(k => {
              if (k.startsWith(`${cleanUser}_`)) delete store.progress[k];
            });
          }
        }
        await db.saveStore(store);
      });
    }

    res.json({ success: true, message: `Examen borrado exitosamente para ${cleanUser}.` });
  } catch (err) {
    console.error('Error al resetear examen:', err.message);
    res.status(500).json({ success: false, message: 'Error al borrar examen de la base de datos.' });
  }
});

// ────────────────────────────────────────────────────────
// GET /api/admin/debug?pin=xxx
// Diagnóstico: muestra los datos crudos de Turso
// ────────────────────────────────────────────────────────
router.get('/admin/debug', async (req, res) => {
  try {
    if (req.query.pin !== 'movers2026') {
      return res.status(401).json({ success: false, message: 'PIN incorrecto.' });
    }

    let turso = null;
    let tursoErr = null;
    try {
      turso = await db.getTursoClient();
    } catch (e) {
      tursoErr = e.message;
    }

    if (!turso) {
      return res.json({
        success: false,
        message: 'Sin conexión a Turso.',
        tursoConnected: false,
        tursoError: tursoErr || 'process.env.TURSO_DATABASE_URL está vacío o indefinido.',
        envVars: {
          hasUrl: !!process.env.TURSO_DATABASE_URL,
          hasToken: !!process.env.TURSO_AUTH_TOKEN
        }
      });
    }

    const [resStudents, resProgress, resSubmissions] = await Promise.all([
      turso.execute('SELECT id, username, assigned_exam_id FROM students ORDER BY id LIMIT 40'),
      turso.execute('SELECT id, username, exam_id, status, updated_at FROM progress ORDER BY id DESC LIMIT 40'),
      turso.execute('SELECT id, username, exam_id, auto_score, max_auto_score, status, submitted_at FROM submissions ORDER BY id DESC LIMIT 40')
    ]);

    // ── Test de escritura en progress
    let writeTest = { attempted: false, insertOk: false, readOk: false, deleteOk: false, error: null };
    // ── Test de escritura en submissions
    let writeTestSub = { insertOk: false, readOk: false, deleteOk: false, rowsAffected: null, error: null };
    try {
      writeTest.attempted = true;
      await turso.execute({
        sql: `INSERT OR IGNORE INTO progress (username, exam_id, raw_answers_json, status, updated_at)
              VALUES ('__debug_write_test__', 0, '{}', 'debug', ?)`,
        args: [new Date().toISOString()]
      });
      writeTest.insertOk = true;
      const readCheck = await turso.execute({
        sql: `SELECT id FROM progress WHERE username = '__debug_write_test__' LIMIT 1`,
        args: []
      });
      writeTest.readOk = readCheck.rows.length > 0;
      await turso.execute({ sql: `DELETE FROM progress WHERE username = '__debug_write_test__'`, args: [] });
      writeTest.deleteOk = true;
    } catch (writeErr) {
      writeTest.error = writeErr.message;
    }

    try {
      const subInsert = await turso.execute({
        sql: `INSERT OR IGNORE INTO submissions
              (username, exam_id, auto_score, max_auto_score, raw_answers_json, status, submitted_at)
              VALUES ('__debug_sub_test__', 0, 0, 0, '{}', 'debug', ?)`,
        args: [new Date().toISOString()]
      });
      writeTestSub.insertOk = true;
      writeTestSub.rowsAffected = subInsert.rowsAffected;
      const subRead = await turso.execute({
        sql: `SELECT id FROM submissions WHERE username = '__debug_sub_test__' LIMIT 1`,
        args: []
      });
      writeTestSub.readOk = subRead.rows.length > 0;
      await turso.execute({ sql: `DELETE FROM submissions WHERE username = '__debug_sub_test__'`, args: [] });
      writeTestSub.deleteOk = true;
    } catch (subErr) {
      writeTestSub.error = subErr.message;
    }

    res.json({
      success: true,
      tursoConnected: true,
      writeTest,
      writeTestSub,
      counts: {
        students: resStudents.rows.length,
        progress: resProgress.rows.length,
        submissions: resSubmissions.rows.length
      },
      submissions: resSubmissions.rows.map(r => ({
        id: String(r.id), username: r.username, examId: String(r.exam_id),
        autoScore: String(r.auto_score), maxAutoScore: String(r.max_auto_score),
        status: r.status, submittedAt: r.submitted_at
      })),
      progress: resProgress.rows.map(r => ({
        id: String(r.id), username: r.username, examId: String(r.exam_id), status: r.status
      }))
    });
  } catch (err) {
    console.error('Error en debug admin:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
