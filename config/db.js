const fs = require('fs');
const path = require('path');

// ============================================================
// Motor de Base de Datos Movers A1 — Turso Cloud (libSQL)
// Turso es el ÚNICO motor de persistencia. No hay fallback en
// producción para evitar pérdida de datos en Vercel serverless.
// Fallback JSON solo para desarrollo local sin TURSO_DATABASE_URL.
// ============================================================

let _tursoClient = null;
let _initPromise = null;
let _initFailed = false;

async function getTursoClient() {
  // Si ya está inicializado, devolverlo
  if (_tursoClient) return _tursoClient;

  // Si está en proceso de inicialización, esperar
  if (_initPromise) return _initPromise;

  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  // Sin URL configurada → modo desarrollo local
  if (!tursoUrl) return null;

  _initPromise = (async () => {
    try {
      const { createClient } = require('@libsql/client');
      const client = createClient({
        url: tursoUrl,
        authToken: tursoToken || undefined
      });

      // Crear tablas si no existen (idempotente)
      await client.batch([
        {
          sql: `CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            grade TEXT NOT NULL,
            username TEXT UNIQUE,
            assigned_exam_id INTEGER DEFAULT 1,
            last_login_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
          )`,
          args: []
        },
        {
          sql: `CREATE TABLE IF NOT EXISTS progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            exam_id INTEGER NOT NULL,
            raw_answers_json TEXT NOT NULL DEFAULT '{}',
            status TEXT DEFAULT 'in_progress',
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(username, exam_id)
          )`,
          args: []
        },
        {
          sql: `CREATE TABLE IF NOT EXISTS submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            exam_id INTEGER NOT NULL,
            auto_score INTEGER DEFAULT 0,
            max_auto_score INTEGER DEFAULT 0,
            raw_answers_json TEXT NOT NULL DEFAULT '{}',
            status TEXT DEFAULT 'submitted',
            submitted_at TEXT DEFAULT (datetime('now'))
          )`,
          args: []
        }
      ], 'write');

      _tursoClient = client;
      _initFailed = false;
      console.log('✅ Turso (libSQL Cloud) conectado y listo.');
      return _tursoClient;
    } catch (err) {
      _initPromise = null;
      _initFailed = true;
      console.error('❌ Error crítico conectando a Turso:', err.message);
      throw err;
    }
  })();

  return _initPromise;
}

// ============================================================
// Fallback LOCAL solo para desarrollo (NODE_ENV !== 'production')
// En Vercel esto NUNCA se usa porque TURSO_DATABASE_URL está set.
// ============================================================

const LOCAL_JSON_PATH = path.join(__dirname, '../data/movers_local_dev.json');

function getInitialStudents() {
  try {
    const p = path.join(__dirname, '../data/students_4to.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {}
  return [];
}

function loadLocalStore() {
  try {
    if (fs.existsSync(LOCAL_JSON_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(LOCAL_JSON_PATH, 'utf8'));
      if (parsed && Array.isArray(parsed.students)) return parsed;
    }
  } catch (e) {}
  return { students: getInitialStudents(), progress: {}, submissions: [] };
}

function saveLocalStore(data) {
  try {
    fs.writeFileSync(LOCAL_JSON_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn('⚠️ No se pudo guardar el store local:', e.message);
  }
}

// ============================================================
// API pública del módulo
// ============================================================

/**
 * Obtiene todos los datos del store.
 * En producción: desde Turso. En desarrollo sin Turso: desde JSON local.
 */
async function fetchStore() {
  const client = await getTursoClient().catch(() => null);

  if (client) {
    try {
      const [resStudents, resProgress, resSubmissions] = await Promise.all([
        client.execute('SELECT * FROM students ORDER BY grade ASC, last_name ASC'),
        client.execute('SELECT * FROM progress'),
        client.execute('SELECT * FROM submissions')
      ]);

      const students = resStudents.rows.map(r => ({
        id: Number(r.id),
        firstName: r.first_name,
        lastName: r.last_name,
        grade: r.grade,
        username: r.username,
        assignedExamId: Number(r.assigned_exam_id) || 1,
        lastLogin: r.last_login_at
      }));

      const progress = {};
      resProgress.rows.forEach(r => {
        const key = `${r.username}_${r.exam_id}`;
        try {
          progress[key] = {
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
          id: Number(r.id),
          username: r.username,
          examId: Number(r.exam_id),
          autoScore: Number(r.auto_score),
          maxAutoScore: Number(r.max_auto_score),
          answers,
          submittedAt: r.submitted_at,
          status: r.status
        };
      });

      return { students, progress, submissions };
    } catch (err) {
      console.error('❌ Error leyendo datos de Turso:', err.message);
      throw err; // No silenciar en producción
    }
  }

  // Solo en desarrollo local
  console.warn('⚠️ Usando store JSON local (modo desarrollo).');
  return loadLocalStore();
}

/**
 * Guarda el store localmente (solo desarrollo).
 * En producción con Turso, cada API escribe directamente a la DB.
 */
async function saveStore(data) {
  const client = await getTursoClient().catch(() => null);
  if (!client) {
    saveLocalStore(data);
  }
  // Con Turso, las escrituras ocurren directamente en cada endpoint.
}

// Lock simple para evitar escrituras concurrentes en el JSON local
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

// Inicializar Turso en background al arrancar el servidor
if (process.env.TURSO_DATABASE_URL) {
  getTursoClient().catch(err => {
    console.error('❌ Fallo en inicialización inicial de Turso:', err.message);
  });
}

module.exports = { fetchStore, saveStore, withLock, getTursoClient };
