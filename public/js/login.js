document.addEventListener('DOMContentLoaded', async () => {
  const studentSelect = document.getElementById('studentSelect');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const loginForm = document.getElementById('student-login-form');
  const errorMsg = document.getElementById('login-error-msg');

  // Cargar lista de alumnos de 4A y 4B
  try {
    const res = await fetch('/api/students/list');
    const data = await res.json();

    if (data.success && data.students) {
      studentSelect.innerHTML = '<option value="">-- Buscar mi nombre en la lista --</option>';

      const gradesMap = {};
      data.students.forEach(st => {
        const g = st.grade || '4to A';
        if (!gradesMap[g]) gradesMap[g] = [];
        gradesMap[g].push(st);
      });

      Object.keys(gradesMap).sort().forEach(gradeName => {
        const groupEl = document.createElement('optgroup');
        groupEl.label = `─── GRADO ${gradeName.toUpperCase()} ───`;
        gradesMap[gradeName].forEach(st => {
          const opt = document.createElement('option');
          opt.value = st.username;
          opt.textContent = `${st.lastName} ${st.firstName}`;
          groupEl.appendChild(opt);
        });
        studentSelect.appendChild(groupEl);
      });
    }
  } catch (err) {
    console.error('Error cargando lista de alumnos:', err);
  }

  // Al seleccionar de la lista, auto-completar usuario y clave
  studentSelect.addEventListener('change', () => {
    const val = studentSelect.value;
    if (val) {
      usernameInput.value = val;
      passwordInput.value = val;
    }
  });

  // Enviar formulario de login
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorMsg.style.display = 'none';

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    try {
      const res = await fetch('/api/students/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (data.success) {
        localStorage.setItem('movers_student', JSON.stringify(data.student));
        window.location.href = '/exam';
      } else {
        errorMsg.textContent = data.message || 'Usuario o contraseña incorrectos.';
        errorMsg.style.display = 'block';
      }
    } catch (err) {
      console.error('Error en inicio de sesión:', err);
      errorMsg.textContent = 'Error de conexión al servidor.';
      errorMsg.style.display = 'block';
    }
  });
});
