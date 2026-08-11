document.addEventListener('DOMContentLoaded', () => {
  let currentStudent = null;
  let currentExamId = 1;
  let examData = null;
  let autoSaveInterval = null;
  let examIsSubmitted = false;
  let timerInterval = null;
  const EXAM_DURATION_FALLBACK_MINS = 80; // fallback si el JSON no tiene durationMinutes

  // ── Verificar login ──────────────────────────────────────────
  const rawStudent = localStorage.getItem('movers_student');
  if (!rawStudent) {
    window.location.href = '/';
    return;
  }
  currentStudent = JSON.parse(rawStudent);
  currentExamId = currentStudent.assignedExamId || 1;

  setupStudentHeader();
  loadExam(currentExamId);

  // ── Encabezado del estudiante ────────────────────────────────
  function setupStudentHeader() {
    document.getElementById('student-display-name').textContent = currentStudent.fullName;
    document.getElementById('student-display-grade').textContent =
      `${currentStudent.grade || '4to Grado'} · Practice Test ${currentExamId}`;
    const initials = (
      (currentStudent.firstName?.[0] || '') +
      (currentStudent.lastName?.[0] || '')
    ).toUpperCase();
    document.getElementById('avatar-initials').textContent = initials;
  }

  // ── Cargar examen ────────────────────────────────────────────
  async function loadExam(examId) {
    const container = document.getElementById('exam-questions-container');
    container.innerHTML = `
      <div style="text-align:center;padding:60px;color:var(--text-muted);">
        <div style="font-size:2.5rem;margin-bottom:12px;">⏳</div>
        Cargando examen…
      </div>`;

    try {
      const res = await fetch(`/api/exams/${examId}`);
      const data = await res.json();
      if (!data.success || !data.exam) {
        container.innerHTML = '<div style="color:var(--danger);text-align:center;padding:40px;">❌ Error al cargar el examen.</div>';
        return;
      }

      examData = data.exam;
      document.getElementById('exam-title-text').textContent =
        `${examData.title} — ${currentStudent.grade}`;

      renderExamParts(examData);

      // Verificar progreso/estado previo
      await checkAndRestoreProgress(currentStudent.username, examId);

    } catch (err) {
      console.error('Error cargando examen:', err);
      container.innerHTML = '<div style="color:var(--danger);text-align:center;padding:40px;">❌ Error de conexión. Recarga la página.</div>';
    }
  }

  // ── Verificar y restaurar progreso ──────────────────────────
  async function checkAndRestoreProgress(username, examId) {
    try {
      const res = await fetch(`/api/progress/${username}/${examId}`);
      const data = await res.json();

      if (!data.success) return;

      if (data.status === 'submitted') {
        // Examen ya entregado → mostrar modo lectura
        examIsSubmitted = true;
        setSubmittedMode(data.progress);
        return;
      }

      if (data.hasProgress && data.progress?.answers && Object.keys(data.progress.answers).length > 0) {
        fillAnswers(data.progress.answers);
        const timeAgo = data.progress.updatedAt
          ? `(guardado el ${new Date(data.progress.updatedAt).toLocaleString('es-CO')})`
          : '';
        showToast(`🔄 Progreso restaurado ${timeAgo}`);
      }

      // Iniciar autosave y temporizador solo si el examen no fue entregado
      startAutoSave();
      startTimer();

    } catch (err) {
      console.error('Error verificando progreso:', err);
      // Si falla la verificación, igual iniciar el examen normalmente
      startAutoSave();
      startTimer();
    }
  }

  // ── Modo "ya entregado" ─────────────────────────────────────
  function setSubmittedMode(progressData) {
    // Mostrar banner
    const banner = document.getElementById('submitted-banner');
    banner.style.display = 'block';

    if (progressData?.autoScore != null) {
      document.getElementById('submitted-score').textContent =
        `${progressData.autoScore} / ${progressData.maxAutoScore} correctas`;
    }

    // Restaurar respuestas en modo lectura
    if (progressData?.answers) {
      fillAnswers(progressData.answers);
    }

    // Deshabilitar inputs y botones
    document.querySelectorAll('#movers-exam-form input').forEach(el => {
      el.disabled = true;
    });
    document.getElementById('action-bar').style.display = 'none';
    document.getElementById('timer-display').style.display = 'none';
  }

  // ── Temporizador ─────────────────────────────────────────────
  function startTimer() {
    const durationMins = examData?.durationMinutes || EXAM_DURATION_FALLBACK_MINS;
    let remaining = durationMins * 60;
    const display = document.getElementById('timer-clock');

    function updateDisplay() {
      const m = Math.floor(remaining / 60).toString().padStart(2, '0');
      const s = (remaining % 60).toString().padStart(2, '0');
      display.textContent = `${m}:${s}`;

      const box = document.getElementById('timer-display');
      if (remaining <= 300) { // últimos 5 min
        box.style.background = '#fef2f2';
        box.style.color = '#dc2626';
        box.style.borderColor = '#fca5a5';
      } else if (remaining <= 600) { // últimos 10 min
        box.style.background = '#fff7ed';
        box.style.color = '#d97706';
      }
    }

    updateDisplay();
    timerInterval = setInterval(() => {
      remaining--;
      updateDisplay();
      if (remaining <= 0) {
        clearInterval(timerInterval);
        display.textContent = '00:00';
        // Guardar progreso automáticamente cuando se acaba el tiempo
        autoSaveProgress().then(() => {
          showToast('⏰ ¡Tiempo agotado! Tu progreso fue guardado. Puedes retomarlo luego.');
        });
      }
    }, 1000);
  }

  // ── Auto-guardado cada 60 segundos ──────────────────────────
  function startAutoSave() {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    autoSaveInterval = setInterval(async () => {
      if (!examIsSubmitted) {
        await autoSaveProgress(true); // silencioso
      }
    }, 60000);
  }

  async function autoSaveProgress(silent = false) {
    const answers = collectAnswers();
    if (Object.keys(answers).length === 0 && silent) return;

    try {
      const res = await fetch('/api/progress/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentStudent.username, examId: currentExamId, answers })
      });
      const data = await res.json();

      if (data.alreadySubmitted) {
        clearInterval(autoSaveInterval);
        clearInterval(timerInterval);
        if (!silent) showToast('ℹ️ Este examen ya fue entregado anteriormente.');
        return;
      }

      if (data.success) {
        if (!silent) {
          showToast('💾 ¡Progreso guardado correctamente!');
        } else {
          // Mostrar barra sutil de autosave
          const bar = document.getElementById('autosave-bar');
          document.getElementById('autosave-time').textContent = new Date().toLocaleTimeString('es-CO');
          bar.style.display = 'block';
          setTimeout(() => { bar.style.display = 'none'; }, 4000);
        }
      } else {
        if (!silent) {
          showToast('⚠️ Error al guardar: ' + (data.message || 'Intenta de nuevo.'));
        }
      }
    } catch (err) {
      console.error('Error en autosave:', err);
      if (!silent) {
        showToast('❌ Error de conexión al guardar el progreso.');
      }
    }
  }

  // ── Renderizado del examen ───────────────────────────────────
  function renderExamParts(exam) {
    const container = document.getElementById('exam-questions-container');
    let html = '';

    const imgMarkup = (url) => url ? `
      <div style="text-align:center;margin:16px 0 24px;">
        <img src="${url}" alt="Cambridge Movers Scene"
          style="width:100%;max-width:720px;height:auto;border-radius:12px;border:2px solid #cbd5e1;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
      </div>` : '';

    // ── Part 1 ──────────────────────────────────────────────────
    if (exam.parts.part1) {
      const p = exam.parts.part1;
      html += `
        <div class="card">
          <div class="part-header"><h3>${p.title}</h3><p>${p.instruction}</p></div>
          ${imgMarkup(p.imageUrl)}
          <div class="word-bank-container">
            ${p.wordBank.map(w => `<div class="word-item"><span>${w.emoji || '📌'}</span> <span>${w.word}</span></div>`).join('')}
          </div>
          <div style="background:#f1f5f9;padding:12px 16px;border-radius:var(--radius-md);margin-bottom:20px;font-size:0.95rem;border-left:4px solid var(--primary);">
            <strong>Example:</strong> ${p.example.text} ➔ <u style="color:var(--primary);font-weight:700;">${p.example.answer}</u>
          </div>
          ${p.questions.map(q => `
            <div class="question-row">
              <div class="question-text">${q.num}. ${q.text}</div>
              <input type="text" name="${q.id}" id="${q.id}" class="input-field" placeholder="Escribe tu respuesta aquí…" autocomplete="off">
            </div>`).join('')}
        </div>`;
    }

    // ── Part 2 ──────────────────────────────────────────────────
    if (exam.parts.part2) {
      const p = exam.parts.part2;
      html += `
        <div class="card">
          <div class="part-header"><h3>${p.title}</h3><p>${p.instruction}</p></div>
          ${imgMarkup(p.imageUrl)}
          <div style="background:#f1f5f9;padding:12px 16px;border-radius:var(--radius-md);margin-bottom:20px;font-size:0.95rem;border-left:4px solid var(--primary);">
            <strong>Example:</strong><br>
            ${p.example.speaker ? `<strong>${p.example.speaker}:</strong> ${p.example.question}<br>` : ''}
            ${p.example.options ? p.example.options.join('<br>') : ''}
            <br>➔ <u style="color:var(--primary);font-weight:700;">Answer: ${p.example.answer}</u>
          </div>
          ${p.questions.map(q => `
            <div class="question-row">
              <div class="question-text">${q.num}. ${q.speaker ? `<strong>${q.speaker}:</strong> ` : ''}${q.question || q.text}</div>
              <div class="mcq-options">
                ${q.options.map(opt => {
                  const letter = opt.substring(0, 1);
                  return `<label class="mcq-option-label">
                    <input type="radio" name="${q.id}" id="${q.id}_${letter}" value="${letter}">
                    <span>${opt}</span>
                  </label>`;
                }).join('')}
              </div>
            </div>`).join('')}
        </div>`;
    }

    // ── Part 3 ──────────────────────────────────────────────────
    if (exam.parts.part3) {
      const p = exam.parts.part3;
      html += `
        <div class="card">
          <div class="part-header"><h3>${p.title}</h3><p>${p.instruction}</p></div>
          ${imgMarkup(p.imageUrl)}
          ${p.wordBox ? `<div class="word-bank-container">
            ${p.wordBox.map(w => `<div class="word-item"><span>${w.emoji || '📌'}</span> <span>${w.word}</span></div>`).join('')}
          </div>` : ''}
          ${p.storyText ? `
            <div style="font-size:1.05rem;line-height:1.9;background:#fff;border:1px solid var(--border);padding:22px;border-radius:var(--radius-md);margin-bottom:22px;">
              ${p.storyText}
            </div>` : ''}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px;">
            ${p.questions.map(q => `
              <div>
                <label style="font-weight:700;font-size:0.9rem;">( ${q.num} ) Write the missing word:</label>
                <input type="text" name="${q.id}" id="${q.id}" class="input-field" placeholder="Escribe tu respuesta aquí…" autocomplete="off">
              </div>`).join('')}
          </div>
          ${p.titleQuestion ? `
            <div class="question-row" style="background:#f8fafc;">
              <div class="question-text"><strong>(${p.titleQuestion.num || (p.questions.length + 1)}) ${p.titleQuestion.question}</strong></div>
              <div class="mcq-options">
                ${p.titleQuestion.options.map(opt => `
                  <label class="mcq-option-label">
                    <input type="radio" name="${p.titleQuestion.id}" id="${p.titleQuestion.id}_${opt.replace(/\s/g,'_')}" value="${opt}">
                    <span>${opt}</span>
                  </label>`).join('')}
              </div>
            </div>` : ''}
        </div>`;
    }

    // ── Part 4 ──────────────────────────────────────────────────
    if (exam.parts.part4) {
      const p = exam.parts.part4;
      html += `
        <div class="card">
          <div class="part-header"><h3>${p.title}</h3><p>${p.instruction}</p></div>
          ${imgMarkup(p.imageUrl)}
          ${p.titleText ? `<h4 style="font-size:1.2rem;color:var(--dark);margin-bottom:12px;">${p.titleText}</h4>` : ''}
          ${(p.paragraphs || p.storyText) ? `
            <div style="font-size:1.05rem;line-height:1.9;background:#fff;border:1px solid var(--border);padding:22px;border-radius:var(--radius-md);margin-bottom:20px;">
              ${p.storyText
                ? p.storyText
                : p.paragraphs.map(par => `<p style="margin-bottom:12px;">${par}</p>`).join('')}
            </div>` : ''}
          ${p.questions.map(q => `
            <div class="question-row">
              <div class="question-text"><strong>( ${q.num} ) Choose the correct word:</strong></div>
              <div style="display:flex;gap:16px;flex-wrap:wrap;">
                ${q.options.map(opt => `
                  <label class="mcq-option-label" style="flex:1;min-width:100px;">
                    <input type="radio" name="${q.id}" id="${q.id}_${opt}" value="${opt}">
                    <span>${opt}</span>
                  </label>`).join('')}
              </div>
            </div>`).join('')}
        </div>`;
    }

    // ── Part 5 ──────────────────────────────────────────────────
    if (exam.parts.part5) {
      const p = exam.parts.part5;
      html += `
        <div class="card">
          <div class="part-header"><h3>${p.title}</h3><p>${p.instruction}</p></div>
          ${imgMarkup(p.imageUrl)}
          <h4 style="font-size:1.25rem;color:var(--dark);margin-bottom:14px;">${p.storyTitle}</h4>
          ${p.storyPassages.map(pass => `
            <div style="background:#f8fafc;border:1px solid var(--border);border-radius:var(--radius-md);padding:18px;margin-bottom:14px;">
              <p style="font-size:1.05rem;line-height:1.8;color:var(--dark);margin:0;">${pass.text}</p>
            </div>`).join('')}
          ${p.questions.map(q => `
            <div class="question-row">
              <div class="question-text">${q.num}. ${q.text}</div>
              <input type="text" name="${q.id}" id="${q.id}" class="input-field" placeholder="Escribe tu respuesta aquí…" autocomplete="off">
            </div>`).join('')}
        </div>`;
    }

    // ── Part 6 ──────────────────────────────────────────────────
    if (exam.parts.part6) {
      const p = exam.parts.part6;
      html += `
        <div class="card">
          <div class="part-header"><h3>${p.title}</h3><p>${p.instruction}</p></div>`;

      if (p.scenes && p.scenes.length > 0) {
        p.scenes.forEach((sc, idx) => {
          html += `
            <div style="${idx > 0 ? 'margin-top:36px;padding-top:28px;border-top:2px dashed #cbd5e1;' : ''}">
              ${sc.title ? `<h4 style="font-size:1.2rem;color:var(--primary);margin-bottom:12px;font-weight:700;">${sc.title}</h4>` : ''}
              ${imgMarkup(sc.imageUrl)}
              ${sc.promptText ? `<p style="font-size:1rem;color:var(--text-muted);text-align:center;margin-bottom:20px;font-weight:600;">${sc.promptText}</p>` : ''}
              ${(sc.questions || []).map(q => `
                <div class="question-row">
                  <div class="question-text">${q.num}. ${q.text}</div>
                  <input type="text" name="${q.id}" id="${q.id}" class="input-field"
                    placeholder="${q.placeholder || 'Escribe tu respuesta aquí…'}" autocomplete="off">
                </div>`).join('')}
            </div>`;
        });
      } else {
        html += `
          ${imgMarkup(p.imageUrl)}
          ${p.promptText ? `<p style="font-size:1rem;color:var(--text-muted);text-align:center;margin-bottom:20px;font-weight:600;">${p.promptText}</p>` : ''}
          ${(p.questions || []).map(q => `
            <div class="question-row">
              <div class="question-text">${q.num}. ${q.text}</div>
              <input type="text" name="${q.id}" id="${q.id}" class="input-field"
                placeholder="${q.placeholder || 'Escribe tu respuesta aquí…'}" autocomplete="off">
            </div>`).join('')}`;
      }

      html += `</div>`;
    }

    container.innerHTML = html;
  }

  // ── Collect / Fill answers ───────────────────────────────────
  function collectAnswers() {
    const form = document.getElementById('movers-exam-form');
    const answers = {};
    new FormData(form).forEach((val, key) => {
      if (val.trim()) answers[key] = val.trim();
    });
    return answers;
  }

  function fillAnswers(answers) {
    if (!answers) return;
    Object.keys(answers).forEach(id => {
      const val = answers[id];
      document.querySelectorAll(`[name="${id}"]`).forEach(el => {
        if (el.type === 'radio') { if (el.value === val) el.checked = true; }
        else el.value = val;
      });
    });
  }

  // ── Botón: Guardar Progreso ──────────────────────────────────
  document.getElementById('btn-save-progress').addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-progress');
    btn.disabled = true;
    btn.textContent = '⏳ Guardando…';
    await autoSaveProgress(false);
    btn.disabled = false;
    btn.textContent = '💾 Guardar Progreso';
  });

  // ── Botón: Entregar Examen ───────────────────────────────────
  document.getElementById('btn-submit-exam').addEventListener('click', async () => {
    if (examIsSubmitted) return;

    const answers = collectAnswers();
    const totalQuestions = document.querySelectorAll('#movers-exam-form input').length;
    const answeredCount = Object.keys(answers).length;

    let confirmMsg;
    if (answeredCount < Math.floor(totalQuestions * 0.5)) {
      confirmMsg = `⚠️ Solo has respondido ${answeredCount} de ${totalQuestions} preguntas.\n¿Estás seguro de que deseas entregar? No podrás modificarlo después.`;
    } else {
      confirmMsg = `📥 ¿Confirmas que deseas entregar tu examen a tu profesor?\nHas respondido ${answeredCount} de ${totalQuestions} preguntas.`;
    }

    if (!confirm(confirmMsg)) return;

    const btn = document.getElementById('btn-submit-exam');
    btn.disabled = true;
    btn.textContent = '⏳ Entregando…';

    try {
      const res = await fetch('/api/exams/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentStudent.username, examId: currentExamId, answers })
      });
      const data = await res.json();

      if (data.alreadySubmitted) {
        alert('Este examen ya fue entregado anteriormente. Recarga la página para ver tus respuestas.');
        window.location.reload();
        return;
      }

      if (data.success) {
        clearInterval(autoSaveInterval);
        clearInterval(timerInterval);
        examIsSubmitted = true;
        document.getElementById('res-total-score').textContent = `${data.autoScore} / ${data.maxAutoScore}`;
        document.getElementById('results-modal').style.display = 'flex';
      } else {
        alert(data.message || 'Error al entregar el examen. Intenta de nuevo.');
        btn.disabled = false;
        btn.textContent = '📥 Entregar Examen';
      }
    } catch (err) {
      console.error('Error entregando examen:', err);
      alert('Error de conexión. Guarda tu progreso y vuelve a intentarlo.');
      btn.disabled = false;
      btn.textContent = '📥 Entregar Examen';
    }
  });

  // ── Toast ────────────────────────────────────────────────────
  function showToast(msg) {
    const toast = document.getElementById('toast-msg');
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 4000);
  }

  // ── Guardar al cerrar la ventana/tab ────────────────────────
  window.addEventListener('beforeunload', () => {
    if (!examIsSubmitted) {
      const answers = collectAnswers();
      if (Object.keys(answers).length > 0) {
        // Usar sendBeacon para garantizar la petición aunque se cierre la pestaña
        const payload = JSON.stringify({ username: currentStudent.username, examId: currentExamId, answers });
        navigator.sendBeacon('/api/progress/save', new Blob([payload], { type: 'application/json' }));
      }
    }
  });
});
