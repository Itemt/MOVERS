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

  let currentPin = '';
  let allStudentsData = [];
  let currentGradeFilter = '4to A';

  pinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    currentPin = pinInput.value.trim();
    loadDashboard(currentPin);
  });

  refreshBtn.addEventListener('click', () => {
    if (currentPin) loadDashboard(currentPin);
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

  async function loadDashboard(pin) {
    errorMsg.style.display = 'none';
    try {
      const res = await fetch(`/api/admin/submissions?pin=${encodeURIComponent(pin)}`);
      const data = await res.json();

      if (!data.success) {
        errorMsg.textContent = data.message || 'PIN incorrecto.';
        errorMsg.style.display = 'block';
        return;
      }

      authCard.style.display = 'none';
      dashboardContent.style.display = 'block';
      allStudentsData = data.students || [];
      renderTable();

    } catch (err) {
      console.error('Error en admin:', err);
      errorMsg.textContent = 'Error de conexión.';
      errorMsg.style.display = 'block';
    }
  }

  function renderTable() {
    const filtered = allStudentsData.filter(st => (st.grade || '4to A') === currentGradeFilter);

    if (!filtered || filtered.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 20px;">No hay alumnos en el ${currentGradeFilter}.</td></tr>`;
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
        </tr>
      `;
    });

    tableBody.innerHTML = html;
  }
});
