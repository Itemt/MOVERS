const express = require('express');
const router = express.Router();
const path = require('path');

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/index.html'));
});

router.get('/exam', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/exam.html'));
});

router.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/admin.html'));
});

module.exports = router;
