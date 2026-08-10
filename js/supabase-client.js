// Cliente único de Supabase, compartido por todos los módulos de la app.
//
// SUPABASE_USER_ID ya NO es un placeholder fijo (Fase B del login real) -- lo completa auth.js
// con el id del usuario autenticado en cuanto hay una sesión válida (supabase.auth.getUser()).
// Empieza en null a propósito: cualquier llamada que se dispare antes del login manda user_id
// null en vez de un valor prestado de otro usuario, así falla de forma obvia en vez de escribir
// datos bajo un id equivocado.
(function () {
  'use strict';
  window.SUPABASE_USER_ID = null;
  window.supabaseClient = supabase.createClient(
    'https://vuxrrrcpbrfquublnqon.supabase.co',
    'sb_publishable_75sLmS--x930dxnDbhKLrw_3zHNY4Qk'
  );
})();
