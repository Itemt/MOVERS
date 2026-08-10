/**
 * Script para Sembrar/Migrar Estudiantes de 4to A y 4to B a la base de datos de Turso
 * 
 * Uso:
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node scripts/seed-turso.js
 */

require('dotenv').config();
const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');

async function seed() {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (!tursoUrl) {
    console.error('❌ ERROR: TURSO_DATABASE_URL no está configurada.');
    console.error('   Ejecuta: TURSO_DATABASE_URL=libsql://tu-db TURSO_AUTH_TOKEN=tu-token node scripts/seed-turso.js');
    process.exit(1);
  }

  console.log('🚀 Conectando a Turso Database...');
  const client = createClient({
    url: tursoUrl,
    authToken: tursoToken || undefined
  });

  console.log('📦 Creando tablas en Turso...');
  await client.execute(`
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

  await client.execute(`
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

  await client.execute(`
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

  console.log('🌱 Insertando alumnos de 4A y 4B...');
  const studentsPath = path.join(__dirname, '../data/students_4to.json');
  const students = JSON.parse(fs.readFileSync(studentsPath, 'utf8'));

  let insertedCount = 0;
  for (const st of students) {
    try {
      await client.execute({
        sql: `
          INSERT INTO students (id, first_name, last_name, grade, username, assigned_exam_id)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(username) DO UPDATE SET
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            grade = excluded.grade,
            assigned_exam_id = excluded.assigned_exam_id
        `,
        args: [st.id, st.firstName, st.lastName, st.grade, st.username, st.assignedExamId || 1]
      });
      insertedCount++;
    } catch (e) {
      console.warn(`⚠️ Error insertando ${st.username}:`, e.message);
    }
  }

  console.log(`🎉 ¡Éxito! Se sincronizaron ${insertedCount} estudiantes de 4A y 4B en la base de datos de Turso.`);
}

seed().catch(err => {
  console.error('❌ Error en el proceso:', err);
});
