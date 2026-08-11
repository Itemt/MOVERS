document.addEventListener('DOMContentLoaded', () => {
  const pinForm = document.getElementById('admin-pin-form');
  const pinInput = document.getElementById('admin-pin-input');
  const errorMsg = document.getElementById('pin-error-msg');
  const authCard = document.getElementById('admin-auth-card');
  const dashboardContent = document.getElementById('admin-dashboard-content');
  const refreshBtn = document.getElementById('btn-refresh-admin');
  const tableBody = document.getElementById('students-table-body');

  const tab4A = document.getElementById('tab-grade-4a');
  const tab4B = document.getElementById('tab-grade-4b');

  // Modal elements
  const answersModal = document.getElementById('answers-modal');
  const modalStudentName = document.getElementById('modal-student-name');
  const modalStudentMeta = document.getElementById('modal-student-meta');
  const modalAnswersBody = document.getElementById('modal-answers-body');
  const btnCloseModal1 = document.getElementById('btn-close-answers-modal');
  const btnCloseModal2 = document.getElementById('btn-close-modal-footer');

  let currentPin = '';
  let allStudentsData = [];
  let currentGradeFilter = '4to A';
  const examsCache = {};
  let autoRefreshInterval = null;
  let nextRefreshIn = 20;

  // Normalización y tolerancia avanzada para comprobación en vista admin
  function normalizeAnswer(str) {
    if (!str) return '';
    let clean = String(str).trim().toLowerCase();
    clean = clean.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    clean = clean.replace(/[\s.,!?;:'"/\-\\_()+]+/g, ' ').trim();
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
          matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
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

      if (rawUser === rawTarget || normUser === normTarget) return true;
      if (normUser && normTarget && stripPlural(normUser) === stripPlural(normTarget)) return true;

      if (normUser && normTarget) {
        const dist = levenshteinDistance(normUser, normTarget);
        const maxAllowedDist = normTarget.length >= 7 ? 2 : (normTarget.length >= 4 ? 1 : 0);
        if (dist <= maxAllowedDist) return true;
      }

      return false;
    });
  }

  async function getExamData(examId) {
    if (examsCache[examId]) return examsCache[examId];
    try {
      const res = await fetch(`/api/exams/${examId}`);
      const data = await res.json();
      if (data.success && data.exam) {
        examsCache[examId] = data.exam;
        return data.exam;
      }
    } catch (err) {
      console.error('Error cargando examen para modal admin:', err);
    }
    return null;
  }

  pinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    currentPin = pinInput.value.trim();
    loadDashboard(currentPin);
  });

  refreshBtn.addEventListener('click', () => {
    if (currentPin) {
      nextRefreshIn = 20;
      loadDashboard(currentPin);
    }
  });

  tab4A.addEventListener('click', () => {
    currentGradeFilter = '4to A';
    tab4A.className = 'btn btn-primary';
    tab4B.className = 'btn btn-outline';
    renderTable();
  });

  tab4B.addEventListener('click', () => {
    currentGradeFilter = '4to B';
    tab4B.className = 'btn btn-primary';
    tab4A.className = 'btn btn-outline';
    renderTable();
  });

  const btnModalDelete = document.getElementById('btn-modal-delete-exam');
  let currentModalStudent = null;

  async function resetStudentExam(username, name, examId) {
    const confirmMsg = `⚠️ ¿Confirmas que deseas BORRAR de la base de datos el examen y progreso de:\n\n👤 ${name} (${username})\n📝 Practice Test ${examId}\n\nEl alumno podrá realizar el examen nuevamente desde cero.`;
    if (!confirm(confirmMsg)) return;

    try {
      const res = await fetch('/api/admin/reset-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: currentPin, username, examId })
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ Examen borrado correctamente para ${name}.`);
        closeModal();
        loadDashboard(currentPin);
      } else {
        alert(`⚠️ ${data.message || 'Error al borrar el examen.'}`);
      }
    } catch (err) {
      console.error('Error borrando examen:', err);
      alert('Error de conexión al intentar borrar el examen.');
    }
  }

  // Delegación de eventos para la tabla
  tableBody.addEventListener('click', (e) => {
    const btnView = e.target.closest('.btn-view-answers');
    if (btnView) {
      const username = btnView.getAttribute('data-username');
      const student = allStudentsData.find(s => s.username === username);
      if (student) {
        openAnswersModal(student);
      }
      return;
    }

    const btnReset = e.target.closest('.btn-reset-student');
    if (btnReset) {
      const username = btnReset.getAttribute('data-username');
      const name = btnReset.getAttribute('data-name');
      const examId = btnReset.getAttribute('data-examid');
      resetStudentExam(username, name, examId);
    }
  });

  if (btnModalDelete) {
    btnModalDelete.addEventListener('click', () => {
      if (currentModalStudent) {
        resetStudentExam(
          currentModalStudent.username,
          `${currentModalStudent.firstName} ${currentModalStudent.lastName}`,
          currentModalStudent.assignedExamId || 1
        );
      }
    });
  }

  // Cerrar Modal
  const closeModal = () => { answersModal.style.display = 'none'; };
  if (btnCloseModal1) btnCloseModal1.addEventListener('click', closeModal);
  if (btnCloseModal2) btnCloseModal2.addEventListener('click', closeModal);
  window.addEventListener('click', (e) => {
    if (e.target === answersModal) closeModal();
  });

  async function loadDashboard(pin, silent = false) {
    if (!silent) errorMsg.style.display = 'none';
    try {
      const res = await fetch(`/api/admin/submissions?pin=${encodeURIComponent(pin)}&t=${Date.now()}`);
      const data = await res.json();

      if (!data.success) {
        if (!silent) {
          errorMsg.textContent = data.message || 'PIN incorrecto.';
          errorMsg.style.display = 'block';
        }
        return;
      }

      authCard.style.display = 'none';
      dashboardContent.style.display = 'block';
      allStudentsData = data.students || [];
      renderTable();
      updateLastRefreshed();

      // Iniciar auto-refresh si no está corriendo
      if (!autoRefreshInterval) {
        startAutoRefresh();
      }

    } catch (err) {
      console.error('Error en admin:', err);
      if (!silent) {
        errorMsg.textContent = 'Error de conexión.';
        errorMsg.style.display = 'block';
      }
    }
  }

  function updateLastRefreshed() {
    const el = document.getElementById('last-refreshed');
    if (el) el.textContent = `Última actualización: ${new Date().toLocaleTimeString('es-CO')}`;
    nextRefreshIn = 20;
  }

  function startAutoRefresh() {
    const countdownEl = document.getElementById('refresh-countdown');
    nextRefreshIn = 20;

    autoRefreshInterval = setInterval(() => {
      nextRefreshIn--;
      if (countdownEl) countdownEl.textContent = `Actualizando en ${nextRefreshIn}s…`;
      if (nextRefreshIn <= 0) {
        nextRefreshIn = 20;
        loadDashboard(currentPin, true);
      }
    }, 1000);
  }

  window.addEventListener('beforeunload', () => {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  });

  function renderTable() {
    const filtered = allStudentsData.filter(st => (st.grade || '4to A') === currentGradeFilter);

    if (!filtered || filtered.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px;">No hay alumnos en el ${currentGradeFilter}.</td></tr>`;
      return;
    }

    let html = '';
    filtered.forEach(st => {
      let badgeHtml = '';
      if (st.examStatus === 'submitted') {
        badgeHtml = `<span style="background: var(--success-light); color: #047857; padding: 6px 14px; border-radius: 20px; font-weight: 800; font-size: 0.85rem;">✅ Entregado</span>`;
      } else if (st.examStatus === 'in_progress') {
        badgeHtml = `<span style="background: var(--warning-light); color: #b45309; padding: 6px 14px; border-radius: 20px; font-weight: 700; font-size: 0.85rem;">💾 En Progreso (Guardado)</span>`;
      } else {
        badgeHtml = `<span style="background: #f1f5f9; color: #64748b; padding: 6px 14px; border-radius: 20px; font-weight: 600; font-size: 0.85rem;">Sin Iniciar</span>`;
      }

      const scoreText = st.autoScore !== null ? `<strong>${st.autoScore}/${st.maxAutoScore}</strong>` : '--';
      const hasAnswers = st.answers && Object.keys(st.answers).length > 0;
      const actionBtn = hasAnswers
        ? `<button type="button" class="btn btn-outline btn-view-answers" data-username="${st.username}" style="padding: 6px 12px; font-size: 0.85rem; font-weight:700;">👁️ Respuestas</button>
           <button type="button" class="btn btn-reset-student" data-username="${st.username}" data-name="${st.firstName} ${st.lastName}" data-examid="${st.assignedExamId || 1}" style="padding: 6px 10px; font-size: 0.82rem; font-weight:700; background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; border-radius: 6px; cursor: pointer; margin-left: 4px;" title="Borrar de la BD para permitir repetir">🗑️ Borrar</button>`
        : (st.examStatus !== 'not_started'
            ? `<button type="button" class="btn btn-reset-student" data-username="${st.username}" data-name="${st.firstName} ${st.lastName}" data-examid="${st.assignedExamId || 1}" style="padding: 6px 10px; font-size: 0.82rem; font-weight:700; background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; border-radius: 6px; cursor: pointer;" title="Borrar de la BD">🗑️ Borrar</button>`
            : `<span style="color: #94a3b8; font-size: 0.85rem;">Sin actividad</span>`);

      html += `
        <tr style="border-bottom: 1px solid var(--border);">
          <td style="padding: 16px;">
            <div style="font-weight: 700; color: var(--dark); font-size: 1rem;">${st.lastName} ${st.firstName}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">${st.username}</div>
          </td>
          <td style="padding: 16px; text-align: center; font-weight: 700; color: var(--primary);">
            📝 Practice Test ${st.assignedExamId || 1}
          </td>
          <td style="padding: 16px; text-align: center;">
            ${badgeHtml}
          </td>
          <td style="padding: 16px; text-align: center; font-size: 1.1rem; color: var(--dark);">
            ${scoreText}
          </td>
          <td style="padding: 16px; text-align: center;">
            ${actionBtn}
          </td>
        </tr>
      `;
    });

    tableBody.innerHTML = html;
  }

  // ── Renderizado del Modal de Respuestas ────────────────────
  async function openAnswersModal(student) {
    currentModalStudent = student;
    if (btnModalDelete) {
      if (student.examStatus !== 'not_started' || (student.answers && Object.keys(student.answers).length > 0)) {
        btnModalDelete.style.display = 'inline-block';
      } else {
        btnModalDelete.style.display = 'none';
      }
    }

    modalStudentName.textContent = `${student.firstName} ${student.lastName}`;
    const statusText = student.examStatus === 'submitted' ? '✅ Examen Entregado' : (student.examStatus === 'in_progress' ? '💾 Examen En Progreso' : 'Sin Iniciar');
    const timeText = student.updatedAt ? ` | Último guardado: ${new Date(student.updatedAt).toLocaleString('es-CO')}` : '';
    const scoreText = student.autoScore !== null ? ` | Puntaje Auto: ${student.autoScore}/${student.maxAutoScore}` : '';
    modalStudentMeta.textContent = `${student.grade || '4to'} · Practice Test ${student.assignedExamId || 1} | ${statusText}${scoreText}${timeText}`;

    modalAnswersBody.innerHTML = `
      <div style="text-align:center; padding:50px; color:var(--text-muted);">
        <div style="font-size:2.5rem; margin-bottom:12px;">⏳</div>
        Cargando preguntas del examen…
      </div>`;

    answersModal.style.display = 'flex';

    const exam = await getExamData(student.assignedExamId || 1);
    if (!exam) {
      modalAnswersBody.innerHTML = `<div style="color:var(--danger); text-align:center; padding:40px;">❌ Error al obtener los datos del examen.</div>`;
      return;
    }

    const answers = student.answers || {};
    let html = '';

    // Parte 1
    if (exam.parts.part1) {
      const p = exam.parts.part1;
      html += `
        <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 18px; margin-bottom: 20px;">
          <h4 style="color: var(--primary); font-size: 1.1rem; margin-bottom: 6px; font-weight: 800;">Part 1 – Look and read</h4>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 14px;">${p.instruction}</p>
          <div style="display: flex; flex-direction: column; gap: 10px;">`;

      (p.questions || []).forEach(q => {
        const userVal = answers[q.id];
        const isCorr = checkAnswer(userVal, q.answer);
        const statusBadge = userVal
          ? (isCorr
              ? `<span style="background: #dcfce7; color: #15803d; padding: 3px 10px; border-radius: 12px; font-weight: 700; font-size: 0.8rem;">✅ Correcta</span>`
              : `<span style="background: #fee2e2; color: #b91c1c; padding: 3px 10px; border-radius: 12px; font-weight: 700; font-size: 0.8rem;">❌ Incorrecta</span>`)
          : `<span style="background: #f1f5f9; color: #64748b; padding: 3px 10px; border-radius: 12px; font-size: 0.8rem;">⚪ Sin responder</span>`;

        html += `
          <div style="background: white; border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px;">
            <div style="font-size: 0.9rem; font-weight: 600; color: var(--dark); margin-bottom: 6px;">
              <strong>${q.num}.</strong> ${q.text}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 0.9rem;">
              <div>
                <strong>Respuesta Alumno:</strong> <span style="color: ${isCorr ? '#15803d' : '#b91c1c'}; font-weight: 700;">${userVal || '(Vacío)'}</span>
                <span style="color: #64748b; font-size: 0.85rem; margin-left: 12px;">(Esperada: <strong>${q.answer}</strong>)</span>
              </div>
              <div>${statusBadge}</div>
            </div>
          </div>`;
      });
      html += `</div></div>`;
    }

    // Parte 2
    if (exam.parts.part2) {
      const p = exam.parts.part2;
      html += `
        <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 18px; margin-bottom: 20px;">
          <h4 style="color: var(--primary); font-size: 1.1rem; margin-bottom: 6px; font-weight: 800;">Part 2 – Short Dialogues</h4>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 14px;">${p.instruction}</p>
          <div style="display: flex; flex-direction: column; gap: 10px;">`;

      (p.questions || []).forEach(q => {
        const userVal = answers[q.id];
        const isCorr = (userVal || '').trim().toUpperCase() === q.answer.toUpperCase();
        const statusBadge = userVal
          ? (isCorr
              ? `<span style="background: #dcfce7; color: #15803d; padding: 3px 10px; border-radius: 12px; font-weight: 700; font-size: 0.8rem;">✅ Correcta</span>`
              : `<span style="background: #fee2e2; color: #b91c1c; padding: 3px 10px; border-radius: 12px; font-weight: 700; font-size: 0.8rem;">❌ Incorrecta</span>`)
          : `<span style="background: #f1f5f9; color: #64748b; padding: 3px 10px; border-radius: 12px; font-size: 0.8rem;">⚪ Sin responder</span>`;

        html += `
          <div style="background: white; border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px;">
            <div style="font-size: 0.9rem; font-weight: 600; color: var(--dark); margin-bottom: 6px;">
              <strong>${q.num}.</strong> ${q.speaker ? `<strong>${q.speaker}:</strong> ` : ''}${q.question || q.text}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 0.9rem;">
              <div>
                <strong>Opción Alumno:</strong> <span style="color: ${isCorr ? '#15803d' : '#b91c1c'}; font-weight: 700;">${userVal || '(Vacío)'}</span>
                <span style="color: #64748b; font-size: 0.85rem; margin-left: 12px;">(Correcta: <strong>${q.answer}</strong>)</span>
              </div>
              <div>${statusBadge}</div>
            </div>
          </div>`;
      });
      html += `</div></div>`;
    }

    // Parte 3
    if (exam.parts.part3) {
      const p = exam.parts.part3;
      html += `
        <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 18px; margin-bottom: 20px;">
          <h4 style="color: var(--primary); font-size: 1.1rem; margin-bottom: 6px; font-weight: 800;">Part 3 – Complete the Story</h4>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 14px;">${p.instruction}</p>
          <div style="display: flex; flex-direction: column; gap: 10px;">`;

      (p.questions || []).forEach(q => {
        const userVal = answers[q.id];
        const isCorr = checkAnswer(userVal, q.answer);
        const statusBadge = userVal
          ? (isCorr
              ? `<span style="background: #dcfce7; color: #15803d; padding: 3px 10px; border-radius: 12px; font-weight: 700; font-size: 0.8rem;">✅ Correcta</span>`
              : `<span style="background: #fee2e2; color: #b91c1c; padding: 3px 10px; border-radius: 12px; font-weight: 700; font-size: 0.8rem;">❌ Incorrecta</span>`)
          : `<span style="background: #f1f5f9; color: #64748b; padding: 3px 10px; border-radius: 12px; font-size: 0.8rem;">⚪ Sin responder</span>`;

        html += `
          <div style="background: white; border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 0.9rem;">
              <div>
                <strong>Palabra (${q.num}):</strong> Alumno: <span style="color: ${isCorr ? '#15803d' : '#b91c1c'}; font-weight: 700;">${userVal || '(Vacío)'}</span>
                <span style="color: #64748b; font-size: 0.85rem; margin-left: 12px;">(Esperada: <strong>${q.answer}</strong>)</span>
              </div>
              <div>${statusBadge}</div>
            </div>
          </div>`;
      });

      if (p.titleQuestion) {
        const tq = p.titleQuestion;
        const userVal = answers[tq.id];
        const isCorr = checkAnswer(userVal, tq.answer);
        const statusBadge = userVal
          ? (isCorr
              ? `<span style="background: #dcfce7; color: #15803d; padding: 3px 10px; border-radius: 12px; font-weight: 700; font-size: 0.8rem;">✅ Correcta</span>`
              : `<span style="background: #fee2e2; color: #b91c1c; padding: 3px 10px; border-radius: 12px; font-weight: 700; font-size: 0.8rem;">❌ Incorrecta</span>`)
          : `<span style="background: #f1f5f9; color: #64748b; padding: 3px 10px; border-radius: 12px; font-size: 0.8rem;">⚪ Sin responder</span>`;

        html += `
          <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; margin-top: 6px;">
            <div style="font-size: 0.9rem; font-weight: 700; color: var(--primary); margin-bottom: 6px;">
              <strong>${tq.num || 11}. Título de la historia:</strong> ${tq.question}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 0.9rem;">
              <div>
                <strong>Respuesta Alumno:</strong> <span style="color: ${isCorr ? '#15803d' : '#b91c1c'}; font-weight: 700;">${userVal || '(Vacío)'}</span>
                <span style="color: #64748b; font-size: 0.85rem; margin-left: 12px;">(Esperado: <strong>${tq.answer}</strong>)</span>
              </div>
              <div>${statusBadge}</div>
            </div>
          </div>`;
      }

      html += `</div></div>`;
    }

    // Parte 4
    if (exam.parts.part4) {
      const p = exam.parts.part4;
      html += `
        <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 18px; margin-bottom: 20px;">
          <h4 style="color: var(--primary); font-size: 1.1rem; margin-bottom: 6px; font-weight: 800;">Part 4 – Factual Text</h4>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 14px;">${p.instruction}</p>
          <div style="display: flex; flex-direction: column; gap: 10px;">`;

      (p.questions || []).forEach(q => {
        const userVal = answers[q.id];
        const isCorr = checkAnswer(userVal, q.answer);
        const statusBadge = userVal
          ? (isCorr
              ? `<span style="background: #dcfce7; color: #15803d; padding: 3px 10px; border-radius: 12px; font-weight: 700; font-size: 0.8rem;">✅ Correcta</span>`
              : `<span style="background: #fee2e2; color: #b91c1c; padding: 3px 10px; border-radius: 12px; font-weight: 700; font-size: 0.8rem;">❌ Incorrecta</span>`)
          : `<span style="background: #f1f5f9; color: #64748b; padding: 3px 10px; border-radius: 12px; font-size: 0.8rem;">⚪ Sin responder</span>`;

        html += `
          <div style="background: white; border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 0.9rem;">
              <div>
                <strong>Pregunta (${q.num}):</strong> Alumno: <span style="color: ${isCorr ? '#15803d' : '#b91c1c'}; font-weight: 700;">${userVal || '(Vacío)'}</span>
                <span style="color: #64748b; font-size: 0.85rem; margin-left: 12px;">(Esperada: <strong>${q.answer}</strong>)</span>
              </div>
              <div>${statusBadge}</div>
            </div>
          </div>`;
      });
      html += `</div></div>`;
    }

    // Parte 5
    if (exam.parts.part5) {
      const p = exam.parts.part5;
      html += `
        <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 18px; margin-bottom: 20px;">
          <h4 style="color: var(--primary); font-size: 1.1rem; margin-bottom: 6px; font-weight: 800;">Part 5 – Complete Sentences</h4>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 14px;">${p.instruction}</p>
          <div style="display: flex; flex-direction: column; gap: 10px;">`;

      (p.questions || []).forEach(q => {
        const userVal = answers[q.id];
        const isCorr = checkAnswer(userVal, q.answer, q.acceptableAnswers);
        const statusBadge = userVal
          ? (isCorr
              ? `<span style="background: #dcfce7; color: #15803d; padding: 3px 10px; border-radius: 12px; font-weight: 700; font-size: 0.8rem;">✅ Correcta</span>`
              : `<span style="background: #fee2e2; color: #b91c1c; padding: 3px 10px; border-radius: 12px; font-weight: 700; font-size: 0.8rem;">❌ Incorrecta</span>`)
          : `<span style="background: #f1f5f9; color: #64748b; padding: 3px 10px; border-radius: 12px; font-size: 0.8rem;">⚪ Sin responder</span>`;

        const acceptableStr = (q.acceptableAnswers || [q.answer]).join(' / ');

        html += `
          <div style="background: white; border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px;">
            <div style="font-size: 0.9rem; font-weight: 600; color: var(--dark); margin-bottom: 6px;">
              <strong>${q.num}.</strong> ${q.text}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 0.9rem;">
              <div>
                <strong>Respuesta Alumno:</strong> <span style="color: ${isCorr ? '#15803d' : '#b91c1c'}; font-weight: 700;">${userVal || '(Vacío)'}</span>
                <span style="color: #64748b; font-size: 0.85rem; margin-left: 12px;">(Aceptables: <strong>${acceptableStr}</strong>)</span>
              </div>
              <div>${statusBadge}</div>
            </div>
          </div>`;
      });
      html += `</div></div>`;
    }

    // Parte 6 — Producción Escrita Abierta
    if (exam.parts.part6) {
      const p = exam.parts.part6;
      html += `
        <div style="background: #fffbe6; border: 2px solid #fef08a; border-radius: var(--radius-md); padding: 20px; margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h4 style="color: #b45309; font-size: 1.15rem; margin: 0; font-weight: 800;">Part 6 – Look and read and write</h4>
            <span style="background: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 12px; font-size: 0.85rem; font-weight: 800;">✍️ Producción Escrita (Revisión Docente)</span>
          </div>
          <p style="font-size: 0.88rem; color: #854d0e; margin-bottom: 16px;">${p.instruction}</p>`;

      const renderQuestionsList = (qList) => {
        return (qList || []).map(q => {
          const userVal = answers[q.id];
          return `
            <div style="background: white; border: 1px solid #fde047; border-radius: 8px; padding: 14px 18px; margin-bottom: 12px;">
              <div style="font-size: 0.95rem; font-weight: 700; color: var(--dark); margin-bottom: 8px;">
                <strong>${q.num}.</strong> ${q.text}
              </div>
              <div style="background: #f8fafc; border-left: 4px solid var(--primary); padding: 10px 14px; border-radius: 4px; font-size: 1rem; color: var(--dark);">
                ${userVal
                  ? `<span style="font-weight: 600; color: #1e293b;">"${userVal}"</span>`
                  : `<span style="color: #94a3b8; font-style: italic;">(El estudiante no escribió respuesta para esta pregunta)</span>`}
              </div>
            </div>`;
        }).join('');
      };

      if (p.scenes && p.scenes.length > 0) {
        p.scenes.forEach(sc => {
          html += `
            <div style="margin-top: 16px;">
              ${sc.title ? `<h5 style="font-size: 1rem; color: var(--primary); margin-bottom: 10px; font-weight: 700;">${sc.title}</h5>` : ''}
              ${renderQuestionsList(sc.questions)}
            </div>`;
        });
      } else {
        html += renderQuestionsList(p.questions);
      }

      html += `</div>`;
    }

    modalAnswersBody.innerHTML = html;
  }
});
