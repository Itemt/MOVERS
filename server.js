const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

// Cargar almacenamiento
require('./config/db');

const webRoutes = require('./routes/webRoutes');
const apiRoutes = require('./routes/apiRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Enrutadores
app.use('/', webRoutes);
app.use('/api', apiRoutes);

// Manejo de 404
app.use((req, res) => {
  res.status(404).send(`
    <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
      <h1>404 - Página no encontrada</h1>
      <p>La ruta requerida no existe en el examen Movers A1.</p>
      <a href="/" style="color: #0284c7; font-weight: bold;">Volver al Inicio</a>
    </div>
  `);
});

// Manejo global de errores
app.use((err, req, res, next) => {
  console.error('❌ Error en el servidor Movers:', err);
  res.status(500).json({ success: false, message: 'Error interno en el servidor.' });
});

// Iniciar servidor Express
const server = app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Servidor Cambridge Movers (A1) corriendo en: http://localhost:${PORT}`);
  console.log(`🏫 Examen interactivo para 4to Grado.`);
  console.log(`🔑 PIN de Panel de Administración: "movers2026"`);
  console.log(`====================================================`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const ALT_PORT = 3001;
    console.log(`⚠️ Puerto ${PORT} ocupado. Usando puerto alternativo ${ALT_PORT}...`);
    app.listen(ALT_PORT, () => {
      console.log(`====================================================`);
      console.log(`🚀 Servidor Cambridge Movers (A1) corriendo en: http://localhost:${ALT_PORT}`);
      console.log(`====================================================`);
    });
  } else {
    console.error('❌ Error de servidor:', err);
  }
});
