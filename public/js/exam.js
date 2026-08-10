document.addEventListener('DOMContentLoaded', () => {
  let currentStudent = null;
  let currentExamId = 1;
  let examData = null;

  // Verificar login del alumno
  const rawStudent = localStorage.getItem('movers_student');
  if (!rawStudent) {
    window.location.href = '/';
    return;
  }

  currentStudent = JSON.parse(rawStudent);
  currentExamId = currentStudent.assignedExamId || 1;

  setupStudentHeader();
  initTestTabs();
  loadExam(currentExamId);

  function setupStudentHeader() {
    document.getElementById('student-display-name').textContent = currentStudent.fullName;
    document.getElementById('student-display-grade').textContent = `${currentStudent.grade || '4to Grado'} • Examen Asignado: Test ${currentExamId}`;
    const initials = (currentStudent.firstName[0] + (currentStudent.lastName ? currentStudent.lastName[0] : '')).toUpperCase();
    document.getElementById('avatar-initials').textContent = initials;
  }

  function initTestTabs() {
    const tabBtns = document.querySelectorAll('.test-tab-btn');
    tabBtns.forEach(btn => {
      const id = parseInt(btn.dataset.exam);
      if (id === currentExamId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }

      btn.addEventListener('click', () => {
        if (id !== currentExamId) {
          tabBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentExamId = id;
          loadExam(currentExamId);
        }
      });
    });
  }

  async function loadExam(examId) {
    const container = document.getElementById('exam-questions-container');
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">Cargando examen...</div>';

    try {
      const res = await fetch(`/api/exams/${examId}`);
      const data = await res.json();
      if (!data.success || !data.exam) {
        container.innerHTML = '<div style="color: var(--danger); text-align: center;">Error al cargar el examen.</div>';
        return;
      }

      examData = data.exam;
      document.getElementById('exam-title-text').textContent = `${examData.title} (${currentStudent.grade})`;
      renderExamParts(examData);

      // Cargar progreso guardado previo
      await checkAndRestoreProgress(currentStudent.username, examId);

    } catch (err) {
      console.error('Error cargando examen:', err);
      container.innerHTML = '<div style="color: var(--danger); text-align: center;">Error de conexión.</div>';
    }
  }

  function renderExamParts(exam) {
    const container = document.getElementById('exam-questions-container');
    let html = '';

    // Helper para renderizar imágenes reales
    const getImageMarkup = (url) => {
      if (!url) return '';
      return `
        <div style="text-align: center; margin: 16px 0 24px 0;">
          <img src="${url}" alt="Cambridge Movers Visual Scene" style="width: 100%; max-width: 750px; height: auto; border-radius: 12px; border: 2px solid #cbd5e1; box-shadow: 0 4px 15px rgba(0,0,0,0.06);">
        </div>
      `;
    };

    // Parte 1
    if (exam.parts.part1) {
      const p1 = exam.parts.part1;
      html += `
        <div class="card">
          <div class="part-header">
            <h3>${p1.title}</h3>
            <p>${p1.instruction}</p>
          </div>
          ${getImageMarkup(p1.imageUrl)}
          <div class="word-bank-container">
            ${p1.wordBank.map(w => `<div class="word-item"><span>${w.emoji || '📌'}</span> <span>${w.word}</span></div>`).join('')}
          </div>
          <div style="background: #f1f5f9; padding: 12px 16px; border-radius: var(--radius-md); margin-bottom: 20px; font-size: 0.95rem; border-left: 4px solid var(--primary);">
            <strong>Example:</strong> ${p1.example.text} ➔ <u style="color: var(--primary); font-weight: 700;">${p1.example.answer}</u>
          </div>
          ${p1.questions.map(q => `
            <div class="question-row">
              <div class="question-text">${q.num}. ${q.text}</div>
              <input type="text" name="${q.id}" class="input-field" placeholder="Write word on the line..." autocomplete="off">
            </div>
          `).join('')}
        </div>
      `;
    }

    // Parte 2
    if (exam.parts.part2) {
      const p2 = exam.parts.part2;
      html += `
        <div class="card">
          <div class="part-header">
            <h3>${p2.title}</h3>
            <p>${p2.instruction}</p>
          </div>
          ${getImageMarkup(p2.imageUrl)}
          ${p2.contextImage ? `<div style="font-size: 2.5rem; text-align: center; margin-bottom: 12px;">${p2.contextImage}</div>` : ''}
          <div style="background: #f1f5f9; padding: 12px 16px; border-radius: var(--radius-md); margin-bottom: 20px; font-size: 0.95rem; border-left: 4px solid var(--primary);">
            <strong>Example:</strong><br>
            ${p2.example.speaker ? `<strong>${p2.example.speaker}:</strong> ${p2.example.question}<br>` : ''}
            ${p2.example.text ? `${p2.example.text} ➔ <u style="color: var(--primary); font-weight: 700;">${p2.example.answer}</u><br>` : ''}
            ${p2.example.options ? p2.example.options.join('<br>') : ''}
          </div>
          ${p2.questions.map(q => `
            <div class="question-row">
              <div class="question-text">${q.num}. ${q.speaker ? `<strong>${q.speaker}:</strong> ` : ''}${q.question || q.text}</div>
              ${q.options ? `
                <div class="mcq-options">
                  ${q.options.map(opt => {
                    const letter = opt.substring(0, 1);
                    return `
                      <label class="mcq-option-label">
                        <input type="radio" name="${q.id}" value="${letter}">
                        <span>${opt}</span>
                      </label>
                    `;
                  }).join('')}
                </div>
              ` : `
                <input type="text" name="${q.id}" class="input-field" placeholder="Write yes or no..." autocomplete="off">
              `}
            </div>
          `).join('')}
        </div>
      `;
    }

    // Parte 3
    if (exam.parts.part3) {
      const p3 = exam.parts.part3;
      html += `
        <div class="card">
          <div class="part-header">
            <h3>${p3.title}</h3>
            <p>${p3.instruction}</p>
          </div>
          ${getImageMarkup(p3.imageUrl)}
          ${p3.wordBox ? `
            <div class="word-bank-container">
              ${p3.wordBox.map(w => `<div class="word-item"><span>${w.emoji || '📌'}</span> <span>${w.word}</span></div>`).join('')}
            </div>
          ` : ''}
          ${p3.storyText ? `
            <div style="font-size: 1.05rem; line-height: 1.8; background: #fff; border: 1px solid var(--border); padding: 20px; border-radius: var(--radius-md); margin-bottom: 20px;">
              ${p3.storyText}
            </div>
          ` : ''}
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 20px;">
            ${p3.questions.map(q => `
              <div>
                <label style="font-weight: 700; font-size: 0.9rem;">( ${q.num} ) ${q.speaker ? `<strong>${q.speaker}:</strong> ${q.question}` : 'Write word on line:'}</label>
                ${q.options ? `
                  <div class="mcq-options" style="margin-top: 6px;">
                    ${q.options.map(opt => {
                      const letter = opt.substring(0, 1);
                      return `
                        <label class="mcq-option-label">
                          <input type="radio" name="${q.id}" value="${letter}">
                          <span>${opt}</span>
                        </label>
                      `;
                    }).join('')}
                  </div>
                ` : `
                  <input type="text" name="${q.id}" class="input-field" placeholder="Word..." autocomplete="off">
                `}
              </div>
            `).join('')}
          </div>
          ${p3.titleQuestion ? `
            <div class="question-row" style="background: #f8fafc;">
              <div class="question-text"><strong>(6) ${p3.titleQuestion.question}</strong></div>
              <div class="mcq-options">
                ${p3.titleQuestion.options.map(opt => `
                  <label class="mcq-option-label">
                    <input type="radio" name="${p3.titleQuestion.id}" value="${opt}">
                    <span>${opt}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }

    // Parte 4
    if (exam.parts.part4) {
      const p4 = exam.parts.part4;
      html += `
        <div class="card">
          <div class="part-header">
            <h3>${p4.title}</h3>
            <p>${p4.instruction}</p>
          </div>
          ${getImageMarkup(p4.imageUrl)}
          ${p4.titleText ? `<h4 style="font-size: 1.2rem; color: var(--dark); margin-bottom: 12px;">${p4.titleText}</h4>` : ''}
          ${p4.paragraphs || p4.storyText ? `
            <div style="font-size: 1.05rem; line-height: 1.8; background: #fff; border: 1px solid var(--border); padding: 20px; border-radius: var(--radius-md); margin-bottom: 20px;">
              ${p4.storyText ? p4.storyText : p4.paragraphs.map(p => `<p style="margin-bottom: 12px;">${p}</p>`).join('')}
            </div>
          ` : ''}
          ${p4.questions.map(q => `
            <div class="question-row">
              <div class="question-text"><strong>( ${q.num} ) Select correct word for line:</strong></div>
              ${q.options ? `
                <div style="display: flex; gap: 16px; flex-wrap: wrap;">
                  ${q.options.map(opt => `
                    <label class="mcq-option-label" style="flex: 1; min-width: 100px;">
                      <input type="radio" name="${q.id}" value="${opt}">
                      <span>${opt}</span>
                    </label>
                  `).join('')}
                </div>
              ` : `
                <input type="text" name="${q.id}" class="input-field" placeholder="Word..." autocomplete="off">
              `}
            </div>
          `).join('')}
          ${p4.titleQuestion ? `
            <div class="question-row" style="background: #f8fafc; margin-top: 16px;">
              <div class="question-text"><strong>(7) ${p4.titleQuestion.question}</strong></div>
              <div class="mcq-options">
                ${p4.titleQuestion.options.map(opt => `
                  <label class="mcq-option-label">
                    <input type="radio" name="${p4.titleQuestion.id}" value="${opt}">
                    <span>${opt}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }

    // Parte 5
    if (exam.parts.part5) {
      const p5 = exam.parts.part5;
      html += `
        <div class="card">
          <div class="part-header">
            <h3>${p5.title}</h3>
            <p>${p5.instruction}</p>
          </div>
          ${getImageMarkup(p5.imageUrl)}
          <h4 style="font-size: 1.25rem; color: var(--dark); margin-bottom: 14px;">${p5.storyTitle}</h4>
          ${p5.storyPassages.map(pass => `
            <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 18px; margin-bottom: 16px;">
              ${pass.image ? `<div style="font-size: 2rem; margin-bottom: 8px;">${pass.image}</div>` : ''}
              <p style="font-size: 1.05rem; line-height: 1.7; color: var(--dark);">${pass.text}</p>
            </div>
          `).join('')}
          ${p5.questions.map(q => `
            <div class="question-row">
              <div class="question-text">${q.num}. ${q.text}</div>
              <input type="text" name="${q.id}" class="input-field" placeholder="Write 1, 2 or 3 words..." autocomplete="off">
            </div>
          `).join('')}
        </div>
      `;
    }

    // Parte 6 (Renderizado de Imagen real SVG/JPEG)
    if (exam.parts.part6) {
      const p6 = exam.parts.part6;
      html += `
        <div class="card">
          <div class="part-header">
            <h3>${p6.title}</h3>
            <p>${p6.instruction}</p>
          </div>
          ${getImageMarkup(p6.imageUrl)}
          ${p6.promptText ? `<p style="font-size: 1rem; color: var(--text-muted); text-align: center; margin-bottom: 20px; font-weight: 600;">${p6.promptText}</p>` : ''}
          ${p6.questions.map(q => `
            <div class="question-row">
              <div class="question-text">${q.num}. ${q.text}</div>
              ${q.options ? `
                <div style="display: flex; gap: 16px; flex-wrap: wrap;">
                  ${q.options.map(opt => `
                    <label class="mcq-option-label" style="flex: 1; min-width: 100px;">
                      <input type="radio" name="${q.id}" value="${opt}">
                      <span>${opt}</span>
                    </label>
                  `).join('')}
                </div>
              ` : `
                <input type="text" name="${q.id}" class="input-field" placeholder="${q.placeholder || 'Your answer...'}" autocomplete="off">
              `}
            </div>
          `).join('')}
        </div>
      `;
    }

    container.innerHTML = html;
  }

  function collectAnswers() {
    const form = document.getElementById('movers-exam-form');
    const formData = new FormData(form);
    const answers = {};

    for (let [key, val] of formData.entries()) {
      if (val.trim()) {
        answers[key] = val.trim();
      }
    }
    return answers;
  }

  function fillAnswers(answers) {
    if (!answers) return;
    Object.keys(answers).forEach(id => {
      const val = answers[id];
      const inputs = document.querySelectorAll(`[name="${id}"]`);
      inputs.forEach(input => {
        if (input.type === 'radio') {
          if (input.value === val) input.checked = true;
        } else {
          input.value = val;
        }
      });
    });
  }

  async function checkAndRestoreProgress(username, examId) {
    try {
      const res = await fetch(`/api/progress/${username}/${examId}`);
      const data = await res.json();
      if (data.success && data.hasProgress && data.progress.answers) {
        fillAnswers(data.progress.answers);
        showToast('🔄 ¡Se ha restaurado tu progreso previo!');
      }
    } catch (err) {
      console.error('Error restaurando progreso:', err);
    }
  }

  // Botón "GUARDAR PROGRESO"
  document.getElementById('btn-save-progress').addEventListener('click', async () => {
    const answers = collectAnswers();
    try {
      const res = await fetch('/api/progress/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentStudent.username,
          examId: currentExamId,
          answers
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('💾 ¡Progreso guardado exitosamente!');
      } else {
        alert('Ocurrió un problema al guardar el progreso.');
      }
    } catch (err) {
      console.error('Error guardando progreso:', err);
      alert('Error de conexión al guardar el progreso.');
    }
  });

  // Botón "ENTREGAR EXAMEN"
  document.getElementById('btn-submit-exam').addEventListener('click', async () => {
    const answers = collectAnswers();
    if (Object.keys(answers).length < 5) {
      if (!confirm('⚠️ Tienes muy pocas preguntas respondidas. ¿Estás seguro de que deseas entregar?')) {
        return;
      }
    } else {
      if (!confirm('📥 ¿Confirmas que deseas entregar tu examen final a tu profesor?')) {
        return;
      }
    }

    try {
      const res = await fetch('/api/exams/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentStudent.username,
          examId: currentExamId,
          answers
        })
      });

      const data = await res.json();
      if (data.success) {
        document.getElementById('res-total-score').textContent = `${data.autoScore}/${data.maxAutoScore}`;
        document.getElementById('results-modal').style.display = 'flex';
      } else {
        alert(data.message || 'Error al entregar examen.');
      }
    } catch (err) {
      console.error('Error entregando examen:', err);
      alert('Error de conexión al entregar el examen.');
    }
  });

  function showToast(msg) {
    const toast = document.getElementById('toast-msg');
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 3000);
  }
});
