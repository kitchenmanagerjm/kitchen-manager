// FASE A: pantalla de login/logout y "tapado" de la app mientras no haya sesión válida.
// FASE B (este bloque): las 17 tablas + el bucket de fotos ya exigen `auth.role() =
// 'authenticated'` en Supabase -- por eso este script ahora también:
//   1. completa window.SUPABASE_USER_ID con el id REAL del usuario autenticado (antes era un
//      placeholder fijo, ver js/supabase-client.js) para que los inserts/RPCs de app.js
//      (que ya leen ese global, sin cambios en esos ~20 sitios) guarden bajo el usuario correcto.
//   2. avisa a app.js cuándo es seguro empezar a sincronizar con Supabase -- app.js expone
//      window.iniciarSincronizacionConSupabase() pero ya NO se llama solo al cargar el script,
//      para no disparar consultas contra tablas que ahora exigen sesión.
// Este script corre ANTES que app.js (justo después de supabase-client.js), así que no puede
// depender de nada que app.js todavía no haya inicializado.
(function () {
  'use strict';

  // id del usuario para el que ya se disparó (o se está disparando) la sincronización -- evita
  // volver a correr toda la cadena de sincronizarXDesdeSupabase() en cada evento de
  // onAuthStateChange que trae la MISMA sesión (por ej. TOKEN_REFRESHED), y sí la vuelve a
  // correr si cambia el usuario (alguien cierra sesión y otra cuenta inicia sesión después, sin
  // recargar la página).
  let usuarioSincronizadoId = null;
  // el callback que registra app.js (más abajo, vía window.registrarInicioSincronizacion) --
  // solo hay un consumidor real, así que no hace falta una lista de suscriptores genérica.
  let callbackInicioSincronizacion = null;
  window.registrarInicioSincronizacion = function (cb) {
    callbackInicioSincronizacion = cb;
    if (usuarioSincronizadoId) cb(); // la sesión ya estaba lista antes de que app.js se registrara
  };

  const overlay = document.getElementById('authOverlay');
  const form = document.getElementById('formLogin');
  const inputEmail = document.getElementById('loginEmail');
  const inputPassword = document.getElementById('loginPassword');
  const errorEl = document.getElementById('loginError');
  const btnLogin = document.getElementById('btnLogin');
  const btnCerrarSesion = document.getElementById('btnCerrarSesion');
  const formSolicitarCodigo = document.getElementById('formSolicitarCodigo');
  const formRestablecerConCodigo = document.getElementById('formRestablecerConCodigo');

  // mismo branding configurable que ya usa el resto de la app (Configuración > Nombre/Logo) --
  // se lee directo de localStorage (mismas claves que usa app.js) porque este script corre
  // antes de que app.js exista para aplicarlas él mismo.
  function aplicarBrandingLogin() {
    try {
      const logo = localStorage.getItem('costeo_logo_v1');
      document.getElementById('authLogoIcono').innerHTML = logo ? `<img src="${logo}" alt="Logo">` : '🍽️';
      const nombre = localStorage.getItem('costeo_nombre_app_v1');
      if (nombre) document.getElementById('authLogoNombre').textContent = nombre;
    } catch (e) { /* localStorage no disponible: se queda con el branding por defecto del HTML */ }
  }
  aplicarBrandingLogin();

  const LS_ULTIMO_EMAIL = 'ultimoEmailLogin';

  // ---------------- recuperar contraseña (código OTP por correo, sin link/redirect) ----------
  // La app corre desde file:///, así que un link mágico de recuperación no puede completar el
  // círculo (los navegadores bloquean que un sitio HTTPS redirija a file://). En vez de eso, el
  // template "Reset Password" en Supabase está configurado para mostrar {{ .Token }} (un código
  // de 6 dígitos) además del link -- el usuario copia ese código y lo pega de vuelta aquí mismo,
  // sin necesitar ningún redirect.
  let emailRecuperacionActual = '';

  function mostrarPanelLogin() {
    form.hidden = false;
    formSolicitarCodigo.hidden = true;
    formRestablecerConCodigo.hidden = true;
    errorEl.hidden = true;
  }
  function mostrarPanelSolicitarCodigo() {
    form.hidden = true;
    formSolicitarCodigo.hidden = false;
    formRestablecerConCodigo.hidden = true;
    document.getElementById('recuperarSolicitarError').hidden = true;
    const actual = inputEmail.value.trim();
    document.getElementById('recuperarEmail').value = actual.includes('@') ? actual : '';
  }
  function mostrarPanelRestablecer() {
    form.hidden = true;
    formSolicitarCodigo.hidden = true;
    formRestablecerConCodigo.hidden = false;
    document.getElementById('recuperarCodigoError').hidden = true;
    document.getElementById('recuperarCodigo').value = '';
    document.getElementById('recuperarNuevaPassword').value = '';
    document.getElementById('recuperarConfirmarPassword').value = '';
  }

  document.getElementById('btnOlvideContrasena').addEventListener('click', mostrarPanelSolicitarCodigo);
  document.getElementById('btnVolverLoginDesdeSolicitar').addEventListener('click', mostrarPanelLogin);
  document.getElementById('btnVolverLoginDesdeCodigo').addEventListener('click', mostrarPanelLogin);

  formSolicitarCodigo.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('recuperarEmail').value.trim();
    const btn = document.getElementById('btnEnviarCodigo');
    btn.disabled = true;
    btn.textContent = 'Enviando...';
    try {
      await window.supabaseClient.auth.resetPasswordForEmail(email);
    } catch (err) {
      // se ignora a propósito: mismo criterio de seguridad de no revelar si el email existe --
      // ver mostrarPanelRestablecer(), que muestra el mismo mensaje genérico sin importar el
      // resultado real de esta llamada (incluso ante un error de red).
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enviar código';
    }
    emailRecuperacionActual = email;
    mostrarPanelRestablecer();
  });

  formRestablecerConCodigo.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('recuperarCodigoError');
    errEl.hidden = true;
    const codigo = document.getElementById('recuperarCodigo').value.trim();
    const nueva = document.getElementById('recuperarNuevaPassword').value;
    const confirmar = document.getElementById('recuperarConfirmarPassword').value;

    if (nueva !== confirmar) { errEl.textContent = 'Las contraseñas no coinciden.'; errEl.hidden = false; return; }
    if (nueva.length < 6) { errEl.textContent = 'La contraseña debe tener al menos 6 caracteres.'; errEl.hidden = false; return; }

    const btn = document.getElementById('btnRestablecerPassword');
    btn.disabled = true;
    btn.textContent = 'Verificando...';
    try {
      const { error: errVerify } = await window.supabaseClient.auth.verifyOtp({
        email: emailRecuperacionActual,
        token: codigo,
        type: 'recovery',
      });
      if (errVerify) {
        errEl.textContent = 'Código incorrecto o vencido. Vuelve a solicitar uno nuevo.';
        errEl.hidden = false;
        return;
      }
      // verifyOtp ya deja una sesión real activa (así funciona la recuperación en Supabase) --
      // por eso updateUser puede llamarse directo, sin pedir la contraseña actual.
      const { error: errUpdate } = await window.supabaseClient.auth.updateUser({ password: nueva });
      if (errUpdate) {
        errEl.textContent = `No se pudo actualizar la contraseña: ${errUpdate.message || errUpdate}`;
        errEl.hidden = false;
        return;
      }
      // éxito: la sesión ya está activa, el overlay se oculta solo vía onAuthStateChange/
      // manejarSesion (mismo camino que un login normal) -- no hace falta hacer nada más acá.
    } catch (err) {
      errEl.textContent = 'No se pudo conectar con el servidor. Revisa tu conexión a internet.';
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Restablecer contraseña';
    }
  });

  function mostrarOverlay() {
    aplicarBrandingLogin();
    mostrarPanelLogin();
    form.reset();
    // recuerda el último email con el que se inició sesión con éxito (ver el submit de abajo)
    // -- nunca la contraseña, esa la sigue guardando (o no) el propio gestor de contraseñas del
    // navegador, que ya funciona nativamente porque el input tiene autocomplete="current-password"
    // y el formulario no bloquea el autocompletado.
    let ultimoEmail = '';
    try { ultimoEmail = localStorage.getItem(LS_ULTIMO_EMAIL) || ''; } catch (e) { /* localStorage no disponible */ }
    inputEmail.value = ultimoEmail;
    errorEl.hidden = true;
    overlay.hidden = false;
    document.body.classList.add('auth-bloqueado');
    // si el email ya viene precargado, el siguiente campo que hace falta llenar es la contraseña.
    (ultimoEmail ? inputPassword : inputEmail).focus();
  }
  function ocultarOverlay() {
    overlay.hidden = true;
    document.body.classList.remove('auth-bloqueado');
  }

  // Supabase devuelve sus mensajes de error en inglés -- se traducen los casos más comunes;
  // cualquier otro caso no mapeado se muestra tal cual (mejor un mensaje en inglés que ninguno).
  const MENSAJES_ERROR = {
    'Invalid login credentials': 'Email o contraseña incorrectos.',
    'Email not confirmed': 'Este email todavía no fue confirmado.',
    'Too many requests': 'Demasiados intentos. Espera un momento y vuelve a intentar.',
  };
  function traducirError(err) {
    if (!err) return 'No se pudo iniciar sesión.';
    return MENSAJES_ERROR[err.message] || err.message || 'No se pudo iniciar sesión.';
  }

  // login con email O nombre de usuario: perfiles_login (user_id, nickname único, email) es de
  // lectura pública a propósito -- hace falta poder "traducir" nickname -> email ANTES de
  // autenticar, cuando todavía no hay sesión. Si el texto no tiene "@", se busca el nickname
  // (normalizado a minúsculas, igual que al guardarlo -- ver el formulario de "Mi cuenta") y se
  // usa el email asociado para el signInWithPassword real. Si no hay ningún nickname que
  // coincida, se sigue intentando con el texto tal cual como si fuera un email -- falla con el
  // mismo error genérico de credenciales incorrectas, sin revelar si el nickname existe o no.
  async function resolverEmailDeLogin(entrada) {
    if (entrada.includes('@')) return entrada;
    try {
      const { data } = await window.supabaseClient
        .from('perfiles_login')
        .select('email')
        .eq('nickname', entrada.trim().toLowerCase())
        .maybeSingle();
      return (data && data.email) || entrada;
    } catch (e) {
      return entrada;
    }
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    errorEl.hidden = true;
    btnLogin.disabled = true;
    btnLogin.textContent = 'Ingresando...';
    try {
      const entrada = inputEmail.value.trim();
      const email = await resolverEmailDeLogin(entrada);
      const { error } = await window.supabaseClient.auth.signInWithPassword({
        email,
        password: inputPassword.value,
      });
      if (error) {
        errorEl.textContent = traducirError(error);
        errorEl.hidden = false;
        return;
      }
      // se recuerda tal cual lo que la persona escribió (email o nickname), no el email
      // resuelto -- así la próxima vez ve precargado lo mismo que escribió.
      try { localStorage.setItem(LS_ULTIMO_EMAIL, entrada); } catch (e) { /* localStorage no disponible */ }
      // si el login fue exitoso, onAuthStateChange (más abajo) oculta el overlay solo.
      inputPassword.value = '';
    } catch (err) {
      errorEl.textContent = 'No se pudo conectar con el servidor. Revisa tu conexión a internet.';
      errorEl.hidden = false;
    } finally {
      btnLogin.disabled = false;
      btnLogin.textContent = 'Ingresar';
    }
  });

  btnCerrarSesion.addEventListener('click', async () => {
    await window.supabaseClient.auth.signOut();
    // la pantalla de login vuelve sola via onAuthStateChange (evento SIGNED_OUT, sesión null).
  });

  // único punto donde se decide qué hacer con una sesión (o su ausencia) -- tanto
  // onAuthStateChange como el getSession() explícito de abajo pasan por acá, así nunca quedan
  // dos caminos separados que puedan decidir cosas distintas.
  function manejarSesion(session) {
    const nuevoUsuarioId = session ? session.user.id : null;
    window.SUPABASE_USER_ID = nuevoUsuarioId;

    if (!nuevoUsuarioId) {
      usuarioSincronizadoId = null;
      mostrarOverlay();
      return;
    }
    ocultarOverlay();
    if (nuevoUsuarioId === usuarioSincronizadoId) return; // misma sesión de siempre (ej. TOKEN_REFRESHED): no re-sincronizar
    usuarioSincronizadoId = nuevoUsuarioId;
    if (callbackInicioSincronizacion) callbackInicioSincronizacion();
  }

  window.supabaseClient.auth.onAuthStateChange((_evento, session) => manejarSesion(session));

  // onAuthStateChange ya entrega el estado inicial (INITIAL_SESSION) al suscribirse, pero se
  // llama getSession() explícitamente también, tal como se pidió, para no depender solo de ese
  // comportamiento y no dejar la pantalla de login parpadeando mientras se resuelve. Pasa por el
  // mismo manejarSesion(), que ya ignora sesiones repetidas -- no hay riesgo de sincronizar dos
  // veces si ambos caminos llegan con la misma sesión.
  window.supabaseClient.auth.getSession().then(({ data }) => manejarSesion(data && data.session));
})();
