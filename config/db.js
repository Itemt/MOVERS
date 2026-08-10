const fs = require('fs');
const path = require('path');

// ============================================================
// Motor de Base de Datos Movers A1
// - En Vercel / Cloud con TURSO_DATABASE_URL: Conecta con Turso (libSQL)
// - En Local sin Turso: Usa archivo de respaldo JSON local en /tmp
// ============================================================

let tursoClient = null;

// Inicialización de Turso si existe variable de entorno
async function getTursoClient() {
  if (tursoClient) return tursoClient;
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (!tursoUrl) return null;

  try {
    const { createClient } = require('@libsql/client');
    tursoClient = createClient({
      url: tursoUrl,
      authToken: tursoToken || undefined
    });

    // Crear tablas en Turso si no existen
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        grade TEXT NOT NULL,
        username TEXT UNIQUE,
        assigned_exam_id INTEGER DEFAULT 1,
        last_login_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        exam_id INTEGER NOT NULL,
        raw_answers_json TEXT NOT NULL DEFAULT '{}',
        status TEXT DEFAULT 'in_progress',
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(username, exam_id)
      );
    `);

    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        exam_id INTEGER NOT NULL,
        auto_score INTEGER DEFAULT 0,
        max_auto_score INTEGER DEFAULT 0,
        raw_answers_json TEXT NOT NULL DEFAULT '{}',
        status TEXT DEFAULT 'submitted',
        submitted_at TEXT DEFAULT (datetime('now'))
      );
    `);

    console.log('✅ Base de Datos Turso (libSQL Cloud) conectada y lista.');
    return tursoClient;
  } catch (err) {
    console.error('⚠️ No se pudo conectar a Turso, usando motor de respaldo local:', err.message);
    return null;
  }
}

// Fallback Local JSON Store
const tmpJsonPath = '/tmp/movers_data.json';
const backupJsonPath = path.join(__dirname, '../data/movers_backup.json');

global.moversMemoryStore = global.moversMemoryStore || null;
global._moversLock = global._moversLock || Promise.resolve();

async function withLock(fn) {
  let release;
  const acquired = new Promise(r => { release = r; });
  const prev = global._moversLock;
  global._moversLock = acquired;
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

function getInitialStudents() {
  try {
    const studentsPath = path.join(__dirname, '../data/students_4to.json');
    if (fs.existsSync(studentsPath)) {
      return JSON.parse(fs.readFileSync(studentsPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error cargando lista inicial de alumnos:', e);
  }
  return [];
}

async function fetchStore() {
  const client = await getTursoClient();

  if (client) {
    // Cargar datos desde Turso
    try {
      const resStudents = await client.execute('SELECT * FROM students ORDER BY grade ASC, last_name ASC');
      const resProgress = await client.execute('SELECT * FROM progress');
      const resSubmissions = await client.execute('SELECT * FROM submissions');

      const students = resStudents.rows.map(r => ({
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        grade: r.grade,
        username: r.username,
        assignedExamId: r.assigned_exam_id || 1,
        lastLogin: r.last_login_at
      }));

      const progressMap = {};
      resProgress.rows.forEach(r => {
        const key = `${r.username}_${r.exam_id}`;
        try {
          progressMap[key] = {
            answers: JSON.parse(r.raw_answers_json || '{}'),
            updatedAt: r.updated_at,
            status: r.status
          };
        } catch (e) {}
      });

      const submissions = resSubmissions.rows.map(r => {
        let answers = {};
        try { answers = JSON.parse(r.raw_answers_json || '{}'); } catch (e) {}
        return {
          id: r.id,
          username: r.username,
          examId: r.exam_id,
          autoScore: r.auto_score,
          maxAutoScore: r.max_auto_score,
          answers,
          submittedAt: r.submitted_at,
          status: r.status
        };
      });

      return { students, progress: progressMap, submissions };
    } catch (err) {
      console.error('Error leyendo datos de Turso:', err.message);
    }
  }

  // Fallback local en memoria / JSON
  if (global.moversMemoryStore) {
    return global.moversMemoryStore;
  }

  try {
    if (fs.existsSync(tmpJsonPath)) {
      const parsed = JSON.parse(fs.readFileSync(tmpJsonPath, 'utf8'));
      if (parsed && Array.isArray(parsed.students)) {
        global.moversMemoryStore = parsed;
        return parsed;
      }
    }
  } catch (e) {}

  try {
    if (fs.existsSync(backupJsonPath)) {
      const parsed = JSON.parse(fs.readFileSync(backupJsonPath, 'utf8'));
      if (parsed && Array.isArray(parsed.students)) {
        global.moversMemoryStore = parsed;
        return parsed;
      }
    }
  } catch (e) {}

  const initialData = {
    students: getInitialStudents(),
    progress: {},
    submissions: []
  };

  global.moversMemoryStore = initialData;
  return initialData;
}

async function saveStore(data) {
  global.moversMemoryStore = data;

  try { fs.writeFileSync(tmpJsonPath, JSON.stringify(data, null, 2), 'utf8'); } catch (e) {}
  try { fs.writeFileSync(backupJsonPath, JSON.stringify(data, null, 2), 'utf8'); } catch (e) {}
}

module.exports = {
  fetchStore,
  saveStore,
  withLock,
  getTursoClient
};
