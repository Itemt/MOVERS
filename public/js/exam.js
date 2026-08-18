document.addEventListener('DOMContentLoaded', () => {
  let currentStudent = null;
  let currentExamId = 1;
  let examData = null;
  let autoSaveInterval = null;
  let examIsSubmitted = false;
  let activeSection = 'listening'; // 'listening' | 'reading'
  const activeAudioPlayers = [];

  // ── 1. Verificar login ──────────────────────────────────────────
  const rawStudent = localStorage.getItem('movers_student');
  if (!rawStudent) {
    window.location.href = '/';
    return;
  }
  currentStudent = JSON.parse(rawStudent);
  currentExamId = currentStudent.assignedExamId || 1;

  setupStudentHeader();
  setupSectionNavigation();
  loadExam(currentExamId);

  // ── 2. Encabezado del estudiante ────────────────────────────────
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

  // ── 3. Navegación entre Secciones (Listening vs Reading & Writing) ──
  function setupSectionNavigation() {
    const tabListening = document.getElementById('tab-btn-listening');
    const tabReading = document.getElementById('tab-btn-reading');

    tabListening.addEventListener('click', () => switchSection('listening'));
    tabReading.addEventListener('click', () => switchSection('reading'));

    // Modal de bienvenida / selección inicial
    const welcomeModal = document.getElementById('welcome-section-modal');
    const choiceListening = document.getElementById('card-choice-listening');
    const choiceReading = document.getElementById('card-choice-reading');

    if (choiceListening) {
      choiceListening.addEventListener('click', () => {
        switchSection('listening');
        welcomeModal.style.display = 'none';
        sessionStorage.setItem('movers_seen_welcome', 'true');
      });
    }

    if (choiceReading) {
      choiceReading.addEventListener('click', () => {
        switchSection('reading');
        welcomeModal.style.display = 'none';
        sessionStorage.setItem('movers_seen_welcome', 'true');
      });
    }
  }

  function switchSection(section) {
    activeSection = section;
    const listeningContainer = document.getElementById('listening-section-container');
    const readingContainer = document.getElementById('reading-section-container');
    const tabListening = document.getElementById('tab-btn-listening');
    const tabReading = document.getElementById('tab-btn-reading');

    // Pausar todos los audios al cambiar de pestaña
    pauseAllAudios();

    if (section === 'listening') {
      listeningContainer.style.display = 'block';
      readingContainer.style.display = 'none';
      tabListening.classList.add('active');
      tabReading.classList.remove('active');
      document.getElementById('exam-meta-subtitle').textContent =
        'Sección Listening • Escucha con atención y selecciona la respuesta correcta.';
    } else {
      listeningContainer.style.display = 'none';
      readingContainer.style.display = 'block';
      tabReading.classList.add('active');
      tabListening.classList.remove('active');
      document.getElementById('exam-meta-subtitle').textContent =
        'Sección Reading & Writing • Lee con atención y completa cada parte del examen.';
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function pauseAllAudios() {
    activeAudioPlayers.forEach(p => {
      if (p && p.audio && !p.audio.paused) {
        p.audio.pause();
      }
    });
  }

  // ── 4. Cargar examen desde la API ─────────────────────────────
  async function loadExam(examId) {
    const listeningContainer = document.getElementById('listening-section-container');
    const readingContainer = document.getElementById('reading-section-container');

    try {
      const res = await fetch(`/api/exams/${examId}`);
      const data = await res.json();
      if (!data.success || !data.exam) {
        listeningContainer.innerHTML = '<div style="color:var(--danger);text-align:center;padding:40px;">❌ Error al cargar el examen.</div>';
        readingContainer.innerHTML = '<div style="color:var(--danger);text-align:center;padding:40px;">❌ Error al cargar el examen.</div>';
        return;
      }

      examData = data.exam;
      document.getElementById('exam-title-text').textContent =
        `${examData.title} — ${currentStudent.grade}`;

      // Renderizar ambas secciones
      renderListeningSection(examData.listening);
      renderReadingSection(examData.parts);

      // Verificar progreso/estado previo
      await checkAndRestoreProgress(currentStudent.username, examId);

    } catch (err) {
      console.error('Error cargando examen:', err);
      listeningContainer.innerHTML = '<div style="color:var(--danger);text-align:center;padding:40px;">❌ Error de conexión. Recarga la página.</div>';
      readingContainer.innerHTML = '<div style="color:var(--danger);text-align:center;padding:40px;">❌ Error de conexión. Recarga la página.</div>';
    }
  }

  // ── 5. Formateo de tiempo (MM:SS) ──────────────────────────────
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // ── 6. Renderizado de Sección Listening ─────────────────────────
  function renderListeningSection(listeningData) {
    const container = document.getElementById('listening-section-container');
    const badgeEl = document.getElementById('listening-badge-count');
    if (badgeEl && listeningData?.parts) {
      badgeEl.textContent = `${listeningData.parts.length} Actividades`;
    }

    if (!listeningData || !listeningData.parts || listeningData.parts.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align:center;padding:40px;">
          <p style="color:var(--text-muted);">No hay partes de Listening configuradas para este examen.</p>
        </div>`;
      return;
    }

    let html = `
      <div class="card" style="background: linear-gradient(135deg, #0284c7, #0369a1); color: white; margin-bottom: 24px; border: none;">
        <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
          <div style="font-size: 3rem;">🎧</div>
          <div>
            <h2 style="font-size: 1.4rem; font-weight: 800; margin-bottom: 4px; color: white;">Cambridge Movers – Listening Test</h2>
            <p style="font-size: 0.95rem; opacity: 0.9;">
              Consta de <strong>${listeningData.parts.length} actividades auditivas</strong>. Usa el reproductor para escuchar el audio, pausar, retroceder (-5s) o adelantar (+5s) cuando lo necesites.
            </p>
          </div>
        </div>
      </div>
    `;

    listeningData.parts.forEach((part, index) => {
      const partId = part.id || `audio_${index + 1}`;
      const playerDomId = `player_${partId}`;
      const audioDomId = `audio_el_${partId}`;

      html += `
        <div class="card" style="margin-bottom: 30px;">
          <!-- Encabezado de la actividad -->
          <div class="part-header">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
              <h3>${part.title || `Part ${part.partNum || index + 1}`}</h3>
              <span style="background: var(--primary); color: white; font-weight: 800; font-size: 0.8rem; padding: 4px 12px; border-radius: 20px;">
                Audio ${index + 1} de ${listeningData.parts.length}
              </span>
            </div>
            <p style="margin-top: 6px;">${part.instruction}</p>
          </div>

          <!-- Reproductor de Audio Personalizado -->
          <div class="movers-audio-player" id="${playerDomId}" data-audio-src="${part.audioUrl}">
            <audio id="${audioDomId}" src="${part.audioUrl}" preload="metadata"></audio>
            
            <div class="audio-player-top">
              <div class="audio-track-info">
                <span class="audio-track-badge">AUDIO ${index + 1}</span>
                <span class="audio-track-title">${part.title}</span>
              </div>
              <div class="audio-status-pill" id="status_${playerDomId}">
                <span>Listo para reproducir</span>
              </div>
            </div>

            <div class="audio-controls-row">
              <!-- Botón Retroceder 5 segundos -->
              <button type="button" class="audio-btn audio-btn-seek btn-rewind" id="rewind_${playerDomId}" title="Retroceder 5 segundos">
                ⏪ -5s
              </button>

              <!-- Botón Principal Play / Pause -->
              <button type="button" class="audio-btn audio-btn-play btn-play" id="play_${playerDomId}" title="Reproducir / Pausar">
                ▶️
              </button>

              <!-- Botón Adelantar 5 segundos -->
              <button type="button" class="audio-btn audio-btn-seek btn-forward" id="forward_${playerDomId}" title="Adelantar 5 segundos">
                ⏩ +5s
              </button>

              <!-- Barra de Tiempo y Progreso Cliqueable -->
              <div class="audio-progress-container">
                <div class="audio-progress-bar" id="progbar_${playerDomId}">
                  <div class="audio-progress-fill" id="progfill_${playerDomId}"></div>
                </div>
                <div class="audio-time-row">
                  <span id="curtime_${playerDomId}">00:00</span>
                  <span id="durtime_${playerDomId}">--:--</span>
                </div>
              </div>

              <!-- Control de Volumen -->
              <div class="audio-volume-box">
                <span style="font-size: 1rem; cursor: pointer;" id="volicon_${playerDomId}" title="Silenciar">🔊</span>
                <input type="range" class="audio-volume-slider" id="volslider_${playerDomId}" min="0" max="1" step="0.05" value="1" title="Volumen">
              </div>
            </div>
          </div>

          <!-- Imagen del Ejercicio -->
          ${part.imageUrl ? `
            <div style="text-align:center; margin: 20px 0 26px;">
              <img src="${part.imageUrl}" alt="${part.title}" class="exam-img-responsive">
              <p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 8px;">
                🔍 Observa la ilustración con atención mientras escuchas el audio.
              </p>
            </div>
          ` : ''}

          <!-- Ejemplo oficial guiado -->
          ${part.example ? `
            <div style="background:#f0fdf4; border: 1px solid #bbf7d0; border-left: 5px solid #16a34a; padding: 14px 18px; border-radius: var(--radius-md); margin-bottom: 22px;">
              <div style="font-weight: 800; color: #166534; font-size: 0.95rem; margin-bottom: 4px;">
                💡 Example (Ejemplo del audio):
              </div>
              <div style="font-size: 0.92rem; color: #14532d;">
                <strong>${part.example.name}</strong> ➔ ${part.example.description || ''} <span style="background: #16a34a; color: white; padding: 2px 8px; border-radius: 6px; font-weight: 800; font-size: 0.85rem; margin-left: 6px;">Respuesta: ${part.example.answer}</span>
              </div>
            </div>
          ` : ''}

          <!-- Preguntas / Actividad -->
          <div style="margin-top: 16px;">
            <h4 style="font-size: 1.05rem; font-weight: 800; color: var(--dark); margin-bottom: 14px;">
              ${part.type === 'fill_in_the_blank'
                ? '✍️ Write the missing words / numbers on the lines:'
                : (part.id === 'audio5' || part.id === 'audio6'
                    ? '📝 Choose the correct option for each question:'
                    : '📝 Select the correct number (1–6) for each person:')}
            </h4>

            ${(part.questions || []).map(q => {
              if (part.type === 'fill_in_the_blank' || (!q.options && q.prompt)) {
                // Formato Fill In The Blank (Audio 7)
                return `
                  <div class="listening-character-card">
                    <div class="question-row" style="margin-bottom: 0; border: none; padding: 4px 0;">
                      <div class="question-text" style="font-size: 1rem; margin-bottom: 8px;">
                        <strong>${q.num}.</strong> ${q.prompt || q.name}
                      </div>
                      <div style="display: flex; align-items: center; gap: 10px;">
                        <input type="text" name="${q.id}" id="${q.id}" class="input-field"
                          placeholder="${q.placeholder || 'Escribe tu respuesta aquí…'}" autocomplete="off" style="max-width: 380px;">
                        ${q.suffix ? `<strong style="font-size: 1rem; color: var(--dark);">${q.suffix}</strong>` : ''}
                      </div>
                    </div>
                  </div>
                `;
              } else if (q.options && typeof q.options[0] === 'string' && q.options[0].length > 3) {
                // Formato MCQ descriptivo (como en Audio 5 y Audio 6)
                return `
                  <div class="listening-character-card">
                    <div class="character-header">
                      <div class="character-name-badge">
                        <span style="background: var(--primary-light); color: var(--primary); padding: 4px 10px; border-radius: 8px;">${q.num}</span>
                        <span>${q.name}</span>
                      </div>
                      ${q.hint ? `<span class="character-hint">(${q.hint})</span>` : ''}
                    </div>
                    <div class="mcq-options" style="margin-top: 10px;">
                      ${q.options.map(opt => {
                        const letter = opt.substring(0, 1);
                        const optId = `${q.id}_${letter}`;
                        return `
                          <label class="mcq-option-label" for="${optId}">
                            <input type="radio" name="${q.id}" id="${optId}" value="${letter}">
                            <span>${opt}</span>
                          </label>
                        `;
                      }).join('')}
                    </div>
                  </div>
                `;
              } else {
                // Formato Number Pills (1 a 6) para personajes numerados
                const numOptions = q.options || ['1', '2', '3', '4', '5', '6'];
                return `
                  <div class="listening-character-card">
                    <div class="character-header">
                      <div class="character-name-badge">
                        <span style="background: var(--primary-light); color: var(--primary); padding: 4px 10px; border-radius: 8px;">${q.num}</span>
                        <span>${q.name}</span>
                      </div>
                      ${q.hint ? `<span class="character-hint">${q.hint}</span>` : ''}
                    </div>
                    <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-muted); margin-bottom: 6px;">
                      Número en el dibujo:
                    </div>
                    <div class="number-selector-grid">
                      ${numOptions.map(numVal => {
                        const pillId = `${q.id}_num_${numVal}`;
                        return `
                          <label class="number-pill-option" for="${pillId}">
                            <input type="radio" name="${q.id}" id="${pillId}" value="${numVal}">
                            <span class="number-pill-label">${numVal}</span>
                          </label>
                        `;
                      }).join('')}
                    </div>
                  </div>
                `;
              }
            }).join('')}
          </div>

        </div>
      `;
    });

    container.innerHTML = html;

    // Inicializar lógica de audio de cada reproductor
    initAudioPlayers(listeningData.parts);
  }

  // ── 7. Inicializador de Reproductores de Audio ──────────────────
  function initAudioPlayers(parts) {
    activeAudioPlayers.length = 0;

    parts.forEach((part, index) => {
      const partId = part.id || `audio_${index + 1}`;
      const playerDomId = `player_${partId}`;
      const audioEl = document.getElementById(`audio_el_${partId}`);
      if (!audioEl) return;

      const playBtn = document.getElementById(`play_${playerDomId}`);
      const rewindBtn = document.getElementById(`rewind_${playerDomId}`);
      const forwardBtn = document.getElementById(`forward_${playerDomId}`);
      const progBar = document.getElementById(`progbar_${playerDomId}`);
      const progFill = document.getElementById(`progfill_${playerDomId}`);
      const curTimeEl = document.getElementById(`curtime_${playerDomId}`);
      const durTimeEl = document.getElementById(`durtime_${playerDomId}`);
      const volSlider = document.getElementById(`volslider_${playerDomId}`);
      const volIcon = document.getElementById(`volicon_${playerDomId}`);
      const statusPill = document.getElementById(`status_${playerDomId}`);

      const playerObj = { id: partId, audio: audioEl, playBtn, statusPill };
      activeAudioPlayers.push(playerObj);

      // Metadatos cargados (duración)
      audioEl.addEventListener('loadedmetadata', () => {
        durTimeEl.textContent = formatTime(audioEl.duration);
      });

      // Actualizar progreso
      audioEl.addEventListener('timeupdate', () => {
        curTimeEl.textContent = formatTime(audioEl.currentTime);
        if (audioEl.duration) {
          const pct = (audioEl.currentTime / audioEl.duration) * 100;
          progFill.style.width = `${pct}%`;
        }
      });

      // Reproducción iniciada
      audioEl.addEventListener('play', () => {
        // Pausar cualquier otro reproductor activo
        activeAudioPlayers.forEach(p => {
          if (p.id !== partId && p.audio && !p.audio.paused) {
            p.audio.pause();
          }
        });

        playBtn.textContent = '⏸️';
        statusPill.classList.add('playing');
        statusPill.innerHTML = `<span>Reproduciendo…</span>`;
      });

      // Pausa
      audioEl.addEventListener('pause', () => {
        playBtn.textContent = '▶️';
        statusPill.classList.remove('playing');
        statusPill.innerHTML = `<span>En pausa</span>`;
      });

      // Fin del audio
      audioEl.addEventListener('ended', () => {
        playBtn.textContent = '▶️';
        statusPill.classList.remove('playing');
        statusPill.innerHTML = `<span>Completado</span>`;
      });

      // Botón Play/Pause
      playBtn.addEventListener('click', () => {
        if (audioEl.paused) {
          audioEl.play().catch(e => console.warn('Error reproduciendo audio:', e));
        } else {
          audioEl.pause();
        }
      });

      // Botón Retroceder 5s
      rewindBtn.addEventListener('click', () => {
        audioEl.currentTime = Math.max(0, audioEl.currentTime - 5);
      });

      // Botón Adelantar 5s
      forwardBtn.addEventListener('click', () => {
        if (audioEl.duration) {
          audioEl.currentTime = Math.min(audioEl.duration, audioEl.currentTime + 5);
        } else {
          audioEl.currentTime += 5;
        }
      });

      // Click en barra de progreso para saltar
      progBar.addEventListener('click', (e) => {
        const rect = progBar.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const width = rect.width;
        if (audioEl.duration && width > 0) {
          const ratio = Math.max(0, Math.min(1, clickX / width));
          audioEl.currentTime = ratio * audioEl.duration;
        }
      });

      // Control de volumen
      volSlider.addEventListener('input', () => {
        audioEl.volume = parseFloat(volSlider.value);
        volIcon.textContent = audioEl.volume === 0 ? '🔇' : (audioEl.volume < 0.5 ? '🔉' : '🔊');
      });

      // Silenciar / Restaurar volumen al click en ícono
      let lastVolume = 1;
      volIcon.addEventListener('click', () => {
        if (audioEl.volume > 0) {
          lastVolume = audioEl.volume;
          audioEl.volume = 0;
          volSlider.value = 0;
          volIcon.textContent = '🔇';
        } else {
          audioEl.volume = lastVolume || 1;
          volSlider.value = audioEl.volume;
          volIcon.textContent = '🔊';
        }
      });
    });
  }

  // ── 8. Renderizado de Sección Reading & Writing ─────────────────
  function renderReadingSection(parts) {
    const container = document.getElementById('reading-section-container');
    if (!parts) {
      container.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:40px;">No hay partes de lectura disponibles.</div>';
      return;
    }

    let html = '';

    const imgMarkup = (url) => url ? `
      <div style="text-align:center;margin:16px 0 24px;">
        <img src="${url}" alt="Cambridge Movers Scene" class="exam-img-responsive">
      </div>` : '';

    // ── Part 1 ──
    if (parts.part1) {
      const p = parts.part1;
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

    // ── Part 2 ──
    if (parts.part2) {
      const p = parts.part2;
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

    // ── Part 3 ──
    if (parts.part3) {
      const p = parts.part3;
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

    // ── Part 4 ──
    if (parts.part4) {
      const p = parts.part4;
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

    // ── Part 5 ──
    if (parts.part5) {
      const p = parts.part5;
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

    // ── Part 6 ──
    if (parts.part6) {
      const p = parts.part6;
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

  // ── 9. Recolección y restauración de respuestas ────────────────
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
        if (el.type === 'radio') {
          const isMatch = (el.value === val);
          el.checked = isMatch;
          const label = el.closest('.number-pill-option') || el.closest('.mcq-option-label');
          if (label) {
            if (isMatch) {
              label.classList.add('is-selected');
            } else {
              label.classList.remove('is-selected');
            }
          }
        } else {
          el.value = val;
        }
      });
    });
  }

  // Delegación de eventos para sincronizar clases activas en opciones seleccionadas
  const formEl = document.getElementById('movers-exam-form');
  if (formEl) {
    formEl.addEventListener('change', (e) => {
      if (e.target && e.target.type === 'radio') {
        const name = e.target.name;
        document.querySelectorAll(`input[name="${name}"]`).forEach(radio => {
          const label = radio.closest('.number-pill-option') || radio.closest('.mcq-option-label');
          if (label) {
            if (radio.checked) {
              label.classList.add('is-selected');
            } else {
              label.classList.remove('is-selected');
            }
          }
        });
      }
    });

    // Permitir clic directo en cualquier parte de la tarjeta o píldora
    formEl.addEventListener('click', (e) => {
      const pill = e.target.closest('.number-pill-option');
      if (pill) {
        const radio = pill.querySelector('input[type="radio"]');
        if (radio && !radio.disabled) {
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });
  }

  // ── 10. Progreso y Estado de Entrega ───────────────────────────
  async function checkAndRestoreProgress(username, examId) {
    try {
      const res = await fetch(`/api/progress/${username}/${examId}`);
      const data = await res.json();

      if (!data.success) return;

      if (data.status === 'submitted') {
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
      } else {
        // Primera vez que entra: mostrar modal de selección si no lo ha visto en esta sesión
        const seenWelcome = sessionStorage.getItem('movers_seen_welcome');
        if (!seenWelcome) {
          const welcomeModal = document.getElementById('welcome-section-modal');
          if (welcomeModal) welcomeModal.style.display = 'flex';
        }
      }

      startAutoSave();

    } catch (err) {
      console.error('Error verificando progreso:', err);
      startAutoSave();
    }
  }

  function setSubmittedMode(progressData) {
    const banner = document.getElementById('submitted-banner');
    banner.style.display = 'block';

    if (progressData?.autoScore != null) {
      document.getElementById('submitted-score').textContent =
        `${progressData.autoScore} / ${progressData.maxAutoScore} correctas`;
    }

    if (progressData?.answers) {
      fillAnswers(progressData.answers);
    }

    // Deshabilitar inputs
    document.querySelectorAll('#movers-exam-form input').forEach(el => {
      el.disabled = true;
    });
    document.getElementById('action-bar').style.display = 'none';
  }

  // ── 11. Auto-guardado cada 60 segundos ─────────────────────────
  function startAutoSave() {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    autoSaveInterval = setInterval(async () => {
      if (!examIsSubmitted) {
        await autoSaveProgress(true);
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
        if (!silent) showToast('ℹ️ Este examen ya fue entregado anteriormente.');
        return;
      }

      if (data.success) {
        if (!silent) {
          showToast('💾 ¡Progreso guardado correctamente (Listening y Reading)!');
        } else {
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

  // ── 12. Botón: Guardar Progreso ─────────────────────────────────
  document.getElementById('btn-save-progress').addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-progress');
    btn.disabled = true;
    btn.textContent = '⏳ Guardando…';
    await autoSaveProgress(false);
    btn.disabled = false;
    btn.textContent = '💾 Guardar Progreso';
  });

  // ── 13. Botón: Entregar Examen ──────────────────────────────────
  document.getElementById('btn-submit-exam').addEventListener('click', async () => {
    if (examIsSubmitted) return;

    pauseAllAudios();

    const answers = collectAnswers();
    const totalInputs = document.querySelectorAll('#movers-exam-form input[type="text"], #movers-exam-form input[type="radio"]').length;
    const answeredCount = Object.keys(answers).length;

    let confirmMsg;
    if (answeredCount < 10) {
      confirmMsg = `⚠️ Solo has respondido ${answeredCount} preguntas en total (Listening + Reading).\n¿Estás seguro de que deseas entregar? No podrás modificar tus respuestas después.`;
    } else {
      confirmMsg = `📥 ¿Confirmas que deseas entregar tu examen a tu profesor?\nHas respondido ${answeredCount} preguntas (Listening y Reading & Writing).`;
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
        examIsSubmitted = true;

        // Calcular puntajes por sección para el modal
        let listeningCorrect = 0;
        let listeningTotal = 0;
        if (examData?.listening?.parts) {
          examData.listening.parts.forEach(part => {
            (part.questions || []).forEach(q => {
              listeningTotal++;
              const userVal = (answers[q.id] || '').trim();
              if (userVal && (userVal.toLowerCase() === (q.answer || '').toLowerCase())) {
                listeningCorrect++;
              }
            });
          });
        }

        const readingTotal = data.maxAutoScore - listeningTotal;
        const readingCorrect = Math.max(0, data.autoScore - listeningCorrect);

        document.getElementById('res-listening-score').textContent = `${listeningCorrect} / ${listeningTotal} correctas`;
        document.getElementById('res-reading-score').textContent = `${readingCorrect} / ${readingTotal} correctas`;
        document.getElementById('res-total-score').textContent = `${data.autoScore} / ${data.maxAutoScore} pts`;

        document.getElementById('results-modal').style.display = 'flex';
      } else {
        alert(data.message || 'Error al entregar el examen. Intenta de nuevo.');
        btn.disabled = false;
        btn.textContent = '📥 Entregar Examen Completo';
      }
    } catch (err) {
      console.error('Error entregando examen:', err);
      alert('Error de conexión. Guarda tu progreso y vuelve a intentarlo.');
      btn.disabled = false;
      btn.textContent = '📥 Entregar Examen Completo';
    }
  });

  // ── 14. Toast ───────────────────────────────────────────────────
  function showToast(msg) {
    const toast = document.getElementById('toast-msg');
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 4000);
  }

  // ── 15. Guardar al salir de pestaña ─────────────────────────────
  window.addEventListener('beforeunload', () => {
    if (!examIsSubmitted) {
      const answers = collectAnswers();
      if (Object.keys(answers).length > 0) {
        const payload = JSON.stringify({ username: currentStudent.username, examId: currentExamId, answers });
        navigator.sendBeacon('/api/progress/save', new Blob([payload], { type: 'application/json' }));
      }
    }
  });
});
