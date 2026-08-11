(function () {
  'use strict';

  const LS_INSUMOS = 'costeo_insumos_v1';
  const LS_RECETAS = 'costeo_recetas_v1';
  const LS_CAT_INSUMOS = 'costeo_categorias_insumos_v1';
  const LS_CAT_RECETAS = 'costeo_categorias_recetas_v1';
  const LS_PEDIDOS = 'costeo_pedidos_v1';
  const LS_CLIENTES = 'costeo_clientes_v1';
  const LS_PAPELERA = 'costeo_papelera_v1';
  const LS_JORNADAS = 'costeo_jornadas_v1';
  const LS_GASTOS = 'costeo_gastos_v1';
  const LS_CAPITAL = 'costeo_capital_v1';
  const LS_DONACIONES = 'costeo_donaciones_v1';
  const LS_CAT_GASTOS = 'costeo_categorias_gastos_v1';
  const LS_PEDIDOS_FILTRO = 'costeo_pedidos_filtro_v1';
  const LS_PEDIDO_CONTADOR = 'costeo_pedido_contador_v1';
  const LS_TEMA = 'costeo_tema_v1';
  const LS_FONDO = 'costeo_fondo_v1'; // clave antigua (una sola imagen); se migra a LS_FONDOS
  const LS_FONDOS = 'costeo_fondos_v1';
  const LS_FONDO_ACTIVO = 'costeo_fondo_activo_v1';
  const LS_FONDO_AJUSTE = 'costeo_fondo_ajuste_v1';
  const LS_FONDO_OPACIDAD = 'costeo_fondo_opacidad_v1';
  const LS_LOGO = 'costeo_logo_v1';
  const LS_NOMBRE_APP = 'costeo_nombre_app_v1';
  const LS_SUBTITULO_APP = 'costeo_subtitulo_app_v1';
  const LS_SEEDED = 'costeo_seeded_v1';

  const CATEGORIAS_INSUMOS_DEFAULT = ['Carnes', 'Verduras y frutas', 'Lácteos y huevos', 'Granos y cereales', 'Condimentos y especias', 'Salsas y aceites', 'Bebidas', 'Empaques', 'Otros'];
  const CATEGORIAS_RECETAS_DEFAULT = ['Entradas', 'Platos fuertes', 'Acompañamientos', 'Postres', 'Bebidas', 'Otros'];
  const CATEGORIAS_GASTOS_DEFAULT = ['Insumos', 'Transporte', 'Servicios', 'Nómina', 'Arriendo', 'Otros'];

  // Todas las cantidades se normalizan a una unidad base por grupo (g, ml o unidad)
  // para poder comparar/convertir entre unidades de compra y de uso.
  const UNITS = {
    kg:     { label: 'kg (kilogramo)', group: 'peso',    factor: 1000 },
    g:      { label: 'g (gramo)',      group: 'peso',    factor: 1 },
    libra:  { label: 'lb (libra)',     group: 'peso',    factor: 453.592 },
    l:      { label: 'l (litro)',      group: 'volumen', factor: 1000 },
    ml:     { label: 'ml (mililitro)', group: 'volumen', factor: 1 },
    unidad: { label: 'unidad',         group: 'conteo',  factor: 1 },
    docena: { label: 'docena',         group: 'conteo',  factor: 12 },
  };

  let insumos = loadInsumos();
  let recetas = loadRecetas();
  // nombre de recetas que están en la Papelera de Supabase (deleted_at marcado, pero la fila
  // sigue existiendo) — para que Pedidos pueda mostrar el nombre real + una etiqueta
  // "Eliminado" en vez del genérico "(plato eliminado)" (que solo aplica cuando la receta
  // fue borrada DEFINITIVAMENTE y ya no queda ninguna fila de la que sacar el nombre).
  let recetasEliminadasPorId = new Map();
  let categoriasInsumos = loadList(LS_CAT_INSUMOS, CATEGORIAS_INSUMOS_DEFAULT).sort((a, b) => a.localeCompare(b));
  let categoriasRecetas = loadList(LS_CAT_RECETAS, CATEGORIAS_RECETAS_DEFAULT).sort((a, b) => a.localeCompare(b));
  let papelera = loadPapelera();
  seedDemoDataOnFirstRun();
  migrarRecetasLegacy();

  // Versiones antiguas guardaban "costos indirectos" y "mano de obra" como % del costo
  // de ingredientes. Se convierten una sola vez a montos fijos (costosAdicionales),
  // que es el nuevo formato editable en la receta.
  function migrarRecetasLegacy() {
    let cambiado = false;
    recetas.forEach(r => {
      if (r.foto === undefined) { r.foto = null; cambiado = true; }
      if (!r.costosAdicionales) {
        const costoIngredientes = (r.ingredientes || []).reduce((s, ing) => s + calcIngrediente(ing.insumoId, ing.cantidad, ing.unidad).costo, 0);
        const items = [];
        if (r.indirectosPct) items.push({ concepto: 'Costos indirectos', valor: Math.round(costoIngredientes * (r.indirectosPct / 100)) });
        if (r.manoObraPct) items.push({ concepto: 'Mano de obra', valor: Math.round(costoIngredientes * (r.manoObraPct / 100)) });
        r.costosAdicionales = items;
        delete r.indirectosPct;
        delete r.manoObraPct;
        cambiado = true;
      }
      // Los costos adicionales se guardaban como un monto único (valor); ahora se
      // manejan como cantidad × precio unitario, igual que los ingredientes.
      r.costosAdicionales.forEach(c => {
        if (c.precioUnitario === undefined) {
          c.cantidad = 1;
          c.precioUnitario = c.valor || 0;
          delete c.valor;
          cambiado = true;
        }
      });
    });
    if (cambiado) saveRecetas();
  }

  // ---------------- storage ----------------
  function loadInsumos() {
    try { return JSON.parse(localStorage.getItem(LS_INSUMOS)) || []; }
    catch (e) { return []; }
  }
  function loadRecetas() {
    try { return JSON.parse(localStorage.getItem(LS_RECETAS)) || []; }
    catch (e) { return []; }
  }
  function loadList(key, defaults) {
    try {
      const stored = JSON.parse(localStorage.getItem(key));
      return Array.isArray(stored) ? stored : defaults.slice();
    } catch (e) { return defaults.slice(); }
  }
  function saveInsumos() { localStorage.setItem(LS_INSUMOS, JSON.stringify(insumos)); }
  function saveRecetas() { localStorage.setItem(LS_RECETAS, JSON.stringify(recetas)); }
  function saveCategoriasInsumos() { localStorage.setItem(LS_CAT_INSUMOS, JSON.stringify(categoriasInsumos)); }
  function saveCategoriasRecetas() { localStorage.setItem(LS_CAT_RECETAS, JSON.stringify(categoriasRecetas)); }
  function saveCategoriasGastos() { localStorage.setItem(LS_CAT_GASTOS, JSON.stringify(categoriasGastos)); }
  function loadJornadas() { try { return JSON.parse(localStorage.getItem(LS_JORNADAS)) || []; } catch (e) { return []; } }
  function saveJornadas() { localStorage.setItem(LS_JORNADAS, JSON.stringify(jornadas)); }
  function loadGastos() { try { return JSON.parse(localStorage.getItem(LS_GASTOS)) || []; } catch (e) { return []; } }
  function saveGastos() { localStorage.setItem(LS_GASTOS, JSON.stringify(gastos)); }
  function loadCapital() { try { return JSON.parse(localStorage.getItem(LS_CAPITAL)) || []; } catch (e) { return []; } }
  function saveCapital() { localStorage.setItem(LS_CAPITAL, JSON.stringify(capitalMovimientos)); }
  function loadDonaciones() { try { return JSON.parse(localStorage.getItem(LS_DONACIONES)) || []; } catch (e) { return []; } }
  function saveDonaciones() { localStorage.setItem(LS_DONACIONES, JSON.stringify(donaciones)); }
  function loadPapelera() {
    try {
      const stored = JSON.parse(localStorage.getItem(LS_PAPELERA)) || {};
      return {
        insumos: Array.isArray(stored.insumos) ? stored.insumos : [],
        recetas: Array.isArray(stored.recetas) ? stored.recetas : [],
        pedidos: Array.isArray(stored.pedidos) ? stored.pedidos : [],
        clientes: Array.isArray(stored.clientes) ? stored.clientes : [],
        jornadas: Array.isArray(stored.jornadas) ? stored.jornadas : [],
        gastos: Array.isArray(stored.gastos) ? stored.gastos : [],
        capitalMovimientos: Array.isArray(stored.capitalMovimientos) ? stored.capitalMovimientos : [],
        donaciones: Array.isArray(stored.donaciones) ? stored.donaciones : [],
      };
    } catch (e) {
      return { insumos: [], recetas: [], pedidos: [], clientes: [], jornadas: [], gastos: [], capitalMovimientos: [], donaciones: [] };
    }
  }
  function savePapelera() { localStorage.setItem(LS_PAPELERA, JSON.stringify(papelera)); }
  function moverAPapelera(tipo, item) {
    papelera[tipo].unshift({ item, eliminadoEn: new Date().toISOString() });
    savePapelera();
  }

  // Los datos de ejemplo solo se cargan una vez, la primera vez que se abre la app:
  // si el usuario borra todo después, no queremos que la demo reaparezca.
  function seedDemoDataOnFirstRun() {
    if (localStorage.getItem(LS_SEEDED)) return;
    localStorage.setItem(LS_SEEDED, '1');
    if (insumos.length || recetas.length) return;
    const now = new Date().toISOString();
    insumos = [
      { id: uid(), nombre: 'Pechuga de pollo', categoria: 'Carnes', unidad: 'kg', precio: 14000, proveedor: '', actualizado: now },
      { id: uid(), nombre: 'Arroz blanco', categoria: 'Granos y cereales', unidad: 'kg', precio: 3800, proveedor: '', actualizado: now },
      { id: uid(), nombre: 'Aceite vegetal', categoria: 'Salsas y aceites', unidad: 'l', precio: 8500, proveedor: '', actualizado: now },
      { id: uid(), nombre: 'Cebolla', categoria: 'Verduras y frutas', unidad: 'kg', precio: 2200, proveedor: '', actualizado: now },
    ];
    saveInsumos();
    const arroz = insumos[1], pollo = insumos[0], aceite = insumos[2], cebolla = insumos[3];
    recetas = [{
      id: uid(), nombre: 'Arroz con pollo', categoria: 'Platos fuertes', porciones: 4,
      ingredientes: [
        { insumoId: pollo.id, cantidad: 500, unidad: 'g' },
        { insumoId: arroz.id, cantidad: 400, unidad: 'g' },
        { insumoId: aceite.id, cantidad: 30, unidad: 'ml' },
        { insumoId: cebolla.id, cantidad: 100, unidad: 'g' },
      ],
      costosAdicionales: [
        { concepto: 'Mano de obra', cantidad: 1, precioUnitario: 1500 },
        { concepto: 'Gas', cantidad: 0.3, precioUnitario: 1000 },
        { concepto: 'Empaques', cantidad: 4, precioUnitario: 50 },
      ],
      margenPct: 150, precioVenta: null, foto: null,
    }];
    saveRecetas();
  }

  function uid() {
    return 'id_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  }

  function money(n) {
    if (!isFinite(n)) n = 0;
    return 'Bs ' + n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function pct(n) {
    if (!isFinite(n)) n = 0;
    return n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + '%';
  }
  function fecha(iso) {
    if (!iso) return '—';
    // si es una fecha "pura" (YYYY-MM-DD, sin hora -- como jornada.fecha, gasto.fecha,
    // capital.fecha, pedido.fechaEntrega), se ancla a medianoche LOCAL antes de crear el Date.
    // Sin esto, new Date("2026-08-09") se interpreta como medianoche UTC, y en cualquier
    // timezone con offset negativo (ej. America/La_Paz, UTC-4) se muestra un día antes del
    // real. Los timestamps completos (con hora, como "actualizado"/"eliminadoEn") ya traen su
    // propio huso horario embebido y se parsean tal cual, sin tocarlos.
    const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T00:00:00') : new Date(iso);
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------- mayúscula automática en la primera letra (todos los campos de texto) ----------------
  // Un solo listener delegado en document, en vez de tocar cada <input>/<textarea> uno por uno --
  // así también cubre campos que se crean dinámicamente (filas de pedido, etc.) sin cablear nada
  // extra. Se excluyen los buscadores (type="search", no tiene sentido "corregir" lo que se está
  // filtrando), los campos que ya fuerzan TODO en mayúscula (.input-mayusculas -- ahí ponerle
  // mayúscula solo a la primera letra sería redundante, el submit ya hace .toUpperCase() completo),
  // y los campos donde "corregir" mayúsculas es directamente indeseado (.sin-auto-mayuscula --
  // ej. el login, que acepta un nickname o email y donde puede importar la capitalización exacta).
  document.addEventListener('input', e => {
    const el = e.target;
    const esTextarea = el.tagName === 'TEXTAREA';
    const esInputTexto = el.tagName === 'INPUT' && el.type === 'text';
    if (!esTextarea && !esInputTexto) return;
    if (el.classList.contains('input-mayusculas')) return;
    if (el.classList.contains('sin-auto-mayuscula')) return;
    const v = el.value;
    if (!v) return;
    const primera = v.charAt(0);
    const primeraMayus = primera.toLocaleUpperCase('es');
    if (primera === primeraMayus) return;
    const inicio = el.selectionStart, fin = el.selectionEnd;
    el.value = primeraMayus + v.slice(1);
    // reponer la posición del cursor -- si no, al reescribir .value el navegador lo manda al final
    if (inicio !== null) el.setSelectionRange(inicio, fin);
  });

  // ---------------- mostrar/ocultar contraseña (👁/🙈) ----------------
  // Un solo listener delegado en document (mismo patrón que la mayúscula automática arriba) --
  // cubre los 3 lugares con campos de contraseña (Login, Recuperar contraseña, Mi cuenta) sin
  // tener que cablear cada botón por separado. data-toggle-password="idDelInput" identifica
  // cuál campo alternar.
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-toggle-password]');
    if (!btn) return;
    const input = document.getElementById(btn.getAttribute('data-toggle-password'));
    if (!input) return;
    const estabaOculta = input.type === 'password';
    input.type = estabaOculta ? 'text' : 'password';
    btn.textContent = estabaOculta ? '🙈' : '👁';
    btn.title = estabaOculta ? 'Ocultar contraseña' : 'Mostrar contraseña';
    btn.setAttribute('aria-label', btn.title);
  });

  // ---------------- toast ----------------
  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
  }

  // ---------------- modal helpers ----------------
  function openModal(id) { document.getElementById(id).hidden = false; }
  function closeModal(id) {
    document.getElementById(id).hidden = true;
    // si se cierra el modal de cliente mientras se creaba "al vuelo" desde un pedido
    // (sin llegar a guardar), hay que volver a mostrar el modal de pedido que quedó oculto.
    if (id === 'modalCliente' && quickAddClienteActivo) {
      quickAddClienteActivo = false;
      document.getElementById('modalPedido').hidden = false;
    }
    // se cerró (Cancelar) el formulario de "+ Agregar gasto" abierto desde el detalle de una
    // Jornada, sin llegar a guardar -- se vuelve a mostrar ese detalle tal cual estaba (no hace
    // falta refrescarlo, no cambió nada).
    if (id === 'modalGasto' && gastoDesdeJornadaId) {
      gastoDesdeJornadaId = null;
      document.getElementById('modalDetalleJornada').hidden = false;
    }
    // modalDonacion siempre se abre desde el detalle de una Jornada (no existe otra pantalla
    // para gestionar donaciones) -- al cerrarlo, sea por Cancelar o tras guardar, se restaura
    // la visibilidad del detalle. Si se guardó, el submit ya llama a abrirDetalleJornada()
    // después de esto, así que no hace falta distinguir los dos casos con una bandera.
    if (id === 'modalDonacion') {
      document.getElementById('modalDetalleJornada').hidden = false;
    }
  }
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close-modal')));
  });
  // Antes cerraba al hacer clic en el backdrop (fuera del modal) -- se quitó a propósito:
  // un clic accidental fuera de la ventana perdía todo lo escrito. Ahora un modal solo se
  // cierra con sus botones explícitos (Cancelar/Guardar/Cerrar, según el caso).

  // ---------------- tabs ----------------
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
      // mismo criterio que Rentabilidad (ver el listener de #subtabsFinanzas): se recalcula
      // fresco cada vez que se abre esta pestaña, no en cada mutación de Pedidos/Jornadas.
      if (btn.dataset.view === 'calendario') renderCalendario();
      // el carrito es compartido entre cuentas (Supabase, sin copia local) -- se recalcula
      // fresco cada vez que se abre la pestaña, mismo criterio que Calendario/Rentabilidad.
      if (btn.dataset.view === 'compras') renderCompras();
    });
  });

  // =========================================================
  //  CONFIGURACIÓN (tema y fondo)
  // =========================================================
  function aplicarTema(tema) {
    if (tema === 'light' || tema === 'dark') document.documentElement.setAttribute('data-theme', tema);
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem(LS_TEMA, tema);
    document.querySelectorAll('.tema-btn').forEach(b => b.classList.toggle('active', b.dataset.tema === tema));
  }

  function aplicarLogo(dataUrl) {
    const icono = document.getElementById('topbarIcono');
    const preview = document.getElementById('logoPreview');
    const btnQuitar = document.getElementById('btnQuitarLogo');
    if (dataUrl) {
      icono.innerHTML = `<img src="${dataUrl}" alt="Logo">`;
      preview.innerHTML = `<img src="${dataUrl}" alt="Logo">`;
      btnQuitar.hidden = false;
    } else {
      icono.textContent = '🍽️';
      preview.innerHTML = '<span class="foto-placeholder">🍽️</span>';
      btnQuitar.hidden = true;
    }
  }

  document.getElementById('logoInput').addEventListener('change', () => {
    const file = document.getElementById('logoInput').files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Selecciona un archivo de imagen.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const LADO_MAX = 256;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > LADO_MAX || h > LADO_MAX) {
          const factor = LADO_MAX / Math.max(w, h);
          w = Math.round(w * factor);
          h = Math.round(h * factor);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/png');
        try {
          localStorage.setItem(LS_LOGO, dataUrl);
          aplicarLogo(dataUrl);
        } catch (e) {
          showToast('El logo es demasiado grande para guardarlo. Prueba con otro.');
        }
      };
      img.onerror = () => showToast('No se pudo leer esa imagen.');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    document.getElementById('logoInput').value = '';
  });

  document.getElementById('btnQuitarLogo').addEventListener('click', () => {
    localStorage.removeItem(LS_LOGO);
    aplicarLogo(null);
  });

  aplicarLogo(localStorage.getItem(LS_LOGO) || null);

  // ---------------- nombre y subtítulo de la plataforma ----------------
  const NOMBRE_APP_DEFAULT = document.getElementById('topbarNombre').textContent;
  const SUBTITULO_APP_DEFAULT = document.getElementById('topbarSubtitulo').textContent;

  function aplicarNombreApp(nombre) {
    const valor = nombre || NOMBRE_APP_DEFAULT;
    document.getElementById('topbarNombre').textContent = valor;
    document.title = valor;
  }
  function aplicarSubtituloApp(subtitulo) {
    document.getElementById('topbarSubtitulo').textContent = subtitulo || SUBTITULO_APP_DEFAULT;
  }

  aplicarNombreApp(localStorage.getItem(LS_NOMBRE_APP) || '');
  aplicarSubtituloApp(localStorage.getItem(LS_SUBTITULO_APP) || '');

  document.getElementById('configNombreApp').addEventListener('input', e => {
    const valor = e.target.value.trim();
    if (valor) localStorage.setItem(LS_NOMBRE_APP, valor); else localStorage.removeItem(LS_NOMBRE_APP);
    aplicarNombreApp(valor);
  });
  document.getElementById('configSubtituloApp').addEventListener('input', e => {
    const valor = e.target.value.trim();
    if (valor) localStorage.setItem(LS_SUBTITULO_APP, valor); else localStorage.removeItem(LS_SUBTITULO_APP);
    aplicarSubtituloApp(valor);
  });

  const FONDOS_MAX = 5;
  const fondoCapa = document.getElementById('fondoCapa');

  function cargarFondos() {
    try { return JSON.parse(localStorage.getItem(LS_FONDOS)) || []; }
    catch (e) { return []; }
  }
  function guardarFondos() { localStorage.setItem(LS_FONDOS, JSON.stringify(fondos)); }

  let fondos = cargarFondos();
  let fondoActivoId = localStorage.getItem(LS_FONDO_ACTIVO) || null;
  let fondoAjuste = localStorage.getItem(LS_FONDO_AJUSTE) || 'cover';
  let fondoOpacidad = parseInt(localStorage.getItem(LS_FONDO_OPACIDAD), 10) || 100;

  // migración: versiones anteriores guardaban una sola imagen suelta (LS_FONDO)
  (function migrarFondoUnico() {
    const anterior = localStorage.getItem(LS_FONDO);
    if (anterior && !fondos.length) {
      const nuevo = { id: uid(), dataUrl: anterior };
      fondos = [nuevo];
      fondoActivoId = nuevo.id;
      guardarFondos();
      localStorage.setItem(LS_FONDO_ACTIVO, fondoActivoId);
    }
    if (anterior) localStorage.removeItem(LS_FONDO);
  })();

  const AJUSTE_ESTILOS = {
    cover: { size: 'cover', repeat: 'no-repeat' },
    contain: { size: 'contain', repeat: 'no-repeat' },
    repeat: { size: 'auto', repeat: 'repeat' },
    stretch: { size: '100% 100%', repeat: 'no-repeat' },
  };

  function aplicarEstiloCapa() {
    const estilo = AJUSTE_ESTILOS[fondoAjuste] || AJUSTE_ESTILOS.cover;
    fondoCapa.style.backgroundSize = estilo.size;
    fondoCapa.style.backgroundRepeat = estilo.repeat;
    fondoCapa.style.opacity = fondoOpacidad / 100;
  }

  function aplicarFondoActivo() {
    const activo = fondos.find(f => f.id === fondoActivoId);
    fondoCapa.style.backgroundImage = activo ? `url(${activo.dataUrl})` : '';
    aplicarEstiloCapa();
  }

  function renderFondosGrid() {
    const grid = document.getElementById('fondosGrid');
    const tileNinguno = `
      <div class="fondo-tile fondo-tile-ninguno ${!fondoActivoId ? 'activo' : ''}" data-fondo-ninguno title="Sin fondo">
        <span class="fondo-tile-ninguno-label">Sin fondo</span>
        ${!fondoActivoId ? '<span class="fondo-tile-check">✓</span>' : ''}
      </div>
    `;
    grid.innerHTML = tileNinguno + fondos.map(f => `
      <div class="fondo-tile ${f.id === fondoActivoId ? 'activo' : ''}" data-fondo-tile="${f.id}" title="Usar como fondo">
        <img src="${f.dataUrl}" alt="Fondo guardado">
        ${f.id === fondoActivoId ? '<span class="fondo-tile-check">✓</span>' : ''}
        <button type="button" class="fondo-tile-del" data-del-fondo="${f.id}" title="Eliminar">✕</button>
      </div>
    `).join('');
    document.getElementById('btnSubirFondoLabel').style.opacity = fondos.length >= FONDOS_MAX ? .5 : 1;

    grid.querySelector('[data-fondo-ninguno]').addEventListener('click', () => {
      fondoActivoId = null;
      localStorage.removeItem(LS_FONDO_ACTIVO);
      aplicarFondoActivo();
      renderFondosGrid();
    });
    grid.querySelectorAll('[data-fondo-tile]').forEach(tile => {
      tile.addEventListener('click', e => {
        if (e.target.closest('[data-del-fondo]')) return;
        fondoActivoId = tile.getAttribute('data-fondo-tile');
        localStorage.setItem(LS_FONDO_ACTIVO, fondoActivoId);
        aplicarFondoActivo();
        renderFondosGrid();
      });
    });
    grid.querySelectorAll('[data-del-fondo]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-del-fondo');
        fondos = fondos.filter(f => f.id !== id);
        guardarFondos();
        if (fondoActivoId === id) {
          fondoActivoId = null;
          localStorage.removeItem(LS_FONDO_ACTIVO);
          aplicarFondoActivo();
        }
        renderFondosGrid();
      });
    });
  }

  // aplica lo guardado apenas carga la app (el tema ya se aplicó antes en <head> para evitar el parpadeo)
  aplicarTema(localStorage.getItem(LS_TEMA) || 'auto');
  aplicarFondoActivo();

  document.getElementById('btnConfiguracion').addEventListener('click', () => {
    renderFondosGrid();
    document.getElementById('fondoAjuste').value = fondoAjuste;
    document.getElementById('fondoOpacidad').value = fondoOpacidad;
    document.getElementById('fondoOpacidadValor').textContent = fondoOpacidad;
    document.getElementById('configNombreApp').value = document.getElementById('topbarNombre').textContent;
    document.getElementById('configSubtituloApp').value = document.getElementById('topbarSubtitulo').textContent;
    openModal('modalConfiguracion');
  });

  document.querySelectorAll('.tema-btn').forEach(btn => {
    btn.addEventListener('click', () => aplicarTema(btn.dataset.tema));
  });

  document.getElementById('fondoInput').addEventListener('change', () => {
    const file = document.getElementById('fondoInput').files[0];
    if (!file) return;
    if (fondos.length >= FONDOS_MAX) { showToast(`Ya tienes ${FONDOS_MAX} imágenes guardadas. Elimina una para agregar otra.`); document.getElementById('fondoInput').value = ''; return; }
    if (!file.type.startsWith('image/')) { showToast('Selecciona un archivo de imagen.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // se redimensiona y comprime antes de guardar: una foto de cámara sin procesar
        // (varios MB) supera el límite de localStorage y antes fallaba en silencio.
        const LADO_MAX = 1600;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > LADO_MAX || h > LADO_MAX) {
          const factor = LADO_MAX / Math.max(w, h);
          w = Math.round(w * factor);
          h = Math.round(h * factor);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        const nuevo = { id: uid(), dataUrl };
        try {
          fondos.push(nuevo);
          guardarFondos();
          fondoActivoId = nuevo.id;
          localStorage.setItem(LS_FONDO_ACTIVO, fondoActivoId);
          aplicarFondoActivo();
          renderFondosGrid();
        } catch (e) {
          fondos.pop();
          showToast('La imagen es demasiado grande para guardarla, incluso comprimida. Prueba con otra.');
        }
      };
      img.onerror = () => showToast('No se pudo leer esa imagen.');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    document.getElementById('fondoInput').value = '';
  });

  document.getElementById('btnQuitarFondo').addEventListener('click', () => {
    fondoActivoId = null;
    localStorage.removeItem(LS_FONDO_ACTIVO);
    aplicarFondoActivo();
    renderFondosGrid();
  });

  document.getElementById('fondoAjuste').addEventListener('change', e => {
    fondoAjuste = e.target.value;
    localStorage.setItem(LS_FONDO_AJUSTE, fondoAjuste);
    aplicarEstiloCapa();
  });

  document.getElementById('fondoOpacidad').addEventListener('input', e => {
    fondoOpacidad = parseInt(e.target.value, 10);
    document.getElementById('fondoOpacidadValor').textContent = fondoOpacidad;
    localStorage.setItem(LS_FONDO_OPACIDAD, fondoOpacidad);
    aplicarEstiloCapa();
  });

  // =========================================================
  //  INSUMOS
  // =========================================================
  const tbodyInsumos = document.getElementById('tbodyInsumos');
  const emptyInsumos = document.getElementById('emptyInsumos');
  const statsInsumos = document.getElementById('statsInsumos');
  const selUnidadInsumo = document.getElementById('insumoUnidad');

  Object.keys(UNITS).forEach(key => {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = UNITS[key].label;
    selUnidadInsumo.appendChild(opt);
  });

  // ---------------- Insumos <-> Supabase ----------------
  // "insumos" sigue viviendo en memoria + localStorage (loadInsumos/saveInsumos, sin cambios)
  // para que el resto de la app (Recetas, Pedidos, etc. — todavía no migrados) sigan leyendo
  // el array de forma síncrona como siempre. Lo que cambia es CUÁNDO se llena ese array y
  // QUIÉN manda al escribir:
  //   - Al cargar la app, se intenta traer la versión más reciente desde Supabase. Si falla
  //     (sin internet, RLS, etc.) se sigue usando lo que ya había en localStorage — ese es el
  //     "fallback/respaldo" que pediste, no se borra ni se bloquea la app por un error de red.
  //   - Alta/edición: se intenta escribir primero en Supabase; solo si eso funciona se aplica
  //     el cambio también en memoria+localStorage. Si Supabase falla, NO se aplica el cambio
  //     local tampoco (para que las dos copias no queden desincronizadas en silencio) y se
  //     avisa con un toast para reintentar.
  function filaSupabaseAInsumo(fila) {
    return {
      id: fila.id,
      nombre: fila.nombre,
      categoria: fila.categoria || '',
      unidad: fila.unidad,
      precio: Number(fila.precio) || 0,
      proveedor: fila.proveedor || '',
      mermaPct: Number(fila.merma_pct) || 0,
      actualizado: fila.updated_at || fila.created_at || null,
    };
  }

  // costo efectivo de un insumo tomando en cuenta su merma: si se pierde X% antes de poder
  // usarse, el costo real por unidad UTILIZABLE es mayor que el precio de compra. Con
  // merma=0 (default de todos los insumos existentes) da exactamente el precio base, sin
  // cambiar nada para quien no la usa. Se limita el divisor a un mínimo para no llegar a
  // Infinity/NaN si alguien pone 100% (matemáticamente correcto -- 100% de pérdida es costo
  // infinito -- pero un número finito enorme es más seguro de propagar por el resto de los
  // cálculos que Infinity).
  function costoEfectivoInsumo(insumo) {
    const merma = Math.min(Math.max(insumo.mermaPct || 0, 0), 100);
    if (merma <= 0) return insumo.precio;
    const divisor = Math.max(1 - merma / 100, 0.0001);
    return insumo.precio / divisor;
  }

  async function sincronizarInsumosDesdeSupabase() {
    // Datos COMPARTIDOS entre cualquier cuenta autenticada (el control de acceso vive 100% en
    // RLS, no acá) -- por eso ya NO se filtra por user_id: se traen los insumos de TODOS los
    // usuarios, sin importar quién los creó.
    const { data, error } = await window.supabaseClient
      .from('insumos')
      .select('*')
      .is('deleted_at', null)
      .order('nombre');
    if (error) {
      console.warn('No se pudo sincronizar Insumos con Supabase, se sigue usando la copia local:', error.message);
      return false;
    }

    const insumosAnteriores = insumos; // snapshot de antes de reemplazar (para reconciliar por nombre, ver abajo)
    const nuevosInsumos = data.map(filaSupabaseAInsumo);

    // Los insumos que ya existían en localStorage antes de la migración a Supabase usaban
    // otro formato de id (uid() local, no un uuid real). Las Recetas que ya existen guardan
    // ese id viejo en cada ingrediente (ingrediente.insumoId). Como Recetas todavía NO está
    // migrado, sus datos siguen en localStorage con esas referencias viejas — si acá nos
    // limitáramos a pisar "insumos" con los ids nuevos de Supabase, esas recetas mostrarían
    // sus ingredientes como "(insumo eliminado)" de la nada. Se reconcilian una sola vez por
    // NOMBRE (viejo insumo con ese nombre -> nuevo id de Supabase con el mismo nombre) y se
    // reescribe en las recetas guardadas localmente. Es un efecto colateral inevitable de
    // cambiarle el esquema de ids a Insumos, no un cambio al módulo de Recetas en sí.
    const nombreNorm = s => (s || '').trim().toLowerCase();
    const idViejoANuevoPorNombre = new Map();
    const advertenciasReconciliacion = [];

    insumosAnteriores.forEach(viejo => {
      const usadoEnRecetas = recetas.some(r => (r.ingredientes || []).some(ing => ing.insumoId === viejo.id));
      const candidatos = nuevosInsumos.filter(n => nombreNorm(n.nombre) === nombreNorm(viejo.nombre));

      if (!candidatos.length) {
        // sin match por nombre: solo importa avisar si de verdad hay una receta local que
        // todavía depende de este insumo (si no lo usa nadie, no hay nada que se rompa).
        if (usadoEnRecetas) {
          advertenciasReconciliacion.push(
            `"${viejo.nombre}" no tiene ningún insumo con ese nombre en Supabase — las receta(s) que lo usan van a mostrar "(insumo eliminado)" hasta que lo corrijas a mano (¿se renombró o se borró?).`
          );
        }
        return;
      }

      if (candidatos.length > 1 && usadoEnRecetas) {
        advertenciasReconciliacion.push(
          `"${viejo.nombre}" coincide con ${candidatos.length} insumos distintos en Supabase (nombres duplicados) — se usó el primero (id ${candidatos[0].id}) para reconectar las recetas que lo usan. Revísalo a mano si no es el correcto.`
        );
      }

      if (candidatos[0].id !== viejo.id) idViejoANuevoPorNombre.set(viejo.id, candidatos[0].id);
    });

    if (advertenciasReconciliacion.length) {
      console.warn('Advertencias al reconciliar Insumos con Supabase por nombre:\n- ' + advertenciasReconciliacion.join('\n- '));
      showToast(`⚠ ${advertenciasReconciliacion.length} advertencia(s) al sincronizar Insumos — revisa la consola (F12) para el detalle.`);
    }

    if (idViejoANuevoPorNombre.size) {
      let recetasCambiaron = false;
      recetas.forEach(r => {
        (r.ingredientes || []).forEach(ing => {
          if (idViejoANuevoPorNombre.has(ing.insumoId)) {
            ing.insumoId = idViejoANuevoPorNombre.get(ing.insumoId);
            recetasCambiaron = true;
          }
        });
      });
      if (recetasCambiaron) {
        saveRecetas();
        console.info(`Se reconectaron ${idViejoANuevoPorNombre.size} insumo(s) en las recetas locales con sus nuevos ids de Supabase (por nombre).`);
      }
    }

    insumos = nuevosInsumos;
    saveInsumos();
    renderInsumos();
    renderRecetas();
    return true;
  }

  async function crearInsumoEnSupabase(id, data, actualizado) {
    const { error } = await window.supabaseClient.from('insumos').insert({
      id,
      user_id: window.SUPABASE_USER_ID,
      nombre: data.nombre,
      categoria: data.categoria,
      unidad: data.unidad,
      precio: data.precio,
      proveedor: data.proveedor,
      merma_pct: data.mermaPct,
      updated_at: actualizado,
    });
    if (error) throw error;
  }

  async function actualizarInsumoEnSupabase(id, data, actualizado) {
    const { error } = await window.supabaseClient.from('insumos').update({
      nombre: data.nombre,
      categoria: data.categoria,
      unidad: data.unidad,
      precio: data.precio,
      proveedor: data.proveedor,
      merma_pct: data.mermaPct,
      updated_at: actualizado,
    }).eq('id', id);
    if (error) throw error;
  }

  async function marcarInsumoEliminadoEnSupabase(id) {
    const { error } = await window.supabaseClient.from('insumos').update({
      deleted_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
  }

  // Restaurar/eliminar-definitivo desde la Papelera van por los hooks opcionales
  // "alRestaurar"/"alEliminarDefinitivo" en PAPELERA_CONFIG.insumos (ver esa sección) —
  // solo Insumos los define, las otras 6 entidades siguen 100% locales sin cambios.
  async function restaurarInsumoEnSupabase(id) {
    const { error } = await window.supabaseClient.from('insumos').update({ deleted_at: null }).eq('id', id);
    if (error) throw error;
  }

  async function eliminarInsumoDefinitivamenteEnSupabase(id) {
    const { error } = await window.supabaseClient.from('insumos').delete().eq('id', id);
    if (error) throw error;
  }

  // ---------------- Historial de precios ----------------
  // Reutilizable a propósito: solo trae y transforma los datos (fetch), sin tocar el DOM ni
  // ningún modal. La usa hoy abrirHistorialPrecios() para el modal de un insumo puntual, y en
  // el futuro un dashboard de análisis general puede llamarla igual (para uno o varios
  // insumos) sin duplicar esta lógica. insumo_historial_precios no tiene columna user_id (la
  // llena el trigger fn_registrar_historial_precio del lado de Supabase, scoped por insumo_id).
  async function obtenerHistorialPreciosInsumo(insumoId) {
    const { data, error } = await window.supabaseClient
      .from('insumo_historial_precios')
      .select('id, precio, registrado_en')
      .eq('insumo_id', insumoId)
      .order('registrado_en', { ascending: true });
    if (error) throw error;
    return data.map(fila => ({ id: fila.id, fecha: fila.registrado_en, precio: Number(fila.precio) || 0 }));
  }

  // Borra físicamente UN registro de auditoría (no soft-delete: la tabla no tiene deleted_at,
  // es solo historial). A propósito NO toca insumos.precio bajo ninguna circunstancia -- son
  // independientes: esto solo borra un punto del registro histórico, nunca el precio actual.
  async function eliminarRegistroHistorialPrecio(id) {
    const { error } = await window.supabaseClient.from('insumo_historial_precios').delete().eq('id', id);
    if (error) throw error;
  }

  let chartHistorialPrecios = null;
  let historialPreciosInsumoActualId = null;

  async function abrirHistorialPrecios(insumoId) {
    const insumo = insumos.find(x => x.id === insumoId);
    if (!insumo) return;
    historialPreciosInsumoActualId = insumoId;
    document.getElementById('modalHistorialPreciosTitulo').textContent = `Historial de precios — ${insumo.nombre}`;
    openModal('modalHistorialPrecios');

    const contenedorChart = document.getElementById('historialPreciosChartWrap');
    const vacio = document.getElementById('historialPreciosVacio');
    const tablaWrap = document.getElementById('historialPreciosTablaWrap');
    const tbody = document.getElementById('tbodyHistorialPrecios');

    let historial;
    try {
      historial = await obtenerHistorialPreciosInsumo(insumoId);
    } catch (err) {
      console.error(err);
      showToast(`No se pudo cargar el historial de precios: ${err.message || err}`);
      closeModal('modalHistorialPrecios');
      return;
    }

    if (chartHistorialPrecios) {
      chartHistorialPrecios.destroy();
      chartHistorialPrecios = null;
    }

    if (historial.length <= 1) {
      contenedorChart.hidden = true;
      tablaWrap.hidden = true;
      vacio.hidden = false;
      vacio.textContent = `Sin historial de cambios aún — precio actual: ${money(insumo.precio)}.`;
      return;
    }

    contenedorChart.hidden = false;
    tablaWrap.hidden = false;
    vacio.hidden = true;

    const ctx = document.getElementById('historialPreciosCanvas');
    chartHistorialPrecios = new Chart(ctx, {
      type: 'line',
      data: {
        labels: historial.map(h => fecha(h.fecha)),
        datasets: [{
          label: 'Precio',
          data: historial.map(h => h.precio),
          borderColor: '#e08a2e',
          backgroundColor: 'rgba(224,138,46,0.15)',
          tension: 0.15,
          fill: true,
          pointRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: false, ticks: { callback: v => money(v) } },
        },
      },
    });

    // tabla: mismos datos que la gráfica, en orden más reciente primero, con fecha y hora
    // exactas (la gráfica solo muestra el día, para no saturar el eje si hay varios cambios el
    // mismo día -- acá se ve el detalle preciso).
    tbody.innerHTML = historial.slice().reverse().map(h => `
      <tr>
        <td>${new Date(h.fecha).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
        <td>${money(h.precio)}</td>
        <td class="col-actions"><button class="btn-icon danger" title="Eliminar registro" data-del-historial-precio="${h.id}">🗑</button></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-del-historial-precio]').forEach(b =>
      b.addEventListener('click', () => borrarRegistroHistorialPrecio(b.getAttribute('data-del-historial-precio'))));
  }

  async function borrarRegistroHistorialPrecio(registroId) {
    if (!confirm('¿Eliminar este registro de precio del historial?')) return;
    try {
      await eliminarRegistroHistorialPrecio(registroId);
    } catch (err) {
      console.error(err);
      showToast(`No se pudo eliminar el registro: ${err.message || err}`);
      return;
    }
    showToast('Registro eliminado del historial');
    // refresca gráfica + tabla del modal ya abierto, sin cerrarlo -- reutiliza
    // abrirHistorialPrecios tal cual (ya maneja el caso de quedar con 0/1 registros).
    await abrirHistorialPrecios(historialPreciosInsumoActualId);
  }

  function renderStatsInsumos() {
    const categorias = new Set(insumos.map(i => i.categoria || 'Otros'));
    statsInsumos.innerHTML = `
      <div class="stat-card"><div class="stat-value">${insumos.length}</div><div class="stat-label">Insumos</div></div>
      <div class="stat-card"><div class="stat-value">${categorias.size}</div><div class="stat-label">Categorías</div></div>
    `;
  }

  // ordenamiento tipo Excel (mismo patrón que Pedidos/Clientes/Rentabilidad/Actividad): clic en
  // un encabezado ordena ascendente, un segundo clic invierte a descendente. Por defecto, Nombre
  // ascendente -- mismo criterio que ya tenía la tabla antes de este ordenamiento.
  const VALOR_ORDEN_INSUMOS = {
    nombre: i => i.nombre.toLowerCase(),
    categoria: i => (i.categoria || '').toLowerCase(),
    unidad: i => (UNITS[i.unidad] ? UNITS[i.unidad].label : (i.unidad || '')).toLowerCase(),
    precio: i => i.precio || 0,
    merma: i => i.mermaPct || 0,
    actualizado: i => i.actualizado || '',
  };
  let ordenInsumosColumna = 'nombre';
  let ordenInsumosDireccion = 'asc';

  function compararInsumos(a, b) {
    const obtenerValor = VALOR_ORDEN_INSUMOS[ordenInsumosColumna];
    const va = obtenerValor(a), vb = obtenerValor(b);
    let cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    // desempate estable por nombre (mismo criterio que Pedidos con numeroPedido): si dos filas
    // empatan en la columna elegida, no quedan en un orden que parezca arbitrario.
    if (cmp === 0 && ordenInsumosColumna !== 'nombre') cmp = a.nombre.toLowerCase().localeCompare(b.nombre.toLowerCase());
    return ordenInsumosDireccion === 'asc' ? cmp : -cmp;
  }

  const ETIQUETA_ORDEN_INSUMOS = {
    nombre: 'Nombre', categoria: 'Categoría', unidad: 'Unidad', precio: 'Precio', merma: 'Merma', actualizado: 'Actualizado',
  };

  function actualizarIndicadoresOrdenInsumos() {
    document.querySelectorAll('#tablaInsumos [data-sort]').forEach(th => {
      const columna = th.getAttribute('data-sort');
      const etiqueta = ETIQUETA_ORDEN_INSUMOS[columna];
      const esActiva = columna === ordenInsumosColumna;
      const indicador = th.querySelector('.sort-indicador');
      indicador.textContent = esActiva ? (ordenInsumosDireccion === 'asc' ? '▲' : '▼') : '';
      th.title = esActiva
        ? `Ordenado por "${etiqueta}" (${ordenInsumosDireccion === 'asc' ? 'ascendente' : 'descendente'}). Clic para invertir el orden.`
        : `Clic para ordenar por "${etiqueta}".`;
    });
  }

  document.querySelectorAll('#tablaInsumos [data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const columna = th.getAttribute('data-sort');
      if (ordenInsumosColumna === columna) {
        ordenInsumosDireccion = ordenInsumosDireccion === 'asc' ? 'desc' : 'asc';
      } else {
        ordenInsumosColumna = columna;
        ordenInsumosDireccion = 'asc';
      }
      renderInsumos();
    });
  });

  // filtro compartido entre la tabla en pantalla y "Exportar PDF" -- así el PDF siempre coincide
  // exactamente con lo que se ve (mismo buscador y mismo orden), sin duplicar el criterio de
  // filtrado/orden en dos sitios.
  function insumosFiltrados() {
    const term = document.getElementById('buscarInsumo').value.trim().toLowerCase();
    return insumos.filter(i =>
      !term || i.nombre.toLowerCase().includes(term) || (i.categoria || '').toLowerCase().includes(term)
    ).sort(compararInsumos);
  }

  function renderInsumos() {
    const filtrados = insumosFiltrados();
    actualizarIndicadoresOrdenInsumos();

    tbodyInsumos.innerHTML = filtrados.map(i => `
      <tr>
        <td class="cell-nombre">${esc(i.nombre)}</td>
        <td>${esc(i.categoria) || '<span class="cell-muted">Sin categoría</span>'}</td>
        <td>${UNITS[i.unidad] ? UNITS[i.unidad].label : esc(i.unidad)}</td>
        <td>${money(i.precio)}</td>
        <td>${i.mermaPct > 0 ? `${i.mermaPct}% <span class="cell-muted">(efectivo: ${money(costoEfectivoInsumo(i))})</span>` : '<span class="cell-muted">—</span>'}</td>
        <td class="cell-muted">${fecha(i.actualizado)}</td>
        <td class="col-actions">
          <button class="btn-icon" title="Historial de precios" data-historial-insumo="${i.id}">📈</button>
          <button class="btn-icon" title="Editar" data-edit-insumo="${i.id}">✎</button>
          <button class="btn-icon danger" title="Eliminar" data-del-insumo="${i.id}">🗑</button>
        </td>
      </tr>
    `).join('');

    emptyInsumos.hidden = insumos.length !== 0;
    renderStatsInsumos();

    tbodyInsumos.querySelectorAll('[data-historial-insumo]').forEach(b =>
      b.addEventListener('click', () => abrirHistorialPrecios(b.getAttribute('data-historial-insumo'))));
    tbodyInsumos.querySelectorAll('[data-edit-insumo]').forEach(b =>
      b.addEventListener('click', () => openInsumoModal(b.getAttribute('data-edit-insumo'))));
    tbodyInsumos.querySelectorAll('[data-del-insumo]').forEach(b =>
      b.addEventListener('click', () => deleteInsumo(b.getAttribute('data-del-insumo'))));
  }

  function generarPDFInsumos() {
    const lista = insumosFiltrados();
    const term = document.getElementById('buscarInsumo').value.trim();

    const filasHTML = lista.map(i => `
      <tr>
        <td>${esc(i.nombre)}</td>
        <td>${esc(i.categoria) || '—'}</td>
        <td>${UNITS[i.unidad] ? UNITS[i.unidad].label : esc(i.unidad)}</td>
        <td class="num">${money(i.precio)}</td>
        <td class="num">${i.mermaPct > 0 ? `${i.mermaPct}%` : '—'}</td>
        <td class="num">${i.mermaPct > 0 ? money(costoEfectivoInsumo(i)) : '—'}</td>
        <td>${fecha(i.actualizado)}</td>
      </tr>
    `).join('');

    const marca = datosMarcaApp();

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Insumos — ${esc(marca.nombre)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#222;padding:16px;margin:0}
  .marca-pdf{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .marca-pdf-icono{font-size:26px;line-height:1;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
  .marca-pdf-icono img{width:32px;height:32px;object-fit:contain}
  h1{font-size:18px;margin:0}
  .marca-pdf .subtitulo-marca{font-size:11px;color:#777;margin:1px 0 0}
  .subtitulo{font-size:12px;color:#666;margin:0 0 18px}
  table{width:100%;border-collapse:collapse;font-size:10.5px;table-layout:fixed}
  th,td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:break-word;word-break:break-word}
  th{background:#f0f0f0}
  td.num,th.num{text-align:right}
  @media print{ body{padding:0} }
</style>
</head>
<body>
  <div class="marca-pdf">
    <span class="marca-pdf-icono">${marca.iconoHTML}</span>
    <div>
      <h1>${esc(marca.nombre)}</h1>
      <p class="subtitulo-marca">${esc(marca.subtitulo)}</p>
    </div>
  </div>
  <p class="subtitulo">Insumos${term ? ` · Filtro: "${esc(term)}"` : ''} · ${lista.length} insumo(s) · Generado ${new Date().toLocaleString('es-CO')}</p>
  <table>
    <thead>
      <tr>
        <th>Nombre</th><th>Categoría</th><th>Unidad</th><th class="num">Precio</th>
        <th class="num">Merma %</th><th class="num">Costo efectivo</th><th>Actualizado</th>
      </tr>
    </thead>
    <tbody>${filasHTML}</tbody>
  </table>
</body>
</html>`;

    const ventana = window.open('', '_blank');
    if (!ventana) { showToast('El navegador bloqueó la ventana. Permite pop-ups para exportar el PDF.'); return; }
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
    setTimeout(() => { try { ventana.focus(); ventana.print(); } catch (e) {} }, 300);
  }
  document.getElementById('btnExportarInsumosPDF').addEventListener('click', generarPDFInsumos);

  function populateCategoriaSelect(selectEl, lista, selected) {
    selectEl.innerHTML = '<option value="">Sin categoría</option>' +
      lista.map(c => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('');
  }

  function openInsumoModal(id) {
    const form = document.getElementById('formInsumo');
    form.reset();
    populateCategoriaSelect(document.getElementById('insumoCategoria'), categoriasInsumos, id ? insumos.find(x => x.id === id).categoria : '');
    if (id) {
      const i = insumos.find(x => x.id === id);
      document.getElementById('modalInsumoTitulo').textContent = 'Editar insumo';
      document.getElementById('insumoId').value = i.id;
      document.getElementById('insumoNombre').value = i.nombre;
      document.getElementById('insumoCategoria').value = i.categoria || '';
      document.getElementById('insumoUnidad').value = i.unidad;
      document.getElementById('insumoPrecio').value = i.precio;
      document.getElementById('insumoProveedor').value = i.proveedor || '';
      document.getElementById('insumoMerma').value = i.mermaPct || 0;
    } else {
      document.getElementById('modalInsumoTitulo').textContent = 'Nuevo insumo';
      document.getElementById('insumoId').value = '';
      document.getElementById('insumoMerma').value = 0;
    }
    updateInsumoHint();
    openModal('modalInsumo');
  }

  function updateInsumoHint() {
    const unidad = document.getElementById('insumoUnidad').value;
    const precio = parseFloat(document.getElementById('insumoPrecio').value) || 0;
    const u = UNITS[unidad];
    const hint = document.getElementById('insumoPrecioHint');
    if (!u || !precio) { hint.textContent = ''; return; }
    const precioBase = precio / u.factor;
    const baseLabel = u.group === 'peso' ? 'gramo' : u.group === 'volumen' ? 'ml' : 'unidad';
    hint.textContent = `Equivale a ${money(precioBase)} por ${baseLabel}.`;
  }
  document.getElementById('insumoUnidad').addEventListener('change', updateInsumoHint);
  document.getElementById('insumoPrecio').addEventListener('input', updateInsumoHint);

  document.getElementById('btnNuevoInsumo').addEventListener('click', () => openInsumoModal(null));

  document.getElementById('formInsumo').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('insumoId').value;
    const data = {
      nombre: document.getElementById('insumoNombre').value.trim(),
      categoria: document.getElementById('insumoCategoria').value.trim(),
      unidad: document.getElementById('insumoUnidad').value,
      precio: parseFloat(document.getElementById('insumoPrecio').value) || 0,
      proveedor: document.getElementById('insumoProveedor').value.trim(),
      mermaPct: Math.min(Math.max(parseFloat(document.getElementById('insumoMerma').value) || 0, 0), 100),
    };
    if (id && !confirm(`¿Guardar los cambios en "${data.nombre}"? Se sobrescribirán los datos actuales de este insumo.`)) return;

    const btnGuardar = document.querySelector('#formInsumo button[type="submit"]');
    btnGuardar.disabled = true;
    const actualizado = new Date().toISOString();
    try {
      if (id) {
        await actualizarInsumoEnSupabase(id, data, actualizado);
        const i = insumos.find(x => x.id === id);
        Object.assign(i, data, { actualizado });
        showToast('Insumo actualizado');
      } else {
        // uuid real (no el uid() local) porque insumos.id en Supabase es de tipo uuid.
        const nuevoId = crypto.randomUUID();
        await crearInsumoEnSupabase(nuevoId, data, actualizado);
        insumos.push({ id: nuevoId, ...data, actualizado });
        showToast('Insumo creado');
      }
      saveInsumos();
      renderInsumos();
      // el precio/merma de un insumo afecta el costo de toda receta que lo use -- sin esto, el
      // costo/plato de Recetas queda desactualizado hasta la próxima acción que fuerce un
      // renderRecetas() (deleteInsumo ya lo hacía; esta rama de editar/crear lo tenía olvidado).
      renderRecetas();
      closeModal('modalInsumo');
    } catch (err) {
      console.error(err);
      showToast(`No se pudo guardar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
    } finally {
      btnGuardar.disabled = false;
    }
  });

  async function deleteInsumo(id) {
    const enUso = recetas.filter(r => r.ingredientes.some(ing => ing.insumoId === id));
    const msg = enUso.length
      ? `Este insumo se usa en ${enUso.length} receta(s) (${enUso.map(r => r.nombre).join(', ')}). Si lo eliminas, esas recetas quedarán con un ingrediente faltante. ¿Eliminar de todas formas?`
      : '¿Eliminar este insumo?';
    if (!confirm(msg)) return;
    try {
      await marcarInsumoEliminadoEnSupabase(id);
    } catch (err) {
      console.error(err);
      showToast(`No se pudo eliminar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
      return;
    }
    moverAPapelera('insumos', insumos.find(x => x.id === id));
    insumos = insumos.filter(x => x.id !== id);
    saveInsumos();
    renderInsumos();
    renderRecetas();
    showToast('Insumo eliminado (puedes restaurarlo desde la Papelera)');
  }

  document.getElementById('buscarInsumo').addEventListener('input', renderInsumos);

  // =========================================================
  //  CÁLCULO DE COSTOS
  // =========================================================
  function calcIngrediente(insumoId, cantidad, unidadUso) {
    const insumo = insumos.find(i => i.id === insumoId);
    if (!insumo) return { costo: 0, ok: false, nombre: '(insumo eliminado)' };
    const uUso = UNITS[unidadUso], uInsumo = UNITS[insumo.unidad];
    if (!uUso || !uInsumo || uUso.group !== uInsumo.group) return { costo: 0, ok: false, nombre: insumo.nombre };
    const cantidadBase = (cantidad || 0) * uUso.factor;
    const precioPorBase = costoEfectivoInsumo(insumo) / uInsumo.factor;
    return { costo: cantidadBase * precioPorBase, ok: true, nombre: insumo.nombre };
  }

  function calcReceta(r) {
    let costoIngredientes = 0;
    const faltantes = [];
    const detalle = r.ingredientes.map(ing => {
      const c = calcIngrediente(ing.insumoId, ing.cantidad, ing.unidad);
      if (!c.ok) faltantes.push(c.nombre);
      costoIngredientes += c.costo;
      return { ...ing, nombre: c.nombre, costo: c.costo, ok: c.ok };
    });
    const costosAdicionales = (r.costosAdicionales || []).map(c => ({ ...c, costo: (c.cantidad || 0) * (c.precioUnitario || 0) }));
    const totalCostosAdicionales = costosAdicionales.reduce((s, c) => s + c.costo, 0);
    const costoTotal = costoIngredientes + totalCostosAdicionales;
    const porciones = Math.max(1, r.porciones || 1);
    const costoPorPlato = costoTotal / porciones;
    const margenPct = Math.max(0, r.margenPct || 0);
    // margen deseado = % de ganancia sobre el COSTO (markup), como se maneja normalmente en cocina
    // (ej: 100% = el precio duplica el costo; 200% = el precio triplica el costo).
    const precioSugerido = costoPorPlato * (1 + margenPct / 100);
    const precioVenta = r.precioVenta && r.precioVenta > 0 ? r.precioVenta : null;
    const precioReferencia = precioVenta || precioSugerido;
    const margenReal = costoPorPlato > 0 ? ((precioReferencia - costoPorPlato) / costoPorPlato) * 100 : 0;
    const utilidadPorPlato = precioReferencia - costoPorPlato;
    return {
      detalle, costoIngredientes, costosAdicionales, totalCostosAdicionales, costoTotal, costoPorPlato,
      precioSugerido, precioVenta, precioReferencia, margenReal, utilidadPorPlato, faltantes,
    };
  }

  // Cuánto de cada insumo hace falta para preparar N platos de una receta, escalando
  // proporcionalmente sus ingredientes base (misma matemática de costo que calcReceta/
  // calcIngrediente -- costo efectivo con merma incluida, sin duplicar esa lógica).
  //
  // A PROPÓSITO independiente del modal "Calcular compra": cuando se retome el módulo de
  // Inventario/Stock (Fase 2/3, todavía pendiente), esta misma función se puede reutilizar tal
  // cual para comparar "cantidadNecesaria" de cada insumo contra el stock disponible y armar una
  // lista de compra sugerida -- no se implementa esa comparación todavía, solo se deja la
  // función lista (recetaId + cantidadPlatos adentro, sin nada del DOM ni del modal).
  function calcularInsumosNecesarios(recetaId, cantidadPlatos) {
    const r = recetas.find(x => x.id === recetaId);
    if (!r) return { items: [], totalGeneral: 0, escala: 0, porcionesBase: 1 };

    const porcionesBase = Math.max(1, r.porciones || 1);
    const escala = Math.max(0, cantidadPlatos || 0) / porcionesBase;

    const items = r.ingredientes.map(ing => {
      const cantidadNecesaria = (ing.cantidad || 0) * escala;
      const c = calcIngrediente(ing.insumoId, cantidadNecesaria, ing.unidad);
      return {
        insumoId: ing.insumoId,
        nombre: c.nombre,
        unidad: ing.unidad,
        cantidadNecesaria,
        costo: c.costo,
        ok: c.ok,
      };
    });
    const totalGeneral = items.reduce((s, it) => s + it.costo, 0);
    return { items, totalGeneral, escala, porcionesBase };
  }

  // Suma los insumos de VARIOS platos (carrito de compras) en una sola tabla consolidada --
  // reutiliza calcularInsumosNecesarios() por cada plato, sin duplicar su matemática. El único
  // cuidado real acá es que dos recetas pueden pedir el MISMO insumo en unidades distintas (ej.
  // una en "g" y otra en "kg") -- sumar las cantidades "cantidadNecesaria" tal cual sería
  // incorrecto, así que cada una se pasa primero a la unidad BASE de su grupo (factor de UNITS)
  // antes de sumar, y el total combinado se vuelve a expresar en la unidad NATIVA del insumo
  // (insumo.unidad) para mostrarlo en algo consistente sin importar qué unidad usó cada receta.
  function consolidarInsumosDeCarrito(itemsCarrito) {
    const mapa = new Map(); // insumoId -> {nombre, unidadNativa, cantidadBase, costo}
    let hayRecetaSinDatos = false;

    itemsCarrito.forEach(item => {
      const receta = recetas.find(r => r.id === item.recetaId);
      if (!receta) { hayRecetaSinDatos = true; return; } // sin la receta no hay ingredientes que sumar
      const { items } = calcularInsumosNecesarios(item.recetaId, item.cantidadPlatos);
      items.forEach(it => {
        if (!it.ok) return; // insumo eliminado o unidad incompatible -- ya se marca en el detalle por plato
        const insumo = insumos.find(i => i.id === it.insumoId);
        const uUso = UNITS[it.unidad];
        if (!insumo || !uUso) return;
        const cantidadBase = it.cantidadNecesaria * uUso.factor;
        const actual = mapa.get(it.insumoId) || { nombre: it.nombre, unidadNativa: insumo.unidad, cantidadBase: 0, costo: 0 };
        actual.cantidadBase += cantidadBase;
        actual.costo += it.costo;
        mapa.set(it.insumoId, actual);
      });
    });

    const consolidado = Array.from(mapa.values()).map(it => {
      const uNativa = UNITS[it.unidadNativa];
      const cantidadNecesaria = uNativa ? it.cantidadBase / uNativa.factor : it.cantidadBase;
      return { nombre: it.nombre, unidad: it.unidadNativa, cantidadNecesaria, costo: it.costo };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre));

    const totalGeneral = consolidado.reduce((s, it) => s + it.costo, 0);
    return { consolidado, totalGeneral, hayRecetaSinDatos };
  }

  // Umbrales pensados como markup sobre el costo (no % del precio): 150% de markup
  // equivale a un costo de alimentos de ~40% del precio de venta (rango sano en cocina).
  function margenBadgeClass(margenReal) {
    if (margenReal >= 150) return 'badge-good';
    if (margenReal >= 80) return 'badge-warn';
    return 'badge-bad';
  }

  // =========================================================
  //  RECETAS — listado
  // =========================================================
  const cardsRecetas = document.getElementById('cardsRecetas');
  const emptyRecetas = document.getElementById('emptyRecetas');
  const statsRecetas = document.getElementById('statsRecetas');

  // ---------------- Recetas <-> Supabase ----------------
  // Mismo patrón que Insumos: "recetas" sigue en memoria + localStorage para que Pedidos
  // (todavía no migrado) lo siga leyendo de forma síncrona. Al cargar se sincroniza desde
  // Supabase, con la misma reconciliación por nombre que usamos en Insumos (acá protege las
  // referencias de Pedidos, que guarda cada plato pedido por el id viejo de la receta).
  // Alta/edición/baja escriben primero en Supabase; solo si funciona se aplica el cambio en
  // memoria+localStorage — si Supabase falla, no se aplica nada local tampoco.
  function filaSupabaseAReceta(fila, filasIngredientes, filasOtrosCostos) {
    return {
      id: fila.id,
      nombre: fila.nombre,
      categoria: fila.categoria || '',
      porciones: Number(fila.porciones) || 1,
      ingredientes: filasIngredientes
        .filter(i => i.receta_id === fila.id)
        .sort((a, b) => a.posicion - b.posicion)
        .map(i => ({ insumoId: i.insumo_id, cantidad: Number(i.cantidad) || 0, unidad: i.unidad })),
      costosAdicionales: filasOtrosCostos
        .filter(c => c.receta_id === fila.id)
        .sort((a, b) => a.posicion - b.posicion)
        .map(c => ({ concepto: c.concepto, cantidad: Number(c.cantidad) || 0, precioUnitario: Number(c.precio_unitario) || 0 })),
      margenPct: Number(fila.margen_pct) || 0,
      precioVenta: typeof fila.precio_venta === 'number' ? fila.precio_venta : null,
      foto: fila.foto || null,
      descripcion: fila.descripcion || '',
      preparacion: fila.preparacion || '',
      favorito: !!fila.favorito,
    };
  }

  async function sincronizarRecetasDesdeSupabase() {
    // se traen TODAS las recetas (vivas y en la Papelera de Supabase), sin filtrar por
    // deleted_at, para poder mostrar el nombre real de un plato eliminado en Pedidos (ver
    // recetasEliminadasPorId más abajo) — solo el array "recetas" en memoria se queda con
    // las vivas, que es lo único que usa el resto de la app (costeo, tarjetas, edición...).
    // Datos compartidos (ver nota en sincronizarInsumosDesdeSupabase): sin filtro por user_id.
    const { data: filasTodas, error: errRecetas } = await window.supabaseClient
      .from('recetas')
      .select('*')
      .order('nombre');
    if (errRecetas) {
      console.warn('No se pudo sincronizar Recetas con Supabase, se sigue usando la copia local:', errRecetas.message);
      return false;
    }

    const filasRecetas = filasTodas.filter(r => !r.deleted_at);
    recetasEliminadasPorId = new Map(filasTodas.filter(r => r.deleted_at).map(r => [r.id, r.nombre]));

    const idsRecetas = filasRecetas.map(r => r.id);
    let filasIngredientes = [], filasOtrosCostos = [];
    if (idsRecetas.length) {
      const [resIng, resCost] = await Promise.all([
        window.supabaseClient.from('receta_ingredientes').select('*').in('receta_id', idsRecetas),
        window.supabaseClient.from('receta_otros_costos').select('*').in('receta_id', idsRecetas),
      ]);
      if (resIng.error || resCost.error) {
        console.warn('No se pudo sincronizar Recetas con Supabase (ingredientes/otros costos), se sigue usando la copia local:', (resIng.error || resCost.error).message);
        return false;
      }
      filasIngredientes = resIng.data;
      filasOtrosCostos = resCost.data;
    }

    const recetasAnteriores = recetas;
    const nuevasRecetas = filasRecetas.map(r => filaSupabaseAReceta(r, filasIngredientes, filasOtrosCostos));

    const nombreNorm = s => (s || '').trim().toLowerCase();
    const idViejoANuevoPorNombre = new Map();
    const advertenciasReconciliacion = [];

    recetasAnteriores.forEach(vieja => {
      const usadaEnPedidos = pedidos.some(p => (p.items || []).some(it => it.recetaId === vieja.id));
      const candidatas = nuevasRecetas.filter(n => nombreNorm(n.nombre) === nombreNorm(vieja.nombre));

      if (!candidatas.length) {
        if (usadaEnPedidos) {
          advertenciasReconciliacion.push(
            `"${vieja.nombre}" no tiene ninguna receta con ese nombre en Supabase — los pedidos que la usan van a mostrar "(plato eliminado)" hasta que lo corrijas a mano (¿se renombró o se borró?).`
          );
        }
        return;
      }
      if (candidatas.length > 1 && usadaEnPedidos) {
        advertenciasReconciliacion.push(
          `"${vieja.nombre}" coincide con ${candidatas.length} recetas distintas en Supabase (nombres duplicados) — se usó la primera (id ${candidatas[0].id}) para reconectar los pedidos que la usan. Revísalo a mano si no es el correcto.`
        );
      }
      if (candidatas[0].id !== vieja.id) idViejoANuevoPorNombre.set(vieja.id, candidatas[0].id);
    });

    if (advertenciasReconciliacion.length) {
      console.warn('Advertencias al reconciliar Recetas con Supabase por nombre:\n- ' + advertenciasReconciliacion.join('\n- '));
      showToast(`⚠ ${advertenciasReconciliacion.length} advertencia(s) al sincronizar Recetas — revisa la consola (F12) para el detalle.`);
    }

    if (idViejoANuevoPorNombre.size) {
      let pedidosCambiaron = false;
      pedidos.forEach(p => {
        (p.items || []).forEach(it => {
          if (idViejoANuevoPorNombre.has(it.recetaId)) {
            it.recetaId = idViejoANuevoPorNombre.get(it.recetaId);
            pedidosCambiaron = true;
          }
        });
      });
      if (pedidosCambiaron) {
        savePedidos();
        console.info(`Se reconectaron ${idViejoANuevoPorNombre.size} receta(s) en los pedidos locales con sus nuevos ids de Supabase (por nombre).`);
      }
    }

    recetas = nuevasRecetas;
    saveRecetas();
    renderRecetas();
    renderPedidos();
    return true;
  }

  // Reemplaza a crearRecetaEnSupabase/actualizarRecetaEnSupabase/
  // reemplazarHijosRecetaEnSupabase: una sola llamada RPC a la función de Postgres
  // guardar_receta_completa (scripts/sql/001_guardar_y_eliminar_receta_completa.sql), que
  // hace el upsert de la receta + reemplaza sus dos tablas hijas en UNA transacción real
  // — sirve tanto para crear (id nuevo, generado en el navegador con crypto.randomUUID())
  // como para editar (id existente).
  async function guardarRecetaEnSupabase(id, data) {
    const { error } = await window.supabaseClient.rpc('guardar_receta_completa', {
      p_id: id,
      p_user_id: window.SUPABASE_USER_ID,
      p_nombre: data.nombre,
      p_categoria: data.categoria,
      p_porciones: data.porciones,
      p_margen_pct: data.margenPct,
      p_precio_venta: data.precioVenta,
      p_foto: data.foto,
      p_descripcion: data.descripcion,
      p_preparacion: data.preparacion,
      p_ingredientes: data.ingredientes.map(ing => ({ insumo_id: ing.insumoId, cantidad: ing.cantidad, unidad: ing.unidad })),
      p_otros_costos: data.costosAdicionales.map(c => ({ concepto: c.concepto, cantidad: c.cantidad, precio_unitario: c.precioUnitario })),
    });
    if (error) throw error;
  }

  // Sube la foto (base64, recién ajustada en el canvas) como archivo real a Supabase Storage
  // en vez de guardarla inline en recetas.foto -- eso era lo que llenaba localStorage (el
  // respaldo local reflejaba la imagen completa). Path determinístico (id de la receta + .jpg)
  // + upsert:true: si ya había una foto para esta receta, la pisa en el mismo lugar, sin dejar
  // un archivo viejo huérfano -- no hace falta borrar antes de subir.
  //
  // El bucket "recetas-fotos" es privado (auth.role() = 'authenticated'), así que getPublicUrl()
  // ya NO sirve -- devuelve una URL que nadie puede cargar sin sesión (esto rompió en silencio
  // las fotos que ya estaban subidas: seguían viéndose por el caché de Cloudflare hasta que
  // venció). Ahora se usa createSignedUrl(), igual que el avatar de cuenta. La URL firmada que
  // se devuelve acá SÍ se guarda en recetas.foto, pero solo como valor de paso -- en cuanto
  // vence, cualquier pantalla que la muestre la vuelve a firmar sola (ver resolverUrlFotoReceta),
  // porque el path real siempre es determinístico y no depende de lo que haya quedado guardado.
  // createSignedUrl puede fallar de forma INTERMITENTE aun con sesión válida -- confirmado con
  // logs reales de Supabase (200 y 400 alternados a lo largo de una misma sesión activa). Revisé
  // el bundle del SDK: el header de Authorization no queda fijo en un objeto compartido, se
  // recalcula en cada petición llamando a auth.getSession() en ese instante exacto (así evita
  // usar un token vencido) -- pero eso significa que una carrera interna del propio SDK al
  // refrescar el token (más probable si varias firmas salen en paralelo al mismo tiempo, ver
  // aplicarFotosRecetasEnDOM más abajo) puede hacer que ESA petición puntual use un token que
  // todavía no está listo. Supabase Storage responde ese caso igual que "no existe" (mismo
  // criterio anti-enumeración que ya vimos), por eso el 400 dice "Object not found" con sesión
  // real y el archivo existiendo de verdad. Un solo reintento con una pausa breve cubre la
  // enorme mayoría de estos casos sin tener que reproducir la carrera exacta del SDK.
  async function firmarObjetoStorage(bucket, path, vigenciaSeg, intentos = 2) {
    let ultimoError = null;
    for (let intento = 1; intento <= intentos; intento++) {
      const { data, error } = await window.supabaseClient.storage.from(bucket).createSignedUrl(path, vigenciaSeg);
      if (!error) return data.signedUrl;
      ultimoError = error;
      if (intento < intentos) await new Promise(r => setTimeout(r, 900));
    }
    throw ultimoError;
  }

  async function subirFotoRecetaAStorage(recetaId, dataUrlJpeg) {
    const blob = await (await fetch(dataUrlJpeg)).blob();
    const path = `${recetaId}.jpg`;
    const { error } = await window.supabaseClient.storage.from('recetas-fotos').upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (error) throw error;
    return await firmarObjetoStorage('recetas-fotos', path, RECETA_FOTO_VIGENCIA_SEG);
  }

  const RECETA_FOTO_VIGENCIA_SEG = 60 * 60 * 24; // 1 día -- se vuelve a firmar sola en cada carga, ver abajo

  function esFotoBase64(foto) {
    return typeof foto === 'string' && foto.startsWith('data:');
  }

  // Cualquier valor de receta.foto que no sea null/vacío ni un data: URI se interpreta como
  // "esta receta tiene una foto en Storage" -- no importa si ese texto exacto es una URL firmada
  // vieja (vencida) o incluso una URL pública de antes de que el bucket se volviera privado: el
  // path real es siempre {receta.id}.jpg (determinístico), así que se ignora el contenido
  // guardado y se firma de nuevo. Por eso no hizo falta ninguna migración de datos para las
  // fotos que ya estaban subidas.
  async function resolverUrlFotoReceta(receta) {
    if (!receta.foto) return null;
    if (esFotoBase64(receta.foto)) return receta.foto;
    // El bloque de init llama a renderRecetas() con lo que ya había en localStorage ANTES de que
    // auth.js confirme la sesión (para no dejar la pantalla en blanco mientras se sincroniza) --
    // sin este freno, esa primera pasada disparaba un createSignedUrl real, sin sesión válida
    // todavía, que Supabase rechaza (disfrazado de "Object not found", no de error de permisos).
    // Una vez hay sesión, sincronizarRecetasDesdeSupabase() vuelve a llamar renderRecetas() y
    // esta misma función se resuelve bien sola -- no hace falta reintentar acá, alcanza con no
    // intentarlo mientras no haya nadie logueado.
    if (!window.SUPABASE_USER_ID) return null;
    try {
      return await firmarObjetoStorage('recetas-fotos', `${receta.id}.jpg`, RECETA_FOTO_VIGENCIA_SEG);
    } catch (err) {
      console.warn(`No se pudo firmar la foto de la receta "${receta.nombre}" (tras reintentar):`, err.message || err);
      return null;
    }
  }

  // Reemplaza cada placeholder [data-foto-receta] (dejado por renderRecetas/openDetalleReceta en
  // vez de un <img> directo) por la imagen real. A propósito SECUENCIAL, no en paralelo: firmar
  // varias fotos al mismo tiempo es justo el escenario que más probabilidad tiene de chocar con
  // la carrera de refresh de token descrita arriba -- una por una es un poco más lento (unos
  // pocos cientos de ms para 3 fotos) pero mucho más confiable.
  async function aplicarFotosRecetasEnDOM(raiz) {
    const nodos = Array.from(raiz.querySelectorAll('[data-foto-receta]'));
    for (const nodo of nodos) {
      const receta = recetas.find(r => r.id === nodo.getAttribute('data-foto-receta'));
      if (!receta) { nodo.remove(); continue; }
      const url = await resolverUrlFotoReceta(receta);
      if (url) nodo.outerHTML = `<img class="${nodo.dataset.fotoClase}" src="${url}" alt="${esc(receta.nombre)}">`;
      else nodo.remove();
    }
  }

  // Se usa cuando el usuario QUITA la foto (no cuando la cambia por otra -- eso ya lo resuelve
  // el upsert de arriba solo). Borrar un archivo que no existe no da error (probado directo
  // contra el bucket), así que no hace falta revisar si la foto anterior era base64 o URL.
  async function eliminarFotoRecetaDeStorage(recetaId) {
    const { error } = await window.supabaseClient.storage.from('recetas-fotos').remove([`${recetaId}.jpg`]);
    if (error) throw error;
  }

  async function marcarRecetaEliminadaEnSupabase(id) {
    const { error } = await window.supabaseClient.from('recetas').update({
      deleted_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
  }

  // Restaurar/eliminar-definitivo van por los hooks opcionales en PAPELERA_CONFIG.recetas
  // (mismo mecanismo que ya agregamos para Insumos).
  async function restaurarRecetaEnSupabase(id) {
    const { error } = await window.supabaseClient.from('recetas').update({ deleted_at: null }).eq('id', id);
    if (error) throw error;
    recetasEliminadasPorId.delete(id);
  }

  // RPC eliminar_receta_completa: borra receta + sus dos tablas hijas en una sola
  // transacción (mismo archivo SQL que guardar_receta_completa). Se borra primero el archivo
  // de Storage (si lo había) para no dejarlo huérfano -- siempre, sin revisar si la receta
  // tenía foto, porque borrar un archivo que no existe no da error (ya probado contra el
  // bucket real). Solo aplica al borrado DEFINITIVO -- mover a la Papelera es soft-delete, la
  // foto se queda intacta por si se restaura.
  async function eliminarRecetaDefinitivamenteEnSupabase(id) {
    await eliminarFotoRecetaDeStorage(id);
    const { error } = await window.supabaseClient.rpc('eliminar_receta_completa', { p_id: id });
    if (error) throw error;
  }

  // "favorito" se toggla aparte del guardado normal (no pasa por guardar_receta_completo),
  // igual que pagado/estadoPreparacion en Pedidos: un update de un solo campo, no un RPC.
  async function actualizarFavoritoRecetaEnSupabase(id, favorito) {
    const { error } = await window.supabaseClient.from('recetas').update({ favorito }).eq('id', id);
    if (error) throw error;
  }

  // Mismo patrón que los toggles de Pedidos: Supabase primero, guard esUuid para recetas
  // viejas/local-only, y el guard de token de secuencia (tokensToggle/siguienteTokenToggle/
  // esTokenVigente, definidos más abajo junto a los toggles de Pedidos) contra respuestas
  // desordenadas si se hace doble clic antes de que responda la primera.
  async function toggleFavoritoReceta(id) {
    const r = recetas.find(x => x.id === id);
    const nuevoValor = !r.favorito;
    const clave = `favorito:${id}`;
    const miToken = siguienteTokenToggle(clave);
    if (esUuid(id)) {
      try {
        await actualizarFavoritoRecetaEnSupabase(id, nuevoValor);
      } catch (err) {
        console.error(err);
        showToast(`No se pudo actualizar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
        return;
      }
    }
    if (!esTokenVigente(clave, miToken)) return;
    r.favorito = nuevoValor;
    saveRecetas();
    renderRecetas();
    showToast(nuevoValor ? 'Marcada como favorita' : 'Quitada de favoritas');
  }

  function renderStatsRecetas() {
    if (!recetas.length) { statsRecetas.innerHTML = ''; return; }
    const calculos = recetas.map(calcReceta);
    const costoProm = calculos.reduce((s, c) => s + c.costoPorPlato, 0) / calculos.length;
    const margenProm = calculos.reduce((s, c) => s + c.margenReal, 0) / calculos.length;
    statsRecetas.innerHTML = `
      <div class="stat-card"><div class="stat-value">${recetas.length}</div><div class="stat-label">Recetas</div></div>
      <div class="stat-card"><div class="stat-value">${money(costoProm)}</div><div class="stat-label">Costo prom. / plato</div></div>
      <div class="stat-card"><div class="stat-value">${pct(margenProm)}</div><div class="stat-label">Margen promedio</div></div>
    `;
  }

  function renderRecetas() {
    const term = document.getElementById('buscarReceta').value.trim().toLowerCase();
    const filtradas = recetas.filter(r =>
      !term || r.nombre.toLowerCase().includes(term) || (r.categoria || '').toLowerCase().includes(term)
    ).sort((a, b) => {
      // favoritas primero; dentro de cada grupo (favorita / no favorita), el mismo orden de
      // siempre (alfabético) -- no se inventa un criterio de orden secundario nuevo.
      if (!!b.favorito !== !!a.favorito) return (b.favorito ? 1 : 0) - (a.favorito ? 1 : 0);
      return a.nombre.localeCompare(b.nombre);
    });

    cardsRecetas.innerHTML = filtradas.map(r => {
      const c = calcReceta(r);
      return `
        <div class="recipe-card" data-open-receta="${r.id}">
          ${r.foto ? `<div class="foto-receta-placeholder recipe-card-photo" data-foto-receta="${r.id}" data-foto-clase="recipe-card-photo"></div>` : ''}
          <div class="recipe-card-head">
            <div>
              <h3>${esc(r.nombre)}</h3>
              <div class="recipe-card-cat">${esc(r.categoria) || 'Sin categoría'} · ${r.porciones} porción(es)</div>
            </div>
            <span class="badge ${margenBadgeClass(c.margenReal)}">${pct(c.margenReal)}</span>
          </div>
          ${c.faltantes.length ? `<div class="summary-warning" style="margin:0">⚠ Ingrediente(s) eliminado(s): ${esc(c.faltantes.join(', '))}</div>` : ''}
          <div class="recipe-card-metrics">
            <div>Costo/plato<b>${money(c.costoPorPlato)}</b></div>
            <div>${c.precioVenta ? 'Precio venta' : 'Precio sugerido'}<b>${money(c.precioReferencia)}</b></div>
            <div>Utilidad/plato<b>${money(c.utilidadPorPlato)}</b></div>
          </div>
          <div class="recipe-card-actions">
            <button class="btn-icon btn-favorito ${r.favorito ? 'activo' : ''}" title="${r.favorito ? 'Quitar de favoritas' : 'Marcar como favorita'}" data-fav-receta="${r.id}">${r.favorito ? '⭐' : '☆'}</button>
            <button class="btn-icon" title="Editar" data-edit-receta="${r.id}">✎</button>
            <button class="btn-icon" title="Duplicar" data-dup-receta="${r.id}">🗐</button>
            <button class="btn-icon" title="Descargar PDF" data-pdf-receta="${r.id}">🖨</button>
            <button class="btn-icon" title="Calcular compra" data-calc-compra="${r.id}">🧮</button>
            <button class="btn-icon danger" title="Eliminar" data-del-receta="${r.id}">🗑</button>
          </div>
        </div>
      `;
    }).join('');

    emptyRecetas.hidden = recetas.length !== 0;
    renderStatsRecetas();
    aplicarFotosRecetasEnDOM(cardsRecetas);

    cardsRecetas.querySelectorAll('[data-open-receta]').forEach(card =>
      card.addEventListener('click', e => {
        if (e.target.closest('[data-edit-receta],[data-del-receta],[data-dup-receta],[data-pdf-receta],[data-fav-receta],[data-calc-compra]')) return;
        openDetalleReceta(card.getAttribute('data-open-receta'));
      }));
    cardsRecetas.querySelectorAll('[data-fav-receta]').forEach(b =>
      b.addEventListener('click', () => toggleFavoritoReceta(b.getAttribute('data-fav-receta'))));
    cardsRecetas.querySelectorAll('[data-edit-receta]').forEach(b =>
      b.addEventListener('click', () => openRecetaModal(b.getAttribute('data-edit-receta'))));
    cardsRecetas.querySelectorAll('[data-dup-receta]').forEach(b =>
      b.addEventListener('click', () => duplicarReceta(b.getAttribute('data-dup-receta'))));
    cardsRecetas.querySelectorAll('[data-pdf-receta]').forEach(b =>
      b.addEventListener('click', () => generarPDFReceta(b.getAttribute('data-pdf-receta'))));
    cardsRecetas.querySelectorAll('[data-calc-compra]').forEach(b =>
      b.addEventListener('click', () => abrirCalcularCompra(b.getAttribute('data-calc-compra'))));
    cardsRecetas.querySelectorAll('[data-del-receta]').forEach(b =>
      b.addEventListener('click', () => deleteReceta(b.getAttribute('data-del-receta'))));
  }

  async function duplicarReceta(id) {
    const original = recetas.find(x => x.id === id);
    if (!original) return;
    const nuevoId = crypto.randomUUID();
    const copia = {
      ...original,
      id: nuevoId,
      nombre: `${original.nombre} (copia)`,
      ingredientes: original.ingredientes.map(ing => ({ ...ing })),
      costosAdicionales: (original.costosAdicionales || []).map(costo => ({ ...costo })),
    };
    try {
      await guardarRecetaEnSupabase(nuevoId, copia);
    } catch (err) {
      console.error(err);
      showToast(`No se pudo duplicar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
      return;
    }
    recetas.push(copia);
    saveRecetas();
    renderRecetas();
    showToast('Receta duplicada');
    openRecetaModal(copia.id);
  }

  // ---------------- Calcular compra (por cantidad de platos) ----------------
  let calcularCompraRecetaId = null;

  // redondeo simple para no mostrar ruido de coma flotante (ej. 4.999999999) -- no es un
  // formateador de moneda, es solo para la columna "Cantidad necesaria".
  function formatoCantidad(n) {
    return (Math.round((n || 0) * 1000) / 1000).toString();
  }

  function renderCalcularCompra() {
    const cantidad = parseFloat(document.getElementById('calcularCompraCantidad').value) || 0;
    const { items, totalGeneral } = calcularInsumosNecesarios(calcularCompraRecetaId, cantidad);

    document.getElementById('tbodyCalcularCompra').innerHTML = items.map(it => `
      <tr>
        <td>${esc(it.nombre)}${!it.ok ? ' <span class="badge badge-bad">no encontrado</span>' : ''}</td>
        <td class="num">${formatoCantidad(it.cantidadNecesaria)} ${UNITS[it.unidad] ? UNITS[it.unidad].label : esc(it.unidad)}</td>
        <td class="num">${money(it.costo)}</td>
      </tr>
    `).join('');
    document.getElementById('calcularCompraTotal').textContent = money(totalGeneral);
  }

  function abrirCalcularCompra(recetaId) {
    const r = recetas.find(x => x.id === recetaId);
    if (!r) return;
    calcularCompraRecetaId = recetaId;
    document.getElementById('modalCalcularCompraTitulo').textContent = `Calcular compra — ${r.nombre}`;
    document.getElementById('calcularCompraCantidad').value = r.porciones || 1;
    renderCalcularCompra();
    openModal('modalCalcularCompra');
  }
  document.getElementById('calcularCompraCantidad').addEventListener('input', renderCalcularCompra);

  function generarPDFCalcularCompra() {
    const r = recetas.find(x => x.id === calcularCompraRecetaId);
    if (!r) return;
    const cantidad = parseFloat(document.getElementById('calcularCompraCantidad').value) || 0;
    const { items, totalGeneral } = calcularInsumosNecesarios(calcularCompraRecetaId, cantidad);

    const filasHTML = items.map(it => `
      <tr>
        <td>${esc(it.nombre)}${!it.ok ? ' (no encontrado)' : ''}</td>
        <td class="num">${formatoCantidad(it.cantidadNecesaria)} ${UNITS[it.unidad] ? UNITS[it.unidad].label : esc(it.unidad)}</td>
        <td class="num">${money(it.costo)}</td>
      </tr>
    `).join('');

    const marca = datosMarcaApp();
    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Calcular compra — ${esc(r.nombre)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#222;padding:16px;margin:0}
  .marca-pdf{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .marca-pdf-icono{font-size:26px;line-height:1;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
  .marca-pdf-icono img{width:32px;height:32px;object-fit:contain}
  h1{font-size:18px;margin:0}
  .marca-pdf .subtitulo-marca{font-size:11px;color:#777;margin:1px 0 0}
  .subtitulo{font-size:12px;color:#666;margin:0 0 18px}
  table{width:100%;border-collapse:collapse;font-size:10.5px;table-layout:fixed}
  th,td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:break-word;word-break:break-word}
  th{background:#f0f0f0}
  td.num,th.num{text-align:right}
  tfoot td{font-weight:bold;background:#f7f7f7}
  @media print{ body{padding:0} }
</style>
</head>
<body>
  <div class="marca-pdf">
    <span class="marca-pdf-icono">${marca.iconoHTML}</span>
    <div>
      <h1>${esc(marca.nombre)}</h1>
      <p class="subtitulo-marca">${esc(marca.subtitulo)}</p>
    </div>
  </div>
  <p class="subtitulo">Calcular compra — ${esc(r.nombre)} · ${formatoCantidad(cantidad)} plato(s) · Generado ${new Date().toLocaleString('es-CO')}</p>
  <table>
    <thead><tr><th>Insumo</th><th class="num">Cantidad necesaria</th><th class="num">Costo total</th></tr></thead>
    <tbody>${filasHTML}</tbody>
    <tfoot><tr><td colspan="2">Total general</td><td class="num">${money(totalGeneral)}</td></tr></tfoot>
  </table>
</body>
</html>`;

    const ventana = window.open('', '_blank');
    if (!ventana) { showToast('El navegador bloqueó la ventana. Permite pop-ups para exportar el PDF.'); return; }
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
    setTimeout(() => { try { ventana.focus(); ventana.print(); } catch (e) {} }, 300);
  }
  document.getElementById('btnPdfCalcularCompra').addEventListener('click', generarPDFCalcularCompra);

  document.getElementById('btnAgregarCarritoCalcularCompra').addEventListener('click', async () => {
    const r = recetas.find(x => x.id === calcularCompraRecetaId);
    const cantidad = parseFloat(document.getElementById('calcularCompraCantidad').value) || 0;
    if (!r || cantidad <= 0) { showToast('Ingresa una cantidad de platos válida.'); return; }

    const btn = document.getElementById('btnAgregarCarritoCalcularCompra');
    btn.disabled = true;
    try {
      const { error } = await window.supabaseClient.from('carrito_compras').insert({
        user_id: window.SUPABASE_USER_ID,
        receta_id: r.id,
        receta_nombre: r.nombre,
        cantidad_platos: cantidad,
      });
      if (error) throw error;
      showToast(`"${r.nombre}" agregado al carrito`);
      closeModal('modalCalcularCompra');
      actualizarBadgeCarrito();
    } catch (err) {
      console.error(err);
      showToast(`No se pudo agregar al carrito: ${err.message || err}`);
    } finally {
      btn.disabled = false;
    }
  });

  async function generarPDFReceta(id) {
    const r = recetas.find(x => x.id === id);
    if (!r) return;
    const c = calcReceta(r);
    const urlFoto = await resolverUrlFotoReceta(r);

    const filasIngredientesHTML = c.detalle.map(d => `
      <tr>
        <td>${esc(d.nombre)}${!d.ok ? ' (no encontrado)' : ''}</td>
        <td class="num">${d.cantidad} ${UNITS[d.unidad] ? UNITS[d.unidad].label : esc(d.unidad)}</td>
        <td class="num">${money(d.costo)}</td>
      </tr>
    `).join('');

    const otrosCostosHTML = c.costosAdicionales.length ? `
      <h3>Otros costos</h3>
      <table>
        <thead><tr><th>Concepto</th><th class="num">Cantidad</th><th class="num">Precio unitario</th><th class="num">Costo</th></tr></thead>
        <tbody>
          ${c.costosAdicionales.map(costo => `
            <tr>
              <td>${esc(costo.concepto) || '(sin nombre)'}</td>
              <td class="num">${costo.cantidad}</td>
              <td class="num">${money(costo.precioUnitario)}</td>
              <td class="num">${money(costo.costo)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '';

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${esc(r.nombre)} — Ficha de costeo</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:0;padding:28px}
  .ficha{max-width:640px;margin:0 auto}
  .ficha-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #222;padding-bottom:10px;margin-bottom:14px;gap:16px}
  h1{font-size:19px;margin:0 0 4px}
  .subtitulo{font-size:12px;color:#666;margin:0}
  .meta{text-align:right;font-size:10.5px;color:#666;white-space:nowrap}
  .foto{width:100%;max-height:220px;object-fit:cover;border-radius:6px;margin-bottom:14px}
  h3{font-size:12.5px;text-transform:uppercase;letter-spacing:.03em;color:#666;margin:18px 0 6px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#f0f0f0}
  td.num,th.num{text-align:right}
  .resumen{width:auto;min-width:260px;margin-left:auto;margin-top:6px}
  .resumen td{border:none;padding:3px 0 3px 14px}
  .resumen tr.total td{font-weight:800;font-size:15px;border-top:2px solid #222;padding-top:6px}
  .texto{font-size:12px;line-height:1.6;white-space:pre-wrap;color:#333;background:#f7f7f7;padding:10px 12px;border-radius:6px}
  @media print{ body{padding:0} }
</style>
</head>
<body>
  <div class="ficha">
    <div class="ficha-header">
      <div>
        <h1>${esc(r.nombre)}</h1>
        <p class="subtitulo">${esc(r.categoria) || 'Sin categoría'} · ${r.porciones} porción(es)</p>
      </div>
      <div class="meta">Generado ${new Date().toLocaleString('es-CO')}</div>
    </div>
    ${urlFoto ? `<img class="foto" src="${urlFoto}">` : ''}
    ${r.descripcion ? `<h3>Descripción</h3><div class="texto">${esc(r.descripcion)}</div>` : ''}
    <h3>Ingredientes</h3>
    <table>
      <thead><tr><th>Insumo</th><th class="num">Cantidad</th><th class="num">Costo</th></tr></thead>
      <tbody>${filasIngredientesHTML}</tbody>
    </table>
    ${otrosCostosHTML}
    <table class="resumen">
      <tr><td>Costo ingredientes</td><td class="num">${money(c.costoIngredientes)}</td></tr>
      <tr><td>Otros costos</td><td class="num">${money(c.totalCostosAdicionales)}</td></tr>
      <tr><td>Costo total</td><td class="num">${money(c.costoTotal)}</td></tr>
      <tr><td>Costo por plato</td><td class="num">${money(c.costoPorPlato)}</td></tr>
      <tr><td>${c.precioVenta ? 'Precio de venta' : 'Precio sugerido'}</td><td class="num">${money(c.precioReferencia)}</td></tr>
      <tr><td>Utilidad por plato</td><td class="num">${money(c.utilidadPorPlato)}</td></tr>
      <tr class="total"><td>Margen real</td><td class="num">${pct(c.margenReal)}</td></tr>
    </table>
    ${r.preparacion ? `<h3>Preparación</h3><div class="texto">${esc(r.preparacion)}</div>` : ''}
  </div>
</body>
</html>`;

    const ventana = window.open('', '_blank');
    if (!ventana) { showToast('El navegador bloqueó la ventana. Permite pop-ups para exportar el PDF.'); return; }
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
    setTimeout(() => { try { ventana.focus(); ventana.print(); } catch (e) {} }, 300);
  }

  async function deleteReceta(id) {
    const r = recetas.find(x => x.id === id);
    const enPedidos = pedidos.filter(p => p.items.some(it => it.recetaId === id));
    const msg = enPedidos.length
      ? `Este plato está en ${enPedidos.length} pedido(s). Si lo eliminas, esos pedidos quedarán con un plato faltante. ¿Eliminar de todas formas?`
      : `¿Eliminar la receta "${r.nombre}"?`;
    if (!confirm(msg)) return;
    try {
      await marcarRecetaEliminadaEnSupabase(id);
    } catch (err) {
      console.error(err);
      showToast(`No se pudo eliminar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
      return;
    }
    moverAPapelera('recetas', r);
    recetas = recetas.filter(x => x.id !== id);
    // así renderPedidos() (justo abajo) ya puede mostrar el nombre real + "Eliminado" sin
    // esperar al próximo refresh/sincronización — antes este mapa solo se llenaba una vez,
    // al cargar la página.
    recetasEliminadasPorId.set(id, r.nombre);
    saveRecetas();
    renderRecetas();
    renderPedidos();
    showToast('Receta eliminada (puedes restaurarla desde la Papelera)');
  }

  document.getElementById('buscarReceta').addEventListener('input', renderRecetas);
  document.getElementById('btnNuevaReceta').addEventListener('click', () => openRecetaModal(null));

  // =========================================================
  //  RECETAS — modal de edición/creación
  // =========================================================
  const tbodyIngredientes = document.getElementById('tbodyIngredientes');

  function insumoOptionsHTML(selectedId) {
    return insumos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(i =>
      `<option value="${i.id}" ${i.id === selectedId ? 'selected' : ''}>${esc(i.nombre)}</option>`
    ).join('');
  }

  function unidadOptionsHTML(groupOrInsumoUnidad, selectedUnidad) {
    const group = UNITS[groupOrInsumoUnidad] ? UNITS[groupOrInsumoUnidad].group : groupOrInsumoUnidad;
    return Object.keys(UNITS).filter(k => UNITS[k].group === group).map(k =>
      `<option value="${k}" ${k === selectedUnidad ? 'selected' : ''}>${UNITS[k].label}</option>`
    ).join('');
  }

  function addIngredientRow(ing) {
    if (!insumos.length) {
      showToast('Primero crea al menos un insumo en la pestaña Insumos.');
      return;
    }
    const tr = document.createElement('tr');
    tr.className = 'ingredient-row';
    const firstInsumoId = ing ? ing.insumoId : insumos[0].id;
    const insumo = insumos.find(i => i.id === firstInsumoId) || insumos[0];
    const unidad = ing ? ing.unidad : insumo.unidad;
    tr.innerHTML = `
      <td><select class="ing-insumo">${insumoOptionsHTML(firstInsumoId)}</select></td>
      <td><input type="number" class="ing-cantidad" min="0" step="any" value="${ing ? ing.cantidad : ''}"></td>
      <td><select class="ing-unidad">${unidadOptionsHTML(insumo.unidad, unidad)}</select></td>
      <td class="ing-costo">${money(0)}</td>
      <td class="ing-porcion cell-muted">—</td>
      <td class="col-actions"><button type="button" class="btn-icon danger" title="Quitar">🗑</button></td>
    `;
    tbodyIngredientes.appendChild(tr);

    const selInsumo = tr.querySelector('.ing-insumo');
    const selUnidad = tr.querySelector('.ing-unidad');
    const inpCantidad = tr.querySelector('.ing-cantidad');

    selInsumo.addEventListener('change', () => {
      const i = insumos.find(x => x.id === selInsumo.value);
      selUnidad.innerHTML = unidadOptionsHTML(i.unidad, i.unidad);
      recalcResumenReceta();
    });
    selUnidad.addEventListener('change', recalcResumenReceta);
    inpCantidad.addEventListener('input', recalcResumenReceta);
    tr.querySelector('.btn-icon').addEventListener('click', () => { tr.remove(); recalcResumenReceta(); });

    recalcResumenReceta();
  }

  document.getElementById('btnAgregarIngrediente').addEventListener('click', () => addIngredientRow(null));

  function readIngredientRows() {
    return Array.from(tbodyIngredientes.querySelectorAll('.ingredient-row')).map(tr => ({
      insumoId: tr.querySelector('.ing-insumo').value,
      cantidad: parseFloat(tr.querySelector('.ing-cantidad').value) || 0,
      unidad: tr.querySelector('.ing-unidad').value,
    }));
  }

  // ---------------- costos adicionales (mano de obra, gas, transporte, servicios...) ----------------
  const tbodyCostosAdicionales = document.getElementById('tbodyCostosAdicionales');

  function addCostoRow(costo) {
    const tr = document.createElement('tr');
    tr.className = 'costo-row';
    tr.innerHTML = `
      <td><input type="text" class="costo-concepto" list="listaConceptosCosto" placeholder="Ej: Mano de obra" value="${costo ? esc(costo.concepto) : ''}"></td>
      <td><input type="number" class="costo-cantidad" min="0" step="any" value="${costo ? costo.cantidad : '1'}"></td>
      <td><input type="number" class="costo-precio" min="0" step="any" value="${costo ? costo.precioUnitario : ''}" placeholder="0.00"></td>
      <td class="costo-costo">${money(0)}</td>
      <td class="col-actions"><button type="button" class="btn-icon danger" title="Quitar">🗑</button></td>
    `;
    tbodyCostosAdicionales.appendChild(tr);
    tr.querySelector('.costo-concepto').addEventListener('input', recalcResumenReceta);
    tr.querySelector('.costo-cantidad').addEventListener('input', recalcResumenReceta);
    tr.querySelector('.costo-precio').addEventListener('input', recalcResumenReceta);
    tr.querySelector('.btn-icon').addEventListener('click', () => { tr.remove(); recalcResumenReceta(); });
    recalcResumenReceta();
  }
  document.getElementById('btnAgregarCostoAdicional').addEventListener('click', () => addCostoRow(null));

  function readCostosAdicionalesRows() {
    return Array.from(tbodyCostosAdicionales.querySelectorAll('.costo-row')).map(tr => ({
      concepto: tr.querySelector('.costo-concepto').value.trim(),
      cantidad: parseFloat(tr.querySelector('.costo-cantidad').value) || 0,
      precioUnitario: parseFloat(tr.querySelector('.costo-precio').value) || 0,
    })).filter(c => c.concepto || c.cantidad || c.precioUnitario);
  }

  function currentFormReceta() {
    // antes esto era "parseFloat(...) || null", que convertía un 0 explícito en null
    // (mismo bug que ya corregimos en el script de migración) — isFinite(0) es true,
    // así que ahora un precio de venta de 0 se guarda como 0, no se pierde.
    const precioVentaValor = parseFloat(document.getElementById('recetaPrecioVenta').value);
    return {
      nombre: document.getElementById('recetaNombre').value.trim() || '(sin nombre)',
      categoria: document.getElementById('recetaCategoria').value,
      porciones: parseInt(document.getElementById('recetaPorciones').value, 10) || 1,
      ingredientes: readIngredientRows(),
      costosAdicionales: readCostosAdicionalesRows(),
      margenPct: parseFloat(document.getElementById('recetaMargen').value) || 0,
      precioVenta: isFinite(precioVentaValor) ? precioVentaValor : null,
      foto: recetaFotoActual,
      descripcion: recetaDescripcionActual,
      preparacion: recetaPreparacionActual,
    };
  }

  function recalcResumenReceta() {
    const r = currentFormReceta();
    const c = calcReceta(r);

    // costo por fila + cuánto de ese ingrediente corresponde a 1 sola porción
    Array.from(tbodyIngredientes.querySelectorAll('.ingredient-row')).forEach((tr, idx) => {
      const d = c.detalle[idx];
      tr.querySelector('.ing-costo').textContent = d ? money(d.costo) : money(0);
      tr.querySelector('.ing-porcion').textContent = d ? porPorcionBase(d.cantidad, d.unidad, r.porciones) : '—';
    });
    Array.from(tbodyCostosAdicionales.querySelectorAll('.costo-row')).forEach((tr, idx) => {
      const costo = c.costosAdicionales[idx];
      tr.querySelector('.costo-costo').textContent = costo ? money(costo.costo) : money(0);
    });

    const resumen = document.getElementById('resumenReceta');
    resumen.innerHTML = `
      <div class="summary-item"><div class="summary-label">Costo ingredientes</div><div class="summary-value">${money(c.costoIngredientes)}</div></div>
      <div class="summary-item"><div class="summary-label">Otros costos</div><div class="summary-value">${money(c.totalCostosAdicionales)}</div></div>
      <div class="summary-item"><div class="summary-label">Costo total</div><div class="summary-value">${money(c.costoTotal)}</div></div>
      <div class="summary-item highlight"><div class="summary-label">Costo por plato</div><div class="summary-value">${money(c.costoPorPlato)}</div></div>
      <div class="summary-item highlight"><div class="summary-label">Precio sugerido</div><div class="summary-value">${money(c.precioSugerido)}</div></div>
      <div class="summary-item"><div class="summary-label">Utilidad por plato</div><div class="summary-value">${money(c.utilidadPorPlato)}</div></div>
      <div class="summary-item"><div class="summary-label">Margen real (sobre el costo)</div><div class="summary-value">${pct(c.margenReal)}</div></div>
      ${c.faltantes.length ? `<div class="summary-warning">⚠ Ingrediente(s) eliminado(s) de la base de insumos: ${esc(c.faltantes.join(', '))}</div>` : ''}
    `;
  }

  ['recetaPorciones', 'recetaMargen', 'recetaPrecioVenta'].forEach(id => {
    document.getElementById(id).addEventListener('input', recalcResumenReceta);
  });

  // ---------------- foto de la receta ----------------
  let recetaFotoActual = null;
  const inputFoto = document.getElementById('recetaFotoInput');
  const previewFoto = document.getElementById('recetaFotoPreview');
  const btnQuitarFoto = document.getElementById('btnQuitarFoto');
  const btnAjustarFoto = document.getElementById('btnAjustarFoto');

  async function renderFotoPreview() {
    if (!recetaFotoActual) {
      previewFoto.innerHTML = '<span class="foto-placeholder">Sin foto</span>';
      btnQuitarFoto.hidden = true;
      btnAjustarFoto.hidden = true;
      return;
    }
    btnQuitarFoto.hidden = false;
    btnAjustarFoto.hidden = false;
    if (esFotoBase64(recetaFotoActual)) {
      previewFoto.innerHTML = `<img src="${recetaFotoActual}" alt="Foto de la receta">`;
      return;
    }
    // foto ya guardada en Storage (no base64): lo que haya en recetaFotoActual puede ser una
    // URL firmada vieja/vencida -- se muestra un estado breve de carga mientras se firma una
    // fresca, igual que el resto de las pantallas que muestran fotos de recetas.
    previewFoto.innerHTML = '<span class="foto-placeholder">Cargando…</span>';
    const idActual = document.getElementById('recetaId').value;
    const url = await resolverUrlFotoReceta({ id: idActual, nombre: 'receta', foto: recetaFotoActual });
    if (!url) { previewFoto.innerHTML = '<span class="foto-placeholder">No se pudo cargar la foto</span>'; return; }
    // se refresca con la firma recién obtenida -- si se guarda la receta sin tocar la foto,
    // currentFormReceta() lee este mismo valor, así que queda guardada una firma vigente.
    recetaFotoActual = url;
    previewFoto.innerHTML = `<img src="${url}" alt="Foto de la receta">`;
  }
  inputFoto.addEventListener('change', () => {
    const file = inputFoto.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Selecciona un archivo de imagen.'); return; }
    const reader = new FileReader();
    reader.onload = () => abrirAjustarFoto(reader.result);
    reader.readAsDataURL(file);
    inputFoto.value = '';
  });
  btnQuitarFoto.addEventListener('click', () => { recetaFotoActual = null; renderFotoPreview(); });
  btnAjustarFoto.addEventListener('click', () => { if (recetaFotoActual) abrirAjustarFoto(recetaFotoActual); });

  // ---------------- ajustar foto (arrastrar para encuadrar + zoom, antes de guardarla) ----------------
  // Antes la imagen se guardaba tal cual, y cada lugar donde se muestra (miniatura cuadrada,
  // tarjeta de receta, detalle, PDF) la recortaba automáticamente al centro con object-fit:cover
  // — sin control sobre qué parte de la foto se ve. Ahora, al subir (o reajustar) una foto, se
  // abre este modal para elegir el encuadre a mano, y recién ahí se "hornea" el resultado en un
  // canvas de tamaño fijo (misma proporción ancha que el detalle/PDF) que se guarda como
  // recetaFotoActual — ya viene precortada, así que se ve bien en todos los tamaños.
  const marcoAjustarFoto = document.getElementById('ajustarFotoMarco');
  const sliderZoomFoto = document.getElementById('ajustarFotoZoom');
  // 4:3 en vez de la proporción ancha original (800x440 ≈ 1.8:1) — con una foto de comida
  // más bien cuadrada, esa proporción tan ancha ya forzaba a recortar mucho solo para
  // "llenar" el marco, antes de tocar el zoom. Tiene que coincidir con el aspect-ratio de
  // .ajustar-foto-marco en css/styles.css, si no el recorte que ves no es el que se guarda.
  const ANCHO_SALIDA_FOTO = 800, ALTO_SALIDA_FOTO = 600;
  let ajusteFotoImagenOriginal = null;
  let ajusteFotoNaturalW = 0, ajusteFotoNaturalH = 0;
  let ajusteFotoZoom = 100;
  let ajusteFotoPosX = 50, ajusteFotoPosY = 50; // % (equivalente a background-position)
  let ajusteFotoArrastrando = false;
  let ajusteFotoUltimoX = 0, ajusteFotoUltimoY = 0;

  // zoom=100 significa "CONTENER" (se ve la foto completa, sin recortar nada — puede
  // dejar franjas vacías a los costados si la proporción no coincide con la del marco);
  // subir el zoom va agrandando la imagen desde ahí, recortando cada vez más. Antes el
  // 100% era "CUBRIR" (llenar el marco recortando lo que sobra), por eso arrancaba
  // recortado — ahora arranca mostrando todo, y el recorte es una decisión, no el punto de partida.
  function aplicarEstiloMarcoAjuste() {
    const rect = marcoAjustarFoto.getBoundingClientRect();
    const escalaContener = Math.min(rect.width / ajusteFotoNaturalW, rect.height / ajusteFotoNaturalH);
    const escala = escalaContener * (ajusteFotoZoom / 100);
    const anchoPx = ajusteFotoNaturalW * escala;
    const altoPx = ajusteFotoNaturalH * escala;
    marcoAjustarFoto.style.backgroundImage = `url("${ajusteFotoImagenOriginal}")`;
    marcoAjustarFoto.style.backgroundSize = `${anchoPx}px ${altoPx}px`;
    marcoAjustarFoto.style.backgroundPosition = `${ajusteFotoPosX}% ${ajusteFotoPosY}%`;
  }

  function abrirAjustarFoto(dataUrl) {
    ajusteFotoImagenOriginal = dataUrl;
    ajusteFotoZoom = 100;
    ajusteFotoPosX = 50;
    ajusteFotoPosY = 50;
    sliderZoomFoto.value = 100;
    const img = new Image();
    img.onload = () => {
      ajusteFotoNaturalW = img.naturalWidth;
      ajusteFotoNaturalH = img.naturalHeight;
      // se abre el modal ANTES de calcular el marco: con el modal todavía oculto,
      // getBoundingClientRect() dentro de aplicarEstiloMarcoAjuste() daría 0x0.
      openModal('modalAjustarFoto');
      aplicarEstiloMarcoAjuste();
    };
    img.src = dataUrl;
  }

  marcoAjustarFoto.addEventListener('pointerdown', e => {
    ajusteFotoArrastrando = true;
    ajusteFotoUltimoX = e.clientX;
    ajusteFotoUltimoY = e.clientY;
    marcoAjustarFoto.classList.add('arrastrando');
    marcoAjustarFoto.setPointerCapture(e.pointerId);
  });
  marcoAjustarFoto.addEventListener('pointermove', e => {
    if (!ajusteFotoArrastrando) return;
    const dx = e.clientX - ajusteFotoUltimoX;
    const dy = e.clientY - ajusteFotoUltimoY;
    ajusteFotoUltimoX = e.clientX;
    ajusteFotoUltimoY = e.clientY;
    const rect = marcoAjustarFoto.getBoundingClientRect();
    // arrastrar hacia la derecha "revela" lo que está a la izquierda de la imagen, por eso
    // el signo contrario — igual que el comportamiento habitual de arrastrar un mapa/imagen.
    ajusteFotoPosX = Math.min(100, Math.max(0, ajusteFotoPosX - (dx / rect.width) * 100));
    ajusteFotoPosY = Math.min(100, Math.max(0, ajusteFotoPosY - (dy / rect.height) * 100));
    aplicarEstiloMarcoAjuste();
  });
  ['pointerup', 'pointercancel'].forEach(ev => marcoAjustarFoto.addEventListener(ev, () => {
    ajusteFotoArrastrando = false;
    marcoAjustarFoto.classList.remove('arrastrando');
  }));

  sliderZoomFoto.addEventListener('input', () => {
    ajusteFotoZoom = parseInt(sliderZoomFoto.value, 10) || 100;
    aplicarEstiloMarcoAjuste();
  });

  document.getElementById('btnGuardarAjusteFoto').addEventListener('click', () => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = ANCHO_SALIDA_FOTO;
      canvas.height = ALTO_SALIDA_FOTO;
      const ctx = canvas.getContext('2d');

      // misma matemática que se ve en pantalla (aplicarEstiloMarcoAjuste: "contener" + zoom
      // manual + posición), pero dibujada en el tamaño de salida fijo en vez del tamaño real
      // del marco en pantalla — el resultado tiene que verse igual a lo que se ve al ajustar.
      const escalaContener = Math.min(ANCHO_SALIDA_FOTO / img.width, ALTO_SALIDA_FOTO / img.height);
      const escala = escalaContener * (ajusteFotoZoom / 100);
      const anchoDibujado = img.width * escala;
      const altoDibujado = img.height * escala;
      const x = -(anchoDibujado - ANCHO_SALIDA_FOTO) * (ajusteFotoPosX / 100);
      const y = -(altoDibujado - ALTO_SALIDA_FOTO) * (ajusteFotoPosY / 100);

      // si a zoom mínimo la imagen no llena el marco por completo (franjas vacías en algún
      // lado), rellenar primero con un gris neutro — si no, al exportar como JPEG (sin
      // transparencia) esas franjas saldrían negras.
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, x, y, anchoDibujado, altoDibujado);
      recetaFotoActual = canvas.toDataURL('image/jpeg', 0.85);
      renderFotoPreview();
      closeModal('modalAjustarFoto');
    };
    img.src = ajusteFotoImagenOriginal;
  });

  // ---------------- descripción y preparación (texto libre, vía modal aparte) ----------------
  let recetaDescripcionActual = '';
  let recetaPreparacionActual = '';
  const btnDescripcionReceta = document.getElementById('btnDescripcionReceta');
  const btnInstruccionesCocina = document.getElementById('btnInstruccionesCocina');

  function actualizarBotonesTexto() {
    btnDescripcionReceta.textContent = recetaDescripcionActual ? '✎ Editar descripción' : '📝 Agregar descripción';
    btnInstruccionesCocina.textContent = recetaPreparacionActual ? '✎ Editar preparación' : '📝 Agregar preparación';
  }

  btnDescripcionReceta.addEventListener('click', () => {
    document.getElementById('descripcionTexto').value = recetaDescripcionActual;
    openModal('modalDescripcion');
  });
  document.getElementById('formDescripcion').addEventListener('submit', e => {
    e.preventDefault();
    recetaDescripcionActual = document.getElementById('descripcionTexto').value.trim();
    actualizarBotonesTexto();
    closeModal('modalDescripcion');
  });

  btnInstruccionesCocina.addEventListener('click', () => {
    document.getElementById('instruccionesTexto').value = recetaPreparacionActual;
    openModal('modalInstrucciones');
  });
  document.getElementById('formInstrucciones').addEventListener('submit', e => {
    e.preventDefault();
    recetaPreparacionActual = document.getElementById('instruccionesTexto').value.trim();
    actualizarBotonesTexto();
    closeModal('modalInstrucciones');
  });

  function openRecetaModal(id) {
    const form = document.getElementById('formReceta');
    form.reset();
    tbodyIngredientes.innerHTML = '';
    tbodyCostosAdicionales.innerHTML = '';
    document.getElementById('recetaPrecioVenta').value = '';
    populateCategoriaSelect(document.getElementById('recetaCategoria'), categoriasRecetas, id ? recetas.find(x => x.id === id).categoria : '');

    if (id) {
      const r = recetas.find(x => x.id === id);
      document.getElementById('modalRecetaTitulo').textContent = 'Editar receta';
      document.getElementById('recetaId').value = r.id;
      document.getElementById('recetaNombre').value = r.nombre;
      document.getElementById('recetaCategoria').value = r.categoria;
      document.getElementById('recetaPorciones').value = r.porciones;
      document.getElementById('recetaMargen').value = r.margenPct;
      document.getElementById('recetaPrecioVenta').value = r.precioVenta || '';
      r.ingredientes.forEach(ing => addIngredientRow(ing));
      (r.costosAdicionales || []).forEach(costo => addCostoRow(costo));
      recetaFotoActual = r.foto || null;
      recetaDescripcionActual = r.descripcion || '';
      recetaPreparacionActual = r.preparacion || '';
    } else {
      document.getElementById('modalRecetaTitulo').textContent = 'Nueva receta';
      document.getElementById('recetaId').value = '';
      document.getElementById('recetaPorciones').value = 1;
      document.getElementById('recetaMargen').value = 150;
      addIngredientRow(null);
      recetaFotoActual = null;
      recetaDescripcionActual = '';
      recetaPreparacionActual = '';
    }
    renderFotoPreview();
    actualizarBotonesTexto();
    recalcResumenReceta();
    openModal('modalReceta');
  }

  document.getElementById('formReceta').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('recetaId').value;
    const data = currentFormReceta();
    if (!data.ingredientes.length) { showToast('Agrega al menos un ingrediente.'); return; }
    if (id && !confirm(`¿Guardar los cambios en "${data.nombre}"? Se sobrescribirán los datos actuales de esta receta.`)) return;

    const btnGuardar = document.querySelector('#formReceta button[type="submit"]');
    btnGuardar.disabled = true;
    try {
      const recetaId = id || crypto.randomUUID();
      const fotoAnterior = id ? (recetas.find(x => x.id === id)?.foto || null) : null;

      // data.foto llega en 3 estados posibles: una URL sin cambios (no se toca), null/'' (se
      // quitó la foto), o un data: URL base64 recién ajustado en el canvas (hay que subirlo
      // antes de guardar la receta -- recetas.foto termina siendo solo la URL resultante).
      if (data.foto && data.foto.startsWith('data:')) {
        data.foto = await subirFotoRecetaAStorage(recetaId, data.foto);
      } else if (!data.foto && fotoAnterior) {
        await eliminarFotoRecetaDeStorage(recetaId);
      }

      await guardarRecetaEnSupabase(recetaId, data);
      if (id) {
        const r = recetas.find(x => x.id === id);
        Object.assign(r, data);
        showToast('Receta actualizada');
      } else {
        recetas.push({ id: recetaId, ...data });
        showToast('Receta creada');
      }
      saveRecetas();
      renderRecetas();
      closeModal('modalReceta');
    } catch (err) {
      console.error(err);
      showToast(`No se pudo guardar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
    } finally {
      btnGuardar.disabled = false;
    }
  });

  // =========================================================
  //  RECETAS — vista de detalle (solo lectura)
  // =========================================================
  let detalleActualId = null;
  function porPorcionBase(cantidad, unidad, porciones) {
    const u = UNITS[unidad];
    if (!u) return '—';
    const enBase = (cantidad || 0) * u.factor;
    const porPorcion = enBase / Math.max(1, porciones || 1);
    const etiqueta = u.group === 'peso' ? 'g' : u.group === 'volumen' ? 'ml' : 'u';
    return `${porPorcion.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 1 })} ${etiqueta}`;
  }

  function seccionColapsableHTML(titulo, contenidoHtml, accionesHTML = '') {
    return `
      <div class="detail-section">
        <h4 class="detail-section-header" data-toggle-seccion>
          <span>${titulo}</span>
          ${accionesHTML ? `<span data-accion-seccion style="margin-left:auto">${accionesHTML}</span>` : ''}
          <span class="chevron" aria-hidden="true"></span>
        </h4>
        <div class="detail-section-body">${contenidoHtml}</div>
      </div>
    `;
  }

  function openDetalleReceta(id) {
    detalleActualId = id;
    const r = recetas.find(x => x.id === id);
    const c = calcReceta(r);
    document.getElementById('detalleTitulo').textContent = r.nombre;

    const tablaIngredientesHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Insumo</th><th>Cantidad</th><th>Costo</th><th>Por plato</th></tr></thead>
          <tbody>
            ${c.detalle.map(d => `
              <tr>
                <td>${esc(d.nombre)}${!d.ok ? ' <span class="badge badge-bad">no encontrado</span>' : ''}</td>
                <td>${d.cantidad} ${UNITS[d.unidad] ? UNITS[d.unidad].label : esc(d.unidad)}</td>
                <td>${money(d.costo)}</td>
                <td>${porPorcionBase(d.cantidad, d.unidad, r.porciones)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;

    const tablaOtrosCostosHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Concepto</th><th>Cantidad</th><th>Precio unitario</th><th>Costo</th></tr></thead>
          <tbody>
            ${c.costosAdicionales.map(costo => `
              <tr>
                <td>${esc(costo.concepto) || '(sin nombre)'}</td>
                <td>${costo.cantidad}</td>
                <td>${money(costo.precioUnitario)}</td>
                <td>${money(costo.costo)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('detalleContenido').innerHTML = `
      ${r.foto ? `<div class="foto-receta-placeholder detail-photo" data-foto-receta="${r.id}" data-foto-clase="detail-photo"></div>` : ''}
      ${r.descripcion ? seccionColapsableHTML('Descripción', `<p class="detail-texto">${esc(r.descripcion)}</p>`) : ''}
      ${r.preparacion ? seccionColapsableHTML('Preparación', `<p class="detail-texto">${esc(r.preparacion)}</p>`) : ''}
      ${seccionColapsableHTML(`Ingredientes (${r.porciones} porción(es))`, tablaIngredientesHTML)}
      ${c.costosAdicionales.length ? seccionColapsableHTML('Otros costos', tablaOtrosCostosHTML) : ''}
      <div class="summary-panel" style="margin-top:0">
        <div class="summary-item"><div class="summary-label">Costo ingredientes</div><div class="summary-value">${money(c.costoIngredientes)}</div></div>
        <div class="summary-item"><div class="summary-label">Otros costos</div><div class="summary-value">${money(c.totalCostosAdicionales)}</div></div>
        <div class="summary-item highlight"><div class="summary-label">Costo por plato</div><div class="summary-value">${money(c.costoPorPlato)}</div></div>
        <div class="summary-item highlight"><div class="summary-label">${c.precioVenta ? 'Precio de venta' : 'Precio sugerido'}</div><div class="summary-value">${money(c.precioReferencia)}</div></div>
        <div class="summary-item"><div class="summary-label">Utilidad por plato</div><div class="summary-value">${money(c.utilidadPorPlato)}</div></div>
        <div class="summary-item"><div class="summary-label">Margen real (sobre el costo)</div><div class="summary-value"><span class="badge ${margenBadgeClass(c.margenReal)}">${pct(c.margenReal)}</span></div></div>
      </div>
    `;

    document.querySelectorAll('#detalleContenido [data-toggle-seccion]').forEach(header => {
      header.addEventListener('click', e => {
        if (e.target.closest('[data-accion-seccion]')) return; // no colapsar al clickear un botón de acción del encabezado
        header.closest('.detail-section').classList.toggle('colapsado');
      });
    });
    aplicarFotosRecetasEnDOM(document.getElementById('detalleContenido'));

    openModal('modalDetalle');
  }
  document.getElementById('btnEditarDesdeDetalle').addEventListener('click', () => {
    closeModal('modalDetalle');
    openRecetaModal(detalleActualId);
  });
  document.getElementById('btnPdfDesdeDetalle').addEventListener('click', () => {
    generarPDFReceta(detalleActualId);
  });

  // =========================================================
  //  CLIENTES
  // =========================================================
  let clientes = loadClientes();
  let quickAddClienteActivo = false;
  // mismo mecanismo que recetasEliminadasPorId: nombre de clientes en la Papelera de
  // Supabase (deleted_at marcado, fila viva), para que Pedidos muestre el nombre real +
  // "Eliminado" en vez del genérico "(cliente eliminado)" (que solo aplica si ya no queda
  // ninguna fila, borrado definitivo).
  let clientesEliminadosPorId = new Map();

  function loadClientes() {
    try { return JSON.parse(localStorage.getItem(LS_CLIENTES)) || []; }
    catch (e) { return []; }
  }
  function saveClientes() { localStorage.setItem(LS_CLIENTES, JSON.stringify(clientes)); }

  // ---------------- Clientes <-> Supabase ----------------
  // Mismo patrón que Insumos: tabla sin hijos, sin necesidad de RPC/transacción — un solo
  // insert/update/delete por operación ya es atómico de por sí. "clientes" sigue en memoria
  // + localStorage para que Pedidos (todavía no migrado) lo siga leyendo síncrono.
  //
  // OJO: resolverOCrearClientePorNombre() (usada al escribir el nombre del cliente
  // directo en el formulario de Pedido, sin abrir el modal de Cliente) NO se tocó a
  // propósito — sigue creando clientes 100% locales con uid() viejo, que no se sincronizan
  // con Supabase hasta que migremos Pedidos de lleno. Es un gap conocido y aceptado, no un
  // descuido: esos clientes desaparecerán del array local en la próxima sincronización si
  // no encuentran un nombre igual en Supabase (mismo aviso que ya vimos en Insumos/Recetas).
  function filaSupabaseACliente(fila) {
    return {
      id: fila.id,
      nombre: fila.nombre,
      telefono: fila.telefono || '',
      direccion: fila.direccion || '',
      notas: fila.notas || '',
      creadoEn: fila.created_at || null,
    };
  }

  async function sincronizarClientesDesdeSupabase() {
    // se traen TODOS los clientes (vivos y en la Papelera de Supabase), igual que hacemos
    // en sincronizarRecetasDesdeSupabase, para poder mostrar el nombre real de un cliente
    // eliminado en Pedidos (clientesEliminadosPorId) — solo el array "clientes" en memoria
    // se queda con los vivos.
    // Datos compartidos (ver nota en sincronizarInsumosDesdeSupabase): sin filtro por user_id.
    const { data: filasTodas, error } = await window.supabaseClient
      .from('clientes')
      .select('*')
      .order('nombre');
    if (error) {
      console.warn('No se pudo sincronizar Clientes con Supabase, se sigue usando la copia local:', error.message);
      return false;
    }

    const data = filasTodas.filter(c => !c.deleted_at);
    clientesEliminadosPorId = new Map(filasTodas.filter(c => c.deleted_at).map(c => [c.id, c.nombre]));

    const clientesAnteriores = clientes;
    const nuevosClientes = data.map(filaSupabaseACliente);

    // reconciliación por nombre — mismo motivo y mecanismo que en Insumos/Recetas: Pedidos
    // (todavía 100% local) guarda cada pedido por el id viejo del cliente.
    const nombreNorm = s => (s || '').trim().toLowerCase();
    const idViejoANuevoPorNombre = new Map();
    const advertenciasReconciliacion = [];

    clientesAnteriores.forEach(viejo => {
      const usadoEnPedidos = pedidos.some(p => p.clienteId === viejo.id);
      const candidatos = nuevosClientes.filter(n => nombreNorm(n.nombre) === nombreNorm(viejo.nombre));

      if (!candidatos.length) {
        if (usadoEnPedidos) {
          advertenciasReconciliacion.push(
            `"${viejo.nombre}" no tiene ningún cliente con ese nombre en Supabase — los pedidos que lo usan van a mostrar "(cliente eliminado)" hasta que lo corrijas a mano (¿se renombró, se borró, o es un cliente creado al vuelo desde un pedido que todavía no se sincroniza?).`
          );
        }
        return;
      }
      if (candidatos.length > 1 && usadoEnPedidos) {
        advertenciasReconciliacion.push(
          `"${viejo.nombre}" coincide con ${candidatos.length} clientes distintos en Supabase (nombres duplicados) — se usó el primero (id ${candidatos[0].id}) para reconectar los pedidos que lo usan. Revísalo a mano si no es el correcto.`
        );
      }
      if (candidatos[0].id !== viejo.id) idViejoANuevoPorNombre.set(viejo.id, candidatos[0].id);
    });

    if (advertenciasReconciliacion.length) {
      console.warn('Advertencias al reconciliar Clientes con Supabase por nombre:\n- ' + advertenciasReconciliacion.join('\n- '));
      showToast(`⚠ ${advertenciasReconciliacion.length} advertencia(s) al sincronizar Clientes — revisa la consola (F12) para el detalle.`);
    }

    if (idViejoANuevoPorNombre.size) {
      let pedidosCambiaron = false;
      pedidos.forEach(p => {
        if (idViejoANuevoPorNombre.has(p.clienteId)) {
          p.clienteId = idViejoANuevoPorNombre.get(p.clienteId);
          pedidosCambiaron = true;
        }
      });
      if (pedidosCambiaron) {
        savePedidos();
        console.info(`Se reconectaron ${idViejoANuevoPorNombre.size} cliente(s) en los pedidos locales con sus nuevos ids de Supabase (por nombre).`);
      }
    }

    clientes = nuevosClientes;
    saveClientes();
    renderClientes();
    renderPedidos();
    return true;
  }

  async function crearClienteEnSupabase(id, data) {
    const { error } = await window.supabaseClient.from('clientes').insert({
      id,
      user_id: window.SUPABASE_USER_ID,
      nombre: data.nombre,
      telefono: data.telefono,
      direccion: data.direccion,
      notas: data.notas,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  async function actualizarClienteEnSupabase(id, data) {
    const { error } = await window.supabaseClient.from('clientes').update({
      nombre: data.nombre,
      telefono: data.telefono,
      direccion: data.direccion,
      notas: data.notas,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
  }

  async function marcarClienteEliminadoEnSupabase(id) {
    const { error } = await window.supabaseClient.from('clientes').update({
      deleted_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
  }

  // Restaurar/eliminar-definitivo van por los hooks opcionales en PAPELERA_CONFIG.clientes
  // (mismo mecanismo que Insumos y Recetas) — restaurarDePapelera/eliminarDefinitivoDePapelera
  // ya validan esUuid() antes de llamarlos, así que un cliente creado al vuelo desde un
  // pedido (id viejo, nunca sincronizado) se restaura/elimina 100% local sin romperse.
  async function restaurarClienteEnSupabase(id) {
    const { error } = await window.supabaseClient.from('clientes').update({ deleted_at: null }).eq('id', id);
    if (error) throw error;
    clientesEliminadosPorId.delete(id);
  }

  async function eliminarClienteDefinitivamenteEnSupabase(id) {
    const { error } = await window.supabaseClient.from('clientes').delete().eq('id', id);
    if (error) throw error;
  }

  const tbodyClientes = document.getElementById('tbodyClientes');
  const emptyClientes = document.getElementById('emptyClientes');
  const statsClientes = document.getElementById('statsClientes');

  // resumen de compras de un cliente: cuántos pedidos, cuántos platos en total
  // y el monto acumulado de todos sus pedidos (usando el mismo cálculo que la pestaña Pedidos).
  function resumenComprasCliente(clienteId) {
    const suyos = pedidos.filter(p => p.clienteId === clienteId);
    const totalPlatos = suyos.reduce((s, p) => s + calcPedido(p).totalPlatos, 0);
    const totalAcumulado = suyos.reduce((s, p) => s + calcPedido(p).total, 0);
    return { numPedidos: suyos.length, totalPlatos, totalAcumulado };
  }

  function renderStatsClientes() {
    statsClientes.innerHTML = `
      <div class="stat-card"><div class="stat-value">${clientes.length}</div><div class="stat-label">Clientes</div></div>
    `;
  }

  // Orden de la tabla de Clientes por columna (mismo patrón que ya usamos en Pedidos): solo
  // "Platos pedidos" y "Total acumulado" son ordenables, tal como se pidió. Por defecto sigue
  // alfabético por nombre.
  const VALOR_ORDEN_CLIENTES = {
    nombre: c => c.nombre,
    totalPlatos: c => resumenComprasCliente(c.id).totalPlatos,
    totalAcumulado: c => resumenComprasCliente(c.id).totalAcumulado,
  };
  const ETIQUETA_ORDEN_CLIENTES = { nombre: 'Nombre', totalPlatos: 'Platos pedidos', totalAcumulado: 'Total acumulado' };
  let ordenClientesColumna = null; // null = orden por defecto (alfabético por nombre, igual que 'nombre'/asc)
  let ordenClientesDireccion = 'asc';

  function compararClientes(a, b) {
    if (!ordenClientesColumna) return a.nombre.localeCompare(b.nombre);
    const obtenerValor = VALOR_ORDEN_CLIENTES[ordenClientesColumna];
    const va = obtenerValor(a), vb = obtenerValor(b);
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return ordenClientesDireccion === 'asc' ? cmp : -cmp;
  }

  function actualizarIndicadoresOrdenClientes() {
    document.querySelectorAll('#tablaClientes [data-sort]').forEach(th => {
      const columna = th.getAttribute('data-sort');
      const etiqueta = ETIQUETA_ORDEN_CLIENTES[columna];
      const esActiva = columna === ordenClientesColumna;
      const indicador = th.querySelector('.sort-indicador');
      indicador.textContent = esActiva ? (ordenClientesDireccion === 'asc' ? '▲' : '▼') : '';
      th.title = esActiva
        ? `Ordenado por "${etiqueta}" (${ordenClientesDireccion === 'asc' ? 'ascendente' : 'descendente'}). Clic para invertir el orden.`
        : `Clic para ordenar por "${etiqueta}".`;
    });
  }

  document.querySelectorAll('#tablaClientes [data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const columna = th.getAttribute('data-sort');
      if (ordenClientesColumna === columna) {
        ordenClientesDireccion = ordenClientesDireccion === 'asc' ? 'desc' : 'asc';
      } else {
        ordenClientesColumna = columna;
        // "Nombre" tiene más sentido empezando A-Z; las columnas numéricas empiezan de mayor a menor
        // (más platos/más gastó primero).
        ordenClientesDireccion = columna === 'nombre' ? 'asc' : 'desc';
      }
      renderClientes();
    });
  });

  // igual que insumosFiltrados(): un solo criterio de filtrado compartido entre la tabla y el PDF.
  function clientesFiltrados() {
    const term = document.getElementById('buscarCliente').value.trim().toLowerCase();
    return clientes.filter(c =>
      !term || c.nombre.toLowerCase().includes(term) || (c.telefono || '').toLowerCase().includes(term)
    ).sort(compararClientes);
  }

  function renderClientes() {
    const filtrados = clientesFiltrados();
    actualizarIndicadoresOrdenClientes();

    tbodyClientes.innerHTML = filtrados.map(c => {
      const r = resumenComprasCliente(c.id);
      return `
        <tr>
          <td class="cell-nombre">${esc(c.nombre)}</td>
          <td>${esc(c.telefono) || '<span class="cell-muted">—</span>'}</td>
          <td class="cell-muted">${esc(c.direccion) || '—'}</td>
          <td class="cell-muted">${esc(c.notas) || '—'}</td>
          <td>${r.numPedidos}</td>
          <td>${r.totalPlatos}</td>
          <td>${money(r.totalAcumulado)}</td>
          <td class="col-actions">
            <button class="btn-icon" title="Historial de pedidos" data-historial-cliente="${c.id}">📋</button>
            <button class="btn-icon" title="Editar" data-edit-cliente="${c.id}">✎</button>
            <button class="btn-icon danger" title="Eliminar" data-del-cliente="${c.id}">🗑</button>
          </td>
        </tr>
      `;
    }).join('');

    emptyClientes.hidden = clientes.length !== 0;
    renderStatsClientes();

    tbodyClientes.querySelectorAll('[data-historial-cliente]').forEach(b =>
      b.addEventListener('click', () => abrirHistorialPedidosCliente(b.getAttribute('data-historial-cliente'))));
    tbodyClientes.querySelectorAll('[data-edit-cliente]').forEach(b =>
      b.addEventListener('click', () => openClienteModal(b.getAttribute('data-edit-cliente'))));
    tbodyClientes.querySelectorAll('[data-del-cliente]').forEach(b =>
      b.addEventListener('click', () => deleteCliente(b.getAttribute('data-del-cliente'))));
  }

  function generarPDFClientes() {
    const lista = clientesFiltrados();
    const term = document.getElementById('buscarCliente').value.trim();
    const totalGeneral = lista.reduce((s, c) => s + resumenComprasCliente(c.id).totalAcumulado, 0);

    const filasHTML = lista.map(c => {
      const r = resumenComprasCliente(c.id);
      return `
        <tr>
          <td>${esc(c.nombre)}</td>
          <td>${esc(c.telefono) || '—'}</td>
          <td>${esc(c.direccion) || '—'}</td>
          <td>${esc(c.notas) || '—'}</td>
          <td class="num">${r.numPedidos}</td>
          <td class="num">${r.totalPlatos}</td>
          <td class="num">${money(r.totalAcumulado)}</td>
        </tr>
      `;
    }).join('');

    const marca = datosMarcaApp();

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Clientes — ${esc(marca.nombre)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#222;padding:16px;margin:0}
  .marca-pdf{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .marca-pdf-icono{font-size:26px;line-height:1;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
  .marca-pdf-icono img{width:32px;height:32px;object-fit:contain}
  h1{font-size:18px;margin:0}
  .marca-pdf .subtitulo-marca{font-size:11px;color:#777;margin:1px 0 0}
  .subtitulo{font-size:12px;color:#666;margin:0 0 18px}
  table{width:100%;border-collapse:collapse;font-size:10.5px;table-layout:fixed}
  th,td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:break-word;word-break:break-word}
  th{background:#f0f0f0}
  td.num,th.num{text-align:right}
  tfoot td{font-weight:bold;background:#f7f7f7}
  @media print{ body{padding:0} }
</style>
</head>
<body>
  <div class="marca-pdf">
    <span class="marca-pdf-icono">${marca.iconoHTML}</span>
    <div>
      <h1>${esc(marca.nombre)}</h1>
      <p class="subtitulo-marca">${esc(marca.subtitulo)}</p>
    </div>
  </div>
  <p class="subtitulo">Clientes${term ? ` · Filtro: "${esc(term)}"` : ''} · ${lista.length} cliente(s) · Generado ${new Date().toLocaleString('es-CO')}</p>
  <table>
    <thead>
      <tr>
        <th>Nombre</th><th>Teléfono</th><th>Dirección</th><th>Notas</th>
        <th class="num">Pedidos</th><th class="num">Platos pedidos</th><th class="num">Total acumulado</th>
      </tr>
    </thead>
    <tbody>${filasHTML}</tbody>
    <tfoot>
      <tr><td colspan="6">Total general</td><td class="num">${money(totalGeneral)}</td></tr>
    </tfoot>
  </table>
</body>
</html>`;

    const ventana = window.open('', '_blank');
    if (!ventana) { showToast('El navegador bloqueó la ventana. Permite pop-ups para exportar el PDF.'); return; }
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
    setTimeout(() => { try { ventana.focus(); ventana.print(); } catch (e) {} }, 300);
  }
  document.getElementById('btnExportarClientesPDF').addEventListener('click', generarPDFClientes);

  // ---------------- Historial de pedidos por cliente (solo consulta) ----------------
  // Criterio elegido para los cancelados: se INCLUYEN en la lista (no se ocultan), marcados
  // visualmente ("🚫 Cancelado" en la columna Pago + fila tachada, misma clase fila-cancelada
  // que ya usa la tabla de Pedidos) -- así el conteo de "Pedidos" que ya se ve en la tabla de
  // Clientes (que tampoco excluye cancelados) coincide con la cantidad de filas de este
  // historial, sin necesidad de explicar una diferencia entre ambos números.
  let historialPedidosClienteActualId = null;

  function pedidosDeClienteOrdenados(clienteId) {
    return pedidos
      .filter(p => p.clienteId === clienteId)
      .sort((a, b) => `${b.fechaEntrega}${b.horaEntrega}`.localeCompare(`${a.fechaEntrega}${a.horaEntrega}`));
  }

  function abrirHistorialPedidosCliente(clienteId) {
    const cliente = clientes.find(c => c.id === clienteId);
    if (!cliente) return;
    historialPedidosClienteActualId = clienteId;
    document.getElementById('modalHistorialPedidosClienteTitulo').textContent = `Historial de pedidos — ${cliente.nombre}`;
    document.getElementById('historialPedidosClienteCreadoInfo').textContent = `Cliente desde: ${fecha(cliente.creadoEn)}`;

    const pedidosCliente = pedidosDeClienteOrdenados(clienteId);
    const vacio = document.getElementById('historialPedidosClienteVacio');
    const tablaWrap = document.getElementById('historialPedidosClienteTablaWrap');

    if (!pedidosCliente.length) {
      vacio.hidden = false;
      tablaWrap.hidden = true;
    } else {
      vacio.hidden = true;
      tablaWrap.hidden = false;
      document.getElementById('tbodyHistorialPedidosCliente').innerHTML = pedidosCliente.map(p => {
        const c = calcPedido(p);
        const platosTxt = c.items.map(i => `${i.cantidad}x ${esc(i.nombre)}${i.papelera ? etiquetaEnPapeleraHTML(false) : ''}`).join('<br>');
        return `
          <tr class="${p.cancelado ? 'fila-cancelada' : ''}">
            <td class="cell-muted">#${p.numeroPedido || '—'}</td>
            <td class="cell-muted cell-nowrap">${fechaHoraEntrega(p)}</td>
            <td class="pedido-platos">${platosTxt}</td>
            <td class="cell-nowrap">${money(c.total)}</td>
            <td>${p.cancelado ? '<span class="btn-pago cancelado">🚫 Cancelado</span>' : `<span class="btn-pago ${p.pagado ? 'cobrado' : 'pendiente'}">${p.pagado ? '✓ Cobrado' : 'Pendiente'}</span>`}</td>
            <td><span class="btn-pago ${p.tipoPago || 'sin-tipo'}">${TIPO_PAGO_LABEL[p.tipoPago || '']}</span></td>
          </tr>
        `;
      }).join('');
    }
    openModal('modalHistorialPedidosCliente');
  }

  function generarPDFHistorialCliente(clienteId) {
    const cliente = clientes.find(c => c.id === clienteId);
    if (!cliente) return;
    const pedidosCliente = pedidosDeClienteOrdenados(clienteId);
    const totalGeneral = pedidosCliente.filter(p => !p.cancelado).reduce((s, p) => s + calcPedido(p).total, 0);

    const filasHTML = pedidosCliente.map(p => {
      const c = calcPedido(p);
      const platosTxt = c.items.map(i => `${i.cantidad}x ${esc(i.nombre)}${i.papelera ? etiquetaEnPapeleraHTML(true) : ''}`).join(', ');
      return `
        <tr${p.cancelado ? ' style="opacity:.55;text-decoration:line-through"' : ''}>
          <td>#${p.numeroPedido || '—'}</td>
          <td>${fechaHoraEntrega(p)}</td>
          <td>${platosTxt}</td>
          <td class="num">${money(c.total)}</td>
          <td>${p.cancelado ? 'Cancelado' : (p.pagado ? 'Cobrado' : 'Pendiente')}</td>
          <td>${TIPO_PAGO_LABEL[p.tipoPago || '']}</td>
        </tr>
      `;
    }).join('');

    // mismo estilo/estructura de impresión que generarPDFPedidos, para mantener consistencia
    // visual entre los PDFs que genera la app (incluye el mismo fix de table-layout:fixed +
    // overflow-wrap para que nunca se corte en la hoja impresa).
    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Historial de pedidos — ${esc(cliente.nombre)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#222;padding:16px;margin:0}
  h1{font-size:18px;margin:0 0 4px}
  .subtitulo{font-size:12px;color:#666;margin:0 0 18px}
  table{width:100%;border-collapse:collapse;font-size:10.5px;table-layout:fixed}
  th,td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:break-word;word-break:break-word}
  th{background:#f0f0f0}
  td.num,th.num{text-align:right}
  tfoot td{font-weight:bold;background:#f7f7f7}
  @media print{ body{padding:0} }
</style>
</head>
<body>
  <h1>Historial de pedidos — KitchenCost</h1>
  <p class="subtitulo">Cliente: ${esc(cliente.nombre)} · ${pedidosCliente.length} pedido(s) · Generado ${new Date().toLocaleString('es-CO')}</p>
  <table>
    <thead>
      <tr><th>N.°</th><th>Entrega</th><th>Platos</th><th class="num">Total</th><th>Pago</th><th>Tipo de pago</th></tr>
    </thead>
    <tbody>${filasHTML}</tbody>
    <tfoot>
      <tr><td colspan="3">Total general (sin cancelados)</td><td class="num">${money(totalGeneral)}</td><td colspan="2"></td></tr>
    </tfoot>
  </table>
</body>
</html>`;

    const ventana = window.open('', '_blank');
    if (!ventana) { showToast('El navegador bloqueó la ventana. Permite pop-ups para exportar el PDF.'); return; }
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
    setTimeout(() => { try { ventana.focus(); ventana.print(); } catch (e) {} }, 300);
  }

  document.getElementById('btnPdfHistorialPedidosCliente').addEventListener('click', () => {
    if (historialPedidosClienteActualId) generarPDFHistorialCliente(historialPedidosClienteActualId);
  });

  async function deleteCliente(id) {
    const c = clientes.find(x => x.id === id);
    const numPedidos = pedidos.filter(p => p.clienteId === id).length;
    const msg = numPedidos
      ? `Este cliente tiene ${numPedidos} pedido(s) registrado(s). Si lo eliminas, esos pedidos quedarán sin cliente asignado. ¿Eliminar de todas formas?`
      : `¿Eliminar al cliente "${c.nombre}"?`;
    if (!confirm(msg)) return;
    // un cliente creado al vuelo desde un Pedido (resolverOCrearClientePorNombre) tiene un
    // id viejo (uid() local) que nunca existió en Supabase — se salta la llamada y se borra
    // 100% local, mismo criterio que ya usan los hooks de la Papelera (ver esUuid()).
    if (esUuid(id)) {
      try {
        await marcarClienteEliminadoEnSupabase(id);
      } catch (err) {
        console.error(err);
        showToast(`No se pudo eliminar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
        return;
      }
      // así renderPedidos() (justo abajo) ya puede mostrar el nombre real + "Eliminado" sin
      // esperar al próximo refresh — mismo fix que ya hicimos para deleteReceta.
      clientesEliminadosPorId.set(id, c.nombre);
    }
    moverAPapelera('clientes', c);
    clientes = clientes.filter(x => x.id !== id);
    saveClientes();
    renderClientes();
    renderPedidos();
    showToast('Cliente eliminado (puedes restaurarlo desde la Papelera)');
  }

  document.getElementById('buscarCliente').addEventListener('input', renderClientes);
  document.getElementById('btnNuevoCliente').addEventListener('click', () => openClienteModal(null));

  function populateClientesDatalist() {
    const dl = document.getElementById('listaClientesSugeridos');
    dl.innerHTML = clientes.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(c =>
      `<option value="${esc(c.nombre)}">${c.telefono ? esc(c.telefono) : ''}</option>`
    ).join('');
  }

  // Detección de nombres "parecidos" (no idénticos) al crear un cliente nuevo -- ej. "MARIA
  // LOURDES DELASUS" vs "MARIA LOURDES DE LASSUS", que el match exacto de arriba no atrapa.
  //
  // Algoritmo: normaliza (mayúsculas, sin acentos) y QUITA TODOS LOS ESPACIOS antes de medir
  // la distancia de Levenshtein -- así "DE LASSUS" y "DELASUS" quedan como "DELASSUS"/"DELASUS",
  // a un solo caracter de diferencia, en vez de compararse palabra por palabra. Umbral: distancia
  // <= 2, calibrado a mano contra los 51 nombres reales de esta base (ver más abajo el resultado):
  // atrapa el caso de arriba (distancia 1) y "ANDREA VARGAS" vs "ANDRES VARGAS" (distancia 1,
  // duda legítima), pero NO atrapa a personas distintas que comparten apellido -- "JORGE GUZMAN"
  // vs "SORAYA GUZMAN" o "JOSE MARIO PARADA" vs "JOSE MARIO ZAMBRANA" quedan en distancia 4,
  // muy por encima del umbral.
  function normalizarNombreParaSimilitud(nombre) {
    return (nombre || '').trim().toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
      .replace(/\s+/g, ''); // quita TODOS los espacios
  }

  function distanciaLevenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp[m][n];
  }

  const UMBRAL_SIMILITUD_NOMBRE = 2;

  // Devuelve el cliente vivo más parecido (distancia <= UMBRAL_SIMILITUD_NOMBRE), o null si
  // ninguno califica. Ojo: NO excluye distancia 0 -- el caller solo llega acá si el nombre
  // exacto (tal cual está tipeado, sin normalizar espacios/acentos) ya falló contra el match
  // exacto de siempre, así que una distancia 0 en esta función significa "idéntico una vez
  // que se ignoran espacios/acentos" (ej. "de lasus" vs "delasus"), que es justo el caso que
  // esta función existe para atrapar -- excluirlo sería el bug contrario al que se busca arreglar.
  function buscarClienteSimilarPorNombre(nombre) {
    const norm = normalizarNombreParaSimilitud(nombre);
    let mejor = null, mejorDistancia = Infinity;
    for (const c of clientes) {
      const distancia = distanciaLevenshtein(norm, normalizarNombreParaSimilitud(c.nombre));
      if (distancia <= UMBRAL_SIMILITUD_NOMBRE && distancia < mejorDistancia) {
        mejor = c;
        mejorDistancia = distancia;
      }
    }
    return mejor;
  }

  // busca un cliente por nombre (sin distinguir mayúsculas/espacios); si no existe, lo crea —
  // ahora también en Supabase (Clientes ya está conectado), Supabase primero: si falla la
  // creación, no se agrega el cliente local tampoco (el pedido que lo llama no se guarda).
  async function resolverOCrearClientePorNombre(nombre) {
    let cliente = clientes.find(c => c.nombre.trim().toLowerCase() === nombre.trim().toLowerCase());
    if (cliente) return { cliente, esNuevo: false };

    const similar = buscarClienteSimilarPorNombre(nombre);
    if (similar && confirm(`Ya existe un cliente parecido: "${similar.nombre}". ¿Es la misma persona?`)) {
      return { cliente: similar, esNuevo: false };
    }

    const nuevoId = crypto.randomUUID();
    const data = { nombre: nombre.trim().toUpperCase(), telefono: '', direccion: '', notas: '' };
    await crearClienteEnSupabase(nuevoId, data);
    cliente = { id: nuevoId, ...data };
    clientes.push(cliente);
    return { cliente, esNuevo: true };
  }

  function openClienteModal(id) {
    const form = document.getElementById('formCliente');
    form.reset();
    const infoCreado = document.getElementById('clienteCreadoInfo');
    if (id) {
      const c = clientes.find(x => x.id === id);
      document.getElementById('modalClienteTitulo').textContent = 'Editar cliente';
      document.getElementById('clienteId').value = c.id;
      document.getElementById('clienteNombre').value = c.nombre;
      document.getElementById('clienteTelefono').value = c.telefono || '';
      document.getElementById('clienteDireccion').value = c.direccion || '';
      document.getElementById('clienteNotas').value = c.notas || '';
      infoCreado.textContent = `Cliente desde: ${fecha(c.creadoEn)}`;
      infoCreado.hidden = false;
    } else {
      document.getElementById('modalClienteTitulo').textContent = 'Nuevo cliente';
      document.getElementById('clienteId').value = '';
      infoCreado.hidden = true;
    }
    openModal('modalCliente');
  }

  document.getElementById('formCliente').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('clienteId').value;
    const data = {
      nombre: document.getElementById('clienteNombre').value.trim().toUpperCase() || '(sin nombre)',
      telefono: document.getElementById('clienteTelefono').value.trim(),
      direccion: document.getElementById('clienteDireccion').value.trim(),
      notas: document.getElementById('clienteNotas').value.trim(),
    };
    if (id && !confirm(`¿Guardar los cambios en "${data.nombre}"? Se sobrescribirán los datos actuales de este cliente.`)) return;

    // Detección de nombre parecido -- solo al CREAR (no al editar uno ya existente). Si
    // confirma que es la misma persona, se redirige a actualizar ESE cliente existente con lo
    // que se acaba de escribir, en vez de crear uno nuevo.
    let idEfectivo = id;
    if (!id) {
      const similar = buscarClienteSimilarPorNombre(data.nombre);
      if (similar && confirm(`Ya existe un cliente parecido: "${similar.nombre}". ¿Es la misma persona?`)) {
        idEfectivo = similar.id;
      }
    }

    const btnGuardar = document.querySelector('#formCliente button[type="submit"]');
    btnGuardar.disabled = true;
    let clienteGuardadoId;
    try {
      if (idEfectivo) {
        // si el id no es uuid, es un cliente creado al vuelo desde un Pedido
        // (resolverOCrearClientePorNombre) que nunca existió en Supabase — se edita 100%
        // local, sin intentar la llamada (mismo criterio que deleteCliente).
        if (esUuid(idEfectivo)) await actualizarClienteEnSupabase(idEfectivo, data);
        const c = clientes.find(x => x.id === idEfectivo);
        Object.assign(c, data);
        clienteGuardadoId = c.id;
        showToast(id ? 'Cliente actualizado' : 'Ya existía un cliente parecido — se actualizó ese registro en vez de crear uno nuevo');
      } else {
        const nuevoId = crypto.randomUUID();
        await crearClienteEnSupabase(nuevoId, data);
        const nuevo = { id: nuevoId, ...data };
        clientes.push(nuevo);
        clienteGuardadoId = nuevo.id;
        showToast('Cliente creado');
      }
      saveClientes();
      renderClientes();

      if (quickAddClienteActivo) {
        quickAddClienteActivo = false;
        document.getElementById('modalCliente').hidden = true;
        document.getElementById('modalPedido').hidden = false;
        const clienteRecienGuardado = clientes.find(x => x.id === clienteGuardadoId);
        populateClientesDatalist();
        document.getElementById('pedidoClienteNombre').value = clienteRecienGuardado.nombre;
      } else {
        closeModal('modalCliente');
      }
    } catch (err) {
      console.error(err);
      showToast(`No se pudo guardar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
    } finally {
      btnGuardar.disabled = false;
    }
  });

  // =========================================================
  //  PEDIDOS
  // =========================================================
  let pedidos = loadPedidos();
  migrarPedidosLegacy();

  function loadPedidos() {
    try { return JSON.parse(localStorage.getItem(LS_PEDIDOS)) || []; }
    catch (e) { return []; }
  }
  function savePedidos() { localStorage.setItem(LS_PEDIDOS, JSON.stringify(pedidos)); }

  // ---------------- Pedidos <-> Supabase ----------------
  // A diferencia de Recetas/Clientes/Jornadas, acá NO hace falta reconciliación por nombre:
  // nada en la app referencia un pedido por su id, así que no hay ninguna referencia
  // "colgando" que proteger al reemplazar el array completo. Arranca con lo que había en
  // localStorage (arriba) y en cuanto responde Supabase se reemplaza por completo, igual que
  // Gastos/Capital. Alta/edición/baja escriben primero en Supabase; solo si funciona se aplica
  // el cambio en memoria+localStorage — si Supabase falla, no se aplica nada local tampoco.
  function filaSupabaseAPedido(fila, filasItems) {
    return {
      id: fila.id,
      numeroPedido: fila.numero_pedido,
      clienteId: fila.cliente_id,
      fechaEntrega: fila.fecha_entrega || '',
      horaEntrega: fila.hora_entrega ? fila.hora_entrega.slice(0, 5) : '',
      pagado: !!fila.pagado,
      tipoPago: fila.tipo_pago || '',
      estadoPreparacion: fila.estado_preparacion || 'sin_accion',
      notas: fila.notas || '',
      cancelado: !!fila.cancelado,
      jornadaId: fila.jornada_id || null,
      esMostrador: !!fila.es_mostrador,
      items: filasItems
        .filter(it => it.pedido_id === fila.id)
        .sort((a, b) => a.posicion - b.posicion)
        .map(it => ({ recetaId: it.receta_id, cantidad: Number(it.cantidad) || 0, precioUnitario: Number(it.precio_unitario) })),
    };
  }

  async function sincronizarPedidosDesdeSupabase() {
    // Datos compartidos (ver nota en sincronizarInsumosDesdeSupabase): sin filtro por user_id.
    const { data: filasPedidos, error: errPedidos } = await window.supabaseClient
      .from('pedidos')
      .select('*')
      .is('deleted_at', null)
      .order('fecha_entrega', { ascending: false });
    if (errPedidos) {
      console.warn('No se pudo sincronizar Pedidos con Supabase, se sigue usando la copia local:', errPedidos.message);
      return false;
    }

    const idsPedidos = filasPedidos.map(p => p.id);
    let filasItems = [];
    if (idsPedidos.length) {
      const { data, error: errItems } = await window.supabaseClient
        .from('pedido_items')
        .select('*')
        .in('pedido_id', idsPedidos);
      if (errItems) {
        console.warn('No se pudo sincronizar Pedidos con Supabase (platos), se sigue usando la copia local:', errItems.message);
        return false;
      }
      filasItems = data;
    }

    pedidos = filasPedidos.map(p => filaSupabaseAPedido(p, filasItems));
    savePedidos();
    renderPedidos();
    renderClientes();
    renderJornadas();
    renderStatsFinanzas();
    return true;
  }

  // RPC guardar_pedido_completo (scripts/sql/002_guardar_y_eliminar_pedido_completo.sql +
  // 003_guardar_pedido_completo_retorna_numero.sql): upsert atómico de pedido + reemplazo
  // completo de pedido_items en una sola transacción. No usa upsert por SQL (usa un IF/ELSE
  // interno) para no gastar números de la secuencia de numero_pedido en cada edición — y por
  // eso mismo devuelve el numero_pedido (nuevo, o el que ya tenía si era una edición): el
  // cliente lo necesita para mostrarlo de inmediato, sin esperar a la próxima sincronización.
  async function guardarPedidoEnSupabase(id, data) {
    const { data: numeroPedido, error } = await window.supabaseClient.rpc('guardar_pedido_completo', {
      p_id: id,
      p_user_id: window.SUPABASE_USER_ID,
      p_cliente_id: data.clienteId,
      p_fecha_entrega: data.fechaEntrega,
      p_hora_entrega: data.horaEntrega,
      p_pagado: data.pagado,
      p_tipo_pago: data.tipoPago || null,
      p_estado_preparacion: data.estadoPreparacion,
      p_notas: data.notas,
      p_cancelado: data.cancelado,
      p_jornada_id: data.jornadaId || null,
      p_items: data.items.map(it => ({ receta_id: it.recetaId, cantidad: it.cantidad, precio_unitario: it.precioUnitario })),
      p_es_mostrador: !!data.esMostrador,
    });
    if (error) throw error;
    return numeroPedido;
  }

  // Update de un solo pedido con los campos que se pasen — usado tanto por los toggles
  // (pagado/estado_preparacion/cancelado, un campo a la vez) como por marcar/restaurar
  // deleted_at. No hace falta RPC acá: son updates de una sola tabla, sin tocar pedido_items.
  async function actualizarCamposPedidoEnSupabase(id, campos) {
    const { error } = await window.supabaseClient.from('pedidos').update(campos).eq('id', id);
    if (error) throw error;
  }

  async function marcarPedidoEliminadoEnSupabase(id) {
    return actualizarCamposPedidoEnSupabase(id, { deleted_at: new Date().toISOString() });
  }

  // Restaurar/eliminar-definitivo van por los hooks opcionales en PAPELERA_CONFIG.pedidos
  // (mismo mecanismo que el resto de las entidades ya conectadas).
  async function restaurarPedidoEnSupabase(id) {
    return actualizarCamposPedidoEnSupabase(id, { deleted_at: null });
  }

  // RPC eliminar_pedido_completo: borra pedido + pedido_items en una sola transacción (mismo
  // archivo SQL que guardar_pedido_completo).
  async function eliminarPedidoDefinitivamenteEnSupabase(id) {
    const { error } = await window.supabaseClient.rpc('eliminar_pedido_completo', { p_id: id });
    if (error) throw error;
  }

  // Versiones antiguas guardaban el nombre y teléfono del cliente sueltos en cada pedido.
  // Se migran una sola vez a la base de datos de clientes (reutilizando uno existente si
  // coincide nombre+teléfono, o creando uno nuevo).
  function migrarPedidosLegacy() {
    let cambiadoPedidos = false, cambiadoClientes = false;
    pedidos.forEach(p => {
      if (!p.clienteId) {
        const nombre = (p.nombre || '(sin nombre)').trim();
        const telefono = (p.telefono || '').trim();
        let cliente = clientes.find(c => c.nombre.toLowerCase() === nombre.toLowerCase() && (c.telefono || '') === telefono);
        if (!cliente) {
          cliente = { id: uid(), nombre, telefono, direccion: '', notas: '' };
          clientes.push(cliente);
          cambiadoClientes = true;
        }
        p.clienteId = cliente.id;
        delete p.nombre;
        delete p.telefono;
        cambiadoPedidos = true;
      }
      if (!p.estadoPreparacion) {
        p.estadoPreparacion = 'sin_accion';
        cambiadoPedidos = true;
      }
      if (p.notas === undefined) {
        p.notas = '';
        cambiadoPedidos = true;
      }
      if (p.cancelado === undefined) {
        p.cancelado = false;
        cambiadoPedidos = true;
      }
      // los pedidos de versiones anteriores no guardaban el precio de cada plato: se
      // congela al precio actual una sola vez, para que futuros cambios de precio en
      // insumos/recetas ya no alteren retroactivamente pedidos que quedan "congelados" aquí.
      (p.items || []).forEach(it => {
        if (it.precioUnitario === undefined || it.precioUnitario === null) {
          const r = recetas.find(x => x.id === it.recetaId);
          it.precioUnitario = r ? calcReceta(r).precioReferencia : 0;
          cambiadoPedidos = true;
        }
      });
    });
    // los pedidos que ya existían (de versiones anteriores) no tenían número: se numeran
    // en el orden en que están guardados, que corresponde al orden en que se crearon.
    if (pedidos.some(p => !p.numeroPedido)) {
      let siguiente = 1;
      pedidos.forEach(p => { if (!p.numeroPedido) p.numeroPedido = siguiente++; });
      localStorage.setItem(LS_PEDIDO_CONTADOR, String(siguiente));
      cambiadoPedidos = true;
    }
    if (cambiadoClientes) saveClientes();
    if (cambiadoPedidos) savePedidos();
  }

  function siguienteNumeroPedido() {
    const n = parseInt(localStorage.getItem(LS_PEDIDO_CONTADOR), 10) || 1;
    localStorage.setItem(LS_PEDIDO_CONTADOR, String(n + 1));
    return n;
  }

  function clienteDePedido(p) {
    // es_mostrador NO decide qué nombre se muestra -- solo importa si hay o no un cliente_id
    // válido. Una Venta de mostrador puede tener un cliente_id real (el nombre es opcional al
    // crearla, no prohibido); si se escribió uno, se resuelve/crea igual que en un pedido
    // normal (ver el submit de formPedido) y debe mostrarse su nombre real igual que en
    // cualquier otro pedido. "Mostrador" es solo el estado por defecto cuando de verdad no hay
    // ningún cliente vinculado (clienteId vacío).
    if (p.clienteId && clientesEliminadosPorId.has(p.clienteId)) {
      return { id: null, nombre: clientesEliminadosPorId.get(p.clienteId), telefono: '', papelera: true };
    }
    if (!p.clienteId) return { id: null, nombre: 'Mostrador', telefono: '' };
    const c = clientes.find(x => x.id === p.clienteId);
    if (c) return c;
    return { id: null, nombre: '(cliente eliminado)', telefono: '' };
  }

  // celda "Jornada/Evento" de la tabla de Pedidos -- mismo patrón de 3 estados que
  // clienteDePedido/nombreRecetaPlan (viva / en Papelera con nombre real / sin rastro alguno).
  function celdaJornadaPedido(p) {
    if (!p.jornadaId) return '<span class="cell-muted">—</span>';
    const j = jornadas.find(x => x.id === p.jornadaId);
    if (j) {
      const tipoLabel = j.tipo === 'evento' ? 'Evento' : 'Venta regular';
      return `${esc(j.nombre)} <span class="badge badge-neutral">${tipoLabel}</span>`;
    }
    if (jornadasEliminadasPorId.has(p.jornadaId)) {
      return `${esc(jornadasEliminadasPorId.get(p.jornadaId))}${etiquetaEnPapeleraHTML(false)}`;
    }
    return '<span class="cell-muted">(jornada eliminada)</span>';
  }

  // nombre "ordenable" de la Jornada de un pedido -- null significa "sin asignar" (sin
  // jornada_id, o una Jornada que ya no dejó ni rastro): estas filas SIEMPRE quedan al final al
  // ordenar por esta columna, sin importar asc/desc (ver compararPedidos) -- no tiene sentido
  // que "sin asignar" aparezca primero solo porque se invirtió el orden.
  function nombreOrdenableJornadaPedido(p) {
    if (!p.jornadaId) return null;
    const j = jornadas.find(x => x.id === p.jornadaId);
    if (j) return j.nombre.toLowerCase();
    if (jornadasEliminadasPorId.has(p.jornadaId)) return jornadasEliminadasPorId.get(p.jornadaId).toLowerCase();
    return null;
  }

  function calcPedido(p) {
    const faltantes = [];
    const items = (p.items || []).map(it => {
      const r = recetas.find(x => x.id === it.recetaId);
      // 3 estados posibles para el plato de este item:
      //  - r existe: receta viva, todo normal.
      //  - r no existe pero está en recetasEliminadasPorId: está en la Papelera de Supabase
      //    (deleted_at marcado, la fila sigue existiendo) -> se muestra su nombre real +
      //    etiqueta "Eliminado" (ver renderPedidos/generarPDFPedidos/descargarDetallePedido).
      //  - ninguna de las dos: se borró DEFINITIVAMENTE, no queda nombre que mostrar ->
      //    genérico "(plato eliminado)", como siempre.
      let nombre, papelera = false;
      if (r) {
        nombre = r.nombre;
      } else if (recetasEliminadasPorId.has(it.recetaId)) {
        nombre = recetasEliminadasPorId.get(it.recetaId);
        papelera = true;
        faltantes.push(`${nombre} (eliminado)`);
      } else {
        nombre = '(plato eliminado)';
        faltantes.push('(plato eliminado)');
      }
      // el precio se congela en el momento de guardar el pedido (ver congelarPreciosPedido),
      // para que subir precios de insumos/recetas después no altere pedidos ya registrados.
      const tienePrecioFijo = it.precioUnitario !== undefined && it.precioUnitario !== null;
      const precioUnitario = tienePrecioFijo ? it.precioUnitario : (r ? calcReceta(r).precioReferencia : 0);
      const subtotal = precioUnitario * (it.cantidad || 0);
      return { ...it, nombre, precioUnitario, subtotal, ok: !!r, papelera };
    });
    const total = items.reduce((s, i) => s + i.subtotal, 0);
    const totalPlatos = items.reduce((s, i) => s + (i.cantidad || 0), 0);
    return { items, total, totalPlatos, faltantes };
  }

  // etiqueta visual para un plato O cliente que está en la Papelera (no para el genérico
  // "(plato eliminado)"/"(cliente eliminado)", que ya es autoexplicativo por sí solo en el
  // nombre). modoPdf=true usa estilos inline (las ventanas de impresión no cargan css/styles.css).
  function etiquetaEnPapeleraHTML(modoPdf) {
    return modoPdf
      ? ' <span style="display:inline-block;padding:1px 6px;border-radius:4px;background:#fff3cd;color:#8a6100;font-size:10px;font-weight:700;margin-left:4px">Eliminado</span>'
      : ' <span class="badge badge-warn">Eliminado</span>';
  }

  function fechaHoraEntrega(p) {
    if (!p.fechaEntrega) return '—';
    const d = new Date(p.fechaEntrega + 'T' + (p.horaEntrega || '00:00'));
    const fechaTxt = d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
    const horaTxt = p.horaEntrega ? d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '';
    return horaTxt ? `${fechaTxt}, ${horaTxt}` : fechaTxt;
  }

  const tbodyPedidos = document.getElementById('tbodyPedidos');
  const emptyPedidos = document.getElementById('emptyPedidos');
  const statsPedidos = document.getElementById('statsPedidos');

  // tarjetas-lista (Platos pedidos/entregados, vendido-planeado por Jornada) pueden llegar a
  // tener muchas filas y ocupar mucho alto -- se les agrega una flecha para minimizarlas. El
  // estado colapsado/expandido se guarda en memoria por "key" (no en localStorage, se resetea
  // al recargar) para que sobreviva los re-renders de renderStatsPedidos, que se disparan
  // seguido (cada toggle de pago/preparación, cada edición, etc.).
  const listasStatColapsadas = new Set();

  function statCardListaHTML(key, label, filasHTML) {
    const colapsada = listasStatColapsadas.has(key);
    return `
      <div class="stat-card stat-card-lista${colapsada ? ' colapsado' : ''}" data-lista-key="${esc(key)}">
        <div class="stat-card-lista-header">
          <div class="stat-label">${label}</div>
          <button type="button" class="stat-lista-toggle" title="${colapsada ? 'Mostrar lista' : 'Minimizar lista'}">▾</button>
        </div>
        ${filasHTML}
      </div>
    `;
  }

  function wireStatListaToggles(contenedor) {
    contenedor.querySelectorAll('.stat-card-lista[data-lista-key]').forEach(card => {
      card.querySelector('.stat-lista-toggle').addEventListener('click', () => {
        const key = card.getAttribute('data-lista-key');
        const colapsar = !card.classList.contains('colapsado');
        card.classList.toggle('colapsado', colapsar);
        card.querySelector('.stat-lista-toggle').title = colapsar ? 'Mostrar lista' : 'Minimizar lista';
        if (colapsar) listasStatColapsadas.add(key); else listasStatColapsadas.delete(key);
      });
    });
  }

  // Vendido/planeado de las Jornadas con plan definido cuya fecha caiga dentro del rango
  // [desde, hasta] (mismo rango del filtro "Entrega desde/hasta" de Pedidos). A propósito NO
  // se suman los planes de distintas Jornadas entre sí -- cada Jornada es su propia unidad de
  // negocio (igual criterio que el resto de la app, ver Finanzas: nunca se mezcla la utilidad
  // de una Jornada con la de otra en una sola cifra). Se devuelve un bloque por Jornada, para
  // poder ver cada una desglosada aunque coincidan en fecha.
  function resumenPlanEnRango(desde, hasta) {
    return jornadas
      .filter(j => {
        if (!j.fecha) return false;
        if (desde && j.fecha < desde) return false;
        if (hasta && j.fecha > hasta) return false;
        return (j.plan || []).length > 0;
      })
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
      .map(j => ({ jornadaId: j.id, jornadaNombre: j.nombre, plan: calcJornada(j).plan }));
  }

  function renderStatsPedidos(lista, desde, hasta) {
    // los pedidos cancelados no cuentan para los montos ni para las cantidades por plato
    const activos = lista.filter(p => !p.cancelado);
    const pendientes = activos.filter(p => !p.pagado);
    const cobrados = activos.filter(p => p.pagado);
    const totalPorCobrar = pendientes.reduce((s, p) => s + calcPedido(p).total, 0);
    const totalCobrado = cobrados.reduce((s, p) => s + calcPedido(p).total, 0);
    const totalPedido = totalPorCobrar + totalCobrado;

    // cantidad total pedida de cada plato, dentro de la misma lista filtrada (sin contar cancelados)
    const cantidadPorPlato = new Map();
    activos.forEach(p => {
      calcPedido(p).items.forEach(it => {
        cantidadPorPlato.set(it.nombre, (cantidadPorPlato.get(it.nombre) || 0) + (it.cantidad || 0));
      });
    });
    const platosOrdenados = Array.from(cantidadPorPlato.entries()).sort((a, b) => b[1] - a[1]);

    // "Platos entregados": mismo cálculo que "Platos pedidos", pero solo de pedidos con
    // estado_preparacion === 'entregado' -- excluye "Sin acción" y cualquier otro estado
    // intermedio (preparando/terminado/enviado). Se filtra sobre "activos" (ya sin
    // cancelados) para ser consistente con el resto de las tarjetas de este resumen.
    const entregados = activos.filter(p => p.estadoPreparacion === 'entregado');
    const cantidadEntregadaPorPlato = new Map();
    entregados.forEach(p => {
      calcPedido(p).items.forEach(it => {
        cantidadEntregadaPorPlato.set(it.nombre, (cantidadEntregadaPorPlato.get(it.nombre) || 0) + (it.cantidad || 0));
      });
    });
    const platosEntregadosOrdenados = Array.from(cantidadEntregadaPorPlato.entries()).sort((a, b) => b[1] - a[1]);
    const resumenPlan = resumenPlanEnRango(desde, hasta);

    statsPedidos.innerHTML = `
      <div class="stat-card"><div class="stat-value">${lista.length}</div><div class="stat-label">Total pedidos</div></div>
      ${platosOrdenados.length ? statCardListaHTML('platosPedidos', 'Platos pedidos', platosOrdenados.map(([nombre, cantidad]) => `
        <div class="stat-lista-fila"><span class="stat-lista-valor">${cantidad}</span> ${esc(nombre)}</div>
      `).join('')) : ''}
      ${platosEntregadosOrdenados.length ? statCardListaHTML('platosEntregados', 'Platos entregados', platosEntregadosOrdenados.map(([nombre, cantidad]) => `
        <div class="stat-lista-fila"><span class="stat-lista-valor">${cantidad}</span> ${esc(nombre)}</div>
      `).join('')) : ''}
      <div class="stat-card"><div class="stat-value">${money(totalPedido)}</div><div class="stat-label">Total Bs pedidos</div></div>
      <div class="stat-card"><div class="stat-value">${money(totalPorCobrar)}</div><div class="stat-label">Total por cobrar</div></div>
      <div class="stat-card"><div class="stat-value">${money(totalCobrado)}</div><div class="stat-label">Total cobrado</div></div>
      ${resumenPlan.map(j => statCardListaHTML(`plan:${j.jornadaId}`, `${esc(j.jornadaNombre)} — vendido/planeado`, j.plan.map(l => `
        <div class="stat-lista-fila"><span class="stat-lista-valor">${l.vendido}/${l.cantidadPlaneada}</span> ${esc(l.nombre)}${l.papelera ? etiquetaEnPapeleraHTML(false) : ''}</div>
      `).join(''))).join('')}
    `;
    wireStatListaToggles(statsPedidos);
  }

  // Orden de la tabla de Pedidos (tipo Excel, clicando el encabezado). Es puramente de
  // renderizado: no toca la consulta a Supabase (que sigue trayendo los datos sin ORDER BY,
  // en el orden físico interno de la tabla -- por eso se veía "desordenado" cada vez que se
  // editaba algo). Se ordena acá, en JS, después de filtrar por búsqueda/fecha.
  const VALOR_ORDEN_PEDIDOS = {
    numeroPedido: p => p.numeroPedido || 0,
    cliente: p => clienteDePedido(p).nombre.toLowerCase(),
    entrega: p => `${p.fechaEntrega || ''}${p.horaEntrega || ''}`,
    total: p => calcPedido(p).total,
    pago: p => p.pagado ? 1 : 0,
    tipoPago: p => TIPO_PAGO_ORDEN.indexOf(p.tipoPago || ''),
    preparacion: p => PREPARACION_ORDEN.indexOf(p.estadoPreparacion || 'sin_accion'),
    cancelado: p => p.cancelado ? 1 : 0,
  };
  let ordenPedidosColumna = 'numeroPedido';
  let ordenPedidosDireccion = 'asc';

  function compararPedidos(a, b) {
    // caso especial: "sin asignar" siempre al final, sin importar la dirección del orden --
    // no se puede resolver con el mecanismo genérico de abajo (que invierte cmp completo según
    // asc/desc), así que se maneja aparte.
    if (ordenPedidosColumna === 'jornada') {
      const na = nombreOrdenableJornadaPedido(a), nb = nombreOrdenableJornadaPedido(b);
      if (na === null || nb === null) {
        if (na === null && nb === null) return (a.numeroPedido || 0) - (b.numeroPedido || 0);
        return na === null ? 1 : -1;
      }
      let cmp = na.localeCompare(nb);
      if (cmp === 0) cmp = (a.numeroPedido || 0) - (b.numeroPedido || 0);
      return ordenPedidosDireccion === 'asc' ? cmp : -cmp;
    }
    const obtenerValor = VALOR_ORDEN_PEDIDOS[ordenPedidosColumna];
    const va = obtenerValor(a), vb = obtenerValor(b);
    let cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    // desempate estable por número de pedido, para que dos filas con el mismo valor en la
    // columna elegida (ej. ambas "Cobrado") no se vean en un orden que parezca arbitrario.
    if (cmp === 0) cmp = (a.numeroPedido || 0) - (b.numeroPedido || 0);
    return ordenPedidosDireccion === 'asc' ? cmp : -cmp;
  }

  const ETIQUETA_ORDEN_PEDIDOS = {
    numeroPedido: 'N.°', cliente: 'Cliente', entrega: 'Entrega', jornada: 'Jornada/Evento', total: 'Total',
    pago: 'Pago', tipoPago: 'Tipo de pago', preparacion: 'Preparación', cancelado: 'Cancelado',
  };

  function actualizarIndicadoresOrdenPedidos() {
    document.querySelectorAll('#tablaPedidos [data-sort]').forEach(th => {
      const columna = th.getAttribute('data-sort');
      const etiqueta = ETIQUETA_ORDEN_PEDIDOS[columna];
      const esActiva = columna === ordenPedidosColumna;
      const indicador = th.querySelector('.sort-indicador');
      indicador.textContent = esActiva ? (ordenPedidosDireccion === 'asc' ? '▲' : '▼') : '';
      // tooltip explicando qué hace un clic acá, y si ya está activa, en qué sentido quedó
      th.title = esActiva
        ? `Ordenado por "${etiqueta}" (${ordenPedidosDireccion === 'asc' ? 'ascendente' : 'descendente'}). Clic para invertir el orden.`
        : `Clic para ordenar por "${etiqueta}".`;
    });
  }

  document.querySelectorAll('#tablaPedidos [data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const columna = th.getAttribute('data-sort');
      if (ordenPedidosColumna === columna) {
        ordenPedidosDireccion = ordenPedidosDireccion === 'asc' ? 'desc' : 'asc';
      } else {
        ordenPedidosColumna = columna;
        ordenPedidosDireccion = 'asc';
      }
      renderPedidos();
    });
  });

  function renderPedidos() {
    const term = document.getElementById('buscarPedido').value.trim().toLowerCase();
    const desde = document.getElementById('pedidosFiltroDesde').value;
    const hasta = document.getElementById('pedidosFiltroHasta').value;
    const filtrados = pedidos.filter(p => {
      if (desde && p.fechaEntrega < desde) return false;
      if (hasta && p.fechaEntrega > hasta) return false;
      if (!term) return true;
      const cliente = clienteDePedido(p);
      return cliente.nombre.toLowerCase().includes(term) || (cliente.telefono || '').toLowerCase().includes(term);
    }).sort(compararPedidos);
    actualizarIndicadoresOrdenPedidos();

    tbodyPedidos.innerHTML = filtrados.map(p => {
      const c = calcPedido(p);
      const cliente = clienteDePedido(p);
      // el nombre de cada plato se escapa individualmente (no el texto completo ya unido),
      // porque un plato en la Papelera lleva una etiqueta en HTML pegada a su nombre.
      const platosTxt = c.items.map(i => `${i.cantidad}x ${esc(i.nombre)}${i.papelera ? etiquetaEnPapeleraHTML(false) : ''}`).join('<br>');
      return `
        <tr class="${p.cancelado ? 'fila-cancelada' : ''}">
          <td class="cell-muted">#${p.numeroPedido || '—'}</td>
          <td class="cell-nombre">${esc(cliente.nombre)}${cliente.papelera ? etiquetaEnPapeleraHTML(false) : ''}</td>
          <td>${esc(cliente.telefono) || '<span class="cell-muted">—</span>'}</td>
          <td class="pedido-platos">${platosTxt}</td>
          <td class="cell-muted cell-nowrap">${fechaHoraEntrega(p)}</td>
          <td class="cell-nowrap">${celdaJornadaPedido(p)}</td>
          <td class="cell-nowrap">${money(c.total)}</td>
          <td><button class="btn-pago ${p.pagado ? 'cobrado' : 'pendiente'}" data-toggle-pago="${p.id}">${p.pagado ? '✓ Cobrado' : 'Pendiente'}</button></td>
          <td><button class="btn-pago ${p.tipoPago || 'sin-tipo'}" data-toggle-tipopago="${p.id}">${TIPO_PAGO_LABEL[p.tipoPago || '']}</button></td>
          <td><button class="btn-pago ${p.estadoPreparacion || 'sin_accion'}" data-toggle-prep="${p.id}">${PREPARACION_LABEL[p.estadoPreparacion || 'sin_accion']}</button></td>
          <td><button class="btn-pago ${p.cancelado ? 'cancelado' : 'no-cancelado'}" data-toggle-cancelado="${p.id}">${p.cancelado ? '🚫 Cancelado' : 'Cancelar'}</button></td>
          <td class="pedido-notas" title="${esc(p.notas)}">${esc(p.notas) || '<span class="cell-muted">—</span>'}</td>
          <td class="col-actions">
            <button class="btn-icon" title="Descargar detalle" data-descargar-pedido="${p.id}">⬇</button>
            <button class="btn-icon" title="Editar" data-edit-pedido="${p.id}">✎</button>
            <button class="btn-icon danger" title="Eliminar" data-del-pedido="${p.id}">🗑</button>
          </td>
        </tr>
      `;
    }).join('');

    emptyPedidos.hidden = filtrados.length !== 0;
    emptyPedidos.textContent = pedidos.length === 0
      ? 'No hay pedidos registrados todavía. Crea el primero con "+ Nuevo pedido".'
      : 'No hay pedidos que coincidan con la búsqueda o el filtro de fecha.';
    renderStatsPedidos(filtrados, desde, hasta);

    tbodyPedidos.querySelectorAll('[data-toggle-pago]').forEach(b =>
      b.addEventListener('click', () => togglePagoPedido(b.getAttribute('data-toggle-pago'))));
    tbodyPedidos.querySelectorAll('[data-toggle-tipopago]').forEach(b =>
      b.addEventListener('click', () => toggleTipoPagoPedido(b.getAttribute('data-toggle-tipopago'))));
    tbodyPedidos.querySelectorAll('[data-toggle-prep]').forEach(b =>
      b.addEventListener('click', () => togglePreparacionPedido(b.getAttribute('data-toggle-prep'))));
    tbodyPedidos.querySelectorAll('[data-toggle-cancelado]').forEach(b =>
      b.addEventListener('click', () => toggleCanceladoPedido(b.getAttribute('data-toggle-cancelado'))));
    tbodyPedidos.querySelectorAll('[data-descargar-pedido]').forEach(b =>
      b.addEventListener('click', () => descargarDetallePedido(b.getAttribute('data-descargar-pedido'))));
    tbodyPedidos.querySelectorAll('[data-edit-pedido]').forEach(b =>
      b.addEventListener('click', () => openPedidoModal(b.getAttribute('data-edit-pedido'))));
    tbodyPedidos.querySelectorAll('[data-del-pedido]').forEach(b =>
      b.addEventListener('click', () => deletePedido(b.getAttribute('data-del-pedido'))));
  }

  // Token de secuencia por (campo, pedido): los 4 toggles de abajo esperan una respuesta de
  // Supabase antes de aplicar el cambio local, así que si se dispara un segundo toggle del
  // MISMO campo/pedido antes de que responda el primero, las respuestas pueden llegar
  // desordenadas -- sin esto, una respuesta vieja que llega tarde podría pisar una más nueva y
  // dejar la pantalla mostrando un estado desactualizado (mismo problema y mismo mecanismo que
  // ya usamos en renderStatsFinanzas). Solo se aplica al DOM la respuesta de la llamada más
  // reciente que se haya disparado para esa clave.
  const tokensToggle = new Map();
  function siguienteTokenToggle(clave) {
    const token = (tokensToggle.get(clave) || 0) + 1;
    tokensToggle.set(clave, token);
    return token;
  }
  function esTokenVigente(clave, token) {
    return tokensToggle.get(clave) === token;
  }

  async function togglePagoPedido(id) {
    const p = pedidos.find(x => x.id === id);
    const nuevoValor = !p.pagado;
    const clave = `pago:${id}`;
    const miToken = siguienteTokenToggle(clave);
    if (esUuid(id)) {
      try {
        await actualizarCamposPedidoEnSupabase(id, { pagado: nuevoValor });
      } catch (err) {
        console.error(err);
        showToast(`No se pudo actualizar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
        return;
      }
    }
    if (!esTokenVigente(clave, miToken)) return;
    p.pagado = nuevoValor;
    savePedidos();
    renderPedidos();
    renderJornadas();
    renderStatsFinanzas();
    showToast(nuevoValor ? 'Marcado como cobrado' : 'Marcado como pendiente');
  }

  const TIPO_PAGO_ORDEN = ['', 'efectivo', 'deposito'];
  const TIPO_PAGO_LABEL = { '': 'Sin especificar', efectivo: '💵 Efectivo', deposito: '🏦 Depósito' };

  async function toggleTipoPagoPedido(id) {
    const p = pedidos.find(x => x.id === id);
    const actual = TIPO_PAGO_ORDEN.indexOf(p.tipoPago || '');
    const nuevoValor = TIPO_PAGO_ORDEN[(actual + 1) % TIPO_PAGO_ORDEN.length];
    const clave = `tipopago:${id}`;
    const miToken = siguienteTokenToggle(clave);
    if (esUuid(id)) {
      try {
        await actualizarCamposPedidoEnSupabase(id, { tipo_pago: nuevoValor || null });
      } catch (err) {
        console.error(err);
        showToast(`No se pudo actualizar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
        return;
      }
    }
    if (!esTokenVigente(clave, miToken)) return;
    p.tipoPago = nuevoValor;
    savePedidos();
    renderPedidos();
    showToast(`Tipo de pago: ${TIPO_PAGO_LABEL[nuevoValor]}`);
  }

  const PREPARACION_ORDEN = ['sin_accion', 'preparando', 'terminado', 'enviado', 'entregado'];
  const PREPARACION_LABEL = { sin_accion: 'Sin acción', preparando: '🍳 Preparando', terminado: '🔔 Terminado', enviado: '🚚 Enviado', entregado: '✅ Entregado' };

  async function togglePreparacionPedido(id) {
    const p = pedidos.find(x => x.id === id);
    const actual = PREPARACION_ORDEN.indexOf(p.estadoPreparacion || 'sin_accion');
    const nuevoValor = PREPARACION_ORDEN[(actual + 1) % PREPARACION_ORDEN.length];
    const clave = `prep:${id}`;
    const miToken = siguienteTokenToggle(clave);
    if (esUuid(id)) {
      try {
        await actualizarCamposPedidoEnSupabase(id, { estado_preparacion: nuevoValor });
      } catch (err) {
        console.error(err);
        showToast(`No se pudo actualizar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
        return;
      }
    }
    if (!esTokenVigente(clave, miToken)) return;
    p.estadoPreparacion = nuevoValor;
    savePedidos();
    renderPedidos();
    showToast(`Marcado como: ${PREPARACION_LABEL[nuevoValor]}`);
  }

  async function toggleCanceladoPedido(id) {
    const p = pedidos.find(x => x.id === id);
    let nuevoCancelado, nuevasNotas = p.notas;
    if (!p.cancelado) {
      const nota = prompt('¿Cancelar este pedido? No contará en las estadísticas de cobro ni de platos pedidos.\nPuedes escribir el motivo de la cancelación (opcional):', p.notas || '');
      if (nota === null) return; // se cerró el prompt sin aceptar: no se cancela el pedido
      nuevasNotas = nota.trim();
      nuevoCancelado = true;
    } else {
      nuevoCancelado = false;
    }
    const clave = `cancelado:${id}`;
    const miToken = siguienteTokenToggle(clave);
    if (esUuid(id)) {
      try {
        await actualizarCamposPedidoEnSupabase(id, { cancelado: nuevoCancelado, notas: nuevasNotas });
      } catch (err) {
        console.error(err);
        showToast(`No se pudo actualizar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
        return;
      }
    }
    if (!esTokenVigente(clave, miToken)) return;
    p.cancelado = nuevoCancelado;
    p.notas = nuevasNotas;
    savePedidos();
    renderPedidos();
    renderJornadas();
    renderStatsFinanzas();
    showToast(nuevoCancelado ? 'Pedido marcado como cancelado' : 'Pedido reactivado');
  }

  async function deletePedido(id) {
    const p = pedidos.find(x => x.id === id);
    if (!confirm(`¿Eliminar el pedido de "${clienteDePedido(p).nombre}"?`)) return;
    if (esUuid(id)) {
      try {
        await marcarPedidoEliminadoEnSupabase(id);
      } catch (err) {
        console.error(err);
        showToast(`No se pudo eliminar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
        return;
      }
    }
    moverAPapelera('pedidos', p);
    pedidos = pedidos.filter(x => x.id !== id);
    savePedidos();
    renderPedidos();
    renderClientes();
    renderJornadas();
    renderStatsFinanzas();
    showToast('Pedido eliminado (puedes restaurarlo desde la Papelera)');
  }

  // el filtro de fecha se guarda para que no se pierda al cambiar de pestaña o recargar la página
  function guardarFiltroFechaPedidos() {
    localStorage.setItem(LS_PEDIDOS_FILTRO, JSON.stringify({
      desde: document.getElementById('pedidosFiltroDesde').value,
      hasta: document.getElementById('pedidosFiltroHasta').value,
    }));
  }
  function restaurarFiltroFechaPedidos() {
    try {
      const guardado = JSON.parse(localStorage.getItem(LS_PEDIDOS_FILTRO));
      if (guardado) {
        document.getElementById('pedidosFiltroDesde').value = guardado.desde || '';
        document.getElementById('pedidosFiltroHasta').value = guardado.hasta || '';
      }
    } catch (e) { /* ignorar filtro guardado corrupto */ }
  }
  restaurarFiltroFechaPedidos();

  document.getElementById('buscarPedido').addEventListener('input', renderPedidos);
  document.getElementById('pedidosFiltroDesde').addEventListener('input', () => { guardarFiltroFechaPedidos(); renderPedidos(); });
  document.getElementById('pedidosFiltroHasta').addEventListener('input', () => { guardarFiltroFechaPedidos(); renderPedidos(); });
  document.getElementById('btnLimpiarFiltroFecha').addEventListener('click', () => {
    document.getElementById('pedidosFiltroDesde').value = '';
    document.getElementById('pedidosFiltroHasta').value = '';
    guardarFiltroFechaPedidos();
    renderPedidos();
  });
  document.getElementById('btnNuevoPedido').addEventListener('click', () => openPedidoModal(null, false));
  document.getElementById('btnVentaMostrador').addEventListener('click', () => openPedidoModal(null, true));

  const tbodyPedidoItems = document.getElementById('tbodyPedidoItems');

  // ---------------- selector de hora simple (hora + minutos + AM/PM) ----------------
  const selHoraH = document.getElementById('pedidoHoraH');
  const selHoraM = document.getElementById('pedidoHoraM');
  const selHoraAmPm = document.getElementById('pedidoHoraAmPm');

  for (let h = 1; h <= 12; h++) {
    const opt = document.createElement('option');
    opt.value = String(h); opt.textContent = String(h);
    selHoraH.appendChild(opt);
  }
  [0, 15, 30, 45].forEach(m => {
    const opt = document.createElement('option');
    opt.value = String(m).padStart(2, '0'); opt.textContent = String(m).padStart(2, '0');
    selHoraM.appendChild(opt);
  });

  function horaA24h(hora12, minuto, ampm) {
    let h = parseInt(hora12, 10) % 12;
    if (ampm === 'PM') h += 12;
    return String(h).padStart(2, '0') + ':' + minuto;
  }
  function horaDe24h(hhmm) {
    if (!hhmm) return { hora12: '12', minuto: '00', ampm: 'AM' };
    const [hh, mm] = hhmm.split(':').map(Number);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    let hora12 = hh % 12;
    if (hora12 === 0) hora12 = 12;
    // redondea a los minutos disponibles (00/15/30/45) más cercanos
    const minutosDisponibles = [0, 15, 30, 45];
    const minuto = minutosDisponibles.reduce((a, b) => Math.abs(b - mm) < Math.abs(a - mm) ? b : a);
    return { hora12: String(hora12), minuto: String(minuto === 60 ? 0 : minuto).padStart(2, '0'), ampm };
  }

  function recetaOptionsHTML(selectedId) {
    return recetas.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(r =>
      `<option value="${r.id}" ${r.id === selectedId ? 'selected' : ''}>${esc(r.nombre)}</option>`
    ).join('');
  }

  function addPedidoItemRow(item) {
    if (!recetas.length) {
      showToast('Primero crea al menos una receta en la pestaña Recetas.');
      return;
    }
    const tr = document.createElement('tr');
    tr.className = 'pedido-item-row';
    const firstRecetaId = item ? item.recetaId : recetas[0].id;
    tr.innerHTML = `
      <td><select class="item-receta">${recetaOptionsHTML(firstRecetaId)}</select></td>
      <td><input type="number" class="item-cantidad" min="1" step="1" value="${item ? item.cantidad : 1}"></td>
      <td class="text-right item-precio">${money(0)}</td>
      <td class="text-right item-subtotal">${money(0)}</td>
      <td class="col-actions"><button type="button" class="btn-icon danger" title="Quitar">🗑</button></td>
    `;
    if (item && item.precioUnitario !== undefined && item.precioUnitario !== null) {
      tr.dataset.precioFijo = String(item.precioUnitario);
    }
    tbodyPedidoItems.appendChild(tr);
    tr.querySelector('.item-receta').addEventListener('change', () => {
      // cambiar el plato de esta fila invalida el precio congelado que tenía (era de otro plato);
      // se recalcula desde el precio actual y se vuelve a congelar recién al guardar el pedido.
      delete tr.dataset.precioFijo;
      recalcResumenPedido();
    });
    tr.querySelector('.item-cantidad').addEventListener('input', recalcResumenPedido);
    tr.querySelector('.btn-icon').addEventListener('click', () => { tr.remove(); recalcResumenPedido(); });
    recalcResumenPedido();
  }
  document.getElementById('btnAgregarPedidoItem').addEventListener('click', () => addPedidoItemRow(null));

  function readPedidoItemRows() {
    return Array.from(tbodyPedidoItems.querySelectorAll('.pedido-item-row')).map(tr => {
      const it = {
        recetaId: tr.querySelector('.item-receta').value,
        cantidad: parseInt(tr.querySelector('.item-cantidad').value, 10) || 0,
      };
      if (tr.dataset.precioFijo !== undefined) it.precioUnitario = parseFloat(tr.dataset.precioFijo);
      return it;
    });
  }

  // asigna el precio actual (congelado) a cualquier item que todavía no tenga uno —
  // platos nuevos agregados al pedido, o cuyo plato fue cambiado en esta edición.
  function congelarPreciosPedido(items) {
    return items.map(it => {
      if (it.precioUnitario !== undefined && it.precioUnitario !== null) return it;
      const r = recetas.find(x => x.id === it.recetaId);
      return { ...it, precioUnitario: r ? calcReceta(r).precioReferencia : 0 };
    });
  }

  // "Ya cobrado" (pagado) y "Método de pago" (tipoPago) son dos controles INDEPENDIENTES del
  // formulario -- a propósito, no un selector único combinado (ver corrección de diseño: un
  // cliente puede elegir "pagará en efectivo al recoger" sin que el pedido esté cobrado
  // todavía). Los botones de ciclo de la tabla (togglePagoPedido/toggleTipoPagoPedido) siguen
  // existiendo tal cual para cambiar cualquiera de los dos después de creado el pedido.
  function currentFormPedido() {
    return {
      fechaEntrega: document.getElementById('pedidoFecha').value,
      horaEntrega: horaA24h(selHoraH.value, selHoraM.value, selHoraAmPm.value),
      items: readPedidoItemRows(),
      pagado: document.getElementById('pedidoPagado').checked,
      tipoPago: document.getElementById('pedidoTipoPago').value,
      estadoPreparacion: pedidoPreparacionActual,
      notas: document.getElementById('pedidoNotas').value.trim(),
      cancelado: pedidoCanceladoActual,
      jornadaId: document.getElementById('pedidoJornada').value || null,
      esMostrador: pedidoEsMostradorActual,
    };
  }

  function recalcResumenPedido() {
    const p = currentFormPedido();
    const c = calcPedido(p);

    Array.from(tbodyPedidoItems.querySelectorAll('.pedido-item-row')).forEach((tr, idx) => {
      const it = c.items[idx];
      tr.querySelector('.item-precio').textContent = it ? money(it.precioUnitario) : money(0);
      tr.querySelector('.item-subtotal').textContent = it ? money(it.subtotal) : money(0);
    });

    const resumen = document.getElementById('resumenPedido');
    resumen.innerHTML = `
      <div class="summary-item"><div class="summary-label">Total de platos</div><div class="summary-value">${c.totalPlatos}</div></div>
      <div class="summary-item highlight"><div class="summary-label">Total a cobrar</div><div class="summary-value">${money(c.total)}</div></div>
      ${c.faltantes.length ? `<div class="summary-warning">⚠ Hay platos que ya no existen en Recetas.</div>` : ''}
    `;
  }

  ['pedidoFecha', 'pedidoHoraH', 'pedidoHoraM', 'pedidoHoraAmPm'].forEach(id => {
    document.getElementById(id).addEventListener('input', recalcResumenPedido);
    document.getElementById(id).addEventListener('change', recalcResumenPedido);
  });

  // Jornada híbrida: si el selector tiene un Evento elegido, la fecha de entrega se
  // autocompleta con la fecha de ese Evento y el campo queda bloqueado mientras siga
  // seleccionado -- así el pedido nunca puede terminar con una fecha distinta a la de su
  // propio Evento. Al volver a "Día normal" se desbloquea y el pedido queda con la fecha que
  // el usuario elija, resolviendo su Jornada automática al guardar (ver el submit de abajo).
  // pedidoFechaBloqueadaPorMostrador (true SOLO al crear una Venta de mostrador) fuerza fecha
  // Y hora bloqueadas sin importar qué esté elegido en el selector de Jornada -- al editar
  // (aunque sea una venta de mostrador) queda en false y todo se comporta como un pedido normal.
  function actualizarBloqueoFechaPedido() {
    const idEvento = document.getElementById('pedidoJornada').value;
    const campoFecha = document.getElementById('pedidoFecha');
    const evento = idEvento ? jornadas.find(j => j.id === idEvento) : null;
    if (evento) {
      campoFecha.value = evento.fecha;
      campoFecha.disabled = true;
    } else {
      campoFecha.disabled = pedidoFechaBloqueadaPorMostrador;
    }
    selHoraH.disabled = selHoraM.disabled = selHoraAmPm.disabled = pedidoFechaBloqueadaPorMostrador;
  }
  document.getElementById('pedidoJornada').addEventListener('change', actualizarBloqueoFechaPedido);

  // Resumen "vendido / planeado" de la Jornada elegida en el selector -- ayuda a quien está
  // tomando el pedido a ver cuánto queda disponible de cada plato planeado para esa jornada.
  // Solo lee lo YA guardado (calcJornada); los platos que se estén agregando en este mismo
  // formulario, sin guardar todavía, no se suman acá -- se actualiza recién al reabrir/guardar.
  function actualizarResumenPlanJornadaPedido() {
    const idJornada = document.getElementById('pedidoJornada').value;
    const contenedor = document.getElementById('resumenPlanPedidoJornada');
    const jornada = idJornada ? jornadas.find(j => j.id === idJornada) : null;
    const plan = jornada ? calcJornada(jornada).plan : [];
    if (!plan.length) {
      contenedor.hidden = true;
      contenedor.innerHTML = '';
      return;
    }
    contenedor.hidden = false;
    contenedor.innerHTML = plan.map(l => `
      <div class="summary-item"><div class="summary-label">${esc(l.nombre)}</div><div class="summary-value">${l.vendido}/${l.cantidadPlaneada}</div></div>
    `).join('');
  }
  document.getElementById('pedidoJornada').addEventListener('change', actualizarResumenPlanJornadaPedido);

  // El selector de Jornada se recalcula cada vez que cambia "Fecha de entrega":
  // - Venta de mostrador: se filtra a solo los Eventos de esa fecha puntual (no lista todos los
  //   Eventos como un pedido normal). Al crear, la fecha está bloqueada = hoy, así que esto no se
  //   dispara (el campo no se puede tocar); al editar, si el usuario cambia la fecha a mano, la
  //   lista se refresca para esa nueva fecha.
  // - Pedido normal: se recalcula con jornadaOptionsHTMLEventosVigentes (oculta Eventos pasados
  //   salvo que coincidan con la nueva fecha). En la práctica solo importa mientras el selector
  //   sigue en "Día normal", porque elegir un Evento bloquea este campo (actualizarBloqueoFechaPedido).
  document.getElementById('pedidoFecha').addEventListener('change', () => {
    const selectJornada = document.getElementById('pedidoJornada');
    const seleccionActual = selectJornada.value;
    const nuevaFecha = document.getElementById('pedidoFecha').value;
    if (pedidoEsMostradorActual) {
      const sigueValida = seleccionActual && jornadas.some(j => j.id === seleccionActual && j.tipo === 'evento' && j.fecha === nuevaFecha);
      selectJornada.innerHTML = jornadaOptionsHTMLEventosDelDia(nuevaFecha, sigueValida ? seleccionActual : null);
    } else {
      const hoy = new Date().toISOString().slice(0, 10);
      const sigueValida = seleccionActual && jornadas.some(j => j.id === seleccionActual && j.tipo === 'evento' && (j.fecha >= hoy || j.fecha === nuevaFecha));
      selectJornada.innerHTML = jornadaOptionsHTMLEventosVigentes(nuevaFecha, sigueValida ? seleccionActual : null);
    }
    actualizarResumenPlanJornadaPedido();
  });

  let pedidoPreparacionActual = 'sin_accion';
  let pedidoCanceladoActual = false;
  let pedidoEsMostradorActual = false;
  let pedidoFechaBloqueadaPorMostrador = false;

  // esMostrador solo aplica al crear (id=null); al editar, se respeta el es_mostrador que el
  // pedido ya tenía -- no se puede "convertir" un pedido normal en venta de mostrador ni
  // viceversa solo por cómo se abrió el modal de edición.
  function openPedidoModal(id, esMostrador = false) {
    const form = document.getElementById('formPedido');
    form.reset();
    tbodyPedidoItems.innerHTML = '';
    populateClientesDatalist();

    if (id) {
      const p = pedidos.find(x => x.id === id);
      document.getElementById('modalPedidoTitulo').textContent = p.esMostrador ? 'Editar venta de mostrador' : 'Editar pedido';
      document.getElementById('pedidoId').value = p.id;
      pedidoEsMostradorActual = !!p.esMostrador;
      // al EDITAR, fecha/hora siempre quedan editables normalmente -- incluso si es una venta
      // de mostrador (el bloqueo solo aplica al crearla, ver la rama de abajo).
      pedidoFechaBloqueadaPorMostrador = false;
      // igual que en la columna Cliente de la tabla: lo que decide si hay un nombre que
      // precargar es si hay clienteId, no si es_mostrador -- si esta venta de mostrador SÍ
      // tiene un cliente real vinculado, hay que precargarlo (si no, guardar sin tocar el
      // campo lo desvincularía en silencio). Solo si de verdad no hay clienteId (el estado
      // normal de una venta de mostrador sin cliente) el campo queda vacío.
      document.getElementById('pedidoClienteNombre').value = p.clienteId ? clienteDePedido(p).nombre : '';
      document.getElementById('pedidoFecha').value = p.fechaEntrega || '';
      const hora = horaDe24h(p.horaEntrega);
      selHoraH.value = hora.hora12; selHoraM.value = hora.minuto; selHoraAmPm.value = hora.ampm;
      document.getElementById('pedidoPagado').checked = !!p.pagado;
      document.getElementById('pedidoTipoPago').value = p.tipoPago || '';
      pedidoPreparacionActual = p.estadoPreparacion || 'sin_accion';
      pedidoCanceladoActual = !!p.cancelado;
      document.getElementById('pedidoNotas').value = p.notas || '';
      // Jornada híbrida: si la jornada actual es un evento, se preselecciona (y el campo de
      // fecha queda bloqueado, ver actualizarBloqueoFechaPedido más abajo); si es la
      // "venta_regular" automática (o no tiene), el selector queda en "día normal".
      const jornadaActual = jornadas.find(j => j.id === p.jornadaId);
      const eventoSeleccionado = jornadaActual && jornadaActual.tipo === 'evento' ? jornadaActual.id : '';
      // Venta de mostrador: solo eventos de esta fecha puntual; pedido normal: todos.
      document.getElementById('pedidoJornada').innerHTML = pedidoEsMostradorActual
        ? jornadaOptionsHTMLEventosDelDia(p.fechaEntrega, eventoSeleccionado)
        : jornadaOptionsHTMLEventosVigentes(p.fechaEntrega, eventoSeleccionado);
      p.items.forEach(item => addPedidoItemRow(item));
    } else {
      document.getElementById('modalPedidoTitulo').textContent = esMostrador ? 'Venta de mostrador' : 'Nuevo pedido';
      document.getElementById('pedidoId').value = '';
      document.getElementById('pedidoClienteNombre').value = '';
      pedidoEsMostradorActual = esMostrador;
      // al CREAR una venta de mostrador, fecha/hora quedan fijas y bloqueadas al momento en que
      // se abrió el modal -- no se pueden tocar en este paso (sí se pueden corregir editando
      // después, ver la rama de arriba).
      pedidoFechaBloqueadaPorMostrador = esMostrador;
      let fechaMostrador = '';
      if (esMostrador) {
        // fecha/hora actuales del sistema, en hora LOCAL (no toISOString/UTC -- eso desfasaría
        // la fecha un día para cualquiera en un huso horario negativo, mismo bug que ya
        // corregimos antes en fecha()).
        const ahora = new Date();
        const yyyy = ahora.getFullYear(), mm = String(ahora.getMonth() + 1).padStart(2, '0'), dd = String(ahora.getDate()).padStart(2, '0');
        fechaMostrador = `${yyyy}-${mm}-${dd}`;
        document.getElementById('pedidoFecha').value = fechaMostrador;
        const horaActual = horaDe24h(`${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`);
        selHoraH.value = horaActual.hora12; selHoraM.value = horaActual.minuto; selHoraAmPm.value = horaActual.ampm;
      } else {
        selHoraH.value = '12'; selHoraM.value = '00'; selHoraAmPm.value = 'PM';
      }
      document.getElementById('pedidoPagado').checked = false;
      document.getElementById('pedidoTipoPago').value = '';
      pedidoPreparacionActual = 'sin_accion';
      pedidoCanceladoActual = false;
      document.getElementById('pedidoJornada').innerHTML = esMostrador
        ? jornadaOptionsHTMLEventosDelDia(fechaMostrador, null)
        : jornadaOptionsHTMLEventosVigentes(document.getElementById('pedidoFecha').value, null);
      addPedidoItemRow(null);
    }
    document.getElementById('labelPedidoCliente').textContent = pedidoEsMostradorActual ? 'Cliente (opcional)' : 'Cliente *';
    actualizarBloqueoFechaPedido();
    actualizarResumenPlanJornadaPedido();
    recalcResumenPedido();
    openModal('modalPedido');
  }

  document.getElementById('formPedido').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('pedidoId').value;
    const nombreCliente = document.getElementById('pedidoClienteNombre').value.trim();
    const data = currentFormPedido();
    // Venta de mostrador: el cliente es opcional -- un pedido normal sigue exigiéndolo.
    if (!nombreCliente && !pedidoEsMostradorActual) { showToast('Escribe el nombre del cliente.'); return; }
    if (!data.items.length) { showToast('Agrega al menos un plato.'); return; }
    if (id && !confirm('¿Guardar los cambios en este pedido? Se sobrescribirán los datos actuales.')) return;
    data.items = congelarPreciosPedido(data.items);

    // Jornada híbrida: si se editó un pedido y cambió su fecha de entrega, y ese pedido ya
    // tenía una Jornada (automática o manual) que ya no corresponde a la nueva fecha, se
    // pregunta explícitamente qué hacer -- nunca se decide en silencio.
    if (id) {
      const pOriginal = pedidos.find(x => x.id === id);
      const jornadaOriginal = pOriginal && pOriginal.jornadaId ? jornadas.find(j => j.id === pOriginal.jornadaId) : null;
      if (pOriginal && pOriginal.fechaEntrega !== data.fechaEntrega && jornadaOriginal && jornadaOriginal.fecha !== data.fechaEntrega) {
        const mantenerOriginal = !confirm(
          `Este pedido estaba asignado a "${jornadaOriginal.nombre}". Cambiaste la fecha de entrega a ${fecha(data.fechaEntrega)}.\n\n` +
          `Aceptar: mover el pedido a la Jornada de ese nuevo día (o al evento que hayas elegido en el selector).\n` +
          `Cancelar: mantenerlo en "${jornadaOriginal.nombre}", aunque ya no sea el día de ese pedido.`
        );
        if (mantenerOriginal) data.jornadaId = pOriginal.jornadaId;
      }
    }

    const btnGuardar = document.querySelector('#formPedido button[type="submit"]');
    btnGuardar.disabled = true;
    try {
      // sin nombre de cliente (venta de mostrador sin cliente) -> clienteId null, sin llamar
      // a resolverOCrearClientePorNombre -- no tiene sentido crear/buscar un cliente vacío.
      let cliente = null, esNuevo = false;
      if (nombreCliente) {
        ({ cliente, esNuevo } = await resolverOCrearClientePorNombre(nombreCliente));
        if (esNuevo) saveClientes();
      }
      data.clienteId = cliente ? cliente.id : null;

      // si el selector quedó en el placeholder ("día normal") y no se forzó a mantener la
      // jornada original arriba, se resuelve/crea la Jornada venta_regular automática de esta
      // fecha; si el usuario eligió un evento (o se mantuvo la original), data.jornadaId ya
      // trae un id de Jornada existente y no hay nada que resolver.
      if (!data.jornadaId) {
        const jornadaAuto = await resolverOCrearJornadaVentaRegular(data.fechaEntrega);
        data.jornadaId = jornadaAuto.id;
      }

      if (id) {
        // si el id no es uuid, es un pedido de antes de conectar Pedidos a Supabase que nunca
        // llegó a existir allá (mismo criterio que ya usamos para clientes/recetas viejos) —
        // se edita 100% local, sin intentar la llamada.
        if (esUuid(id)) await guardarPedidoEnSupabase(id, data);
        const p = pedidos.find(x => x.id === id);
        Object.assign(p, data);
        showToast('Pedido actualizado');
      } else {
        const nuevoId = crypto.randomUUID();
        const numeroPedido = await guardarPedidoEnSupabase(nuevoId, data);
        pedidos.push({ id: nuevoId, numeroPedido, ...data });
        if (esNuevo) showToast(`Pedido creado. Se registró "${cliente.nombre}" como cliente nuevo.`);
        else showToast(data.esMostrador ? 'Venta de mostrador registrada' : 'Pedido creado');
      }
      savePedidos();
      renderPedidos();
      renderClientes();
      renderJornadas();
      renderStatsFinanzas();
      closeModal('modalPedido');
    } catch (err) {
      console.error(err);
      showToast(`No se pudo guardar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
    } finally {
      btnGuardar.disabled = false;
    }
  });

  document.getElementById('btnNuevoClienteDesdePedido').addEventListener('click', () => {
    quickAddClienteActivo = true;
    document.getElementById('modalPedido').hidden = true;
    openClienteModal(null);
    document.getElementById('clienteNombre').value = document.getElementById('pedidoClienteNombre').value.trim();
  });

  // =========================================================
  //  EXPORTAR PEDIDOS A PDF (por rango de fechas)
  // =========================================================
  document.getElementById('btnExportarPedidosPDF').addEventListener('click', () => {
    const hoy = new Date().toISOString().slice(0, 10);
    document.getElementById('pdfDesde').value = hoy;
    document.getElementById('pdfHasta').value = hoy;
    openModal('modalExportarPedidos');
  });

  document.getElementById('formExportarPedidos').addEventListener('submit', e => {
    e.preventDefault();
    const desde = document.getElementById('pdfDesde').value;
    const hasta = document.getElementById('pdfHasta').value;
    if (!desde || !hasta) return;
    if (desde > hasta) { showToast('La fecha "Desde" no puede ser posterior a "Hasta".'); return; }

    // mismo orden que esté elegido en ese momento en la tabla de Pedidos (columna/dirección
    // del clic en el encabezado) -- así el PDF exportado coincide con lo que se ve en pantalla,
    // en vez de imponer siempre "fecha de entrega ascendente" sin importar qué se haya elegido.
    const enRango = pedidos
      .filter(p => p.fechaEntrega >= desde && p.fechaEntrega <= hasta)
      .sort(compararPedidos);

    if (!enRango.length) { showToast('No hay pedidos en ese rango de fechas.'); return; }

    generarPDFPedidos(enRango, desde, hasta);
    closeModal('modalExportarPedidos');
  });

  // lee el nombre/subtítulo/ícono actuales de la topbar (configurables en Configuración) para
  // reusarlos como encabezado de los PDF que genera la app -- así el PDF siempre coincide con
  // la marca que se ve en pantalla, sin tener que duplicar "KitchenCost" a mano en cada plantilla.
  function datosMarcaApp() {
    return {
      nombre: document.getElementById('topbarNombre').textContent,
      subtitulo: document.getElementById('topbarSubtitulo').textContent,
      iconoHTML: document.getElementById('topbarIcono').innerHTML,
    };
  }

  function generarPDFPedidos(lista, desde, hasta) {
    // mismo resumen que se ve en pantalla (renderStatsPedidos), pero calculado sobre la lista
    // filtrada por el rango de fechas que se está exportando, no sobre todos los pedidos.
    const activos = lista.filter(p => !p.cancelado);
    const pendientes = activos.filter(p => !p.pagado);
    const cobrados = activos.filter(p => p.pagado);
    const totalPorCobrar = pendientes.reduce((s, p) => s + calcPedido(p).total, 0);
    const totalCobrado = cobrados.reduce((s, p) => s + calcPedido(p).total, 0);
    const totalGeneral = totalPorCobrar + totalCobrado;

    const cantidadPorPlato = new Map();
    activos.forEach(p => {
      calcPedido(p).items.forEach(it => {
        cantidadPorPlato.set(it.nombre, (cantidadPorPlato.get(it.nombre) || 0) + (it.cantidad || 0));
      });
    });
    const platosOrdenados = Array.from(cantidadPorPlato.entries()).sort((a, b) => b[1] - a[1]);

    const resumenHTML = `
      <div class="resumen-stats">
        <div class="stat-box"><div class="stat-valor">${lista.length}</div><div class="stat-label">Total pedidos</div></div>
        ${platosOrdenados.length ? `
          <div class="stat-box stat-box-lista">
            <div class="stat-label">Platos pedidos</div>
            ${platosOrdenados.map(([nombre, cantidad]) => `<div>${cantidad} ${esc(nombre)}</div>`).join('')}
          </div>
        ` : ''}
        <div class="stat-box"><div class="stat-valor">${money(totalGeneral)}</div><div class="stat-label">Total Bs pedidos</div></div>
        <div class="stat-box"><div class="stat-valor">${money(totalPorCobrar)}</div><div class="stat-label">Total por cobrar</div></div>
        <div class="stat-box"><div class="stat-valor">${money(totalCobrado)}</div><div class="stat-label">Total cobrado</div></div>
      </div>
    `;

    const filasHTML = lista.map(p => {
      const c = calcPedido(p);
      const cliente = clienteDePedido(p);
      // en lista, un plato por línea -- mismo formato que la columna "Platos" en pantalla
      // (renderPedidos), en vez de todo seguido separado por comas.
      const platosTxt = c.items.map(i => `${i.cantidad}x ${esc(i.nombre)}${i.papelera ? etiquetaEnPapeleraHTML(true) : ''}`).join('<br>');
      return `
        <tr${p.cancelado ? ' style="opacity:.55;text-decoration:line-through"' : ''}>
          <td>#${p.numeroPedido || '—'}</td>
          <td>${esc(cliente.nombre)}${cliente.papelera ? etiquetaEnPapeleraHTML(true) : ''}</td>
          <td>${esc(cliente.telefono) || '—'}</td>
          <td>${platosTxt}</td>
          <td>${fechaHoraEntrega(p)}</td>
          <td class="num">${money(c.total)}</td>
          <td>${p.pagado ? 'Cobrado' : 'Pendiente'}</td>
          <td>${TIPO_PAGO_LABEL[p.tipoPago || '']}</td>
          <td>${PREPARACION_LABEL[p.estadoPreparacion || 'sin_accion']}</td>
          <td>${p.cancelado ? 'Cancelado' : '—'}</td>
          <td>${esc(p.notas) || '—'}</td>
        </tr>
      `;
    }).join('');

    const marca = datosMarcaApp();

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Pedidos ${fecha(desde + 'T00:00:00')} — ${fecha(hasta + 'T00:00:00')}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#222;padding:16px;margin:0}
  .marca-pdf{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .marca-pdf-icono{font-size:26px;line-height:1;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
  .marca-pdf-icono img{width:32px;height:32px;object-fit:contain}
  h1{font-size:18px;margin:0}
  .marca-pdf .subtitulo-marca{font-size:11px;color:#777;margin:1px 0 0}
  .subtitulo{font-size:12px;color:#666;margin:0 0 18px}
  table{width:100%;border-collapse:collapse;font-size:10.5px;table-layout:fixed}
  th,td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:break-word;word-break:break-word}
  th{background:#f0f0f0}
  td.num,th.num{text-align:right}
  tfoot td{font-weight:bold;background:#f7f7f7}
  .resumen-stats{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 20px}
  .stat-box{border:1px solid #ccc;border-radius:6px;padding:8px 12px;min-width:110px}
  .stat-box .stat-valor{font-size:16px;font-weight:800}
  .stat-box .stat-label{font-size:9px;text-transform:uppercase;color:#777;letter-spacing:.02em;margin-top:2px}
  .stat-box-lista div{font-size:11px;margin-top:2px}
  @media print{ body{padding:0} }
</style>
</head>
<body>
  <div class="marca-pdf">
    <span class="marca-pdf-icono">${marca.iconoHTML}</span>
    <div>
      <h1>${esc(marca.nombre)}</h1>
      <p class="subtitulo-marca">${esc(marca.subtitulo)}</p>
    </div>
  </div>
  <p class="subtitulo">Pedidos · Rango: ${fecha(desde + 'T00:00:00')} al ${fecha(hasta + 'T00:00:00')} · ${lista.length} pedido(s) · Generado ${new Date().toLocaleString('es-CO')}</p>
  ${resumenHTML}
  <table>
    <colgroup>
      <col style="width:4%"><col style="width:14%"><col style="width:7%"><col style="width:20%"><col style="width:9%">
      <col style="width:6%"><col style="width:6%"><col style="width:7%"><col style="width:7%"><col style="width:6%"><col style="width:14%">
    </colgroup>
    <thead>
      <tr>
        <th>N.°</th><th>Cliente</th><th>Teléfono</th><th>Platos</th><th>Entrega</th>
        <th class="num">Total</th><th>Pago</th><th>Tipo de pago</th><th>Preparación</th><th>Cancelado</th><th>Notas</th>
      </tr>
    </thead>
    <tbody>${filasHTML}</tbody>
    <tfoot>
      <tr><td colspan="5">Total general</td><td class="num">${money(totalGeneral)}</td><td colspan="5"></td></tr>
    </tfoot>
  </table>
</body>
</html>`;

    const ventana = window.open('', '_blank');
    if (!ventana) { showToast('El navegador bloqueó la ventana. Permite pop-ups para exportar el PDF.'); return; }
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
    setTimeout(() => { try { ventana.focus(); ventana.print(); } catch (e) {} }, 300);
  }

  function descargarDetallePedido(id) {
    const p = pedidos.find(x => x.id === id);
    const c = calcPedido(p);
    const cliente = clienteDePedido(p);
    const numeroOrden = p.numeroPedido || p.id.replace(/^id_/, '').slice(0, 8).toUpperCase();
    const filasHTML = c.items.map(i => `
      <tr>
        <td>${esc(i.nombre)}${i.papelera ? etiquetaEnPapeleraHTML(true) : ''}</td>
        <td class="num">${i.cantidad}</td>
        <td class="num">${money(i.precioUnitario)}</td>
        <td class="num">${money(i.subtotal)}</td>
      </tr>
    `).join('');

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Pedido ${numeroOrden} — ${esc(cliente.nombre)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:0;padding:28px 12px;background:#eee}
  .factura{max-width:420px;margin:0 auto;background:#fff;padding:22px 22px 18px;border:1px solid #ddd}
  .factura-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #222;padding-bottom:10px;margin-bottom:14px}
  .marca{font-size:17px;font-weight:800;letter-spacing:-.02em}
  .marca-sub{font-size:10.5px;color:#777;margin-top:1px}
  .meta{text-align:right;font-size:10.5px;color:#666;line-height:1.5}
  .meta b{color:#222}
  .datos{font-size:12px;margin-bottom:14px;line-height:1.7}
  .datos b{display:inline-block;width:72px;color:#555;font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:11.5px}
  thead th{font-size:10px;text-transform:uppercase;letter-spacing:.02em;color:#777;text-align:left;padding:0 0 5px;border-bottom:1.5px solid #222}
  tbody td{padding:6px 0;border-bottom:1px solid #eee}
  td.num,th.num{text-align:right}
  thead th:first-child,tbody td:first-child{padding-left:0}
  .totales{display:flex;justify-content:flex-end;margin-top:10px}
  .totales-tabla{width:auto;min-width:150px}
  .totales-tabla td{padding:3px 0 3px 14px;border:none;font-size:12px}
  .totales-tabla tr.total td{font-weight:800;font-size:15px;border-top:2px solid #222;padding-top:6px}
  .notas{margin-top:14px;font-size:11px;color:#555;background:#f7f7f7;padding:8px 10px;border-radius:4px}
  .footer-nota{margin-top:18px;font-size:10px;color:#999;text-align:center}
  @media print{ body{background:#fff;padding:0} .factura{border:none;max-width:100%} }
</style>
</head>
<body>
  <div class="factura">
    <div class="factura-header">
      <div>
        <div class="marca">KitchenCost</div>
        <div class="marca-sub">Detalle de pedido</div>
      </div>
      <div class="meta">
        <div>Orden <b>#${numeroOrden}</b></div>
        <div>${new Date().toLocaleDateString('es-CO')}</div>
      </div>
    </div>
    <div class="datos">
      <div><b>Cliente</b> ${esc(cliente.nombre)}${cliente.papelera ? etiquetaEnPapeleraHTML(true) : ''}</div>
      <div><b>Teléfono</b> ${esc(cliente.telefono) || '—'}</div>
      ${cliente.direccion ? `<div><b>Dirección</b> ${esc(cliente.direccion)}</div>` : ''}
      <div><b>Entrega</b> ${fechaHoraEntrega(p)}</div>
    </div>
    <table>
      <thead>
        <tr><th>Plato</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Subtotal</th></tr>
      </thead>
      <tbody>${filasHTML}</tbody>
    </table>
    <div class="totales">
      <table class="totales-tabla">
        <tr class="total"><td>Total</td><td class="num">${money(c.total)}</td></tr>
      </table>
    </div>
    ${p.notas ? `<div class="notas"><b>Notas:</b> ${esc(p.notas)}</div>` : ''}
    <p class="footer-nota">Generado el ${new Date().toLocaleString('es-CO')}</p>
  </div>
</body>
</html>`;

    const ventana = window.open('', '_blank');
    if (!ventana) { showToast('El navegador bloqueó la ventana. Permite pop-ups para descargar el detalle.'); return; }
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
    setTimeout(() => { try { ventana.focus(); ventana.print(); } catch (e) {} }, 300);
  }

  // =========================================================
  //  FINANZAS
  // =========================================================
  let jornadas = loadJornadas();
  let gastos = loadGastos();
  let capitalMovimientos = loadCapital();
  let donaciones = loadDonaciones();
  let categoriasGastos = loadList(LS_CAT_GASTOS, CATEGORIAS_GASTOS_DEFAULT).sort((a, b) => a.localeCompare(b));
  // mismo mecanismo que recetasEliminadasPorId/clientesEliminadosPorId: nombre de jornadas
  // en la Papelera de Supabase, para que Gastos (y en el futuro Pedidos) muestren el nombre
  // real + "Eliminado" en vez del genérico "(jornada eliminada)".
  let jornadasEliminadasPorId = new Map();

  // ---------------- Jornadas <-> Supabase ----------------
  // Mismo patrón que Insumos/Recetas/Clientes. Gastos referencia Jornadas por jornada_id
  // (opcional) — la reconciliación por nombre de abajo protege esa referencia tanto en
  // "gastos" como en "pedidos" (todavía local), igual que ya hicimos para insumo_id/receta_id/
  // cliente_id. Capital y Pedidos/Finanzas (resumen) NO se tocan en este paso.
  function filaSupabaseAJornada(fila, filasPlan) {
    return {
      id: fila.id,
      nombre: fila.nombre,
      tipo: fila.tipo,
      fecha: fila.fecha || '',
      ingresoManual: Number(fila.ingreso_manual) || 0,
      notas: fila.notas || '',
      // default true si por algún motivo viniera null/undefined (no debería pasar, la columna
      // tiene default true en Supabase) -- así ninguna Jornada existente se excluye sola.
      incluirEnAnalisis: fila.incluir_en_analisis !== false,
      plan: filasPlan
        .filter(l => l.jornada_id === fila.id)
        .sort((a, b) => (a.posicion || 0) - (b.posicion || 0))
        .map(l => ({ recetaId: l.receta_id, cantidadPlaneada: Number(l.cantidad_planeada) || 0 })),
    };
  }

  async function sincronizarJornadasDesdeSupabase() {
    // igual que en Recetas/Clientes: se traen TODAS (vivas y en la Papelera de Supabase)
    // para poder mostrar el nombre real de una jornada eliminada en Gastos
    // (jornadasEliminadasPorId) — solo el array "jornadas" en memoria se queda con las vivas.
    // Datos compartidos (ver nota en sincronizarInsumosDesdeSupabase): sin filtro por user_id.
    const { data: filasTodas, error } = await window.supabaseClient
      .from('jornadas')
      .select('*')
      .order('fecha', { ascending: false });
    if (error) {
      console.warn('No se pudo sincronizar Jornadas con Supabase, se sigue usando la copia local:', error.message);
      return false;
    }

    const data = filasTodas.filter(j => !j.deleted_at);
    jornadasEliminadasPorId = new Map(filasTodas.filter(j => j.deleted_at).map(j => [j.id, j.nombre]));

    // plan de platos: se trae junto con las jornadas (mismo patrón que receta_ingredientes en
    // sincronizarRecetasDesdeSupabase) -- para TODAS las jornadas traídas (vivas y en Papelera),
    // así una jornada restaurada no pierde su plan aunque se haya sincronizado mientras
    // estaba eliminada.
    const idsJornadas = filasTodas.map(j => j.id);
    let filasPlan = [];
    if (idsJornadas.length) {
      const { data: dataPlan, error: errPlan } = await window.supabaseClient
        .from('jornada_platos_plan')
        .select('*')
        .in('jornada_id', idsJornadas);
      if (errPlan) {
        console.warn('No se pudo sincronizar el plan de platos de las Jornadas, se sigue usando la copia local:', errPlan.message);
        return false;
      }
      filasPlan = dataPlan;
    }

    const jornadasAnteriores = jornadas;
    const nuevasJornadas = data.map(f => filaSupabaseAJornada(f, filasPlan));

    const nombreNorm = s => (s || '').trim().toLowerCase();
    const idViejoANuevoPorNombre = new Map();
    const advertenciasReconciliacion = [];

    jornadasAnteriores.forEach(vieja => {
      const usadaEnGastos = gastos.some(g => g.jornadaId === vieja.id);
      const usadaEnPedidos = pedidos.some(p => p.jornadaId === vieja.id);
      const candidatas = nuevasJornadas.filter(n => nombreNorm(n.nombre) === nombreNorm(vieja.nombre));

      if (!candidatas.length) {
        if (usadaEnGastos || usadaEnPedidos) {
          advertenciasReconciliacion.push(
            `"${vieja.nombre}" no tiene ninguna jornada con ese nombre en Supabase — los gastos/pedidos que la usan van a quedar sin jornada asignada hasta que lo corrijas a mano.`
          );
        }
        return;
      }
      if (candidatas.length > 1 && (usadaEnGastos || usadaEnPedidos)) {
        advertenciasReconciliacion.push(
          `"${vieja.nombre}" coincide con ${candidatas.length} jornadas distintas en Supabase (nombres duplicados) — se usó la primera (id ${candidatas[0].id}). Revísalo a mano si no es el correcto.`
        );
      }
      if (candidatas[0].id !== vieja.id) idViejoANuevoPorNombre.set(vieja.id, candidatas[0].id);
    });

    if (advertenciasReconciliacion.length) {
      console.warn('Advertencias al reconciliar Jornadas con Supabase por nombre:\n- ' + advertenciasReconciliacion.join('\n- '));
      showToast(`⚠ ${advertenciasReconciliacion.length} advertencia(s) al sincronizar Jornadas — revisa la consola (F12) para el detalle.`);
    }

    if (idViejoANuevoPorNombre.size) {
      let gastosCambiaron = false, pedidosCambiaron = false;
      gastos.forEach(g => {
        if (idViejoANuevoPorNombre.has(g.jornadaId)) { g.jornadaId = idViejoANuevoPorNombre.get(g.jornadaId); gastosCambiaron = true; }
      });
      pedidos.forEach(p => {
        if (idViejoANuevoPorNombre.has(p.jornadaId)) { p.jornadaId = idViejoANuevoPorNombre.get(p.jornadaId); pedidosCambiaron = true; }
      });
      if (gastosCambiaron) saveGastos();
      if (pedidosCambiaron) savePedidos();
      if (gastosCambiaron || pedidosCambiaron) {
        console.info(`Se reconectaron ${idViejoANuevoPorNombre.size} jornada(s) en gastos/pedidos locales con sus nuevos ids de Supabase (por nombre).`);
      }
    }

    jornadas = nuevasJornadas;
    saveJornadas();
    renderJornadas();
    renderGastos();
    renderStatsFinanzas();
    return true;
  }

  async function crearJornadaEnSupabase(id, data) {
    const { error } = await window.supabaseClient.from('jornadas').insert({
      id,
      user_id: window.SUPABASE_USER_ID,
      nombre: data.nombre,
      tipo: data.tipo,
      fecha: data.fecha,
      ingreso_manual: data.ingresoManual,
      notas: data.notas,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  // "Sábado 9 ago" -- toLocaleDateString no da ese formato directo (da algo como "sábado, 9 de
  // ago."), así que se arma a mano: día de la semana capitalizado + día + mes corto sin punto.
  function nombreVentaRegularSugerido(fechaISO) {
    const d = new Date(fechaISO + 'T00:00:00');
    const dia = d.toLocaleDateString('es-CO', { weekday: 'long' });
    const diaCap = dia.charAt(0).toUpperCase() + dia.slice(1);
    const mesCorto = d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
    return `${diaCap} ${d.getDate()} ${mesCorto}`;
  }

  // Jornada híbrida: busca la Jornada "venta_regular" de esta fecha; si no existe, la crea
  // (nombre sugerido, ingresoManual 0). Mismo patrón que resolverOCrearClientePorNombre.
  // El índice único jornadas_venta_regular_por_dia (scripts/sql/004_...) es la red de
  // seguridad real contra duplicados por condición de carrera (dos pedidos del mismo día
  // guardados casi al mismo tiempo desde pestañas/dispositivos distintos) -- si el insert
  // choca contra ese índice (23505), significa que otro proceso ya creó la Jornada de este
  // día una fracción de segundo antes: se vuelve a consultar y se usa esa, en vez de fallar.
  async function resolverOCrearJornadaVentaRegular(fechaEntrega) {
    let jornada = jornadas.find(j => j.tipo === 'venta_regular' && j.fecha === fechaEntrega);
    if (jornada) return jornada;

    const nuevoId = crypto.randomUUID();
    const data = { nombre: nombreVentaRegularSugerido(fechaEntrega), tipo: 'venta_regular', fecha: fechaEntrega, ingresoManual: 0, notas: '' };
    try {
      await crearJornadaEnSupabase(nuevoId, data);
    } catch (err) {
      if (err.code !== '23505') throw err;
      // Datos compartidos (ver nota en sincronizarInsumosDesdeSupabase): sin filtro por user_id
      // -- la Jornada "venta_regular" de este día que ganó la carrera puede haberla creado
      // cualquier usuario autenticado, no solo el actual.
      const { data: filas, error } = await window.supabaseClient
        .from('jornadas')
        .select('*')
        .eq('tipo', 'venta_regular')
        .eq('fecha', fechaEntrega)
        .is('deleted_at', null)
        .limit(1);
      if (error || !filas.length) throw err; // no se pudo recuperar la que ganó la carrera: se propaga el error original
      // se trae el plan de esa jornada por si el proceso que ganó la carrera ya le había
      // definido uno (muy improbable para una venta_regular recién creada, pero filaSupabaseAJornada
      // ahora exige este segundo argumento).
      const { data: filasPlanGanadora } = await window.supabaseClient
        .from('jornada_platos_plan').select('*').eq('jornada_id', filas[0].id);
      jornada = filaSupabaseAJornada(filas[0], filasPlanGanadora || []);
      jornadas.push(jornada);
      saveJornadas();
      return jornada;
    }
    jornada = { id: nuevoId, ...data };
    jornadas.push(jornada);
    saveJornadas();
    return jornada;
  }

  // guarda la Jornada (datos propios + su plan de platos) en UNA sola llamada RPC atómica --
  // sirve tanto para crear (id nuevo) como para editar (id existente): guardar_jornada_completa
  // hace upsert de la fila de "jornadas" y reemplaza jornada_platos_plan en la misma transacción,
  // mismo criterio que guardar_receta_completa/guardar_pedido_completo: si falla a la mitad, no
  // debe quedar la Jornada guardada sin su plan (ni el plan guardado sin los demás campos).
  async function guardarJornadaCompletaEnSupabase(id, data, plan) {
    const { error } = await window.supabaseClient.rpc('guardar_jornada_completa', {
      p_id: id,
      p_user_id: window.SUPABASE_USER_ID,
      p_nombre: data.nombre,
      p_tipo: data.tipo,
      p_fecha: data.fecha,
      p_ingreso_manual: data.ingresoManual,
      p_notas: data.notas,
      p_plan: plan.map(l => ({ receta_id: l.recetaId, cantidad_planeada: l.cantidadPlaneada })),
      // la RPC ya no tiene una versión de 8 parámetros -- este campo es obligatorio en cada
      // llamada, no opcional.
      p_incluir_en_analisis: data.incluirEnAnalisis !== false,
    });
    if (error) throw error;
  }

  async function marcarJornadaEliminadaEnSupabase(id) {
    const { error } = await window.supabaseClient.from('jornadas').update({
      deleted_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
  }

  async function restaurarJornadaEnSupabase(id) {
    const { error } = await window.supabaseClient.from('jornadas').update({ deleted_at: null }).eq('id', id);
    if (error) throw error;
    jornadasEliminadasPorId.delete(id);
  }

  async function eliminarJornadaDefinitivamenteEnSupabase(id) {
    const { error } = await window.supabaseClient.from('jornadas').delete().eq('id', id);
    if (error) throw error;
  }

  // ---------------- Gastos <-> Supabase ----------------
  // Tabla simple sin hijos, ya migrada desde el Paso 1 (el único gasto existente, "verduras",
  // ya tiene uuid real) — no hace falta reconciliación por nombre para el propio id de Gasto
  // (nada lo referencia por id). jornada_id se guarda tal cual venga del formulario: si hay
  // jornada seleccionada, ya es un uuid real (el <select> se llena desde "jornadas", que para
  // este momento ya está sincronizado con Supabase).
  function filaSupabaseAGasto(fila) {
    return {
      id: fila.id,
      fecha: fila.fecha || '',
      categoria: fila.categoria || '',
      concepto: fila.concepto,
      monto: Number(fila.monto) || 0,
      jornadaId: fila.jornada_id || null,
    };
  }

  async function sincronizarGastosDesdeSupabase() {
    // Datos compartidos (ver nota en sincronizarInsumosDesdeSupabase): sin filtro por user_id.
    const { data, error } = await window.supabaseClient
      .from('gastos')
      .select('*')
      .is('deleted_at', null)
      .order('fecha', { ascending: false });
    if (error) {
      console.warn('No se pudo sincronizar Gastos con Supabase, se sigue usando la copia local:', error.message);
      return false;
    }
    gastos = data.map(filaSupabaseAGasto);
    saveGastos();
    renderGastos();
    renderJornadas();
    renderStatsFinanzas();
    return true;
  }

  async function crearGastoEnSupabase(id, data) {
    const { error } = await window.supabaseClient.from('gastos').insert({
      id,
      user_id: window.SUPABASE_USER_ID,
      fecha: data.fecha,
      categoria: data.categoria,
      concepto: data.concepto,
      monto: data.monto,
      jornada_id: data.jornadaId || null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  async function actualizarGastoEnSupabase(id, data) {
    const { error } = await window.supabaseClient.from('gastos').update({
      fecha: data.fecha,
      categoria: data.categoria,
      concepto: data.concepto,
      monto: data.monto,
      jornada_id: data.jornadaId || null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
  }

  async function marcarGastoEliminadoEnSupabase(id) {
    const { error } = await window.supabaseClient.from('gastos').update({
      deleted_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
  }

  async function restaurarGastoEnSupabase(id) {
    const { error } = await window.supabaseClient.from('gastos').update({ deleted_at: null }).eq('id', id);
    if (error) throw error;
  }

  async function eliminarGastoDefinitivamenteEnSupabase(id) {
    const { error } = await window.supabaseClient.from('gastos').delete().eq('id', id);
    if (error) throw error;
  }

  // ---------------- Donaciones <-> Supabase ----------------
  // Solo aplican a Jornadas tipo 'evento' (se filtra en la UI, no acá -- la tabla en sí no
  // distingue tipo de jornada). A diferencia de Gastos, jornada_id NUNCA es null: una donación
  // siempre nace desde el detalle de una Jornada puntual, no existe un "General" para donaciones.
  function filaSupabaseADonacion(fila) {
    return {
      id: fila.id,
      jornadaId: fila.jornada_id,
      concepto: fila.concepto,
      monto: Number(fila.monto) || 0,
      fecha: fila.fecha || '',
    };
  }

  async function sincronizarDonacionesDesdeSupabase() {
    // Datos compartidos (ver nota en sincronizarInsumosDesdeSupabase): sin filtro por user_id.
    const { data, error } = await window.supabaseClient
      .from('donaciones_jornada')
      .select('*')
      .is('deleted_at', null)
      .order('fecha', { ascending: false });
    if (error) {
      console.warn('No se pudo sincronizar Donaciones con Supabase, se sigue usando la copia local:', error.message);
      return false;
    }
    donaciones = data.map(filaSupabaseADonacion);
    saveDonaciones();
    if (detalleJornadaActualId) abrirDetalleJornada(detalleJornadaActualId);
    return true;
  }

  async function crearDonacionEnSupabase(id, data) {
    const { error } = await window.supabaseClient.from('donaciones_jornada').insert({
      id,
      user_id: window.SUPABASE_USER_ID,
      jornada_id: data.jornadaId,
      concepto: data.concepto,
      monto: data.monto,
      fecha: data.fecha,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  async function actualizarDonacionEnSupabase(id, data) {
    const { error } = await window.supabaseClient.from('donaciones_jornada').update({
      concepto: data.concepto,
      monto: data.monto,
      fecha: data.fecha,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
  }

  async function marcarDonacionEliminadaEnSupabase(id) {
    const { error } = await window.supabaseClient.from('donaciones_jornada').update({
      deleted_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
  }

  async function restaurarDonacionEnSupabase(id) {
    const { error } = await window.supabaseClient.from('donaciones_jornada').update({ deleted_at: null }).eq('id', id);
    if (error) throw error;
  }

  async function eliminarDonacionDefinitivamenteEnSupabase(id) {
    const { error } = await window.supabaseClient.from('donaciones_jornada').delete().eq('id', id);
    if (error) throw error;
  }

  // ---------------- Capital <-> Supabase ----------------
  // La más simple de las 4: tabla sin hijos y sin nada que la referencie por id (a diferencia
  // de Jornadas, nada apunta a un CapitalMovimiento) — no hace falta reconciliación por
  // nombre. Único detalle: el campo local se llama "nota" (singular) pero la columna en
  // Supabase es "notas" (plural, consistente con Cliente/Pedido/Jornada) — se traduce el
  // nombre acá, igual que ya hizo el script de migración.
  function filaSupabaseACapital(fila) {
    return {
      id: fila.id,
      tipo: fila.tipo,
      fecha: fila.fecha || '',
      monto: Number(fila.monto) || 0,
      nota: fila.notas || '',
    };
  }

  async function sincronizarCapitalDesdeSupabase() {
    // Datos compartidos (ver nota en sincronizarInsumosDesdeSupabase): sin filtro por user_id.
    const { data, error } = await window.supabaseClient
      .from('capital_movimientos')
      .select('*')
      .is('deleted_at', null)
      .order('fecha', { ascending: false });
    if (error) {
      console.warn('No se pudo sincronizar Capital con Supabase, se sigue usando la copia local:', error.message);
      return false;
    }
    capitalMovimientos = data.map(filaSupabaseACapital);
    saveCapital();
    renderCapital();
    renderStatsFinanzas();
    return true;
  }

  async function crearCapitalEnSupabase(id, data) {
    const { error } = await window.supabaseClient.from('capital_movimientos').insert({
      id,
      user_id: window.SUPABASE_USER_ID,
      tipo: data.tipo,
      fecha: data.fecha,
      monto: data.monto,
      notas: data.nota,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  async function actualizarCapitalEnSupabase(id, data) {
    const { error } = await window.supabaseClient.from('capital_movimientos').update({
      tipo: data.tipo,
      fecha: data.fecha,
      monto: data.monto,
      notas: data.nota,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
  }

  async function marcarCapitalEliminadoEnSupabase(id) {
    const { error } = await window.supabaseClient.from('capital_movimientos').update({
      deleted_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
  }

  async function restaurarCapitalEnSupabase(id) {
    const { error } = await window.supabaseClient.from('capital_movimientos').update({ deleted_at: null }).eq('id', id);
    if (error) throw error;
  }

  async function eliminarCapitalDefinitivamenteEnSupabase(id) {
    const { error } = await window.supabaseClient.from('capital_movimientos').delete().eq('id', id);
    if (error) throw error;
  }

  document.querySelectorAll('#subtabsFinanzas .subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#subtabsFinanzas .subtab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('#view-finanzas .subview').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('subview-' + btn.dataset.subview).classList.add('active');
      // Rentabilidad no se cruza-renderiza en cada mutación de Pedidos/Recetas/Insumos (la
      // cadena de dependencia es demasiado larga) -- en cambio, se recalcula fresca cada vez
      // que se abre este sub-tab, además de cuando cambia su propio filtro de fechas.
      if (btn.dataset.subview === 'rentabilidad') renderRentabilidad();
    });
  });

  // ---------------- cálculo ----------------
  // nombre de un plato del plan, con el mismo criterio de 3 estados que ya usa calcPedido()
  // para los platos de un pedido (vivo / en Papelera con nombre real / borrado definitivo).
  function nombreRecetaPlan(recetaId) {
    const r = recetas.find(x => x.id === recetaId);
    if (r) return { nombre: r.nombre, papelera: false };
    if (recetasEliminadasPorId.has(recetaId)) return { nombre: recetasEliminadasPorId.get(recetaId), papelera: true };
    return { nombre: '(plato eliminado)', papelera: false };
  }

  function calcJornada(j) {
    // Ingresos = Pendiente + Cobrado, excluyendo cancelados -- mismo criterio que "Total Bs
    // pedidos" en la pestaña Pedidos (sobre lo VENDIDO, no sobre lo ya cobrado). Antes esto
    // solo contaba pedidos con pagado=true (como "Total cobrado"), lo cual era inconsistente
    // con el resto de los reportes de la app -- corregido a pedido del usuario. El mismo
    // criterio también estaba duplicado en la vista SQL vista_calc_jornada (usada por la
    // pestaña Finanzas > Resumen vía la vista "resumen"); se corrigió ahí también para que
    // ambos lados sigan de acuerdo (ver migración 013_ingresos_jornada_pendiente_y_cobrado).
    const pedidosVinculados = pedidos.filter(p => p.jornadaId === j.id && !p.cancelado);
    const ingresoPedidos = pedidosVinculados.reduce((s, p) => s + calcPedido(p).total, 0);
    const ingresoManual = j.ingresoManual || 0;
    // Donaciones (solo aplican a Jornadas tipo 'evento', pero sumar acá es inofensivo aunque la
    // jornada sea 'venta_regular' -- en la práctica nunca va a tener donaciones vinculadas
    // porque la UI solo ofrece agregarlas desde una Jornada evento). Mismo campo que ya suma
    // vista_calc_jornada.ingreso_total del lado de Supabase (ver comentario de la migración
    // arriba) -- se mantienen ambos lados de acuerdo a propósito.
    const donacionesVinculadas = donaciones.filter(d => d.jornadaId === j.id);
    const ingresoDonaciones = donacionesVinculadas.reduce((s, d) => s + (d.monto || 0), 0);
    const ingresoTotal = ingresoManual + ingresoPedidos + ingresoDonaciones;
    const gastosVinculados = gastos.filter(g => g.jornadaId === j.id);
    const gastoTotal = gastosVinculados.reduce((s, g) => s + (g.monto || 0), 0);

    // "vendido" por plato: mismo conjunto de pedidos que ingresoPedidos ahora (ya no hace
    // falta un filtro aparte sin el pagado, los dos criterios quedaron iguales).
    const vendidoPorReceta = new Map();
    pedidosVinculados.forEach(p => {
      calcPedido(p).items.forEach(it => {
        if (!it.recetaId) return;
        vendidoPorReceta.set(it.recetaId, (vendidoPorReceta.get(it.recetaId) || 0) + (it.cantidad || 0));
      });
    });
    const plan = (j.plan || []).map(linea => {
      const { nombre, papelera } = nombreRecetaPlan(linea.recetaId);
      return { recetaId: linea.recetaId, nombre, papelera, cantidadPlaneada: linea.cantidadPlaneada, vendido: vendidoPorReceta.get(linea.recetaId) || 0 };
    });

    return {
      ingresoManual, ingresoPedidos, ingresoDonaciones, ingresoTotal, gastosVinculados, gastoTotal,
      utilidad: ingresoTotal - gastoTotal, pedidosVinculados, donacionesVinculadas, plan,
    };
  }

  // Cálculo local (el de siempre) — se usa como respaldo si la vista "resumen" de Supabase
  // no responde. Capital/Gastos/Jornadas ya están 100% sincronizados con Supabase, así que
  // este cálculo local debería coincidir con la vista de todas formas; se mantiene solo por
  // si falla la red/RLS/lo que sea, para no dejar la pestaña Finanzas en blanco.
  function calcFinanzasLocal() {
    const capitalNeto = capitalMovimientos.reduce((s, m) => s + (m.tipo === 'aporte' ? (m.monto || 0) : -(m.monto || 0)), 0);
    const gastoTotalGeneral = gastos.reduce((s, g) => s + (g.monto || 0), 0);
    const ingresoTotalGeneral = jornadas.reduce((s, j) => s + calcJornada(j).ingresoTotal, 0);
    const utilidadNeta = ingresoTotalGeneral - gastoTotalGeneral;
    return { capitalNeto, gastoTotalGeneral, ingresoTotalGeneral, utilidadNeta, saldoDisponible: capitalNeto + ingresoTotalGeneral - gastoTotalGeneral };
  }

  // Lee el resumen ya calculado por Supabase (vista "resumen": capital_neto,
  // gasto_total_general, ingreso_total_general, utilidad_neta — sin saldo_disponible, que se
  // sigue calculando acá con la misma fórmula de siempre). Si la consulta falla o no hay fila
  // para este usuario, cae al cálculo local (calcFinanzasLocal) — la app nunca se queda sin
  // números en Finanzas por un problema de red.
  async function calcFinanzas() {
    try {
      // La vista "resumen" en Supabase está agrupada POR user_id (una fila por cada usuario que
      // tenga movimientos) -- viene de cuando los datos todavía eran por-usuario. Ahora que son
      // compartidos entre cualquier cuenta autenticada, ya no se filtra por user_id (traería solo
      // la fila del usuario actual) sino que se traen TODAS las filas y se suman acá, para
      // obtener el total real compartido sin tener que tocar la vista en Supabase.
      const { data, error } = await window.supabaseClient
        .from('resumen')
        .select('*');
      if (error) throw error;
      if (data && data.length) {
        const capitalNeto = data.reduce((s, fila) => s + (Number(fila.capital_neto) || 0), 0);
        const gastoTotalGeneral = data.reduce((s, fila) => s + (Number(fila.gasto_total_general) || 0), 0);
        const ingresoTotalGeneral = data.reduce((s, fila) => s + (Number(fila.ingreso_total_general) || 0), 0);
        const utilidadNeta = ingresoTotalGeneral - gastoTotalGeneral;
        return { capitalNeto, gastoTotalGeneral, ingresoTotalGeneral, utilidadNeta, saldoDisponible: capitalNeto + ingresoTotalGeneral - gastoTotalGeneral };
      }
    } catch (err) {
      console.warn('No se pudo leer el resumen de Finanzas desde Supabase, se usa el cálculo local:', err.message || err);
    }
    return calcFinanzasLocal();
  }

  function nombreJornada(id) {
    if (!id) return null;
    const j = jornadas.find(x => x.id === id);
    if (j) return j.nombre;
    if (jornadasEliminadasPorId.has(id)) return jornadasEliminadasPorId.get(id);
    return '(jornada eliminada)';
  }

  function jornadaOptionsHTML(selectedId) {
    const ordenadas = jornadas.slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    return '<option value="">— Sin jornada —</option>' + ordenadas.map(j =>
      `<option value="${j.id}" ${j.id === selectedId ? 'selected' : ''}>${esc(j.nombre)} (${fecha(j.fecha)})</option>`
    ).join('');
  }

  // Selector de Jornada del formulario de Pedido (Jornada híbrida): elegir un evento autocompleta
  // y bloquea fecha_entrega con la fecha de ese evento (ver actualizarBloqueoFechaPedido). El día
  // normal se resuelve solo (ver resolverOCrearJornadaVentaRegular) cuando el selector queda en el
  // placeholder. Oculta Eventos ya PASADOS (respecto a hoy) para no llenar la lista de historial
  // viejo -- salvo que su fecha coincida con la Fecha de entrega actual del formulario (por si se
  // está registrando a propósito un pedido atrasado de un Evento puntual). Los eventos futuros
  // nunca se ocultan, así siempre se pueden elegir por nombre sin importar qué fecha haya en el
  // formulario en ese momento; se recalcula cada vez que cambia "Fecha de entrega" (ver el
  // listener de pedidoFecha más abajo).
  function jornadaOptionsHTMLEventosVigentes(fechaFormulario, selectedId) {
    const hoy = new Date().toISOString().slice(0, 10);
    const eventos = jornadas
      .filter(j => j.tipo === 'evento' && (j.fecha >= hoy || j.fecha === fechaFormulario))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    return '<option value="">— Día normal (automático) —</option>' + eventos.map(j =>
      `<option value="${j.id}" ${j.id === selectedId ? 'selected' : ''}>${esc(j.nombre)} (${fecha(j.fecha)})</option>`
    ).join('');
  }

  // Selector de Jornada, variante para Venta de mostrador: solo eventos de ESA fecha de
  // entrega puntual (no el historial completo como jornadaOptionsHTMLEventos) -- tiene más
  // sentido acá porque la fecha ya está fija (bloqueada al crear, o la que se esté editando).
  function jornadaOptionsHTMLEventosDelDia(fechaEntrega, selectedId) {
    const eventosDelDia = jornadas
      .filter(j => j.tipo === 'evento' && j.fecha === fechaEntrega)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    return '<option value="">— Día normal (automático) —</option>' + eventosDelDia.map(j =>
      `<option value="${j.id}" ${j.id === selectedId ? 'selected' : ''}>${esc(j.nombre)}</option>`
    ).join('');
  }

  // ---------------- Resumen ----------------
  // Token de secuencia: calcFinanzas() depende de una consulta de red (vista "resumen"), así
  // que si esta función se dispara dos veces seguidas, las respuestas pueden llegar
  // desordenadas. Sin esto, la respuesta más vieja podría pintarse después de la más nueva y
  // dejar la pantalla mostrando un número desactualizado hasta la próxima acción. Con el
  // token, solo se aplica al DOM la respuesta de la llamada más reciente que se haya disparado.
  let statsFinanzasToken = 0;
  async function renderStatsFinanzas() {
    const miToken = ++statsFinanzasToken;
    const f = await calcFinanzas();
    if (miToken !== statsFinanzasToken) return;
    document.getElementById('statsFinanzas').innerHTML = `
      <div class="stat-card"><div class="stat-value">${money(f.capitalNeto)}</div><div class="stat-label">Capital invertido</div></div>
      <div class="stat-card"><div class="stat-value">${money(f.gastoTotalGeneral)}</div><div class="stat-label">Capital usado (gastos)</div></div>
      <div class="stat-card"><div class="stat-value">${money(f.ingresoTotalGeneral)}</div><div class="stat-label">Ingresos totales</div></div>
      <div class="stat-card"><div class="stat-value">${money(f.utilidadNeta)}</div><div class="stat-label">Utilidad neta</div></div>
      <div class="stat-card"><div class="stat-value">${money(f.saldoDisponible)}</div><div class="stat-label">Saldo disponible</div></div>
    `;
  }

  // ---------------- Jornadas / Eventos ----------------
  let detalleJornadaActualId = null;
  // id de la Jornada cuando "+ Agregar gasto" se abrió DESDE el modal de detalle de esa Jornada
  // (no desde la pestaña Gastos normal) -- null en cualquier otro caso. Se usa para preseleccionar
  // y bloquear el selector de Jornada del formulario, y para saber a qué Jornada volver (refrescada)
  // al guardar o cancelar.
  let gastoDesdeJornadaId = null;

  function renderJornadas() {
    const term = document.getElementById('buscarJornada').value.trim().toLowerCase();
    const filtradas = jornadas.filter(j => !term || j.nombre.toLowerCase().includes(term))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    document.getElementById('cardsJornadas').innerHTML = filtradas.map(j => {
      const c = calcJornada(j);
      return `
        <div class="recipe-card" data-open-jornada="${j.id}">
          <div class="recipe-card-head">
            <div>
              <h3>${esc(j.nombre)}</h3>
              <div class="recipe-card-cat">${j.tipo === 'evento' ? 'Evento / catering' : 'Venta regular'} · ${fecha(j.fecha)}</div>
            </div>
            <span class="badge ${c.utilidad >= 0 ? 'badge-good' : 'badge-bad'}">${money(c.utilidad)}</span>
          </div>
          <div class="recipe-card-metrics">
            <div>Ingreso<b>${money(c.ingresoTotal)}</b></div>
            <div>Gasto<b>${money(c.gastoTotal)}</b></div>
            <div>Utilidad<b>${money(c.utilidad)}</b></div>
          </div>
          <div class="recipe-card-actions">
            <button class="btn-icon" title="Exportar reporte" data-reporte-jornada="${j.id}">🖨</button>
            <button class="btn-icon" title="Editar" data-edit-jornada="${j.id}">✎</button>
            <button class="btn-icon danger" title="Eliminar" data-del-jornada="${j.id}">🗑</button>
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('emptyJornadas').hidden = jornadas.length !== 0;

    document.querySelectorAll('#cardsJornadas [data-open-jornada]').forEach(card =>
      card.addEventListener('click', e => {
        if (e.target.closest('[data-edit-jornada],[data-del-jornada],[data-reporte-jornada]')) return;
        abrirDetalleJornada(card.getAttribute('data-open-jornada'));
      }));
    document.querySelectorAll('#cardsJornadas [data-edit-jornada]').forEach(b =>
      b.addEventListener('click', () => openJornadaModal(b.getAttribute('data-edit-jornada'))));
    document.querySelectorAll('#cardsJornadas [data-del-jornada]').forEach(b =>
      b.addEventListener('click', () => deleteJornada(b.getAttribute('data-del-jornada'))));
    document.querySelectorAll('#cardsJornadas [data-reporte-jornada]').forEach(b =>
      b.addEventListener('click', () => generarReporteJornada(b.getAttribute('data-reporte-jornada'))));
  }

  document.getElementById('buscarJornada').addEventListener('input', renderJornadas);
  document.getElementById('btnNuevaJornada').addEventListener('click', () => openJornadaModal(null));

  const tbodyPlanJornada = document.getElementById('tbodyPlanJornada');

  function addPlanJornadaRow(linea) {
    if (!recetas.length) {
      showToast('Primero crea al menos una receta en la pestaña Recetas.');
      return;
    }
    const tr = document.createElement('tr');
    tr.className = 'plan-jornada-row';
    const firstRecetaId = linea ? linea.recetaId : recetas[0].id;
    tr.innerHTML = `
      <td><select class="plan-receta">${recetaOptionsHTML(firstRecetaId)}</select></td>
      <td><input type="number" class="plan-cantidad" min="1" step="1" value="${linea ? linea.cantidadPlaneada : 1}"></td>
      <td class="col-actions"><button type="button" class="btn-icon danger" title="Quitar">🗑</button></td>
    `;
    tbodyPlanJornada.appendChild(tr);
    tr.querySelector('.btn-icon').addEventListener('click', () => tr.remove());
  }
  document.getElementById('btnAgregarPlanJornada').addEventListener('click', () => addPlanJornadaRow(null));

  function readPlanJornadaRows() {
    return Array.from(tbodyPlanJornada.querySelectorAll('.plan-jornada-row'))
      .map(tr => ({
        recetaId: tr.querySelector('.plan-receta').value,
        cantidadPlaneada: Number(tr.querySelector('.plan-cantidad').value) || 0,
      }))
      .filter(l => l.cantidadPlaneada > 0);
  }

  function openJornadaModal(id) {
    const form = document.getElementById('formJornada');
    form.reset();
    tbodyPlanJornada.innerHTML = '';
    if (id) {
      const j = jornadas.find(x => x.id === id);
      document.getElementById('modalJornadaTitulo').textContent = 'Editar jornada';
      document.getElementById('jornadaId').value = j.id;
      document.getElementById('jornadaNombre').value = j.nombre;
      document.getElementById('jornadaTipo').value = j.tipo || 'venta_regular';
      document.getElementById('jornadaFecha').value = j.fecha || '';
      document.getElementById('jornadaNotas').value = j.notas || '';
      document.getElementById('jornadaIncluirEnAnalisis').checked = j.incluirEnAnalisis !== false;
      (j.plan || []).forEach(linea => addPlanJornadaRow(linea));
    } else {
      document.getElementById('modalJornadaTitulo').textContent = 'Nueva jornada';
      document.getElementById('jornadaId').value = '';
      document.getElementById('jornadaIncluirEnAnalisis').checked = true;
    }
    openModal('modalJornada');
  }

  document.getElementById('formJornada').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('jornadaId').value;
    const data = {
      nombre: document.getElementById('jornadaNombre').value.trim() || '(sin nombre)',
      tipo: document.getElementById('jornadaTipo').value,
      fecha: document.getElementById('jornadaFecha').value,
      // ingresoManual ya no tiene campo en el formulario -- lo reemplaza Venta de mostrador
      // (pedidos con es_mostrador=true). Se sigue mandando 0 explícito para no romper
      // calcJornada/guardar_jornada_completa, que todavía leen este campo.
      ingresoManual: 0,
      notas: document.getElementById('jornadaNotas').value.trim(),
      incluirEnAnalisis: document.getElementById('jornadaIncluirEnAnalisis').checked,
    };
    const plan = readPlanJornadaRows();
    const btnGuardar = document.querySelector('#formJornada button[type="submit"]');
    btnGuardar.disabled = true;
    try {
      if (id) {
        if (esUuid(id)) await guardarJornadaCompletaEnSupabase(id, data, plan);
        const j = jornadas.find(x => x.id === id);
        Object.assign(j, data, { plan });
        showToast('Jornada actualizada');
      } else {
        const nuevoId = crypto.randomUUID();
        await guardarJornadaCompletaEnSupabase(nuevoId, data, plan);
        jornadas.push({ id: nuevoId, ...data, plan });
        showToast('Jornada creada');
      }
      saveJornadas();
      renderJornadas();
      renderStatsFinanzas();
      renderPedidos(); // el plan de esta jornada puede afectar la tarjeta "Vendido / planeado" de Pedidos
      closeModal('modalJornada');
    } catch (err) {
      console.error(err);
      showToast(`No se pudo guardar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
    } finally {
      btnGuardar.disabled = false;
    }
  });

  async function deleteJornada(id) {
    const j = jornadas.find(x => x.id === id);
    const nPedidos = pedidos.filter(p => p.jornadaId === id).length;
    const nGastos = gastos.filter(g => g.jornadaId === id).length;
    const partes = [];
    if (nPedidos) partes.push(`${nPedidos} pedido(s)`);
    if (nGastos) partes.push(`${nGastos} gasto(s)`);
    const msg = partes.length
      ? `Esta jornada tiene ${partes.join(' y ')} vinculados. Si la eliminas, quedarán sin jornada asignada. ¿Eliminar de todas formas?`
      : `¿Eliminar la jornada "${j.nombre}"?`;
    if (!confirm(msg)) return;
    // una jornada con id viejo (uid() local) nunca existió en Supabase — se salta la llamada
    // y se borra 100% local, mismo criterio que ya usan Clientes/la Papelera (ver esUuid()).
    if (esUuid(id)) {
      try {
        await marcarJornadaEliminadaEnSupabase(id);
      } catch (err) {
        console.error(err);
        showToast(`No se pudo eliminar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
        return;
      }
      // así renderGastos() (justo abajo) ya puede mostrar el nombre real + "Eliminado" sin
      // esperar al próximo refresh — mismo fix que ya hicimos para Recetas/Clientes.
      jornadasEliminadasPorId.set(id, j.nombre);
    }
    moverAPapelera('jornadas', j);
    jornadas = jornadas.filter(x => x.id !== id);
    saveJornadas();
    renderJornadas();
    renderGastos();
    renderStatsFinanzas();
    renderPedidos();
    showToast('Jornada eliminada (puedes restaurarla desde la Papelera)');
  }

  // agrega por receta la cantidad/monto vendido dentro de una lista de pedidos ya filtrada
  // (pensada para c.pedidosVinculados de calcJornada) -- compartido entre el detalle de
  // Jornada en pantalla y el PDF de "Exportar reporte", para que nunca puedan desalinearse.
  function resumenPorPlatoDeJornada(pedidosVinculados) {
    const mapa = new Map(); // recetaId (o clave sintética) -> {nombre, papelera, cantidad, monto}
    pedidosVinculados.forEach(p => {
      calcPedido(p).items.forEach(it => {
        const clave = it.recetaId || `sin-receta:${it.nombre}`;
        const actual = mapa.get(clave) || { nombre: it.nombre, papelera: it.papelera, cantidad: 0, monto: 0 };
        actual.cantidad += it.cantidad || 0;
        actual.monto += it.subtotal;
        mapa.set(clave, actual);
      });
    });
    const resumenPlatos = Array.from(mapa.values()).sort((a, b) => b.monto - a.monto);
    const totalGeneralPlatos = resumenPlatos.reduce((s, v) => s + v.monto, 0);
    return { resumenPlatos, totalGeneralPlatos };
  }

  function abrirDetalleJornada(id) {
    detalleJornadaActualId = id;
    const j = jornadas.find(x => x.id === id);
    const c = calcJornada(j);
    document.getElementById('detalleJornadaTitulo').textContent = j.nombre;

    const tablaPedidosHTML = c.pedidosVinculados.length ? `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Cliente</th><th>Platos</th><th>Entrega</th><th>Total</th></tr></thead>
          <tbody>
            ${c.pedidosVinculados.map(p => {
              const cliente = clienteDePedido(p);
              const cp = calcPedido(p);
              // mismo formato que la columna "Platos" de la tabla de Pedidos: un plato por línea
              const platosTxt = cp.items.map(i => `${i.cantidad}x ${esc(i.nombre)}${i.papelera ? etiquetaEnPapeleraHTML(false) : ''}`).join('<br>');
              return `
              <tr>
                <td>${esc(cliente.nombre)}${cliente.papelera ? etiquetaEnPapeleraHTML(false) : ''}</td>
                <td class="pedido-platos">${platosTxt}</td>
                <td>${fechaHoraEntrega(p)}</td>
                <td>${money(cp.total)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    ` : '<p class="detail-texto">No hay pedidos vinculados a esta jornada.</p>';

    // Resumen por plato de esta Jornada -- se arma a partir de los MISMOS pedidos que ya cuentan
    // para "Ingresos" (c.pedidosVinculados: pagados y no cancelados), para que el "Total general"
    // de acá coincida siempre con el "Ingresos (Bs X)" del encabezado de la sección, sin importar
    // qué criterio se use en otras partes de la app. Factorizado en resumenPorPlatoDeJornada()
    // para reusarlo tal cual en el PDF de "Exportar reporte".
    const { resumenPlatos, totalGeneralPlatos } = resumenPorPlatoDeJornada(c.pedidosVinculados);
    const resumenPlatosHTML = resumenPlatos.length ? `
      <div style="font-size:11.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--text-muted);margin:14px 0 6px">Resumen por plato</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Plato</th><th>Cantidad</th><th>Monto</th></tr></thead>
          <tbody>
            ${resumenPlatos.map(v => `
              <tr>
                <td>${esc(v.nombre)}${v.papelera ? etiquetaEnPapeleraHTML(false) : ''}</td>
                <td>${v.cantidad}</td>
                <td>${money(v.monto)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr><td>Total general</td><td></td><td>${money(totalGeneralPlatos)}</td></tr>
          </tfoot>
        </table>
      </div>
    ` : '';

    const tablaGastosHTML = c.gastosVinculados.length ? `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Fecha</th><th>Categoría</th><th>Concepto</th><th>Monto</th></tr></thead>
          <tbody>
            ${c.gastosVinculados.map(g => `
              <tr>
                <td>${fecha(g.fecha)}</td>
                <td>${esc(g.categoria) || '—'}</td>
                <td>${esc(g.concepto)}</td>
                <td>${money(g.monto)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    ` : '<p class="detail-texto">No hay gastos vinculados a esta jornada.</p>';

    // Donaciones -- solo tiene sentido en Jornadas tipo 'evento' (la sección entera se omite
    // para 'venta_regular', ver más abajo). A diferencia de la tabla de Gastos de acá arriba
    // (de solo lectura, se editan desde la pestaña Gastos), las donaciones SÍ tienen
    // editar/eliminar acá mismo -- no existe ninguna otra pantalla donde gestionarlas.
    const tablaDonacionesHTML = c.donacionesVinculadas.length ? `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th><th class="col-actions">Acciones</th></tr></thead>
          <tbody>
            ${c.donacionesVinculadas.map(d => `
              <tr>
                <td>${fecha(d.fecha)}</td>
                <td>${esc(d.concepto)}</td>
                <td>${money(d.monto)}</td>
                <td class="col-actions">
                  <button class="btn-icon" title="Editar" data-edit-donacion="${d.id}">✎</button>
                  <button class="btn-icon danger" title="Eliminar" data-del-donacion="${d.id}">🗑</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    ` : '<p class="detail-texto">No hay donaciones registradas para esta jornada.</p>';

    const tablaPlanHTML = c.plan.length ? `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Plato</th><th>Vendido</th><th>Planeado</th></tr></thead>
          <tbody>
            ${c.plan.map(l => `
              <tr>
                <td>${esc(l.nombre)}${l.papelera ? etiquetaEnPapeleraHTML(false) : ''}</td>
                <td class="${l.vendido >= l.cantidadPlaneada ? 'badge-good' : ''}">${l.vendido}</td>
                <td>${l.cantidadPlaneada}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    ` : '<p class="detail-texto">Esta jornada no tiene planificación de platos. Edítala para agregar cuántas unidades planeas vender de cada plato.</p>';

    document.getElementById('detalleJornadaContenido').innerHTML = `
      ${seccionColapsableHTML(`Ingresos (${money(c.ingresoTotal)})`, `
        ${tablaPedidosHTML}
        ${resumenPlatosHTML}
      `)}
      ${seccionColapsableHTML(`Gastos (${money(c.gastoTotal)})`, tablaGastosHTML, '<button type="button" class="btn btn-ghost btn-sm" id="btnAgregarGastoDesdeJornada">+ Agregar gasto</button>')}
      ${j.tipo === 'evento' ? seccionColapsableHTML(`Donaciones (${money(c.ingresoDonaciones)})`, tablaDonacionesHTML, '<button type="button" class="btn btn-ghost btn-sm" id="btnAgregarDonacionDesdeJornada">+ Agregar donación</button>') : ''}
      ${seccionColapsableHTML('Planificación de platos (vendido / planeado)', tablaPlanHTML)}
      <div class="summary-panel" style="margin-top:0">
        <div class="summary-item"><div class="summary-label">Ingreso total</div><div class="summary-value">${money(c.ingresoTotal)}</div></div>
        <div class="summary-item"><div class="summary-label">Gasto total</div><div class="summary-value">${money(c.gastoTotal)}</div></div>
        <div class="summary-item highlight"><div class="summary-label">Utilidad</div><div class="summary-value">${money(c.utilidad)}</div></div>
      </div>
      ${j.notas ? `<div class="detail-section"><h4>Notas</h4><p class="detail-texto">${esc(j.notas)}</p></div>` : ''}
    `;

    document.querySelectorAll('#detalleJornadaContenido [data-toggle-seccion]').forEach(header => {
      header.addEventListener('click', e => {
        if (e.target.closest('[data-accion-seccion]')) return; // no colapsar al clickear un botón de acción del encabezado
        header.closest('.detail-section').classList.toggle('colapsado');
      });
    });
    const btnAgregarGasto = document.getElementById('btnAgregarGastoDesdeJornada');
    if (btnAgregarGasto) {
      btnAgregarGasto.addEventListener('click', () => {
        gastoDesdeJornadaId = id;
        document.getElementById('modalDetalleJornada').hidden = true;
        openGastoModal(null);
      });
    }
    const btnAgregarDonacion = document.getElementById('btnAgregarDonacionDesdeJornada');
    if (btnAgregarDonacion) {
      btnAgregarDonacion.addEventListener('click', () => openDonacionModal(null));
    }
    document.querySelectorAll('#detalleJornadaContenido [data-edit-donacion]').forEach(b =>
      b.addEventListener('click', () => openDonacionModal(b.getAttribute('data-edit-donacion'))));
    document.querySelectorAll('#detalleJornadaContenido [data-del-donacion]').forEach(b =>
      b.addEventListener('click', () => deleteDonacion(b.getAttribute('data-del-donacion'))));

    openModal('modalDetalleJornada');
  }
  document.getElementById('btnEditarDesdeDetalleJornada').addEventListener('click', () => {
    closeModal('modalDetalleJornada');
    openJornadaModal(detalleJornadaActualId);
  });
  document.getElementById('btnExportarReporteJornada').addEventListener('click', () => {
    generarReporteJornada(detalleJornadaActualId);
  });

  // ---------------- Donaciones (solo se gestionan desde el detalle de una Jornada evento) ----------------
  function openDonacionModal(id) {
    const form = document.getElementById('formDonacion');
    form.reset();
    if (id) {
      const d = donaciones.find(x => x.id === id);
      document.getElementById('modalDonacionTitulo').textContent = 'Editar donación';
      document.getElementById('donacionId').value = d.id;
      document.getElementById('donacionConcepto').value = d.concepto;
      document.getElementById('donacionMonto').value = d.monto;
      document.getElementById('donacionFecha').value = d.fecha || '';
    } else {
      document.getElementById('modalDonacionTitulo').textContent = 'Nueva donación';
      document.getElementById('donacionId').value = '';
      document.getElementById('donacionFecha').value = new Date().toISOString().slice(0, 10);
    }
    document.getElementById('modalDetalleJornada').hidden = true;
    openModal('modalDonacion');
  }

  document.getElementById('formDonacion').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('donacionId').value;
    const data = {
      jornadaId: detalleJornadaActualId,
      concepto: document.getElementById('donacionConcepto').value.trim().toUpperCase() || '(sin concepto)',
      monto: parseFloat(document.getElementById('donacionMonto').value) || 0,
      fecha: document.getElementById('donacionFecha').value,
    };
    const btnGuardar = document.querySelector('#formDonacion button[type="submit"]');
    btnGuardar.disabled = true;
    try {
      if (id) {
        if (esUuid(id)) await actualizarDonacionEnSupabase(id, data);
        const d = donaciones.find(x => x.id === id);
        Object.assign(d, data);
        showToast('Donación actualizada');
      } else {
        const nuevoId = crypto.randomUUID();
        await crearDonacionEnSupabase(nuevoId, data);
        donaciones.push({ id: nuevoId, ...data });
        showToast('Donación creada');
      }
      saveDonaciones();
      closeModal('modalDonacion');
      abrirDetalleJornada(detalleJornadaActualId); // refresca Donaciones/Ingreso total/Utilidad
    } catch (err) {
      console.error(err);
      showToast(`No se pudo guardar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
    } finally {
      btnGuardar.disabled = false;
    }
  });

  async function deleteDonacion(id) {
    const d = donaciones.find(x => x.id === id);
    if (!confirm(`¿Eliminar la donación "${d.concepto}"?`)) return;
    if (esUuid(id)) {
      try {
        await marcarDonacionEliminadaEnSupabase(id);
      } catch (err) {
        console.error(err);
        showToast(`No se pudo eliminar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
        return;
      }
    }
    moverAPapelera('donaciones', d);
    donaciones = donaciones.filter(x => x.id !== id);
    saveDonaciones();
    abrirDetalleJornada(detalleJornadaActualId); // refresca Donaciones/Ingreso total/Utilidad
    showToast('Donación eliminada (puedes restaurarla desde la Papelera)');
  }

  // Reporte PDF completo de una Jornada -- mismo mecanismo que el resto de los PDF de la app
  // (window.open + document.write + print), mismo encabezado de marca (datosMarcaApp()) y
  // mismo criterio "table-layout:fixed + overflow-wrap" para no desbordar en A4.
  function generarReporteJornada(jornadaId) {
    const j = jornadas.find(x => x.id === jornadaId);
    if (!j) return;
    const c = calcJornada(j);
    const marca = datosMarcaApp();
    const { resumenPlatos, totalGeneralPlatos } = resumenPorPlatoDeJornada(c.pedidosVinculados);

    const tablaIngresosHTML = c.pedidosVinculados.length ? `
      <table>
        <thead><tr><th>Cliente</th><th>Platos</th><th>Entrega</th><th class="num">Total</th></tr></thead>
        <tbody>
          ${c.pedidosVinculados.map(p => {
            const cliente = clienteDePedido(p);
            const cp = calcPedido(p);
            const platosTxt = cp.items.map(i => `${i.cantidad}x ${esc(i.nombre)}${i.papelera ? etiquetaEnPapeleraHTML(true) : ''}`).join('<br>');
            return `
            <tr>
              <td>${esc(cliente.nombre)}${cliente.papelera ? etiquetaEnPapeleraHTML(true) : ''}</td>
              <td>${platosTxt}</td>
              <td>${fechaHoraEntrega(p)}</td>
              <td class="num">${money(cp.total)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    ` : '<p class="nota">No hay pedidos vinculados a esta jornada.</p>';

    const resumenPlatosHTML = resumenPlatos.length ? `
      <table>
        <thead><tr><th>Plato</th><th class="num">Cantidad</th><th class="num">Monto</th></tr></thead>
        <tbody>
          ${resumenPlatos.map(v => `
            <tr>
              <td>${esc(v.nombre)}${v.papelera ? etiquetaEnPapeleraHTML(true) : ''}</td>
              <td class="num">${v.cantidad}</td>
              <td class="num">${money(v.monto)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr><td>Total general</td><td></td><td class="num">${money(totalGeneralPlatos)}</td></tr>
        </tfoot>
      </table>
    ` : '<p class="nota">No hay platos vendidos en esta jornada.</p>';

    const donacionesHTML = (j.tipo === 'evento' && c.donacionesVinculadas.length) ? `
      <h3>Donaciones (${money(c.ingresoDonaciones)})</h3>
      <table>
        <thead><tr><th>Fecha</th><th>Concepto</th><th class="num">Monto</th></tr></thead>
        <tbody>
          ${c.donacionesVinculadas.map(d => `
            <tr><td>${fecha(d.fecha)}</td><td>${esc(d.concepto)}</td><td class="num">${money(d.monto)}</td></tr>`).join('')}
        </tbody>
      </table>
    ` : '';

    const tablaGastosHTML = c.gastosVinculados.length ? `
      <table>
        <thead><tr><th>Fecha</th><th>Categoría</th><th>Concepto</th><th class="num">Monto</th></tr></thead>
        <tbody>
          ${c.gastosVinculados.map(g => `
            <tr><td>${fecha(g.fecha)}</td><td>${esc(g.categoria) || '—'}</td><td>${esc(g.concepto)}</td><td class="num">${money(g.monto)}</td></tr>`).join('')}
        </tbody>
      </table>
    ` : '<p class="nota">No hay gastos vinculados a esta jornada.</p>';

    const tablaPlanHTML = c.plan.length ? `
      <table>
        <thead><tr><th>Plato</th><th class="num">Vendido</th><th class="num">Planeado</th></tr></thead>
        <tbody>
          ${c.plan.map(l => `
            <tr><td>${esc(l.nombre)}${l.papelera ? etiquetaEnPapeleraHTML(true) : ''}</td><td class="num">${l.vendido}</td><td class="num">${l.cantidadPlaneada}</td></tr>`).join('')}
        </tbody>
      </table>
    ` : '';

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Reporte — ${esc(j.nombre)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#222;padding:16px;margin:0}
  .marca-pdf{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .marca-pdf-icono{font-size:26px;line-height:1;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
  .marca-pdf-icono img{width:32px;height:32px;object-fit:contain}
  h1{font-size:18px;margin:0}
  .marca-pdf .subtitulo-marca{font-size:11px;color:#777;margin:1px 0 0}
  .subtitulo{font-size:13px;color:#444;margin:0 0 18px;font-weight:700}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.03em;color:#555;margin:20px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}
  h3{font-size:12px;margin:10px 0 6px}
  table{width:100%;border-collapse:collapse;font-size:10.5px;table-layout:fixed;margin-bottom:6px}
  th,td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:break-word;word-break:break-word}
  th{background:#f0f0f0}
  td.num,th.num{text-align:right}
  tfoot td{font-weight:bold;background:#f7f7f7}
  .nota{font-size:11px;color:#777;margin:0 0 10px}
  .resumen-stats{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 6px}
  .stat-box{border:1px solid #ccc;border-radius:6px;padding:8px 12px;min-width:110px}
  .stat-box .stat-valor{font-size:16px;font-weight:800}
  .stat-box .stat-label{font-size:9px;text-transform:uppercase;color:#777;letter-spacing:.02em;margin-top:2px}
  @media print{ body{padding:0} }
</style>
</head>
<body>
  <div class="marca-pdf">
    <span class="marca-pdf-icono">${marca.iconoHTML}</span>
    <div>
      <h1>${esc(marca.nombre)}</h1>
      <p class="subtitulo-marca">${esc(marca.subtitulo)}</p>
    </div>
  </div>
  <p class="subtitulo">${esc(j.nombre)} · ${fecha(j.fecha)} · ${j.tipo === 'evento' ? 'Evento / catering' : 'Venta regular'}</p>

  <div class="resumen-stats">
    <div class="stat-box"><div class="stat-valor">${money(c.ingresoTotal)}</div><div class="stat-label">Ingreso total</div></div>
    <div class="stat-box"><div class="stat-valor">${money(c.gastoTotal)}</div><div class="stat-label">Gasto total</div></div>
    <div class="stat-box"><div class="stat-valor">${money(c.utilidad)}</div><div class="stat-label">Utilidad</div></div>
  </div>

  <h2>Ingresos (${money(c.ingresoTotal)})</h2>
  ${tablaIngresosHTML}

  <h2>Resumen por plato</h2>
  ${resumenPlatosHTML}

  ${donacionesHTML}

  <h2>Gastos (${money(c.gastoTotal)})</h2>
  ${tablaGastosHTML}

  ${c.plan.length ? `<h2>Planificación de platos (vendido / planeado)</h2>${tablaPlanHTML}` : ''}
</body>
</html>`;

    const ventana = window.open('', '_blank');
    if (!ventana) { showToast('El navegador bloqueó la ventana. Permite pop-ups para exportar el PDF.'); return; }
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
    setTimeout(() => { try { ventana.focus(); ventana.print(); } catch (e) {} }, 300);
  }

  // ---------------- Gastos ----------------
  function renderStatsGastos(filtrados) {
    const total = filtrados.reduce((s, g) => s + (g.monto || 0), 0);
    document.getElementById('statsGastos').innerHTML = `
      <div class="stat-card"><div class="stat-value">${filtrados.length}</div><div class="stat-label">Gastos</div></div>
      <div class="stat-card"><div class="stat-value">${money(total)}</div><div class="stat-label">Total gastado</div></div>
    `;
  }

  // igual que insumosFiltrados()/clientesFiltrados(): un solo criterio de filtrado (buscador +
  // rango de fechas) compartido entre la tabla en pantalla, la tarjeta de total y el PDF.
  function gastosFiltrados() {
    const term = document.getElementById('buscarGasto').value.trim().toLowerCase();
    const desde = document.getElementById('gastosFiltroDesde').value;
    const hasta = document.getElementById('gastosFiltroHasta').value;
    return gastos.filter(g => {
      if (desde && g.fecha < desde) return false;
      if (hasta && g.fecha > hasta) return false;
      if (!term) return true;
      return g.concepto.toLowerCase().includes(term) || (g.categoria || '').toLowerCase().includes(term);
    }).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  }

  function renderGastos() {
    const filtrados = gastosFiltrados();

    document.getElementById('tbodyGastos').innerHTML = filtrados.map(g => `
      <tr>
        <td class="cell-muted">${fecha(g.fecha)}</td>
        <td>${esc(g.categoria) || '<span class="cell-muted">Sin categoría</span>'}</td>
        <td>${esc(g.concepto)}</td>
        <td>${g.jornadaId ? esc(nombreJornada(g.jornadaId)) + (jornadasEliminadasPorId.has(g.jornadaId) ? etiquetaEnPapeleraHTML(false) : '') : '<span class="cell-muted">General</span>'}</td>
        <td>${money(g.monto)}</td>
        <td class="col-actions">
          <button class="btn-icon" title="Editar" data-edit-gasto="${g.id}">✎</button>
          <button class="btn-icon danger" title="Eliminar" data-del-gasto="${g.id}">🗑</button>
        </td>
      </tr>
    `).join('');

    document.getElementById('emptyGastos').hidden = filtrados.length !== 0;
    document.getElementById('emptyGastos').textContent = gastos.length === 0
      ? 'No hay gastos registrados todavía. Crea el primero con "+ Nuevo gasto".'
      : 'No hay gastos que coincidan con la búsqueda o el filtro de fecha.';
    renderStatsGastos(filtrados);

    document.querySelectorAll('#tbodyGastos [data-edit-gasto]').forEach(b =>
      b.addEventListener('click', () => openGastoModal(b.getAttribute('data-edit-gasto'))));
    document.querySelectorAll('#tbodyGastos [data-del-gasto]').forEach(b =>
      b.addEventListener('click', () => deleteGasto(b.getAttribute('data-del-gasto'))));
  }

  function generarPDFGastos() {
    const lista = gastosFiltrados();
    const term = document.getElementById('buscarGasto').value.trim();
    const desde = document.getElementById('gastosFiltroDesde').value;
    const hasta = document.getElementById('gastosFiltroHasta').value;
    const totalGeneral = lista.reduce((s, g) => s + (g.monto || 0), 0);

    const filasHTML = lista.map(g => `
      <tr>
        <td>${fecha(g.fecha)}</td>
        <td>${esc(g.categoria) || '—'}</td>
        <td>${esc(g.concepto)}</td>
        <td>${g.jornadaId ? esc(nombreJornada(g.jornadaId)) + (jornadasEliminadasPorId.has(g.jornadaId) ? etiquetaEnPapeleraHTML(true) : '') : 'General'}</td>
        <td class="num">${money(g.monto)}</td>
      </tr>
    `).join('');

    const marca = datosMarcaApp();
    const rangoTxt = desde && hasta ? `${fecha(desde + 'T00:00:00')} al ${fecha(hasta + 'T00:00:00')}` : (desde ? `desde ${fecha(desde + 'T00:00:00')}` : (hasta ? `hasta ${fecha(hasta + 'T00:00:00')}` : 'Todo el historial'));

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Gastos — ${esc(marca.nombre)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#222;padding:16px;margin:0}
  .marca-pdf{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .marca-pdf-icono{font-size:26px;line-height:1;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
  .marca-pdf-icono img{width:32px;height:32px;object-fit:contain}
  h1{font-size:18px;margin:0}
  .marca-pdf .subtitulo-marca{font-size:11px;color:#777;margin:1px 0 0}
  .subtitulo{font-size:12px;color:#666;margin:0 0 18px}
  table{width:100%;border-collapse:collapse;font-size:10.5px;table-layout:fixed}
  th,td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:break-word;word-break:break-word}
  th{background:#f0f0f0}
  td.num,th.num{text-align:right}
  tfoot td{font-weight:bold;background:#f7f7f7}
  @media print{ body{padding:0} }
</style>
</head>
<body>
  <div class="marca-pdf">
    <span class="marca-pdf-icono">${marca.iconoHTML}</span>
    <div>
      <h1>${esc(marca.nombre)}</h1>
      <p class="subtitulo-marca">${esc(marca.subtitulo)}</p>
    </div>
  </div>
  <p class="subtitulo">Gastos · Rango: ${rangoTxt}${term ? ` · Filtro: "${esc(term)}"` : ''} · ${lista.length} gasto(s) · Generado ${new Date().toLocaleString('es-CO')}</p>
  <table>
    <thead>
      <tr><th>Fecha</th><th>Categoría</th><th>Concepto</th><th>Jornada</th><th class="num">Monto</th></tr>
    </thead>
    <tbody>${filasHTML}</tbody>
    <tfoot>
      <tr><td colspan="4">Total general</td><td class="num">${money(totalGeneral)}</td></tr>
    </tfoot>
  </table>
</body>
</html>`;

    const ventana = window.open('', '_blank');
    if (!ventana) { showToast('El navegador bloqueó la ventana. Permite pop-ups para exportar el PDF.'); return; }
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
    setTimeout(() => { try { ventana.focus(); ventana.print(); } catch (e) {} }, 300);
  }
  document.getElementById('btnExportarGastosPDF').addEventListener('click', generarPDFGastos);

  document.getElementById('buscarGasto').addEventListener('input', renderGastos);
  document.getElementById('gastosFiltroDesde').addEventListener('input', renderGastos);
  document.getElementById('gastosFiltroHasta').addEventListener('input', renderGastos);
  document.getElementById('btnLimpiarFiltroGastos').addEventListener('click', () => {
    document.getElementById('gastosFiltroDesde').value = '';
    document.getElementById('gastosFiltroHasta').value = '';
    renderGastos();
  });
  document.getElementById('btnNuevoGasto').addEventListener('click', () => openGastoModal(null));
  document.getElementById('btnCategoriasGasto').addEventListener('click', () => openCategoriasModal('gasto'));

  function openGastoModal(id) {
    const form = document.getElementById('formGasto');
    form.reset();
    const selectJornada = document.getElementById('gastoJornada');
    selectJornada.disabled = false; // por si quedó bloqueado de un uso anterior desde el detalle de una Jornada
    populateCategoriaSelect(document.getElementById('gastoCategoria'), categoriasGastos, id ? gastos.find(x => x.id === id).categoria : '');
    selectJornada.innerHTML = jornadaOptionsHTML(id ? gastos.find(x => x.id === id).jornadaId : null);
    if (id) {
      const g = gastos.find(x => x.id === id);
      document.getElementById('modalGastoTitulo').textContent = 'Editar gasto';
      document.getElementById('gastoId').value = g.id;
      document.getElementById('gastoFecha').value = g.fecha || '';
      document.getElementById('gastoCategoria').value = g.categoria || '';
      document.getElementById('gastoConcepto').value = g.concepto;
      document.getElementById('gastoMonto').value = g.monto;
      selectJornada.value = g.jornadaId || '';
    } else {
      document.getElementById('modalGastoTitulo').textContent = 'Nuevo gasto';
      document.getElementById('gastoId').value = '';
      document.getElementById('gastoFecha').value = new Date().toISOString().slice(0, 10);
      // "+ Agregar gasto" desde el detalle de una Jornada: la deja preseleccionada y bloqueada --
      // si quiere vincularlo a otra Jornada, que lo haga desde la pestaña Gastos normal.
      if (gastoDesdeJornadaId) {
        selectJornada.value = gastoDesdeJornadaId;
        selectJornada.disabled = true;
      }
    }
    openModal('modalGasto');
  }

  document.getElementById('formGasto').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('gastoId').value;
    const data = {
      fecha: document.getElementById('gastoFecha').value,
      categoria: document.getElementById('gastoCategoria').value.trim(),
      concepto: document.getElementById('gastoConcepto').value.trim() || '(sin concepto)',
      monto: parseFloat(document.getElementById('gastoMonto').value) || 0,
      jornadaId: document.getElementById('gastoJornada').value || null,
    };
    const btnGuardar = document.querySelector('#formGasto button[type="submit"]');
    btnGuardar.disabled = true;
    try {
      if (id) {
        if (esUuid(id)) await actualizarGastoEnSupabase(id, data);
        const g = gastos.find(x => x.id === id);
        Object.assign(g, data);
        showToast('Gasto actualizado');
      } else {
        const nuevoId = crypto.randomUUID();
        await crearGastoEnSupabase(nuevoId, data);
        gastos.push({ id: nuevoId, ...data });
        showToast('Gasto creado');
      }
      saveGastos();
      renderGastos();
      renderJornadas();
      renderStatsFinanzas();
      if (gastoDesdeJornadaId) {
        // volver al detalle de la Jornada desde la que se abrió este formulario, ya refrescado
        // (Gastos, Gasto total y Utilidad quedan al día sin cerrar/reabrir el modal a mano).
        const jornadaId = gastoDesdeJornadaId;
        gastoDesdeJornadaId = null; // limpiar ANTES de closeModal, para que su manejo de "cancelado" no se dispare también
        closeModal('modalGasto');
        abrirDetalleJornada(jornadaId);
      } else {
        closeModal('modalGasto');
      }
    } catch (err) {
      console.error(err);
      showToast(`No se pudo guardar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
    } finally {
      btnGuardar.disabled = false;
    }
  });

  async function deleteGasto(id) {
    const g = gastos.find(x => x.id === id);
    if (!confirm(`¿Eliminar el gasto "${g.concepto}"?`)) return;
    if (esUuid(id)) {
      try {
        await marcarGastoEliminadoEnSupabase(id);
      } catch (err) {
        console.error(err);
        showToast(`No se pudo eliminar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
        return;
      }
    }
    moverAPapelera('gastos', g);
    gastos = gastos.filter(x => x.id !== id);
    saveGastos();
    renderGastos();
    renderJornadas();
    renderStatsFinanzas();
    showToast('Gasto eliminado (puedes restaurarlo desde la Papelera)');
  }

  // ---------------- Capital ----------------
  function renderStatsCapital() {
    const aportes = capitalMovimientos.filter(m => m.tipo === 'aporte').reduce((s, m) => s + (m.monto || 0), 0);
    const retiros = capitalMovimientos.filter(m => m.tipo === 'retiro').reduce((s, m) => s + (m.monto || 0), 0);
    document.getElementById('statsCapital').innerHTML = `
      <div class="stat-card"><div class="stat-value">${money(aportes)}</div><div class="stat-label">Total aportes</div></div>
      <div class="stat-card"><div class="stat-value">${money(retiros)}</div><div class="stat-label">Total retiros</div></div>
      <div class="stat-card"><div class="stat-value">${money(aportes - retiros)}</div><div class="stat-label">Capital neto</div></div>
    `;
  }

  function renderCapital() {
    const ordenados = capitalMovimientos.slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    document.getElementById('tbodyCapital').innerHTML = ordenados.map(m => `
      <tr>
        <td class="cell-muted">${fecha(m.fecha)}</td>
        <td><span class="badge ${m.tipo === 'aporte' ? 'badge-good' : 'badge-bad'}">${m.tipo === 'aporte' ? 'Aporte' : 'Retiro'}</span></td>
        <td class="cell-muted">${esc(m.nota) || '—'}</td>
        <td>${money(m.monto)}</td>
        <td class="col-actions">
          <button class="btn-icon" title="Editar" data-edit-capital="${m.id}">✎</button>
          <button class="btn-icon danger" title="Eliminar" data-del-capital="${m.id}">🗑</button>
        </td>
      </tr>
    `).join('');

    document.getElementById('emptyCapital').hidden = capitalMovimientos.length !== 0;
    renderStatsCapital();

    document.querySelectorAll('#tbodyCapital [data-edit-capital]').forEach(b =>
      b.addEventListener('click', () => openCapitalModal(b.getAttribute('data-edit-capital'))));
    document.querySelectorAll('#tbodyCapital [data-del-capital]').forEach(b =>
      b.addEventListener('click', () => deleteCapital(b.getAttribute('data-del-capital'))));
  }

  document.getElementById('btnNuevoCapital').addEventListener('click', () => openCapitalModal(null));

  function openCapitalModal(id) {
    const form = document.getElementById('formCapital');
    form.reset();
    if (id) {
      const m = capitalMovimientos.find(x => x.id === id);
      document.getElementById('modalCapitalTitulo').textContent = 'Editar movimiento';
      document.getElementById('capitalId').value = m.id;
      document.getElementById('capitalTipo').value = m.tipo;
      document.getElementById('capitalFecha').value = m.fecha || '';
      document.getElementById('capitalMonto').value = m.monto;
      document.getElementById('capitalNota').value = m.nota || '';
    } else {
      document.getElementById('modalCapitalTitulo').textContent = 'Nuevo movimiento de capital';
      document.getElementById('capitalId').value = '';
      document.getElementById('capitalFecha').value = new Date().toISOString().slice(0, 10);
    }
    openModal('modalCapital');
  }

  document.getElementById('formCapital').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('capitalId').value;
    const data = {
      tipo: document.getElementById('capitalTipo').value,
      fecha: document.getElementById('capitalFecha').value,
      monto: parseFloat(document.getElementById('capitalMonto').value) || 0,
      nota: document.getElementById('capitalNota').value.trim(),
    };
    const btnGuardar = document.querySelector('#formCapital button[type="submit"]');
    btnGuardar.disabled = true;
    try {
      if (id) {
        if (esUuid(id)) await actualizarCapitalEnSupabase(id, data);
        const m = capitalMovimientos.find(x => x.id === id);
        Object.assign(m, data);
        showToast('Movimiento actualizado');
      } else {
        const nuevoId = crypto.randomUUID();
        await crearCapitalEnSupabase(nuevoId, data);
        capitalMovimientos.push({ id: nuevoId, ...data });
        showToast('Movimiento creado');
      }
      saveCapital();
      renderCapital();
      renderStatsFinanzas();
      closeModal('modalCapital');
    } catch (err) {
      console.error(err);
      showToast(`No se pudo guardar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
    } finally {
      btnGuardar.disabled = false;
    }
  });

  async function deleteCapital(id) {
    const m = capitalMovimientos.find(x => x.id === id);
    if (!confirm('¿Eliminar este movimiento de capital?')) return;
    if (esUuid(id)) {
      try {
        await marcarCapitalEliminadoEnSupabase(id);
      } catch (err) {
        console.error(err);
        showToast(`No se pudo eliminar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
        return;
      }
    }
    moverAPapelera('capitalMovimientos', m);
    capitalMovimientos = capitalMovimientos.filter(x => x.id !== id);
    saveCapital();
    renderCapital();
    renderStatsFinanzas();
    showToast('Movimiento eliminado (puedes restaurarlo desde la Papelera)');
  }

  document.getElementById('btnPapeleraJornadas').addEventListener('click', () => abrirPapelera('jornadas'));
  document.getElementById('btnPapeleraGastos').addEventListener('click', () => abrirPapelera('gastos'));
  document.getElementById('btnPapeleraCapital').addEventListener('click', () => abrirPapelera('capitalMovimientos'));

  // ---------------- Rentabilidad ----------------
  // Costo actual de una receta (insumos de HOY, nunca un histórico -- ver la notita de ayuda
  // en la UI). Si la receta ya no está viva, se usa 0: no existe en la app ningún snapshot de
  // costo que rescatar (ni siquiera receta_ingredientes se conserva para una receta eliminada),
  // así que inventar un número sería peor que mostrar 0 con la etiqueta "(Eliminada)" visible.
  function costoActualReceta(recetaId) {
    const r = recetas.find(x => x.id === recetaId);
    if (r) return calcReceta(r).costoPorPlato;
    if (!recetasEliminadasPorId.has(recetaId)) {
      // esto no debería pasar -- un recetaId que no está vivo NI en la Papelera es un id que no
      // corresponde a ninguna receta real. Se deja visible en consola para no inflar en silencio
      // la utilidad del reporte con un costo de 0 que en realidad sería un bug de datos.
      console.warn(`Rentabilidad: recetaId "${recetaId}" no está en "recetas" ni en recetasEliminadasPorId -- se usa costo 0, pero esto podría ser un bug de datos (no una eliminación real).`);
    }
    return 0;
  }

  function calcularRentabilidad(desde, hasta) {
    const enRangoDeFecha = p => (!desde || p.fechaEntrega >= desde) && (!hasta || p.fechaEntrega <= hasta);

    // Jornadas marcadas "no incluir en el Reporte de Rentabilidad" (checkbox del formulario de
    // Jornada) -- sus pedidos se excluyen SOLO de este reporte. Siguen contando normal en
    // Jornadas/Eventos, Finanzas > Resumen, Clientes, etc. Un pedido sin jornada_id (null)
    // nunca se excluye por esta vía.
    const idsJornadasExcluidas = new Set(jornadas.filter(j => j.incluirEnAnalisis === false).map(j => j.id));

    const enRango = pedidos.filter(p =>
      !p.cancelado &&
      enRangoDeFecha(p) &&
      !(p.jornadaId && idsJornadasExcluidas.has(p.jornadaId))
    );

    // para la notita en la UI: nombres de las Jornadas excluidas que de verdad tenían al menos
    // un pedido en este rango (si no tenían ninguno, no hay nada que explicarle al usuario).
    const jornadasExcluidas = Array.from(new Set(
      pedidos
        .filter(p => !p.cancelado && enRangoDeFecha(p) && p.jornadaId && idsJornadasExcluidas.has(p.jornadaId))
        .map(p => nombreJornada(p.jornadaId))
    ));

    const porDiaMap = new Map();   // fechaEntrega -> {ingresos, costo}
    const porPlatoMap = new Map(); // recetaId (o clave sintética) -> {nombre, papelera, cantidad, ingreso, costo}

    enRango.forEach(p => {
      const c = calcPedido(p);
      const dia = porDiaMap.get(p.fechaEntrega) || { ingresos: 0, costo: 0 };
      c.items.forEach(it => {
        const costoUnitario = it.recetaId ? costoActualReceta(it.recetaId) : 0;
        const costoItem = costoUnitario * (it.cantidad || 0);
        dia.ingresos += it.subtotal;
        dia.costo += costoItem;

        const clave = it.recetaId || `sin-receta:${it.nombre}`;
        const actual = porPlatoMap.get(clave) || { nombre: it.nombre, papelera: it.papelera, cantidad: 0, ingreso: 0, costo: 0 };
        actual.cantidad += it.cantidad || 0;
        actual.ingreso += it.subtotal;
        actual.costo += costoItem;
        porPlatoMap.set(clave, actual);
      });
      porDiaMap.set(p.fechaEntrega, dia);
    });

    const porDia = Array.from(porDiaMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([f, v]) => ({ fecha: f, ingresos: v.ingresos, costo: v.costo, utilidad: v.ingresos - v.costo }));

    const porPlato = Array.from(porPlatoMap.values()).map(v => ({
      ...v, utilidad: v.ingreso - v.costo,
      margenPct: v.ingreso > 0 ? ((v.ingreso - v.costo) / v.ingreso) * 100 : 0,
    }));

    const totalIngresos = porPlato.reduce((s, v) => s + v.ingreso, 0);
    const totalCosto = porPlato.reduce((s, v) => s + v.costo, 0);
    const totalUtilidad = totalIngresos - totalCosto;
    const margenPct = totalIngresos > 0 ? (totalUtilidad / totalIngresos) * 100 : 0;

    return { porDia, porPlato, totales: { totalIngresos, totalCosto, totalUtilidad, margenPct }, jornadasExcluidas };
  }

  // orden de la tabla de Rentabilidad (mismo patrón que Pedidos/Clientes): por defecto,
  // Utilidad total descendente.
  const VALOR_ORDEN_RENTABILIDAD = {
    nombre: v => v.nombre.toLowerCase(),
    cantidad: v => v.cantidad,
    ingreso: v => v.ingreso,
    costo: v => v.costo,
    utilidad: v => v.utilidad,
    margen: v => v.margenPct,
  };
  const ETIQUETA_ORDEN_RENTABILIDAD = {
    nombre: 'Plato', cantidad: 'Cantidad vendida', ingreso: 'Ingreso total',
    costo: 'Costo total', utilidad: 'Utilidad total', margen: 'Margen %',
  };
  let ordenRentabilidadColumna = 'utilidad';
  let ordenRentabilidadDireccion = 'desc';

  function compararRentabilidad(a, b) {
    const obtenerValor = VALOR_ORDEN_RENTABILIDAD[ordenRentabilidadColumna];
    const va = obtenerValor(a), vb = obtenerValor(b);
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return ordenRentabilidadDireccion === 'asc' ? cmp : -cmp;
  }

  function actualizarIndicadoresOrdenRentabilidad() {
    document.querySelectorAll('#tablaRentabilidad [data-sort]').forEach(th => {
      const columna = th.getAttribute('data-sort');
      const etiqueta = ETIQUETA_ORDEN_RENTABILIDAD[columna];
      const esActiva = columna === ordenRentabilidadColumna;
      const indicador = th.querySelector('.sort-indicador');
      indicador.textContent = esActiva ? (ordenRentabilidadDireccion === 'asc' ? '▲' : '▼') : '';
      th.title = esActiva
        ? `Ordenado por "${etiqueta}" (${ordenRentabilidadDireccion === 'asc' ? 'ascendente' : 'descendente'}). Clic para invertir el orden.`
        : `Clic para ordenar por "${etiqueta}".`;
    });
  }

  document.querySelectorAll('#tablaRentabilidad [data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const columna = th.getAttribute('data-sort');
      if (ordenRentabilidadColumna === columna) {
        ordenRentabilidadDireccion = ordenRentabilidadDireccion === 'asc' ? 'desc' : 'asc';
      } else {
        ordenRentabilidadColumna = columna;
        ordenRentabilidadDireccion = columna === 'nombre' ? 'asc' : 'desc';
      }
      renderRentabilidad();
    });
  });

  function renderStatsRentabilidad(totales) {
    document.getElementById('statsRentabilidad').innerHTML = `
      <div class="stat-card"><div class="stat-value">${money(totales.totalIngresos)}</div><div class="stat-label">Total ingresos</div></div>
      <div class="stat-card"><div class="stat-value">${money(totales.totalCosto)}</div><div class="stat-label">Total costo</div></div>
      <div class="stat-card"><div class="stat-value">${money(totales.totalUtilidad)}</div><div class="stat-label">Utilidad</div></div>
      <div class="stat-card"><div class="stat-value">${totales.margenPct.toFixed(1)}%</div><div class="stat-label">Margen %</div></div>
    `;
  }

  // instancia única de Chart.js, reutilizada (se actualiza con .data + .update() en vez de
  // destruir/crear el gráfico cada vez que se re-renderiza).
  let chartRentabilidadInstancia = null;
  function renderChartRentabilidad(porDia) {
    const ctx = document.getElementById('chartRentabilidad');
    const datos = {
      labels: porDia.map(d => fecha(d.fecha)),
      datasets: [
        { label: 'Ingresos', data: porDia.map(d => d.ingresos), borderColor: '#2e7d32', tension: 0.2 },
        { label: 'Costo', data: porDia.map(d => d.costo), borderColor: '#c62828', tension: 0.2 },
        { label: 'Utilidad', data: porDia.map(d => d.utilidad), borderColor: '#1565c0', tension: 0.2 },
      ],
    };
    if (chartRentabilidadInstancia) {
      chartRentabilidadInstancia.data = datos;
      chartRentabilidadInstancia.update();
    } else {
      chartRentabilidadInstancia = new Chart(ctx, {
        type: 'line',
        data: datos,
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
      });
    }
  }

  function renderTablaRentabilidad(porPlato) {
    const ordenado = porPlato.slice().sort(compararRentabilidad);
    actualizarIndicadoresOrdenRentabilidad();
    document.getElementById('tbodyRentabilidad').innerHTML = ordenado.map(v => `
      <tr>
        <td>${esc(v.nombre)}${v.papelera ? etiquetaEnPapeleraHTML(false) : ''}</td>
        <td>${v.cantidad}</td>
        <td>${money(v.ingreso)}</td>
        <td>${money(v.costo)}</td>
        <td>${money(v.utilidad)}</td>
        <td>${v.margenPct.toFixed(1)}%</td>
      </tr>
    `).join('');
    document.getElementById('emptyRentabilidad').hidden = ordenado.length !== 0;
  }

  function renderRentabilidad() {
    const desde = document.getElementById('rentabilidadFiltroDesde').value;
    const hasta = document.getElementById('rentabilidadFiltroHasta').value;
    const { porDia, porPlato, totales, jornadasExcluidas } = calcularRentabilidad(desde, hasta);
    renderStatsRentabilidad(totales);
    renderChartRentabilidad(porDia);
    renderTablaRentabilidad(porPlato);

    const notaExcluidas = document.getElementById('rentabilidadJornadasExcluidas');
    if (jornadasExcluidas.length) {
      notaExcluidas.hidden = false;
      notaExcluidas.textContent = `⚠ ${jornadasExcluidas.length} Jornada(s) excluida(s) de este análisis: ${jornadasExcluidas.join(', ')}.`;
    } else {
      notaExcluidas.hidden = true;
    }
  }

  document.getElementById('rentabilidadFiltroDesde').addEventListener('input', renderRentabilidad);
  document.getElementById('rentabilidadFiltroHasta').addEventListener('input', renderRentabilidad);
  document.getElementById('btnLimpiarFiltroRentabilidad').addEventListener('click', () => {
    document.getElementById('rentabilidadFiltroDesde').value = '';
    document.getElementById('rentabilidadFiltroHasta').value = '';
    renderRentabilidad();
  });

  function generarPDFRentabilidad(desde, hasta) {
    const { porPlato, totales } = calcularRentabilidad(desde, hasta);
    const ordenado = porPlato.slice().sort(compararRentabilidad);
    const marca = datosMarcaApp();

    const resumenHTML = `
      <div class="resumen-stats">
        <div class="stat-box"><div class="stat-valor">${money(totales.totalIngresos)}</div><div class="stat-label">Total ingresos</div></div>
        <div class="stat-box"><div class="stat-valor">${money(totales.totalCosto)}</div><div class="stat-label">Total costo</div></div>
        <div class="stat-box"><div class="stat-valor">${money(totales.totalUtilidad)}</div><div class="stat-label">Utilidad</div></div>
        <div class="stat-box"><div class="stat-valor">${totales.margenPct.toFixed(1)}%</div><div class="stat-label">Margen %</div></div>
      </div>
    `;

    const filasHTML = ordenado.map(v => `
      <tr>
        <td>${esc(v.nombre)}${v.papelera ? etiquetaEnPapeleraHTML(true) : ''}</td>
        <td class="num">${v.cantidad}</td>
        <td class="num">${money(v.ingreso)}</td>
        <td class="num">${money(v.costo)}</td>
        <td class="num">${money(v.utilidad)}</td>
        <td class="num">${v.margenPct.toFixed(1)}%</td>
      </tr>
    `).join('');

    const rangoTxt = desde && hasta ? `${fecha(desde + 'T00:00:00')} al ${fecha(hasta + 'T00:00:00')}` : 'Todo el historial';

    // la gráfica se dibuja con Chart.js en un <canvas> de la página actual -- document.write()
    // abre un documento nuevo que no ejecuta ese script, así que en vez de recrear la gráfica ahí
    // se captura como imagen la que YA está renderizada en pantalla (mismo rango de fechas,
    // porque este botón vive en el mismo sub-tab que ese filtro) y se inserta como <img>.
    const canvasChart = document.getElementById('chartRentabilidad');
    const imgChartHTML = chartRentabilidadInstancia
      ? `<img class="grafica-pdf" src="${canvasChart.toDataURL('image/png')}" alt="Evolución de Ingresos, Costo y Utilidad">`
      : '';

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Rentabilidad — ${rangoTxt}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#222;padding:16px;margin:0}
  .marca-pdf{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .marca-pdf-icono{font-size:26px;line-height:1;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
  .marca-pdf-icono img{width:32px;height:32px;object-fit:contain}
  h1{font-size:18px;margin:0}
  .marca-pdf .subtitulo-marca{font-size:11px;color:#777;margin:1px 0 0}
  .subtitulo{font-size:12px;color:#666;margin:0 0 18px}
  table{width:100%;border-collapse:collapse;font-size:10.5px;table-layout:fixed}
  th,td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:break-word;word-break:break-word}
  th{background:#f0f0f0}
  td.num,th.num{text-align:right}
  tfoot td{font-weight:bold;background:#f7f7f7}
  .resumen-stats{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 20px}
  .stat-box{border:1px solid #ccc;border-radius:6px;padding:8px 12px;min-width:110px}
  .stat-box .stat-valor{font-size:16px;font-weight:800}
  .stat-box .stat-label{font-size:9px;text-transform:uppercase;color:#777;letter-spacing:.02em;margin-top:2px}
  .nota{font-size:10.5px;color:#777;margin:0 0 14px}
  .grafica-pdf{width:100%;max-height:280px;object-fit:contain;display:block;margin:0 0 20px;border:1px solid #ccc;border-radius:6px}
  @media print{ body{padding:0} .grafica-pdf{max-height:220px} }
</style>
</head>
<body>
  <div class="marca-pdf">
    <span class="marca-pdf-icono">${marca.iconoHTML}</span>
    <div>
      <h1>${esc(marca.nombre)}</h1>
      <p class="subtitulo-marca">${esc(marca.subtitulo)}</p>
    </div>
  </div>
  <p class="subtitulo">Rentabilidad · Rango: ${rangoTxt} · Generado ${new Date().toLocaleString('es-CO')}</p>
  <p class="nota">Los costos se calculan con los precios ACTUALES de los insumos, no con los precios históricos que tenían en cada fecha.</p>
  ${resumenHTML}
  ${imgChartHTML}
  <table>
    <thead>
      <tr>
        <th>Plato</th><th class="num">Cantidad vendida</th><th class="num">Ingreso total</th>
        <th class="num">Costo total</th><th class="num">Utilidad total</th><th class="num">Margen %</th>
      </tr>
    </thead>
    <tbody>${filasHTML}</tbody>
  </table>
</body>
</html>`;

    const ventana = window.open('', '_blank');
    if (!ventana) { showToast('El navegador bloqueó la ventana. Permite pop-ups para exportar el PDF.'); return; }
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
    setTimeout(() => { try { ventana.focus(); ventana.print(); } catch (e) {} }, 300);
  }

  document.getElementById('btnExportarRentabilidadPDF').addEventListener('click', () => {
    generarPDFRentabilidad(document.getElementById('rentabilidadFiltroDesde').value, document.getElementById('rentabilidadFiltroHasta').value);
  });

  // =========================================================
  //  AYUDA
  // =========================================================
  const AYUDA_CONTENIDO = {
    calendario: `
      <p>Vista mensual de tus Jornadas y Pedidos.</p>
      <ul>
        <li>Navega con <strong>"← Anterior" / "Hoy" / "Siguiente →"</strong>.</li>
        <li>Insignia en un día = hay un <strong>Evento</strong> programado esa fecha (clic la abre en su detalle).</li>
        <li>Número en la esquina de un día = cantidad de <strong>Pedidos</strong> con entrega ese día (clic te lleva a Pedidos con el filtro de fecha ya puesto).</li>
        <li>Días sin nada no muestran ninguna marca.</li>
      </ul>
    `,
    compras: `
      <p>Calcula y organiza tus compras de insumos según los platos que planeas preparar.</p>
      <h4>Cómo agregar platos</h4>
      <p>Desde cualquier Receta, usa el ícono <strong>"🧮 Calcular compra"</strong> — indica cuántos platos vas a preparar, revisa la cantidad de insumos y el costo, y usa <strong>"🛒 Agregar al carrito"</strong>.</p>
      <h4>Carrito activo</h4>
      <ul>
        <li>Lista de los platos que agregaste, con opción de quitarlos (van a la Papelera, no se borran de una).</li>
        <li>Tabla <strong>"Insumos a comprar (consolidado)"</strong>: suma la cantidad necesaria de cada insumo entre TODOS los platos del carrito (si dos platos usan cebolla, se suman), con el costo total.</li>
        <li>"Exportar PDF" de esa lista consolidada.</li>
        <li><strong>"Finalizar compra"</strong>: le pones un nombre a la tanda (ej. "Compra kermés agosto") y la archiva en el Historial — el carrito activo queda vacío para la próxima.</li>
      </ul>
      <h4>Historial de compras</h4>
      <p>Cada tanda finalizada aparece colapsada, con su nombre — clic para expandir y ver el detalle. Puedes exportar cada una en PDF, o todo el historial junto.</p>
      <h4>Papelera</h4>
      <p>Los platos que quitaste del carrito se pueden restaurar o eliminar definitivamente desde ahí.</p>
    `,
    insumos: `
      <p>Aquí registras cada ingrediente que compras. El precio de cada insumo es la base de todos los cálculos de costo de tus recetas.</p>
      <h4>Crear y editar</h4>
      <ul>
        <li><strong>+ Nuevo insumo</strong>: nombre, categoría, unidad de medida, precio y merma (%).</li>
        <li>Ícono ✎ para editar uno existente.</li>
      </ul>
      <h4>Categorías</h4>
      <ul>
        <li>Botón <strong>⚙ Categorías</strong> para ver todas las que están en uso.</li>
        <li>Puedes renombrar una (✎) — actualiza automáticamente todos los insumos que la usan. Si el nuevo nombre coincide con una categoría que ya existe, te pregunta si quieres fusionarlas.</li>
        <li>Puedes eliminar una categoría (🗑).</li>
      </ul>
      <h4>Historial de precios</h4>
      <ul>
        <li>Ícono de historial en Acciones: gráfica + tabla de todos los cambios de precio de ese insumo a lo largo del tiempo. Se registra solo, cada vez que editas el precio.</li>
        <li>Puedes borrar una fila puntual del historial sin que afecte el precio actual del insumo.</li>
      </ul>
      <h4>Merma</h4>
      <ul>
        <li>Es el % de un insumo que se pierde antes de usarse (cáscaras, huesos, recorte). La app calcula un "costo efectivo" más caro que el precio de compra, y ese es el que se usa en el costeo de tus recetas.</li>
        <li>Ejemplo: cebolla a Bs 7/kg con 10% de merma → costo efectivo ≈ Bs 7,78/kg.</li>
        <li>Por defecto es 0% — no cambia nada hasta que tú lo configures.</li>
      </ul>
      <h4>Papelera</h4>
      <p>Los insumos eliminados van a la Papelera antes de borrarse definitivo — puedes restaurarlos desde ahí.</p>
    `,
    recetas: `
      <p>Cada Receta es un plato de tu menú: sus ingredientes, cuánto rinde, y cuánto te cuesta producirlo HOY (el costo se recalcula en vivo).</p>
      <h4>Crear y editar</h4>
      <ul>
        <li>Nombre del plato, categoría, porciones que rinde la receta.</li>
        <li><strong>Ingredientes</strong>: elige el insumo y la cantidad usada — el costo se calcula solo (usando el costo efectivo del insumo, con merma incluida si aplica).</li>
        <li><strong>Otros costos</strong>: mano de obra, gas, empaques, etc. — se suman al costo total antes de dividir entre las porciones.</li>
        <li><strong>Margen deseado (%)</strong> y/o <strong>Precio de venta real</strong>: define uno o el otro, la app calcula el que falte.</li>
        <li>Foto del plato (opcional) — se sube y se guarda en la nube.</li>
      </ul>
      <h4>Favoritas</h4>
      <p>Marca la estrella (⭐) para que ese plato aparezca siempre primero en la lista.</p>
      <h4>Costo del plato</h4>
      <p>Si cambias el precio o la merma de un insumo, el costo de todas las recetas que lo usan se actualiza solo, sin que tengas que tocar nada.</p>
      <h4>Papelera</h4>
      <p>Recetas eliminadas se pueden restaurar desde ahí. Si una receta eliminada aparece referenciada en un Pedido o reporte viejo, se muestra con su nombre real + "(Eliminada)", nunca se pierde el rastro.</p>
    `,
    pedidos: `
      <p>Aquí registras cada venta — con cliente identificado o como venta rápida de mostrador.</p>
      <h4>Crear un pedido</h4>
      <ul>
        <li><strong>Cliente</strong>: si el nombre no existe, se crea automáticamente al guardar. Si escribes un nombre parecido a uno que ya existe, la app te pregunta si es la misma persona (evita duplicados por errores de tipeo).</li>
        <li>Fecha y hora de entrega.</li>
        <li><strong>Jornada / Evento</strong> (opcional): si no eliges nada, el pedido se asigna solo al "Día normal" de esa fecha. Si eliges un Evento, la fecha se autocompleta y se bloquea con la fecha de ese Evento.</li>
        <li><strong>Platos</strong>: el precio queda "congelado" al momento de guardar — si luego cambias el precio de venta de esa receta, este pedido conserva el precio original con el que se vendió.</li>
        <li><strong>"Ya cobrado"</strong> (checkbox) y <strong>"Método de pago"</strong> (Efectivo/Depósito) son INDEPENDIENTES: puedes indicar el método sin que eso signifique que ya se cobró (ej. "pagará en efectivo al recoger", todavía pendiente).</li>
      </ul>
      <h4>Venta de mostrador</h4>
      <p>Botón <strong>"⚡ Venta de mostrador"</strong> para ventas rápidas sin cliente identificado — fecha/hora se llenan solas con el momento actual.</p>
      <h4>En la tabla</h4>
      <ul>
        <li>Los botones de "Pago", "Tipo de pago", "Preparación" y "Cancelado" ciclan su estado con un clic, sin abrir el pedido.</li>
        <li>Haz clic en cualquier encabezado de columna para ordenar (como en Excel) — un segundo clic invierte el orden.</li>
        <li>El filtro "Entrega desde/hasta" acota la tabla y las tarjetas de estadísticas a un rango de fechas.</li>
        <li>La columna "Jornada/Evento" muestra a qué Jornada pertenece cada pedido.</li>
        <li>"Exportar PDF" genera un reporte imprimible de lo que ves en pantalla (respeta el filtro y el orden activos).</li>
      </ul>
      <h4>Tarjetas de estadísticas</h4>
      <p>Total pedidos, ranking de Platos pedidos, Platos entregados, Total Bs pedidos, Total por cobrar, Total cobrado, y Vendido/planeado (si alguna Jornada del rango tiene planificación de platos).</p>
    `,
    clientes: `
      <p>Lista de tus clientes con su historial de compras.</p>
      <ul>
        <li>Los nombres se guardan siempre en MAYÚSCULAS automáticamente, para mantener la lista prolija.</li>
        <li>Si escribes un nombre parecido a uno que ya existe (al crear desde aquí o desde un Pedido), la app pregunta si es la misma persona antes de crear un duplicado.</li>
        <li>Ícono de historial en Acciones: ventana de solo consulta con todos los pedidos de ese cliente (fecha, platos, total, pago), con botón para descargar en PDF.</li>
        <li>Papelera: clientes eliminados se pueden restaurar. Si un pedido viejo referencia a un cliente eliminado definitivamente, sigue mostrando su nombre real + "(Eliminado)".</li>
      </ul>
    `,
    finanzasResumen: `
      <p>Vista general de tu negocio: Capital invertido, Capital usado (gastos), Ingresos totales, Utilidad neta y Saldo disponible — suma TODO tu negocio (todas las Jornadas, todos los Gastos), no un plato o evento en particular.</p>
    `,
    finanzasJornadas: `
      <p>Cada día de venta normal ("Venta regular") o cada evento especial ("Evento": kermés, catering) es una Jornada.</p>
      <h4>Crear una Jornada</h4>
      <ul>
        <li>Nombre, tipo (Venta regular / Evento), fecha, notas.</li>
        <li><strong>Planificación de platos</strong> (opcional): define cuántas unidades de cada plato planeas vender — se compara contra lo real vendido en los pedidos vinculados.</li>
        <li><strong>"Incluir en el Reporte de Rentabilidad"</strong> (checkbox, marcado por defecto): desmárcalo en eventos atípicos (ej. una kermés benéfica) para que no distorsionen tu análisis de ventas habituales — sigue registrándose normal en todos los demás lugares, solo se excluye de ese reporte en particular.</li>
      </ul>
      <h4>Detalle de una Jornada (clic en la tarjeta)</h4>
      <ul>
        <li><strong>Ingresos</strong>: lista de pedidos vinculados + resumen rápido de cuánto se vendió de cada plato.</li>
        <li><strong>Gastos</strong>: los vinculados a esa Jornada — puedes agregar uno nuevo directo desde ahí con "+ Agregar gasto".</li>
        <li><strong>Donaciones</strong> (SOLO en Eventos): aportes recibidos aparte de la venta de platos ("+ Agregar donación") — se suman al ingreso total del evento.</li>
        <li><strong>Planificación de platos</strong>: avance vendido/planeado por plato.</li>
        <li>Botón <strong>"🖨 Exportar reporte"</strong>: PDF completo de esa Jornada con todo lo anterior.</li>
      </ul>
      <p>Un evento sólo se crea automáticamente como "Venta regular" del día cuando guardas un pedido sin elegir Jornada manualmente.</p>
    `,
    finanzasGastos: `
      <p>Registro de gastos del negocio: categoría, concepto, monto, fecha — vinculados a una Jornada específica (opcional) o sueltos (gastos generales del negocio, como alquiler o sueldos).</p>
    `,
    finanzasCapital: `
      <p>Aportes y retiros de capital del negocio — lo que metes o sacas tú (o los socios) del negocio, separado de las ventas del día a día.</p>
    `,
    finanzasRentabilidad: `
      <p>El reporte que responde: "¿qué plato me deja más ganancia REAL, y cuánto gané en total?"</p>
      <ul>
        <li>Filtro de fechas (Desde/Hasta).</li>
        <li>Tarjetas: Total ingresos, Total costo, Utilidad, Margen %.</li>
        <li>Gráfica de evolución diaria (Ingresos, Costo, Utilidad).</li>
        <li>Tabla ranking de platos, ordenable (clic en encabezado) por Cantidad, Ingreso, Costo, Utilidad o Margen.</li>
        <li>Botón "Exportar PDF".</li>
      </ul>
      <p><strong>Importante</strong>: los costos se calculan con los precios ACTUALES de los insumos, no con los que tenían en cada fecha histórica. Las Jornadas marcadas como "no incluir en el Reporte de Rentabilidad" quedan fuera de este cálculo (se avisa cuáles, si aplica, en el rango filtrado).</p>
    `,
  };

  function abrirAyuda(clave, titulo) {
    document.getElementById('modalAyudaTitulo').textContent = titulo;
    document.getElementById('modalAyudaContenido').innerHTML = AYUDA_CONTENIDO[clave];
    openModal('modalAyuda');
  }

  document.getElementById('btnAyudaCalendario').addEventListener('click', () => abrirAyuda('calendario', 'Ayuda — Calendario'));
  document.getElementById('btnAyudaCompras').addEventListener('click', () => abrirAyuda('compras', 'Ayuda — Compras'));
  document.getElementById('btnAyudaInsumos').addEventListener('click', () => abrirAyuda('insumos', 'Ayuda — Insumos'));
  document.getElementById('btnAyudaRecetas').addEventListener('click', () => abrirAyuda('recetas', 'Ayuda — Recetas'));
  document.getElementById('btnAyudaPedidos').addEventListener('click', () => abrirAyuda('pedidos', 'Ayuda — Pedidos'));
  document.getElementById('btnAyudaClientes').addEventListener('click', () => abrirAyuda('clientes', 'Ayuda — Clientes'));

  // Antes era un solo botón de Ayuda para toda Finanzas que leía el sub-tab activo -- ahora que
  // cada sub-pestaña tiene su propia fila de acciones (y su propio botón de Ayuda dentro), ya no
  // hace falta detectar nada: cada botón vive únicamente dentro de la sub-vista a la que
  // corresponde, así que siempre es el contenido correcto.
  document.getElementById('btnAyudaFinanzasResumen').addEventListener('click', () => abrirAyuda('finanzasResumen', 'Ayuda — Finanzas · Resumen'));
  document.getElementById('btnAyudaFinanzasJornadas').addEventListener('click', () => abrirAyuda('finanzasJornadas', 'Ayuda — Finanzas · Jornadas / Eventos'));
  document.getElementById('btnAyudaFinanzasGastos').addEventListener('click', () => abrirAyuda('finanzasGastos', 'Ayuda — Finanzas · Gastos'));
  document.getElementById('btnAyudaFinanzasCapital').addEventListener('click', () => abrirAyuda('finanzasCapital', 'Ayuda — Finanzas · Capital'));
  document.getElementById('btnAyudaFinanzasRentabilidad').addEventListener('click', () => abrirAyuda('finanzasRentabilidad', 'Ayuda — Finanzas · Rentabilidad'));

  // =========================================================
  //  AUDITORÍA (Fase C) — historial de solo lectura, 100% desde Supabase (auditoria).
  //  Las 8 tablas principales ya tienen triggers que escriben ahí solas (datos_anteriores/
  //  datos_nuevos = to_jsonb(OLD)/to_jsonb(NEW), columnas crudas de la BD, snake_case) --
  //  este bloque solo lee y traduce esas filas a un resumen legible. Nunca inserta/actualiza/
  //  borra nada en "auditoria" (ni siquiera podría: RLS solo permite SELECT e INSERT vía
  //  trigger, no UPDATE/DELETE desde el cliente).
  // =========================================================
  function nombreClientePorId(id) {
    if (!id) return '—';
    const c = clientes.find(x => x.id === id);
    if (c) return c.nombre;
    if (clientesEliminadosPorId.has(id)) return `${clientesEliminadosPorId.get(id)}${etiquetaEnPapeleraHTML(true)}`;
    return '(cliente eliminado)';
  }

  // fecha() (la de siempre) solo devuelve el día -- acá interesa también la hora, ya que en un
  // historial de actividad puede haber varias entradas el mismo día.
  function fechaHoraAuditoria(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const fechaTxt = d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
    const horaTxt = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    return `${fechaTxt}, ${horaTxt}`;
  }

  function truncarTexto(valor, max = 60) {
    if (valor === null || valor === undefined || valor === '') return '—';
    const s = String(valor);
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  // por tabla: "identificar" arma la frase "Tipo + valor" que se usa en crear/eliminar/editar
  // (ej. `Insumo "Cebolla colla"`, `Pedido #123`), y "campos" mapea cada columna cruda de la
  // BD (snake_case, tal cual sale de to_jsonb) a una etiqueta legible + un formateador opcional
  // -- un valor string simple (sin formateador) usa truncarTexto() por defecto.
  const AUDITORIA_CONFIG = {
    insumos: {
      identificar: d => `Insumo "${d.nombre || '(sin nombre)'}"`,
      campos: {
        nombre: 'Nombre', categoria: 'Categoría',
        unidad: { label: 'Unidad', formato: v => (UNITS[v] ? UNITS[v].label : v) },
        precio: { label: 'Precio', formato: money },
        proveedor: 'Proveedor',
        merma_pct: { label: 'Merma %', formato: v => `${v || 0}%` },
      },
    },
    recetas: {
      identificar: d => `Receta "${d.nombre || '(sin nombre)'}"`,
      campos: {
        nombre: 'Nombre', categoria: 'Categoría', porciones: 'Porciones',
        margen_pct: { label: 'Margen %', formato: v => `${v ?? 0}%` },
        precio_venta: { label: 'Precio de venta', formato: money },
        descripcion: 'Descripción', preparacion: 'Preparación',
        favorito: { label: 'Favorito', formato: v => (v ? 'Sí' : 'No') },
        foto: { label: 'Foto', formato: () => '(actualizada)' },
      },
    },
    clientes: {
      identificar: d => `Cliente "${d.nombre || '(sin nombre)'}"`,
      campos: { nombre: 'Nombre', telefono: 'Teléfono', direccion: 'Dirección', notas: 'Notas' },
    },
    jornadas: {
      identificar: d => `Jornada "${d.nombre || '(sin nombre)'}"`,
      campos: {
        nombre: 'Nombre',
        tipo: { label: 'Tipo', formato: v => (v === 'evento' ? 'Evento' : 'Venta regular') },
        fecha: { label: 'Fecha', formato: v => fecha(v) },
        ingreso_manual: { label: 'Ingreso manual', formato: money },
        notas: 'Notas',
        incluir_en_analisis: { label: 'Incluir en Reporte de Rentabilidad', formato: v => (v === false ? 'No' : 'Sí') },
      },
    },
    pedidos: {
      identificar: d => (d.numero_pedido ? `Pedido #${d.numero_pedido}` : 'Pedido'),
      campos: {
        cliente_id: { label: 'Cliente', formato: nombreClientePorId },
        fecha_entrega: { label: 'Fecha de entrega', formato: v => fecha(v) },
        hora_entrega: { label: 'Hora de entrega', formato: v => (v ? v.slice(0, 5) : '—') },
        pagado: { label: 'Pago', formato: v => (v ? 'Cobrado' : 'Pendiente') },
        tipo_pago: { label: 'Tipo de pago', formato: v => TIPO_PAGO_LABEL[v || ''] },
        estado_preparacion: { label: 'Preparación', formato: v => PREPARACION_LABEL[v || 'sin_accion'] },
        cancelado: { label: 'Cancelado', formato: v => (v ? 'Sí' : 'No') },
        jornada_id: { label: 'Jornada', formato: v => (v ? nombreJornada(v) : '— Sin jornada —') },
        notas: 'Notas',
        es_mostrador: { label: 'Venta de mostrador', formato: v => (v ? 'Sí' : 'No') },
      },
    },
    gastos: {
      identificar: d => `Gasto "${d.concepto || '(sin concepto)'}"`,
      campos: {
        fecha: { label: 'Fecha', formato: v => fecha(v) },
        categoria: 'Categoría', concepto: 'Concepto',
        monto: { label: 'Monto', formato: money },
        jornada_id: { label: 'Jornada', formato: v => (v ? nombreJornada(v) : 'General') },
      },
    },
    donaciones_jornada: {
      identificar: d => `Donación "${d.concepto || '(sin concepto)'}"`,
      campos: {
        jornada_id: { label: 'Jornada', formato: v => nombreJornada(v) },
        concepto: 'Concepto',
        monto: { label: 'Monto', formato: money },
        fecha: { label: 'Fecha', formato: v => fecha(v) },
      },
    },
    capital_movimientos: {
      identificar: d => `${d.tipo === 'aporte' ? 'Aporte' : 'Retiro'} de ${money(d.monto)}`,
      campos: {
        tipo: { label: 'Tipo', formato: v => (v === 'aporte' ? 'Aporte' : 'Retiro') },
        fecha: { label: 'Fecha', formato: v => fecha(v) },
        monto: { label: 'Monto', formato: money },
        notas: 'Notas',
      },
    },
  };
  const AUDITORIA_TABLA_LABEL = {
    insumos: 'Insumos', recetas: 'Recetas', pedidos: 'Pedidos', clientes: 'Clientes',
    jornadas: 'Jornadas', gastos: 'Gastos', capital_movimientos: 'Capital', donaciones_jornada: 'Donaciones',
  };
  // nunca se muestran como "cambio" -- son metadatos, no algo que un usuario reconozca como
  // haber editado. deleted_at se maneja aparte (es la Papelera, no un campo cualquiera).
  const AUDITORIA_CAMPOS_IGNORADOS = new Set(['id', 'user_id', 'created_at', 'updated_at']);

  function auditoriaEtiquetaCampo(camposCfg, campo) {
    const c = camposCfg[campo];
    if (!c) return campo;
    return typeof c === 'string' ? c : c.label;
  }
  function auditoriaFormatoCampo(camposCfg, campo, valor) {
    const c = camposCfg[campo];
    if (valor === null || valor === undefined) return '—';
    if (!c) return truncarTexto(valor);
    return typeof c === 'string' ? truncarTexto(valor) : c.formato(valor);
  }

  // compara datos_anteriores vs datos_nuevos y devuelve solo las frases de los campos que de
  // verdad cambiaron (ej. "Precio: Bs 7 → Bs 8") -- si algo desapareció de la comparación
  // (updated_at, ids) es a propósito, ver AUDITORIA_CAMPOS_IGNORADOS.
  function auditoriaDiferencias(tabla, anteriores, nuevos) {
    const camposCfg = (AUDITORIA_CONFIG[tabla] || {}).campos || {};
    const a = anteriores || {}, n = nuevos || {};
    const claves = new Set([...Object.keys(a), ...Object.keys(n)]);
    const cambios = [];
    claves.forEach(campo => {
      if (AUDITORIA_CAMPOS_IGNORADOS.has(campo)) return;
      const va = a[campo], vn = n[campo];
      if (campo === 'deleted_at') {
        if (!va && vn) cambios.push('Movió a la Papelera');
        else if (va && !vn) cambios.push('Restauró desde la Papelera');
        return;
      }
      const na = va === null || va === undefined ? null : String(va);
      const nn = vn === null || vn === undefined ? null : String(vn);
      if (na === nn) return;
      const etiqueta = auditoriaEtiquetaCampo(camposCfg, campo);
      cambios.push(`${etiqueta}: ${auditoriaFormatoCampo(camposCfg, campo, va)} → ${auditoriaFormatoCampo(camposCfg, campo, vn)}`);
    });
    return cambios;
  }

  function resumenAuditoria(fila) {
    const cfg = AUDITORIA_CONFIG[fila.tabla];
    if (!cfg) return `${fila.accion} en ${fila.tabla}`;
    if (fila.accion === 'crear') return `Creó ${cfg.identificar(fila.datos_nuevos || {})}`;
    if (fila.accion === 'eliminar') return `Eliminó ${cfg.identificar(fila.datos_anteriores || {})} definitivamente`;
    if (fila.accion === 'editar') {
      const id = cfg.identificar(fila.datos_nuevos || fila.datos_anteriores || {});
      const cambios = auditoriaDiferencias(fila.tabla, fila.datos_anteriores, fila.datos_nuevos);
      return cambios.length ? `Editó ${id} — ${cambios.join(', ')}` : `Guardó ${id} (sin cambios relevantes)`;
    }
    return `${fila.accion} ${cfg.identificar(fila.datos_nuevos || fila.datos_anteriores || {})}`;
  }

  const ACCION_LABEL = { crear: '🟢 Creó', editar: '✎ Editó', eliminar: '🔴 Eliminó' };
  const LIMITE_FILAS_AUDITORIA = 200;

  // Tabla se puebla una sola vez con las 8 conocidas (fijas, no dependen de datos). Usuario se
  // puebla con los emails que de verdad aparecen en el historial -- se refresca cada vez que se
  // abre el modal, con una consulta liviana (solo la columna usuario_email, sin traer todo el
  // resto de cada fila) para no tener que adivinar quién ha usado la app.
  function poblarFiltroTablaAuditoria() {
    const sel = document.getElementById('auditoriaFiltroTabla');
    if (sel.options.length > 1) return; // ya poblado, no hace falta repetirlo cada vez que se abre
    Object.entries(AUDITORIA_TABLA_LABEL).forEach(([valor, etiqueta]) => {
      sel.appendChild(new Option(etiqueta, valor));
    });
  }

  async function poblarFiltroUsuarioAuditoria() {
    const sel = document.getElementById('auditoriaFiltroUsuario');
    const seleccionActual = sel.value;
    try {
      const { data, error } = await window.supabaseClient
        .from('auditoria')
        .select('usuario_email')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      const emails = Array.from(new Set((data || []).map(f => f.usuario_email).filter(Boolean))).sort();
      sel.innerHTML = '<option value="">Todos</option>' + emails.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('');
      sel.value = emails.includes(seleccionActual) ? seleccionActual : '';
    } catch (err) {
      console.warn('No se pudo cargar la lista de usuarios de Auditoría:', err.message || err);
    }
  }

  // lee los filtros activos y corre la MISMA consulta (tabla/usuario/rango de fechas + tope de
  // 200 filas) para la tabla en pantalla y para "Exportar PDF" -- así el PDF nunca puede
  // divergir de lo que se está viendo en ese momento.
  async function consultarAuditoriaFiltrada() {
    const tabla = document.getElementById('auditoriaFiltroTabla').value;
    const usuario = document.getElementById('auditoriaFiltroUsuario').value;
    const desde = document.getElementById('auditoriaFiltroDesde').value;
    const hasta = document.getElementById('auditoriaFiltroHasta').value;

    let q = window.supabaseClient.from('auditoria').select('*').order('created_at', { ascending: false }).limit(LIMITE_FILAS_AUDITORIA);
    if (tabla) q = q.eq('tabla', tabla);
    if (usuario) q = q.eq('usuario_email', usuario);
    if (desde) q = q.gte('created_at', desde + 'T00:00:00');
    if (hasta) q = q.lte('created_at', hasta + 'T23:59:59');

    const { data, error } = await q;
    return { data, error, tabla, usuario, desde, hasta };
  }

  async function cargarAuditoria() {
    const tbody = document.getElementById('tbodyAuditoria');
    const empty = document.getElementById('emptyAuditoria');
    const nota = document.getElementById('auditoriaNotaLimite');

    tbody.innerHTML = `<tr><td colspan="5" class="cell-muted">Cargando…</td></tr>`;
    empty.hidden = true;
    nota.hidden = true;

    const { data, error } = await consultarAuditoriaFiltrada();
    if (error) {
      tbody.innerHTML = '';
      empty.hidden = false;
      empty.textContent = `No se pudo cargar la actividad: ${error.message || error}`;
      return;
    }

    if (!data.length) {
      tbody.innerHTML = '';
      empty.hidden = false;
      empty.textContent = 'No hay actividad que coincida con el filtro.';
      return;
    }

    nota.hidden = data.length < LIMITE_FILAS_AUDITORIA;
    tbody.innerHTML = data.map(fila => `
      <tr>
        <td class="cell-nowrap">${fechaHoraAuditoria(fila.created_at)}</td>
        <td>${esc(fila.usuario_email) || '<span class="cell-muted">desconocido</span>'}</td>
        <td>${AUDITORIA_TABLA_LABEL[fila.tabla] || esc(fila.tabla)}</td>
        <td class="cell-nowrap">${ACCION_LABEL[fila.accion] || esc(fila.accion)}</td>
        <td>${esc(resumenAuditoria(fila))}</td>
      </tr>
    `).join('');
  }

  async function generarPDFAuditoria() {
    const btn = document.getElementById('btnExportarAuditoriaPDF');
    btn.disabled = true;
    try {
      const { data, error, tabla, usuario, desde, hasta } = await consultarAuditoriaFiltrada();
      if (error) { showToast(`No se pudo exportar: ${error.message || error}`); return; }
      if (!data.length) { showToast('No hay actividad que coincida con el filtro para exportar.'); return; }

      const filtrosTxt = [
        tabla ? `Tabla: ${AUDITORIA_TABLA_LABEL[tabla] || tabla}` : null,
        usuario ? `Usuario: ${usuario}` : null,
        desde || hasta ? `Rango: ${desde ? fecha(desde) : 'inicio'} al ${hasta ? fecha(hasta) : 'hoy'}` : null,
      ].filter(Boolean).join(' · ') || 'Sin filtros (todas las tablas y usuarios)';

      const filasHTML = data.map(fila => `
        <tr>
          <td>${fechaHoraAuditoria(fila.created_at)}</td>
          <td>${esc(fila.usuario_email) || 'desconocido'}</td>
          <td>${esc(AUDITORIA_TABLA_LABEL[fila.tabla] || fila.tabla)}</td>
          <td>${esc((ACCION_LABEL[fila.accion] || fila.accion).replace(/^[^\s]+\s/, ''))}</td>
          <td>${esc(resumenAuditoria(fila))}</td>
        </tr>
      `).join('');

      const marca = datosMarcaApp();
      const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Actividad — ${esc(marca.nombre)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#222;padding:16px;margin:0}
  .marca-pdf{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .marca-pdf-icono{font-size:26px;line-height:1;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
  .marca-pdf-icono img{width:32px;height:32px;object-fit:contain}
  h1{font-size:18px;margin:0}
  .marca-pdf .subtitulo-marca{font-size:11px;color:#777;margin:1px 0 0}
  .subtitulo{font-size:12px;color:#666;margin:0 0 4px}
  .nota{font-size:10.5px;color:#777;margin:0 0 14px}
  table{width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed}
  th,td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:break-word;word-break:break-word}
  th{background:#f0f0f0}
  @media print{ body{padding:0} }
</style>
</head>
<body>
  <div class="marca-pdf">
    <span class="marca-pdf-icono">${marca.iconoHTML}</span>
    <div>
      <h1>${esc(marca.nombre)}</h1>
      <p class="subtitulo-marca">${esc(marca.subtitulo)}</p>
    </div>
  </div>
  <p class="subtitulo">Actividad · ${esc(filtrosTxt)} · ${data.length} registro(s) · Generado ${new Date().toLocaleString('es-CO')}</p>
  ${data.length >= LIMITE_FILAS_AUDITORIA ? `<p class="nota">Mostrando los ${LIMITE_FILAS_AUDITORIA} registros más recientes que coinciden con el filtro — puede haber más en el historial completo.</p>` : ''}
  <table>
    <thead>
      <tr><th style="width:15%">Fecha</th><th style="width:18%">Usuario</th><th style="width:10%">Tabla</th><th style="width:10%">Acción</th><th>Resumen</th></tr>
    </thead>
    <tbody>${filasHTML}</tbody>
  </table>
</body>
</html>`;

      const ventana = window.open('', '_blank');
      if (!ventana) { showToast('El navegador bloqueó la ventana. Permite pop-ups para exportar el PDF.'); return; }
      ventana.document.open();
      ventana.document.write(html);
      ventana.document.close();
      setTimeout(() => { try { ventana.focus(); ventana.print(); } catch (e) {} }, 300);
    } finally {
      btn.disabled = false;
    }
  }
  document.getElementById('btnExportarAuditoriaPDF').addEventListener('click', generarPDFAuditoria);

  document.getElementById('btnAuditoria').addEventListener('click', async () => {
    poblarFiltroTablaAuditoria();
    openModal('modalAuditoria');
    await poblarFiltroUsuarioAuditoria();
    cargarAuditoria();
  });
  document.getElementById('auditoriaFiltroTabla').addEventListener('change', cargarAuditoria);
  document.getElementById('auditoriaFiltroUsuario').addEventListener('change', cargarAuditoria);
  document.getElementById('auditoriaFiltroDesde').addEventListener('input', cargarAuditoria);
  document.getElementById('auditoriaFiltroHasta').addEventListener('input', cargarAuditoria);
  document.getElementById('btnLimpiarFiltroAuditoria').addEventListener('click', () => {
    document.getElementById('auditoriaFiltroTabla').value = '';
    document.getElementById('auditoriaFiltroUsuario').value = '';
    document.getElementById('auditoriaFiltroDesde').value = '';
    document.getElementById('auditoriaFiltroHasta').value = '';
    cargarAuditoria();
  });

  // =========================================================
  //  CUENTA / AVATAR / MI CUENTA
  //  El bucket "perfiles" es privado (requiere sesión) -- a diferencia de "recetas-fotos" (ver
  //  aviso aparte, ya migrado al mismo mecanismo), acá se usa createSignedUrl() desde el
  //  principio, regenerada cada vez que carga la app o se abre el modal -- así nunca queda una
  //  URL vencida guardada. El path es determinístico ({user.id}.jpg), así que ni siquiera hace
  //  falta leer user_metadata.avatar_url para saber si hay foto: alcanza con intentar firmar
  //  ese path. Igual se guarda avatar_url en Auth (updateUser) por si algo más lo necesita.
  // =========================================================
  const AVATAR_BUCKET = 'perfiles';
  const AVATAR_VIGENCIA_SEG = 60 * 60 * 24; // 1 día -- se regenera de todas formas en cada carga

  function pathAvatarUsuario(userId) {
    return `${userId}.jpg`;
  }
  // actualiza el ícono del header Y la vista previa grande del modal "Mi cuenta" a la vez --
  // cualquiera de los dos que no exista en ese momento (modal cerrado) simplemente no hace nada.
  function pintarAvatarEnTodosLados(url) {
    document.getElementById('avatarIcono').innerHTML = url ? `<img src="${url}" alt="Foto de perfil">` : '👤';
    const preview = document.getElementById('avatarModalPreview');
    if (preview) preview.innerHTML = url ? `<img src="${url}" alt="Foto de perfil">` : '<span class="foto-placeholder">🍽️</span>';
  }

  async function firmarAvatarUsuario(userId) {
    try {
      return await firmarObjetoStorage(AVATAR_BUCKET, pathAvatarUsuario(userId), AVATAR_VIGENCIA_SEG);
    } catch (err) {
      return null; // sin foto todavía (o no se pudo firmar tras reintentar) -- ícono genérico, sin toast de error
    }
  }

  // "Usuario" por defecto si todavía no configuró un nombre de usuario en perfiles_login.
  function actualizarEtiquetaAvatar(nickname) {
    const el = document.getElementById('avatarEtiqueta');
    if (el) el.textContent = nickname || 'Usuario';
  }

  // se llama una vez por login (ver iniciarSincronizacionConSupabase) -- pinta el ícono del
  // header y su etiqueta (nickname); los demás campos (nombre, teléfono, email) se leen recién
  // al abrir el modal.
  async function refrescarCuentaUsuario() {
    const { data, error } = await window.supabaseClient.auth.getUser();
    if (error || !data.user) return;
    pintarAvatarEnTodosLados(await firmarAvatarUsuario(data.user.id));
    try {
      const { data: perfil, error: errPerfil } = await window.supabaseClient
        .from('perfiles_login').select('nickname').eq('user_id', data.user.id).maybeSingle();
      if (errPerfil) throw errPerfil;
      actualizarEtiquetaAvatar(perfil && perfil.nickname);
    } catch (err) {
      console.warn('No se pudo leer el nombre de usuario para la etiqueta del header:', err.message || err);
    }
  }

  async function abrirModalCuenta() {
    openModal('modalMiCuenta');
    document.getElementById('cuentaNuevaPassword').value = '';
    document.getElementById('cuentaConfirmarPassword').value = '';

    const { data, error } = await window.supabaseClient.auth.getUser();
    if (error || !data.user) { showToast('No se pudo cargar los datos de la cuenta.'); return; }
    const user = data.user;

    document.getElementById('cuentaEmailSoloLectura').value = user.email || '';
    document.getElementById('cuentaNombreCompleto').value = (user.user_metadata && user.user_metadata.nombre_completo) || '';
    document.getElementById('cuentaTelefono').value = (user.user_metadata && user.user_metadata.telefono) || '';
    pintarAvatarEnTodosLados(await firmarAvatarUsuario(user.id));

    document.getElementById('cuentaNickname').value = '';
    try {
      const { data: perfil, error: errPerfil } = await window.supabaseClient
        .from('perfiles_login').select('nickname').eq('user_id', user.id).maybeSingle();
      if (errPerfil) throw errPerfil;
      if (perfil) document.getElementById('cuentaNickname').value = perfil.nickname;
      actualizarEtiquetaAvatar(perfil && perfil.nickname);
    } catch (err) {
      console.warn('No se pudo leer el nombre de usuario actual:', err.message || err);
    }
  }

  document.getElementById('btnCuenta').addEventListener('click', abrirModalCuenta);
  document.getElementById('btnCerrarSesion').addEventListener('click', () => closeModal('modalMiCuenta'));

  // recorta al centro en un cuadrado (mismo criterio "cubrir" que usa el resto de la app para
  // miniaturas) -- sin modal de encuadre manual, no se pidió para el avatar y hoy alcanza con
  // un recorte automático centrado.
  function recortarImagenCuadrada(dataUrl, lado = 256) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = lado; canvas.height = lado;
        const escala = Math.max(lado / img.width, lado / img.height);
        const anchoDibujado = img.width * escala, altoDibujado = img.height * escala;
        canvas.getContext('2d').drawImage(
          img, (lado - anchoDibujado) / 2, (lado - altoDibujado) / 2, anchoDibujado, altoDibujado
        );
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('No se pudo leer esa imagen.'));
      img.src = dataUrl;
    });
  }

  document.getElementById('avatarInput').addEventListener('change', async () => {
    const input = document.getElementById('avatarInput');
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Selecciona un archivo de imagen.'); return; }

    try {
      const { data: userData, error: errUser } = await window.supabaseClient.auth.getUser();
      if (errUser || !userData.user) throw errUser || new Error('No hay sesión activa.');

      const dataUrlOriginal = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('No se pudo leer esa imagen.'));
        reader.readAsDataURL(file);
      });
      const dataUrlCuadrada = await recortarImagenCuadrada(dataUrlOriginal, 256);

      // mismo patrón exacto que subirFotoRecetaAStorage: Blob + upload + upsert:true (path
      // determinístico, así que una foto nueva pisa la anterior sin dejar huérfanos).
      const blob = await (await fetch(dataUrlCuadrada)).blob();
      const path = pathAvatarUsuario(userData.user.id);
      const { error: errSubir } = await window.supabaseClient.storage.from(AVATAR_BUCKET).upload(path, blob, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      if (errSubir) throw errSubir;

      const urlFirmada = await firmarObjetoStorage(AVATAR_BUCKET, path, AVATAR_VIGENCIA_SEG);

      const { error: errUpdate } = await window.supabaseClient.auth.updateUser({ data: { avatar_url: urlFirmada } });
      if (errUpdate) throw errUpdate;

      pintarAvatarEnTodosLados(urlFirmada);
      showToast('Foto de perfil actualizada');
    } catch (err) {
      console.error(err);
      showToast(`No se pudo actualizar la foto de perfil: ${err.message || err}`);
    }
  });

  // Un solo botón "Guardar cambios" para todo el modal (nombre/teléfono/contraseña van en el
  // mismo updateUser; el nombre de usuario es un upsert aparte, a otra tabla) -- separar en un
  // botón por sección hubiera significado repetir la misma lectura de campos varias veces sin
  // ninguna ganancia real, ya que todo se guarda contra el mismo usuario autenticado.
  document.getElementById('formMiCuenta').addEventListener('submit', async e => {
    e.preventDefault();
    const nombreCompleto = document.getElementById('cuentaNombreCompleto').value.trim();
    const telefono = document.getElementById('cuentaTelefono').value.trim();
    const nicknameCrudo = document.getElementById('cuentaNickname').value.trim();
    const nickname = nicknameCrudo.toLowerCase(); // mismo criterio de normalización que auth.js usa al resolver el login
    const nuevaPassword = document.getElementById('cuentaNuevaPassword').value;
    const confirmarPassword = document.getElementById('cuentaConfirmarPassword').value;

    if (nuevaPassword || confirmarPassword) {
      if (nuevaPassword !== confirmarPassword) { showToast('Las contraseñas no coinciden.'); return; }
      if (nuevaPassword.length < 6) { showToast('La nueva contraseña debe tener al menos 6 caracteres.'); return; }
    }

    const btn = document.getElementById('btnGuardarMiCuenta');
    btn.disabled = true;
    try {
      const { data: userData, error: errUser } = await window.supabaseClient.auth.getUser();
      if (errUser || !userData.user) throw errUser || new Error('No hay sesión activa.');

      const cambiosAuth = { data: { nombre_completo: nombreCompleto, telefono } };
      if (nuevaPassword) cambiosAuth.password = nuevaPassword;
      const { error: errUpdate } = await window.supabaseClient.auth.updateUser(cambiosAuth);
      if (errUpdate) throw errUpdate;

      if (nickname) {
        const { error: errNick } = await window.supabaseClient
          .from('perfiles_login')
          .upsert({ user_id: userData.user.id, nickname, email: userData.user.email }, { onConflict: 'user_id' });
        if (errNick) {
          if (errNick.code === '23505') { showToast('Ese nombre de usuario ya está en uso.'); return; }
          throw errNick;
        }
        actualizarEtiquetaAvatar(nickname);
      }

      document.getElementById('cuentaNuevaPassword').value = '';
      document.getElementById('cuentaConfirmarPassword').value = '';
      showToast('Datos de la cuenta actualizados');
      closeModal('modalMiCuenta');
    } catch (err) {
      console.error(err);
      showToast(`No se pudo guardar: ${err.message || err}`);
    } finally {
      btn.disabled = false;
    }
  });

  // =========================================================
  //  CALENDARIO
  // =========================================================
  const NOMBRES_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const NOMBRES_DIA_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const pad2 = n => String(n).padStart(2, '0');
  const comoFechaISO = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  let calendarioAnio, calendarioMes; // mes 0-indexado
  (function inicializarCalendario() {
    const hoy = new Date();
    calendarioAnio = hoy.getFullYear();
    calendarioMes = hoy.getMonth();
  })();

  function jornadasEventoEnFecha(fechaStr) {
    return jornadas.filter(j => j.tipo === 'evento' && j.fecha === fechaStr);
  }
  function cantidadPedidosEnFecha(fechaStr) {
    return pedidos.filter(p => !p.cancelado && p.fechaEntrega === fechaStr).length;
  }

  function irAPedidosConFecha(fechaStr) {
    document.querySelector('.tab-btn[data-view="pedidos"]').click();
    document.getElementById('pedidosFiltroDesde').value = fechaStr;
    document.getElementById('pedidosFiltroHasta').value = fechaStr;
    guardarFiltroFechaPedidos();
    renderPedidos();
  }

  // clic en el DÍA (no en una insignia puntual): si hay un solo Evento ese día, va directo a su
  // detalle -- si hay más de uno, es ambiguo a cuál abrir, así que no hace nada (cada insignia
  // ya es clickeable individualmente para ese caso). Si no hay Evento pero sí Pedidos, navega a
  // Pedidos con el filtro de fecha puesto.
  function manejarClicDiaCalendario(fechaStr) {
    const eventosDia = jornadasEventoEnFecha(fechaStr);
    if (eventosDia.length === 1) { abrirDetalleJornada(eventosDia[0].id); return; }
    if (eventosDia.length > 1) return;
    if (cantidadPedidosEnFecha(fechaStr) > 0) irAPedidosConFecha(fechaStr);
  }

  const MAX_INSIGNIAS_EVENTO_VISIBLES = 2;

  function celdaCalendarioHTML(fechaObj, esOtroMes, hoyStr) {
    const fechaStr = comoFechaISO(fechaObj);
    const eventosDia = jornadasEventoEnFecha(fechaStr);
    const cantidadPedidos = cantidadPedidosEnFecha(fechaStr);

    const visibles = eventosDia.slice(0, MAX_INSIGNIAS_EVENTO_VISIBLES);
    const restantes = eventosDia.length - visibles.length;
    const insigniasHTML = visibles.map(j =>
      `<span class="badge badge-neutral calendario-badge-evento" data-jornada-id="${j.id}" title="${esc(j.nombre)}">${esc(j.nombre)}</span>`
    ).join('') + (restantes > 0 ? `<span class="badge badge-neutral calendario-badge-evento" title="${restantes} evento(s) más este día">+${restantes}</span>` : '');

    return `
      <div class="calendario-dia${esOtroMes ? ' otro-mes' : ''}${fechaStr === hoyStr ? ' hoy' : ''}" data-fecha="${fechaStr}">
        <div class="calendario-dia-numero">${fechaObj.getDate()}</div>
        <div class="calendario-dia-eventos">${insigniasHTML}</div>
        ${cantidadPedidos ? `<span class="calendario-dia-pedidos" title="${cantidadPedidos} pedido(s) con entrega este día">${cantidadPedidos}</span>` : ''}
      </div>
    `;
  }

  function renderCalendario() {
    document.getElementById('calendarioTitulo').textContent = `${NOMBRES_MES[calendarioMes]} ${calendarioAnio}`;

    const primerDiaMes = new Date(calendarioAnio, calendarioMes, 1);
    const diasEnMes = new Date(calendarioAnio, calendarioMes + 1, 0).getDate();
    const primerDiaSemana = primerDiaMes.getDay(); // 0 = domingo
    const totalCeldas = primerDiaSemana + diasEnMes;
    const sobrantes = (7 - (totalCeldas % 7)) % 7;
    const hoyStr = comoFechaISO(new Date());

    let html = NOMBRES_DIA_CORTO.map(d => `<div class="calendario-dia-nombre">${d}</div>`).join('');
    for (let i = 0; i < primerDiaSemana; i++) {
      html += celdaCalendarioHTML(new Date(calendarioAnio, calendarioMes, i - primerDiaSemana + 1), true, hoyStr);
    }
    for (let dia = 1; dia <= diasEnMes; dia++) {
      html += celdaCalendarioHTML(new Date(calendarioAnio, calendarioMes, dia), false, hoyStr);
    }
    for (let i = 1; i <= sobrantes; i++) {
      html += celdaCalendarioHTML(new Date(calendarioAnio, calendarioMes + 1, i), true, hoyStr);
    }
    document.getElementById('calendarioGrid').innerHTML = html;

    document.querySelectorAll('#calendarioGrid [data-jornada-id]').forEach(el =>
      el.addEventListener('click', e => { e.stopPropagation(); abrirDetalleJornada(el.getAttribute('data-jornada-id')); }));
    document.querySelectorAll('#calendarioGrid .calendario-dia[data-fecha]').forEach(el =>
      el.addEventListener('click', () => manejarClicDiaCalendario(el.getAttribute('data-fecha'))));
  }

  document.getElementById('btnCalendarioAnterior').addEventListener('click', () => {
    calendarioMes--; if (calendarioMes < 0) { calendarioMes = 11; calendarioAnio--; }
    renderCalendario();
  });
  document.getElementById('btnCalendarioSiguiente').addEventListener('click', () => {
    calendarioMes++; if (calendarioMes > 11) { calendarioMes = 0; calendarioAnio++; }
    renderCalendario();
  });
  document.getElementById('btnCalendarioHoy').addEventListener('click', () => {
    const hoy = new Date();
    calendarioAnio = hoy.getFullYear();
    calendarioMes = hoy.getMonth();
    renderCalendario();
  });

  // =========================================================
  //  COMPRAS (carrito compartido entre cuentas, tabla carrito_compras en Supabase)
  //  Sin copia local -- se lee fresco de Supabase cada vez que se abre la pestaña, igual que
  //  Auditoría/Rentabilidad. carritoActivoActual guarda el último resultado cargado, para que
  //  "Exportar PDF" y "Finalizar compra" no tengan que volver a pedirlo.
  // =========================================================
  let carritoActivoActual = [];

  function nombrePlatoCarrito(fila) {
    const receta = recetas.find(r => r.id === fila.receta_id);
    return receta ? esc(receta.nombre) : `${esc(fila.receta_nombre)}${etiquetaEnPapeleraHTML(false)}`;
  }

  // versión en texto plano de nombrePlatoCarrito, para usar dentro de un PDF (sin el badge HTML)
  function nombrePlatoCarritoTexto(fila) {
    const receta = recetas.find(r => r.id === fila.receta_id);
    return receta ? receta.nombre : `${fila.receta_nombre} (eliminada)`;
  }

  function pintarBadgeCarrito(cantidad) {
    const badge = document.getElementById('badgeCarritoCompras');
    badge.hidden = !cantidad;
    badge.textContent = cantidad > 99 ? '99+' : String(cantidad);
  }

  async function actualizarBadgeCarrito() {
    try {
      const { count, error } = await window.supabaseClient
        .from('carrito_compras').select('id', { count: 'exact', head: true })
        .is('lote_id', null).is('deleted_at', null);
      if (error) throw error;
      pintarBadgeCarrito(count || 0);
    } catch (err) {
      console.error(err);
    }
  }

  async function renderCompras() {
    const tbody = document.getElementById('tbodyCarritoItems');
    tbody.innerHTML = `<tr><td colspan="3" class="cell-muted">Cargando…</td></tr>`;
    try {
      const { data: activos, error } = await window.supabaseClient
        .from('carrito_compras').select('*').is('lote_id', null).is('deleted_at', null).order('created_at');
      if (error) throw error;
      carritoActivoActual = activos;
      pintarBadgeCarrito(activos.length);

      document.getElementById('emptyCarrito').hidden = activos.length !== 0;
      tbody.innerHTML = activos.map(f => `
        <tr>
          <td>${nombrePlatoCarrito(f)}</td>
          <td>${f.cantidad_platos}</td>
          <td class="col-actions"><button class="btn-icon danger" title="Quitar del carrito" data-quitar-carrito="${f.id}">🗑</button></td>
        </tr>
      `).join('');
      tbody.querySelectorAll('[data-quitar-carrito]').forEach(b =>
        b.addEventListener('click', () => quitarDelCarrito(b.getAttribute('data-quitar-carrito'))));

      const itemsParaConsolidar = activos.map(f => ({ recetaId: f.receta_id, cantidadPlatos: f.cantidad_platos }));
      const { consolidado, totalGeneral, hayRecetaSinDatos } = consolidarInsumosDeCarrito(itemsParaConsolidar);
      document.getElementById('tbodyCarritoConsolidado').innerHTML = consolidado.map(it => `
        <tr>
          <td>${esc(it.nombre)}</td>
          <td class="num">${formatoCantidad(it.cantidadNecesaria)} ${UNITS[it.unidad] ? UNITS[it.unidad].label : esc(it.unidad)}</td>
          <td class="num">${money(it.costo)}</td>
        </tr>
      `).join('');
      document.getElementById('carritoConsolidadoTotal').textContent = money(totalGeneral);

      const notaEliminadas = document.getElementById('carritoNotaEliminadas');
      notaEliminadas.hidden = !hayRecetaSinDatos;
      notaEliminadas.textContent = hayRecetaSinDatos
        ? '⚠ Uno o más platos del carrito son de una receta ya eliminada -- no se pueden incluir en el consolidado porque no queda su lista de ingredientes.'
        : '';

      const { data: historial, error: errHist } = await window.supabaseClient
        .from('carrito_compras').select('*, compras_lotes(nombre, created_at)').not('lote_id', 'is', null).is('deleted_at', null);
      if (errHist) throw errHist;
      renderHistorialCompras(historial);
    } catch (err) {
      console.error(err);
      tbody.innerHTML = '';
      showToast(`No se pudo cargar el carrito de compras: ${err.message || err}`);
    }
  }

  async function quitarDelCarrito(id) {
    if (!confirm('¿Quitar este plato del carrito?')) return;
    try {
      const { error } = await window.supabaseClient
        .from('carrito_compras').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      renderCompras();
    } catch (err) {
      console.error(err);
      showToast(`No se pudo quitar del carrito: ${err.message || err}`);
    }
  }

  document.getElementById('btnFinalizarCompra').addEventListener('click', async () => {
    if (!carritoActivoActual.length) { showToast('El carrito está vacío.'); return; }
    const sugerido = `Compra ${fecha(new Date().toISOString())}`;
    const nombreIngresado = prompt('Nombre de esta compra:', sugerido);
    if (nombreIngresado === null) return; // canceló -- el prompt hace de confirmación
    const nombreLote = nombreIngresado.trim() || sugerido;

    const btn = document.getElementById('btnFinalizarCompra');
    btn.disabled = true;
    try {
      const { data: lote, error: errLote } = await window.supabaseClient
        .from('compras_lotes').insert({ nombre: nombreLote, user_id: window.SUPABASE_USER_ID }).select().single();
      if (errLote) throw errLote;
      const { error } = await window.supabaseClient
        .from('carrito_compras').update({ lote_id: lote.id }).in('id', carritoActivoActual.map(f => f.id));
      if (error) throw error;
      showToast(`Compra "${nombreLote}" finalizada -- el carrito quedó vacío y se movió al Historial`);
      renderCompras();
    } catch (err) {
      console.error(err);
      showToast(`No se pudo finalizar la compra: ${err.message || err}`);
    } finally {
      btn.disabled = false;
    }
  });

  function generarPDFCarrito() {
    if (!carritoActivoActual.length) { showToast('El carrito está vacío.'); return; }
    const itemsParaConsolidar = carritoActivoActual.map(f => ({ recetaId: f.receta_id, cantidadPlatos: f.cantidad_platos }));
    const { consolidado, totalGeneral } = consolidarInsumosDeCarrito(itemsParaConsolidar);
    const platosTxt = carritoActivoActual.map(f => `${f.cantidad_platos} × ${esc(f.receta_nombre)}`).join(', ');

    const filasHTML = consolidado.map(it => `
      <tr>
        <td>${esc(it.nombre)}</td>
        <td class="num">${formatoCantidad(it.cantidadNecesaria)} ${UNITS[it.unidad] ? UNITS[it.unidad].label : esc(it.unidad)}</td>
        <td class="num">${money(it.costo)}</td>
      </tr>
    `).join('');

    const marca = datosMarcaApp();
    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Carrito de compras — ${esc(marca.nombre)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#222;padding:16px;margin:0}
  .marca-pdf{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .marca-pdf-icono{font-size:26px;line-height:1;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
  .marca-pdf-icono img{width:32px;height:32px;object-fit:contain}
  h1{font-size:18px;margin:0}
  .marca-pdf .subtitulo-marca{font-size:11px;color:#777;margin:1px 0 0}
  .subtitulo{font-size:12px;color:#666;margin:0 0 6px}
  .platos{font-size:11px;color:#555;margin:0 0 16px}
  table{width:100%;border-collapse:collapse;font-size:10.5px;table-layout:fixed}
  th,td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:break-word;word-break:break-word}
  th{background:#f0f0f0}
  td.num,th.num{text-align:right}
  tfoot td{font-weight:bold;background:#f7f7f7}
  @media print{ body{padding:0} }
</style>
</head>
<body>
  <div class="marca-pdf">
    <span class="marca-pdf-icono">${marca.iconoHTML}</span>
    <div>
      <h1>${esc(marca.nombre)}</h1>
      <p class="subtitulo-marca">${esc(marca.subtitulo)}</p>
    </div>
  </div>
  <p class="subtitulo">Carrito de compras (consolidado) · Generado ${new Date().toLocaleString('es-CO')}</p>
  <p class="platos"><strong>Platos:</strong> ${platosTxt}</p>
  <table>
    <thead><tr><th>Insumo</th><th class="num">Cantidad total necesaria</th><th class="num">Costo total</th></tr></thead>
    <tbody>${filasHTML}</tbody>
    <tfoot><tr><td colspan="2">Total general</td><td class="num">${money(totalGeneral)}</td></tr></tfoot>
  </table>
</body>
</html>`;

    const ventana = window.open('', '_blank');
    if (!ventana) { showToast('El navegador bloqueó la ventana. Permite pop-ups para exportar el PDF.'); return; }
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
    setTimeout(() => { try { ventana.focus(); ventana.print(); } catch (e) {} }, 300);
  }
  document.getElementById('btnExportarCarritoPDF').addEventListener('click', generarPDFCarrito);

  // cada tanda del historial (un "lote") acumula sus platos + su consolidado ya calculado, para
  // que los botones de PDF (individual y "exportar todo") no tengan que recalcular nada.
  let tandasHistorialActual = [];

  // agrupa las filas archivadas por lote_id (cada "Finalizar compra" crea una fila nueva en
  // compras_lotes y le asigna ese id a todas las filas de esa tanda a la vez).
  function renderHistorialCompras(filasHistorial) {
    const porLote = new Map();
    filasHistorial.forEach(fila => {
      const clave = fila.lote_id;
      if (!porLote.has(clave)) porLote.set(clave, { nombre: fila.compras_lotes ? fila.compras_lotes.nombre : '(compra sin nombre)', fecha: fila.compras_lotes ? fila.compras_lotes.created_at : null, filas: [] });
      porLote.get(clave).filas.push(fila);
    });

    tandasHistorialActual = Array.from(porLote.entries()).map(([loteId, info]) => {
      const itemsParaConsolidar = info.filas.map(f => ({ recetaId: f.receta_id, cantidadPlatos: f.cantidad_platos }));
      const { consolidado, totalGeneral } = consolidarInsumosDeCarrito(itemsParaConsolidar);
      return { loteId, nombre: info.nombre, fecha: info.fecha, filas: info.filas, consolidado, totalGeneral };
    }).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    document.getElementById('btnExportarHistorialCompletoPDF').hidden = !tandasHistorialActual.length;

    const wrap = document.getElementById('historialComprasWrap');
    if (!tandasHistorialActual.length) {
      wrap.innerHTML = '<p class="empty-state">Todavía no hay compras finalizadas.</p>';
      return;
    }

    wrap.innerHTML = tandasHistorialActual.map(t => {
      const platosTxt = t.filas.map(f => `${f.cantidad_platos} × ${nombrePlatoCarrito(f)}`).join('<br>');
      const filasInsumosHTML = t.consolidado.map(it => `
        <tr>
          <td>${esc(it.nombre)}</td>
          <td>${formatoCantidad(it.cantidadNecesaria)} ${UNITS[it.unidad] ? UNITS[it.unidad].label : esc(it.unidad)}</td>
          <td>${money(it.costo)}</td>
        </tr>
      `).join('');
      return seccionColapsableHTML(
        `📦 ${esc(t.nombre)} · ${fechaHoraAuditoria(t.fecha)} — ${t.filas.length} plato(s) · ${money(t.totalGeneral)}`,
        `
          <p><strong>Platos de esta compra:</strong><br>${platosTxt}</p>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Insumo</th><th>Cantidad</th><th>Costo</th></tr></thead>
              <tbody>${filasInsumosHTML}</tbody>
              <tfoot><tr><td colspan="2">Total</td><td>${money(t.totalGeneral)}</td></tr></tfoot>
            </table>
          </div>
        `,
        `<button type="button" class="btn btn-ghost btn-sm" data-pdf-lote="${t.loteId}">🖨 Exportar PDF</button>`
      );
    }).join('');

    // empiezan colapsadas a propósito -- con varias tandas acumuladas, mostrarlas todas
    // expandidas de una sería demasiado para escanear de un vistazo.
    wrap.querySelectorAll('.detail-section').forEach(s => s.classList.add('colapsado'));
    wrap.querySelectorAll('[data-toggle-seccion]').forEach(header =>
      header.addEventListener('click', e => {
        if (e.target.closest('[data-accion-seccion]')) return; // no colapsar al clickear "Exportar PDF"
        header.closest('.detail-section').classList.toggle('colapsado');
      }));
    wrap.querySelectorAll('[data-pdf-lote]').forEach(b =>
      b.addEventListener('click', () => generarPDFLoteCompra(b.getAttribute('data-pdf-lote'))));
  }

  // encabezado + estilos compartidos por el PDF de una sola compra y el PDF del historial completo
  function abrirVentanaPDF(tituloDoc, subtituloGeneral, seccionesHTML) {
    const marca = datosMarcaApp();
    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${esc(tituloDoc)} — ${esc(marca.nombre)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#222;padding:16px;margin:0}
  .marca-pdf{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .marca-pdf-icono{font-size:26px;line-height:1;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
  .marca-pdf-icono img{width:32px;height:32px;object-fit:contain}
  h1{font-size:18px;margin:0}
  h2{font-size:14px;margin:18px 0 4px;border-top:1px solid #ddd;padding-top:10px}
  .tanda:first-of-type h2{border-top:none;padding-top:0;margin-top:6px}
  .marca-pdf .subtitulo-marca{font-size:11px;color:#777;margin:1px 0 0}
  .subtitulo{font-size:12px;color:#666;margin:0 0 6px}
  .platos{font-size:11px;color:#555;margin:0 0 10px}
  table{width:100%;border-collapse:collapse;font-size:10.5px;table-layout:fixed;margin-bottom:6px}
  th,td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:break-word;word-break:break-word}
  th{background:#f0f0f0}
  td.num,th.num{text-align:right}
  tfoot td{font-weight:bold;background:#f7f7f7}
  @media print{ body{padding:0} .tanda{page-break-inside:avoid} }
</style>
</head>
<body>
  <div class="marca-pdf">
    <span class="marca-pdf-icono">${marca.iconoHTML}</span>
    <div>
      <h1>${esc(marca.nombre)}</h1>
      <p class="subtitulo-marca">${esc(marca.subtitulo)}</p>
    </div>
  </div>
  <p class="subtitulo">${esc(subtituloGeneral)} · Generado ${new Date().toLocaleString('es-CO')}</p>
  ${seccionesHTML}
</body>
</html>`;

    const ventana = window.open('', '_blank');
    if (!ventana) { showToast('El navegador bloqueó la ventana. Permite pop-ups para exportar el PDF.'); return; }
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
    setTimeout(() => { try { ventana.focus(); ventana.print(); } catch (e) {} }, 300);
  }

  function seccionTandaParaPDF(t) {
    const platosTxt = t.filas.map(f => `${f.cantidad_platos} × ${esc(nombrePlatoCarritoTexto(f))}`).join(', ');
    const filasHTML = t.consolidado.map(it => `
      <tr>
        <td>${esc(it.nombre)}</td>
        <td class="num">${formatoCantidad(it.cantidadNecesaria)} ${UNITS[it.unidad] ? UNITS[it.unidad].label : esc(it.unidad)}</td>
        <td class="num">${money(it.costo)}</td>
      </tr>
    `).join('');
    return `
      <div class="tanda">
        <h2>${esc(t.nombre)}</h2>
        <p class="subtitulo">Finalizada el ${fechaHoraAuditoria(t.fecha)}</p>
        <p class="platos"><strong>Platos:</strong> ${platosTxt}</p>
        <table>
          <thead><tr><th>Insumo</th><th class="num">Cantidad total necesaria</th><th class="num">Costo total</th></tr></thead>
          <tbody>${filasHTML}</tbody>
          <tfoot><tr><td colspan="2">Total de esta compra</td><td class="num">${money(t.totalGeneral)}</td></tr></tfoot>
        </table>
      </div>
    `;
  }

  function generarPDFLoteCompra(loteId) {
    const t = tandasHistorialActual.find(x => x.loteId === loteId);
    if (!t) { showToast('No se encontró esta compra.'); return; }
    abrirVentanaPDF(`Compra: ${t.nombre}`, `Compra "${t.nombre}"`, seccionTandaParaPDF(t));
  }

  function generarPDFHistorialCompleto() {
    if (!tandasHistorialActual.length) { showToast('Todavía no hay compras finalizadas.'); return; }
    abrirVentanaPDF('Historial de compras', `Historial de compras (${tandasHistorialActual.length} compra(s))`, tandasHistorialActual.map(seccionTandaParaPDF).join(''));
  }
  document.getElementById('btnExportarHistorialCompletoPDF').addEventListener('click', generarPDFHistorialCompleto);

  // Papelera del carrito: reutiliza SOLO el modal compartido (#modalPapelera y sus hijos) --
  // no el PAPELERA_CONFIG/papelera[tipo] genérico, porque ese es 100% local/localStorage y
  // carrito_compras es una entidad viva y compartida entre cuentas. Por eso son funciones
  // aparte, con sus propios data-* para no chocar con los handlers genéricos de abrirPapelera().
  function abrirPapeleraCarrito() {
    document.getElementById('papeleraModalTitulo').textContent = 'Papelera del carrito de compras';
    document.getElementById('btnVaciarPapelera').hidden = true; // no se pidió "vaciar todo" para esta entidad
    renderPapeleraCarrito();
    openModal('modalPapelera');
  }

  async function renderPapeleraCarrito() {
    const tbody = document.getElementById('tbodyPapelera');
    tbody.innerHTML = `<tr><td colspan="3" class="cell-muted">Cargando…</td></tr>`;
    try {
      const { data: eliminados, error } = await window.supabaseClient
        .from('carrito_compras').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
      if (error) throw error;

      document.getElementById('emptyPapelera').hidden = eliminados.length !== 0;
      tbody.innerHTML = eliminados.map(f => `
        <tr>
          <td>${f.cantidad_platos} × ${nombrePlatoCarrito(f)}</td>
          <td class="cell-muted" style="white-space:nowrap">${fechaHoraAuditoria(f.deleted_at)}</td>
          <td class="col-actions">
            <button class="btn-icon" title="Restaurar" data-restaurar-carrito-papelera="${f.id}">↺</button>
            <button class="btn-icon danger" title="Eliminar definitivamente" data-borrar-carrito-papelera="${f.id}">🗑</button>
          </td>
        </tr>
      `).join('');
      tbody.querySelectorAll('[data-restaurar-carrito-papelera]').forEach(b =>
        b.addEventListener('click', () => restaurarCarritoDePapelera(b.getAttribute('data-restaurar-carrito-papelera'))));
      tbody.querySelectorAll('[data-borrar-carrito-papelera]').forEach(b =>
        b.addEventListener('click', () => eliminarCarritoDefinitivoDePapelera(b.getAttribute('data-borrar-carrito-papelera'))));
    } catch (err) {
      console.error(err);
      tbody.innerHTML = '';
      showToast(`No se pudo cargar la papelera del carrito: ${err.message || err}`);
    }
  }

  async function restaurarCarritoDePapelera(id) {
    try {
      const { error } = await window.supabaseClient.from('carrito_compras').update({ deleted_at: null }).eq('id', id);
      if (error) throw error;
      showToast('Plato restaurado al carrito');
      renderPapeleraCarrito();
      renderCompras();
    } catch (err) {
      console.error(err);
      showToast(`No se pudo restaurar: ${err.message || err}`);
    }
  }

  async function eliminarCarritoDefinitivoDePapelera(id) {
    if (!confirm('¿Eliminar definitivamente este elemento? Esta acción no se puede deshacer.')) return;
    try {
      const { error } = await window.supabaseClient.from('carrito_compras').delete().eq('id', id);
      if (error) throw error;
      showToast('Elemento eliminado definitivamente');
      renderPapeleraCarrito();
    } catch (err) {
      console.error(err);
      showToast(`No se pudo eliminar definitivamente: ${err.message || err}`);
    }
  }

  document.getElementById('btnPapeleraCarrito').addEventListener('click', abrirPapeleraCarrito);

  // =========================================================
  //  EXPORTAR / IMPORTAR
  // =========================================================
  document.getElementById('btnAbrirDatos').addEventListener('click', () => openModal('modalDatos'));

  document.getElementById('btnExport').addEventListener('click', () => {
    const payload = {
      insumos, recetas, pedidos, clientes, categoriasInsumos, categoriasRecetas,
      jornadas, gastos, capitalMovimientos, categoriasGastos, donaciones,
      exportadoEn: new Date().toISOString(), version: 1,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kitchencost-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Datos exportados');
  });

  const fileImport = document.getElementById('fileImport');
  document.getElementById('btnImport').addEventListener('click', () => fileImport.click());
  fileImport.addEventListener('change', () => {
    const file = fileImport.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); }
      catch (e) { showToast('El archivo no es un JSON válido.'); return; }
      if (!Array.isArray(data.insumos) || !Array.isArray(data.recetas)) {
        showToast('El archivo no tiene el formato esperado.'); return;
      }
      if (!confirm('Esto reemplazará todos los insumos y recetas actuales. ¿Continuar?')) return;
      insumos = data.insumos;
      recetas = data.recetas;
      if (Array.isArray(data.pedidos)) pedidos = data.pedidos;
      if (Array.isArray(data.clientes)) clientes = data.clientes;
      if (Array.isArray(data.categoriasInsumos)) categoriasInsumos = data.categoriasInsumos;
      if (Array.isArray(data.categoriasRecetas)) categoriasRecetas = data.categoriasRecetas;
      if (Array.isArray(data.jornadas)) jornadas = data.jornadas;
      if (Array.isArray(data.gastos)) gastos = data.gastos;
      if (Array.isArray(data.capitalMovimientos)) capitalMovimientos = data.capitalMovimientos;
      if (Array.isArray(data.categoriasGastos)) categoriasGastos = data.categoriasGastos;
      if (Array.isArray(data.donaciones)) donaciones = data.donaciones;
      saveInsumos();
      saveRecetas();
      savePedidos();
      saveClientes();
      saveCategoriasInsumos();
      saveCategoriasRecetas();
      saveJornadas();
      saveGastos();
      saveCapital();
      saveCategoriasGastos();
      saveDonaciones();
      renderInsumos();
      renderRecetas();
      renderPedidos();
      renderClientes();
      renderJornadas();
      renderGastos();
      renderCapital();
      renderStatsFinanzas();
      showToast('Datos importados correctamente');
    };
    reader.readAsText(file);
    fileImport.value = '';
  });

  // =========================================================
  //  EXPORTAR EXCEL (con fórmulas) / CSV
  // =========================================================
  // Cada hoja se construye ya con los valores calculados (para que se vea bien en cualquier
  // visor), y además se le agregan las fórmulas equivalentes en las celdas que dependen de
  // otras (mismo cálculo que hacen calcReceta/calcPedido/calcJornada/calcFinanzas en la app),
  // para que abriendo el Excel se pueda ver y verificar cómo se llega a cada número.
  function setFormula(ws, r, c, formula) {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (ws[addr]) ws[addr].f = formula;
  }

  async function construirDatosParaExportar() {
    const hojas = [];

    // ---------- Insumos ----------
    const insumosOrdenados = insumos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
    const insumoRowMap = new Map(); // insumoId -> fila de Excel (1-indexada) en la hoja Insumos
    // "Merma %" y "Costo efectivo" se agregan AL FINAL (no en medio) para no correr las
    // columnas existentes -- otras fórmulas de este archivo referencian columnas de esta hoja
    // por letra fija (ver insumoRowMap más abajo).
    const insumosAOA = [['Nombre', 'Categoría', 'Unidad', 'Precio', 'Proveedor', 'Actualizado', 'Merma %', 'Costo efectivo', 'ID']];
    insumosOrdenados.forEach((i, idx) => {
      insumosAOA.push([
        i.nombre, i.categoria || '', UNITS[i.unidad] ? UNITS[i.unidad].label : (i.unidad || ''), i.precio || 0, i.proveedor || '', i.actualizado || '',
        i.mermaPct || 0, costoEfectivoInsumo(i), i.id,
      ]);
      insumoRowMap.set(i.id, idx + 2);
    });
    hojas.push({ nombre: 'Insumos', aoa: insumosAOA, formulas: [] });

    // ---------- Ingredientes / OtrosCostos / Recetas ----------
    const recetasOrdenadas = recetas.slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
    const ingAOA = [['Receta', 'Insumo', 'Cantidad usada', 'Unidad usada', 'Factor unidad usada→base', 'Costo efectivo insumo (por unidad de compra, ya con merma)', 'Factor unidad insumo→base', 'Costo', 'ID Receta', 'ID Insumo']];
    const costAOA = [['Receta', 'Concepto', 'Cantidad', 'Precio unitario', 'Costo', 'ID Receta']];
    const recetasAOA = [['Nombre', 'Categoría', 'Porciones', 'Costo ingredientes', 'Otros costos', 'Costo total', 'Costo por plato', 'Margen deseado (%)', 'Precio sugerido', 'Precio de venta (manual)', 'Precio de referencia', 'Utilidad por plato', 'Margen real (%)', 'ID']];
    const ingFormulas = [];
    const costFormulas = [];
    const recetasFormulas = [];
    let ingRow = 1, costRow = 1;

    recetasOrdenadas.forEach(r => {
      const c = calcReceta(r);

      const ingStart = ingRow + 1;
      (r.ingredientes || []).forEach((ing, idx2) => {
        ingRow++;
        const d = c.detalle[idx2];
        const insumo = insumos.find(x => x.id === ing.insumoId);
        const uUso = UNITS[ing.unidad];
        const uIns = insumo ? UNITS[insumo.unidad] : null;
        const nota = !insumo ? ' (insumo eliminado)' : (!uUso || !uIns || uUso.group !== uIns.group ? ' (unidad incompatible)' : '');
        ingAOA.push([
          r.nombre, (d.nombre || '') + nota, ing.cantidad || 0,
          uUso ? uUso.label : (ing.unidad || ''), uUso ? uUso.factor : 0,
          insumo ? costoEfectivoInsumo(insumo) : 0, uIns ? uIns.factor : 0, d.costo,
          r.id, insumo ? insumo.id : '',
        ]);
        if (insumo && insumoRowMap.has(insumo.id)) {
          // columna H de la hoja Insumos = "Costo efectivo" (ya incluye la merma) -- no la D
          // ("Precio"), para que la fórmula visible en Excel calcule lo mismo que calcIngrediente().
          ingFormulas.push({ r: ingRow - 1, c: 5, f: `Insumos!H${insumoRowMap.get(insumo.id)}` });
          ingFormulas.push({ r: ingRow - 1, c: 7, f: `C${ingRow}*E${ingRow}*(F${ingRow}/G${ingRow})` });
        }
      });
      const ingEnd = ingRow;

      const costStart = costRow + 1;
      (c.costosAdicionales || []).forEach(cc => {
        costRow++;
        costAOA.push([r.nombre, cc.concepto || '(sin nombre)', cc.cantidad || 0, cc.precioUnitario || 0, cc.costo, r.id]);
        costFormulas.push({ r: costRow - 1, c: 4, f: `C${costRow}*D${costRow}` });
      });
      const costEnd = costRow;

      recetasAOA.push([
        r.nombre, r.categoria || '', r.porciones || 1,
        c.costoIngredientes, c.totalCostosAdicionales, c.costoTotal, c.costoPorPlato,
        r.margenPct || 0, c.precioSugerido, r.precioVenta || '', c.precioReferencia, c.utilidadPorPlato, c.margenReal,
        r.id,
      ]);
      const rIdx = recetasAOA.length - 2; // fila 0-indexada de esta receta dentro del AOA (sin contar encabezado)
      const excelRow = rIdx + 2;
      if ((r.ingredientes || []).length) recetasFormulas.push({ r: rIdx + 1, c: 3, f: `SUM(Ingredientes!H${ingStart}:H${ingEnd})` });
      if ((c.costosAdicionales || []).length) recetasFormulas.push({ r: rIdx + 1, c: 4, f: `SUM(OtrosCostos!E${costStart}:E${costEnd})` });
      recetasFormulas.push({ r: rIdx + 1, c: 5, f: `D${excelRow}+E${excelRow}` });
      recetasFormulas.push({ r: rIdx + 1, c: 6, f: `F${excelRow}/C${excelRow}` });
      recetasFormulas.push({ r: rIdx + 1, c: 8, f: `G${excelRow}*(1+H${excelRow}/100)` });
      recetasFormulas.push({ r: rIdx + 1, c: 10, f: `IF(J${excelRow}>0,J${excelRow},I${excelRow})` });
      recetasFormulas.push({ r: rIdx + 1, c: 11, f: `K${excelRow}-G${excelRow}` });
      recetasFormulas.push({ r: rIdx + 1, c: 12, f: `IF(G${excelRow}>0,(K${excelRow}-G${excelRow})/G${excelRow}*100,0)` });
    });

    hojas.push({ nombre: 'Ingredientes', aoa: ingAOA, formulas: ingFormulas });
    hojas.push({ nombre: 'OtrosCostos', aoa: costAOA, formulas: costFormulas });
    hojas.push({ nombre: 'Recetas', aoa: recetasAOA, formulas: recetasFormulas });

    // ---------- PedidoItems / Pedidos ----------
    const pedidosOrdenados = pedidos.slice().sort((a, b) => `${a.fechaEntrega}${a.horaEntrega}`.localeCompare(`${b.fechaEntrega}${b.horaEntrega}`));
    const itemsAOA = [['Pedido', 'Cliente', 'Plato', 'Cantidad', 'Precio unitario (congelado)', 'Subtotal', 'ID Pedido', 'ID Receta']];
    const pedidosAOA = [['N°', 'Cliente', 'Teléfono', 'Entrega', 'Jornada', 'Total', 'Pagado', 'Cancelado', 'Preparación', 'Notas', 'Total platos', 'ID']];
    const itemsFormulas = [];
    const pedidosFormulas = [];
    let itemRow = 1;

    pedidosOrdenados.forEach(p => {
      const cliente = clienteDePedido(p);
      const c = calcPedido(p);
      const start = itemRow + 1;
      c.items.forEach(it => {
        itemRow++;
        itemsAOA.push([p.numeroPedido ? '#' + p.numeroPedido : '', cliente.nombre, it.nombre, it.cantidad || 0, it.precioUnitario, it.subtotal, p.id, it.recetaId || '']);
        itemsFormulas.push({ r: itemRow - 1, c: 5, f: `D${itemRow}*E${itemRow}` });
      });
      const end = itemRow;
      pedidosAOA.push([
        p.numeroPedido || '', cliente.nombre, cliente.telefono || '', fechaHoraEntrega(p),
        p.jornadaId ? (nombreJornada(p.jornadaId) || '') : '',
        c.total, !!p.pagado, !!p.cancelado, PREPARACION_LABEL[p.estadoPreparacion || 'sin_accion'], p.notas || '', c.totalPlatos,
        p.id,
      ]);
      const rIdx = pedidosAOA.length - 2;
      const excelRow = rIdx + 2;
      if (c.items.length) {
        pedidosFormulas.push({ r: rIdx + 1, c: 5, f: `SUM(PedidoItems!F${start}:F${end})` });
        pedidosFormulas.push({ r: rIdx + 1, c: 10, f: `SUM(PedidoItems!D${start}:D${end})` });
      }
    });

    hojas.push({ nombre: 'PedidoItems', aoa: itemsAOA, formulas: itemsFormulas });
    hojas.push({ nombre: 'Pedidos', aoa: pedidosAOA, formulas: pedidosFormulas });

    // ---------- Clientes ----------
    const clientesOrdenados = clientes.slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
    const clientesAOA = [['Nombre', 'Teléfono', 'Dirección', 'Notas', 'N° pedidos', 'Total platos', 'Total acumulado', 'ID']];
    const clientesFormulas = [];
    clientesOrdenados.forEach((cl, idx) => {
      const r = resumenComprasCliente(cl.id);
      clientesAOA.push([cl.nombre, cl.telefono || '', cl.direccion || '', cl.notas || '', r.numPedidos, r.totalPlatos, r.totalAcumulado, cl.id]);
      const excelRow = idx + 2;
      clientesFormulas.push({ r: idx + 1, c: 4, f: `COUNTIF(Pedidos!B:B,A${excelRow})` });
      clientesFormulas.push({ r: idx + 1, c: 5, f: `SUMIF(Pedidos!B:B,A${excelRow},Pedidos!K:K)` });
      clientesFormulas.push({ r: idx + 1, c: 6, f: `SUMIF(Pedidos!B:B,A${excelRow},Pedidos!F:F)` });
    });
    hojas.push({ nombre: 'Clientes', aoa: clientesAOA, formulas: clientesFormulas });

    // ---------- Jornadas ----------
    const jornadasOrdenadas = jornadas.slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    const jornadasAOA = [['Nombre', 'Tipo', 'Fecha', 'Ingreso manual', 'Ingreso pedidos', 'Ingreso total', 'Gasto total', 'Utilidad', 'ID']];
    const jornadasFormulas = [];
    jornadasOrdenadas.forEach((j, idx) => {
      const c = calcJornada(j);
      jornadasAOA.push([j.nombre, j.tipo === 'evento' ? 'Evento / catering' : 'Venta regular', j.fecha || '', j.ingresoManual || 0, c.ingresoPedidos, c.ingresoTotal, c.gastoTotal, c.utilidad, j.id]);
      const excelRow = idx + 2;
      jornadasFormulas.push({ r: idx + 1, c: 4, f: `SUMIFS(Pedidos!F:F,Pedidos!E:E,A${excelRow},Pedidos!G:G,TRUE,Pedidos!H:H,FALSE)` });
      jornadasFormulas.push({ r: idx + 1, c: 5, f: `D${excelRow}+E${excelRow}` });
      jornadasFormulas.push({ r: idx + 1, c: 6, f: `SUMIF(Gastos!D:D,A${excelRow},Gastos!E:E)` });
      jornadasFormulas.push({ r: idx + 1, c: 7, f: `F${excelRow}-G${excelRow}` });
    });
    hojas.push({ nombre: 'Jornadas', aoa: jornadasAOA, formulas: jornadasFormulas });

    // ---------- Gastos ----------
    const gastosOrdenados = gastos.slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    const gastosAOA = [['Fecha', 'Categoría', 'Concepto', 'Jornada', 'Monto', 'ID']];
    gastosOrdenados.forEach(g => {
      gastosAOA.push([g.fecha || '', g.categoria || '', g.concepto || '', g.jornadaId ? (nombreJornada(g.jornadaId) || '') : '', g.monto || 0, g.id]);
    });
    hojas.push({ nombre: 'Gastos', aoa: gastosAOA, formulas: [] });

    // ---------- Capital ----------
    const capitalOrdenados = capitalMovimientos.slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    const capitalAOA = [['Fecha', 'Tipo', 'Nota', 'Monto', 'Monto neto', 'ID']];
    const capitalFormulas = [];
    capitalOrdenados.forEach((m, idx) => {
      const neto = (m.tipo === 'aporte' ? 1 : -1) * (m.monto || 0);
      capitalAOA.push([m.fecha || '', m.tipo === 'aporte' ? 'Aporte' : 'Retiro', m.nota || '', m.monto || 0, neto, m.id]);
      const excelRow = idx + 2;
      capitalFormulas.push({ r: idx + 1, c: 4, f: `IF(B${excelRow}="Aporte",D${excelRow},-D${excelRow})` });
    });
    hojas.push({ nombre: 'Capital', aoa: capitalAOA, formulas: capitalFormulas });

    // ---------- Resumen ----------
    const f = await calcFinanzas();
    const resumenAOA = [
      ['Concepto', 'Valor'],
      ['Capital invertido', f.capitalNeto],
      ['Gastos totales (capital usado)', f.gastoTotalGeneral],
      ['Ingresos totales', f.ingresoTotalGeneral],
      ['Utilidad neta', f.utilidadNeta],
      ['Saldo disponible', f.saldoDisponible],
    ];
    const resumenFormulas = [
      { r: 1, c: 1, f: 'SUM(Capital!E:E)' },
      { r: 2, c: 1, f: 'SUM(Gastos!E:E)' },
      { r: 3, c: 1, f: 'SUM(Jornadas!F:F)' },
      { r: 4, c: 1, f: 'B4-B3' },
      { r: 5, c: 1, f: 'B2+B4-B3' },
    ];
    hojas.push({ nombre: 'Resumen', aoa: resumenAOA, formulas: resumenFormulas });

    return hojas;
  }

  function descargarArchivo(nombre, contenido, tipoMime) {
    const blob = new Blob([contenido], { type: tipoMime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  }

  document.getElementById('btnExportExcel').addEventListener('click', async () => {
    if (typeof XLSX === 'undefined') { showToast('No se pudo cargar el motor de Excel. Revisa que el archivo js/vendor/xlsx.full.min.js exista.'); return; }
    const hojas = await construirDatosParaExportar();
    const wb = XLSX.utils.book_new();
    hojas.forEach(h => {
      const ws = XLSX.utils.aoa_to_sheet(h.aoa);
      h.formulas.forEach(({ r, c, f }) => setFormula(ws, r, c, f));
      XLSX.utils.book_append_sheet(wb, ws, h.nombre);
    });
    XLSX.writeFile(wb, `kitchencost-datos-${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast('Excel descargado');
  });

  document.getElementById('btnExportCSV').addEventListener('click', async () => {
    if (typeof XLSX === 'undefined') { showToast('No se pudo cargar el motor de exportación. Revisa que el archivo js/vendor/xlsx.full.min.js exista.'); return; }
    const hojas = await construirDatosParaExportar();
    const fechaStr = new Date().toISOString().slice(0, 10);
    hojas.forEach((h, idx) => {
      const ws = XLSX.utils.aoa_to_sheet(h.aoa);
      const csv = XLSX.utils.sheet_to_csv(ws);
      setTimeout(() => descargarArchivo(`kitchencost-${h.nombre.toLowerCase()}-${fechaStr}.csv`, csv, 'text/csv;charset=utf-8;'), idx * 150);
    });
    showToast(`Descargando ${hojas.length} archivos CSV (uno por tabla)...`);
  });

  // =========================================================
  //  GESTIÓN DE CATEGORÍAS (insumos y recetas)
  // =========================================================
  let categoriasTipoActual = null; // 'insumo' | 'receta'

  function categoriasActivas() { return categoriasTipoActual === 'insumo' ? categoriasInsumos : categoriasTipoActual === 'receta' ? categoriasRecetas : categoriasGastos; }
  function itemsQueUsanCategorias() { return categoriasTipoActual === 'insumo' ? insumos : categoriasTipoActual === 'receta' ? recetas : gastos; }
  function guardarCategoriasActivas() {
    if (categoriasTipoActual === 'insumo') saveCategoriasInsumos();
    else if (categoriasTipoActual === 'receta') saveCategoriasRecetas();
    else saveCategoriasGastos();
  }

  function openCategoriasModal(tipo) {
    categoriasTipoActual = tipo;
    document.getElementById('categoriasModalTitulo').textContent =
      tipo === 'insumo' ? 'Categorías de insumos' : tipo === 'receta' ? 'Categorías de recetas' : 'Categorías de gastos';
    document.getElementById('nuevaCategoriaInput').value = '';
    renderCategoriasModal();
    openModal('modalCategorias');
  }

  function renderCategoriasModal() {
    const lista = categoriasActivas();
    const items = itemsQueUsanCategorias();
    const tbody = document.getElementById('tbodyCategorias');
    document.getElementById('emptyCategorias').hidden = lista.length !== 0;

    tbody.innerHTML = lista.map((cat, idx) => {
      const usos = items.filter(it => it.categoria === cat).length;
      return `
        <tr>
          <td><input type="text" class="cat-nombre-input" data-idx="${idx}" value="${esc(cat)}" style="border:1px solid transparent;background:transparent;color:var(--text);padding:4px 6px;width:100%"></td>
          <td class="cell-muted" style="white-space:nowrap">${usos ? `${usos} en uso` : ''}</td>
          <td class="col-actions">
            <button class="btn-icon" title="Renombrar" data-edit-cat="${idx}">✎</button>
            <button class="btn-icon danger" title="Eliminar" data-del-cat="${idx}">🗑</button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.cat-nombre-input').forEach(input => {
      input.addEventListener('focus', () => { input.style.borderColor = 'var(--border)'; input.style.background = 'var(--surface)'; });
      input.addEventListener('blur', () => renombrarCategoria(parseInt(input.dataset.idx, 10), input.value));
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    });
    tbody.querySelectorAll('[data-edit-cat]').forEach(btn =>
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.editCat, 10);
        const actual = categoriasActivas()[idx];
        const nuevo = prompt('Nuevo nombre para esta categoría:', actual);
        if (nuevo === null) return; // canceló el prompt -- no hace nada
        renombrarCategoria(idx, nuevo);
      }));
    tbody.querySelectorAll('[data-del-cat]').forEach(btn =>
      btn.addEventListener('click', () => eliminarCategoria(parseInt(btn.dataset.delCat, 10))));
  }

  // UPDATE masivo (una sola llamada, no un insumo a la vez) -- renombra la categoría de TODOS
  // los insumos que la tengan. Se filtra por igualdad exacta de texto en "categoria" (no hay
  // una tabla de categorías normalizada por FK: cada insumo guarda el nombre de su categoría
  // como texto suelto), igual criterio que ya usa itemsQueUsanCategorias() en memoria.
  async function renombrarCategoriaInsumosEnSupabase(categoriaAnterior, categoriaNueva) {
    // Datos compartidos (ver nota en sincronizarInsumosDesdeSupabase): el renombre debe aplicar
    // a TODOS los insumos con esa categoría, sin importar qué usuario los creó.
    const { error } = await window.supabaseClient
      .from('insumos')
      .update({ categoria: categoriaNueva, updated_at: new Date().toISOString() })
      .eq('categoria', categoriaAnterior);
    if (error) throw error;
  }

  async function renombrarCategoria(idx, nuevoNombreRaw) {
    const lista = categoriasActivas();
    const nuevoNombre = nuevoNombreRaw.trim();
    const anterior = lista[idx];
    if (!nuevoNombre || nuevoNombre === anterior) { renderCategoriasModal(); return; }

    // fusión: el nombre nuevo coincide con OTRA categoría que ya existe. Fuera de Insumos se
    // mantiene el comportamiento de siempre (no se permite duplicar); para Insumos, en cambio,
    // se ofrece fusionar ambas en una sola tras confirmar.
    const idxExistente = lista.findIndex((c, i) => i !== idx && c.toLowerCase() === nuevoNombre.toLowerCase());
    const esFusion = idxExistente !== -1;
    if (esFusion && categoriasTipoActual !== 'insumo') {
      showToast('Ya existe una categoría con ese nombre.');
      renderCategoriasModal();
      return;
    }
    // al fusionar, se usa la capitalización/espaciado de la categoría YA existente como nombre
    // final -- así todos los insumos convergen a una sola grafía, en vez de crear una tercera
    // variante a partir de lo que se acaba de escribir.
    const nombreFinal = esFusion ? lista[idxExistente] : nuevoNombre;

    const usos = itemsQueUsanCategorias().filter(it => it.categoria === anterior).length;
    const msg = esFusion
      ? `Ya existe la categoría "${nombreFinal}". Esto fusionará ambas categorías en una sola. ¿Continuar?`
      : usos
        ? `¿Renombrar "${anterior}" a "${nuevoNombre}"? Se actualizará en ${usos} elemento(s) que la usan.`
        : `¿Renombrar "${anterior}" a "${nuevoNombre}"?`;
    if (!confirm(msg)) { renderCategoriasModal(); return; }

    // Supabase primero (solo aplica a Insumos -- Recetas/Gastos siguen 100% locales, igual que
    // ya estaban): si el UPDATE masivo falla, no se toca nada en memoria/localStorage tampoco,
    // para no quedar desincronizado en silencio.
    if (categoriasTipoActual === 'insumo') {
      try {
        await renombrarCategoriaInsumosEnSupabase(anterior, nombreFinal);
      } catch (err) {
        console.error(err);
        showToast(`No se pudo renombrar en Supabase (sigue sin aplicarse localmente): ${err.message || err}`);
        renderCategoriasModal();
        return;
      }
    }

    if (esFusion) lista.splice(idx, 1); // la categoría vieja desaparece de la lista, fusionada en la existente
    else lista[idx] = nuevoNombre;
    lista.sort((a, b) => a.localeCompare(b)); // la lista de categorías siempre se muestra alfabética
    itemsQueUsanCategorias().forEach(it => { if (it.categoria === anterior) it.categoria = nombreFinal; });
    guardarCategoriasActivas();
    if (categoriasTipoActual === 'insumo') { saveInsumos(); renderInsumos(); }
    else if (categoriasTipoActual === 'receta') { saveRecetas(); renderRecetas(); }
    else { saveGastos(); renderGastos(); }
    renderCategoriasModal();
    showToast(esFusion ? 'Categorías fusionadas' : 'Categoría actualizada');
  }

  function eliminarCategoria(idx) {
    const lista = categoriasActivas();
    const items = itemsQueUsanCategorias();
    const nombre = lista[idx];
    const usos = items.filter(it => it.categoria === nombre).length;
    const msg = usos
      ? `"${nombre}" se usa en ${usos} elemento(s). Si la eliminas, quedarán sin categoría. ¿Continuar?`
      : `¿Eliminar la categoría "${nombre}"?`;
    if (!confirm(msg)) return;
    lista.splice(idx, 1);
    items.forEach(it => { if (it.categoria === nombre) it.categoria = ''; });
    guardarCategoriasActivas();
    if (categoriasTipoActual === 'insumo') { saveInsumos(); renderInsumos(); }
    else if (categoriasTipoActual === 'receta') { saveRecetas(); renderRecetas(); }
    else { saveGastos(); renderGastos(); }
    renderCategoriasModal();
    showToast('Categoría eliminada');
  }

  function agregarCategoria() {
    const input = document.getElementById('nuevaCategoriaInput');
    const nombre = input.value.trim();
    if (!nombre) return;
    const lista = categoriasActivas();
    if (lista.some(c => c.toLowerCase() === nombre.toLowerCase())) {
      showToast('Esa categoría ya existe.'); return;
    }
    lista.push(nombre);
    lista.sort((a, b) => a.localeCompare(b)); // la lista de categorías siempre se muestra alfabética
    guardarCategoriasActivas();
    input.value = '';
    renderCategoriasModal();
    showToast('Categoría creada');
  }

  document.getElementById('btnCategoriasInsumo').addEventListener('click', () => openCategoriasModal('insumo'));
  document.getElementById('btnCategoriasReceta').addEventListener('click', () => openCategoriasModal('receta'));
  document.getElementById('btnAgregarCategoria').addEventListener('click', agregarCategoria);
  document.getElementById('nuevaCategoriaInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); agregarCategoria(); } });

  // =========================================================
  //  PAPELERA (una por cada pestaña: insumos, recetas, pedidos, clientes)
  // =========================================================
  const PAPELERA_CONFIG = {
    insumos: {
      titulo: 'Papelera de insumos',
      getArr: () => insumos, setArr: v => { insumos = v; }, save: saveInsumos,
      render: () => { renderInsumos(); renderRecetas(); },
      describir: x => `${x.nombre} · ${x.categoria || 'Sin categoría'}`,
      // únicos hooks opcionales hoy en PAPELERA_CONFIG — las otras 6 entidades no los
      // definen, así que restaurarDePapelera/eliminarDefinitivoDePapelera/vaciar siguen
      // siendo 100% locales para ellas, sin ningún cambio de comportamiento.
      alRestaurar: item => restaurarInsumoEnSupabase(item.id),
      alEliminarDefinitivo: item => eliminarInsumoDefinitivamenteEnSupabase(item.id),
    },
    recetas: {
      titulo: 'Papelera de recetas',
      getArr: () => recetas, setArr: v => { recetas = v; }, save: saveRecetas,
      render: () => { renderRecetas(); renderPedidos(); },
      describir: x => `${x.nombre} · ${x.categoria || 'Sin categoría'}`,
      alRestaurar: item => restaurarRecetaEnSupabase(item.id),
      alEliminarDefinitivo: item => eliminarRecetaDefinitivamenteEnSupabase(item.id),
    },
    pedidos: {
      titulo: 'Papelera de pedidos',
      getArr: () => pedidos, setArr: v => { pedidos = v; }, save: savePedidos,
      render: () => { renderPedidos(); renderClientes(); renderJornadas(); renderStatsFinanzas(); },
      describir: x => `Pedido ${x.numeroPedido ? '#' + x.numeroPedido : ''} · ${clienteDePedido(x).nombre}`,
      alRestaurar: item => restaurarPedidoEnSupabase(item.id),
      alEliminarDefinitivo: item => eliminarPedidoDefinitivamenteEnSupabase(item.id),
    },
    clientes: {
      titulo: 'Papelera de clientes',
      getArr: () => clientes, setArr: v => { clientes = v; }, save: saveClientes,
      render: () => { renderClientes(); renderPedidos(); },
      describir: x => `${x.nombre}${x.telefono ? ' · ' + x.telefono : ''}`,
      alRestaurar: item => restaurarClienteEnSupabase(item.id),
      alEliminarDefinitivo: item => eliminarClienteDefinitivamenteEnSupabase(item.id),
    },
    jornadas: {
      titulo: 'Papelera de jornadas',
      getArr: () => jornadas, setArr: v => { jornadas = v; }, save: saveJornadas,
      render: () => { renderJornadas(); renderGastos(); renderStatsFinanzas(); renderPedidos(); },
      describir: x => `${x.nombre} · ${fecha(x.fecha)}`,
      alRestaurar: item => restaurarJornadaEnSupabase(item.id),
      alEliminarDefinitivo: item => eliminarJornadaDefinitivamenteEnSupabase(item.id),
    },
    gastos: {
      titulo: 'Papelera de gastos',
      getArr: () => gastos, setArr: v => { gastos = v; }, save: saveGastos,
      render: () => { renderGastos(); renderJornadas(); renderStatsFinanzas(); },
      describir: x => `${x.concepto} · ${money(x.monto)}`,
      alRestaurar: item => restaurarGastoEnSupabase(item.id),
      alEliminarDefinitivo: item => eliminarGastoDefinitivamenteEnSupabase(item.id),
    },
    capitalMovimientos: {
      titulo: 'Papelera de capital',
      getArr: () => capitalMovimientos, setArr: v => { capitalMovimientos = v; }, save: saveCapital,
      render: () => { renderCapital(); renderStatsFinanzas(); },
      describir: x => `${x.tipo === 'aporte' ? 'Aporte' : 'Retiro'} · ${money(x.monto)}`,
      alRestaurar: item => restaurarCapitalEnSupabase(item.id),
      alEliminarDefinitivo: item => eliminarCapitalDefinitivamenteEnSupabase(item.id),
    },
    donaciones: {
      titulo: 'Papelera de donaciones',
      getArr: () => donaciones, setArr: v => { donaciones = v; }, save: saveDonaciones,
      render: () => { if (detalleJornadaActualId) abrirDetalleJornada(detalleJornadaActualId); },
      describir: x => `${x.concepto} · ${money(x.monto)} · ${nombreJornada(x.jornadaId) || '(jornada eliminada)'}`,
      alRestaurar: item => restaurarDonacionEnSupabase(item.id),
      alEliminarDefinitivo: item => eliminarDonacionDefinitivamenteEnSupabase(item.id),
    },
  };

  let papeleraTipoActual = null;

  // Elementos que ya estaban en la Papelera ANTES de conectar Supabase (el export original
  // del Paso 1 nunca incluyó el contenido de la Papelera, así que estos quedaron con el id
  // viejo, tipo "id_xxxxx") nunca llegaron a existir en Supabase con ese id. Si se intenta
  // llamar a un hook de Supabase con uno de estos ids, Postgres rechaza el uuid inválido.
  // Se detecta acá, centralizado, para que aplique a cualquier entidad con hooks (hoy
  // Insumos y Recetas) sin tener que repetir el chequeo en cada función.
  function esUuid(v) {
    return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  }

  function abrirPapelera(tipo) {
    papeleraTipoActual = tipo;
    document.getElementById('papeleraModalTitulo').textContent = PAPELERA_CONFIG[tipo].titulo;
    document.getElementById('btnVaciarPapelera').hidden = false;
    renderPapelera();
    openModal('modalPapelera');
  }

  function renderPapelera() {
    const cfg = PAPELERA_CONFIG[papeleraTipoActual];
    const lista = papelera[papeleraTipoActual];
    const tbody = document.getElementById('tbodyPapelera');
    document.getElementById('emptyPapelera').hidden = lista.length !== 0;

    tbody.innerHTML = lista.map((entry, idx) => `
      <tr>
        <td>${esc(cfg.describir(entry.item))}</td>
        <td class="cell-muted" style="white-space:nowrap">${fecha(entry.eliminadoEn)}</td>
        <td class="col-actions">
          <button class="btn-icon" title="Restaurar" data-restaurar-papelera="${idx}">↺</button>
          <button class="btn-icon danger" title="Eliminar definitivamente" data-borrar-papelera="${idx}">🗑</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-restaurar-papelera]').forEach(b =>
      b.addEventListener('click', () => restaurarDePapelera(parseInt(b.getAttribute('data-restaurar-papelera'), 10))));
    tbody.querySelectorAll('[data-borrar-papelera]').forEach(b =>
      b.addEventListener('click', () => eliminarDefinitivoDePapelera(parseInt(b.getAttribute('data-borrar-papelera'), 10))));
  }

  // cfg.alRestaurar/alEliminarDefinitivo son hooks OPCIONALES (hoy solo los define
  // PAPELERA_CONFIG.insumos, para reflejar el cambio también en Supabase). Si el tipo no
  // define el hook, el comportamiento es exactamente el de siempre — cero cambios para
  // Recetas/Pedidos/Clientes/Jornadas/Gastos/Capital.
  async function restaurarDePapelera(idx) {
    const cfg = PAPELERA_CONFIG[papeleraTipoActual];
    const entry = papelera[papeleraTipoActual][idx];
    // si el id no es uuid, este elemento nunca existió en Supabase (estaba en la Papelera
    // desde antes de conectar el módulo) -> se trata 100% local, sin llamar al hook.
    if (cfg.alRestaurar && esUuid(entry.item.id)) {
      try {
        await cfg.alRestaurar(entry.item);
      } catch (err) {
        console.error(err);
        showToast(`No se pudo restaurar en Supabase (sigue en la Papelera): ${err.message || err}`);
        return;
      }
    }
    papelera[papeleraTipoActual].splice(idx, 1);
    cfg.setArr([...cfg.getArr(), entry.item]);
    cfg.save();
    savePapelera();
    cfg.render();
    renderPapelera();
    showToast('Elemento restaurado');
  }

  async function eliminarDefinitivoDePapelera(idx) {
    if (!confirm('¿Eliminar definitivamente este elemento? Esta acción no se puede deshacer.')) return;
    const cfg = PAPELERA_CONFIG[papeleraTipoActual];
    const entry = papelera[papeleraTipoActual][idx];
    if (cfg.alEliminarDefinitivo && esUuid(entry.item.id)) {
      try {
        await cfg.alEliminarDefinitivo(entry.item);
      } catch (err) {
        console.error(err);
        showToast(`No se pudo eliminar definitivamente en Supabase (sigue en la Papelera): ${err.message || err}`);
        return;
      }
    }
    papelera[papeleraTipoActual].splice(idx, 1);
    savePapelera();
    renderPapelera();
    showToast('Elemento eliminado definitivamente');
  }

  document.getElementById('btnVaciarPapelera').addEventListener('click', async () => {
    const cfg = PAPELERA_CONFIG[papeleraTipoActual];
    const lista = papelera[papeleraTipoActual];
    if (!lista.length) return;
    if (!confirm('¿Vaciar la papelera? Esta acción no se puede deshacer y eliminará todos los elementos definitivamente.')) return;
    if (cfg.alEliminarDefinitivo) {
      while (lista.length) {
        const entry = lista[0];
        if (esUuid(entry.item.id)) {
          try {
            await cfg.alEliminarDefinitivo(entry.item);
          } catch (err) {
            console.error(err);
            showToast(`Se detuvo al vaciar: falló "${cfg.describir(entry.item)}" en Supabase (${err.message || err}). El resto sigue en la Papelera.`);
            renderPapelera();
            return;
          }
        }
        lista.shift();
      }
    } else {
      papelera[papeleraTipoActual] = [];
    }
    savePapelera();
    renderPapelera();
    showToast('Papelera vaciada');
  });

  document.getElementById('btnPapeleraInsumos').addEventListener('click', () => abrirPapelera('insumos'));
  document.getElementById('btnPapeleraRecetas').addEventListener('click', () => abrirPapelera('recetas'));
  document.getElementById('btnPapeleraPedidos').addEventListener('click', () => abrirPapelera('pedidos'));
  document.getElementById('btnPapeleraClientes').addEventListener('click', () => abrirPapelera('clientes'));

  // ---------------- init ----------------
  // Solo pinta lo que ya había en localStorage -- todavía no toca Supabase (ver más abajo:
  // renderStatsFinanzas() SÍ hace una consulta en vivo, por eso se movió fuera de este bloque).
  renderInsumos();
  renderRecetas();
  renderPedidos();
  renderClientes();
  renderJornadas();
  renderGastos();
  renderCapital();

  // ---------------- Sincronización inicial: bloquear "Exportar" mientras esté en curso ----------------
  // Riesgo real: si se hace clic en Exportar (JSON/Excel/CSV/PDF) en el instante en que la app
  // recién cargó pero Supabase todavía no respondió, el archivo exportado toma los datos viejos
  // de localStorage SIN ningún aviso -- el peor tipo de bug porque nadie se da cuenta hasta que
  // falta algo en el reporte. Mientras `sincronizacionInicialEnCurso` sea true, todos los
  // botones de exportar quedan disabled.
  //
  // Criterio para cuando la sincronización termina pero algún módulo falló (quedó con su copia
  // local en vez de la de Supabase): se decidió HABILITAR los botones igual, pero con una
  // advertencia visible (tooltip + toast al hacer clic) en vez de deshabilitarlos indefinidamente.
  // Razón: un fallo de sincronización suele ser "no hay internet ahora" -- eso puede durar toda
  // la sesión, y dejar Exportar bloqueado para siempre dejaría al usuario sin ninguna forma de
  // sacar sus datos, ni siquiera la copia local (que sigue siendo una copia real y coherente,
  // solo no necesariamente la más reciente). Bloquear todo el tiempo es peor que avisar y dejar
  // decidir. El problema que había que resolver era el SILENCIO, no la posibilidad de que algún
  // dato no esté 100% al día.
  const BOTONES_EXPORTAR = ['btnExport', 'btnExportExcel', 'btnExportCSV', 'btnExportarPedidosPDF', 'btnExportarRentabilidadPDF', 'btnExportarInsumosPDF', 'btnExportarClientesPDF', 'btnExportarGastosPDF', 'btnExportarAuditoriaPDF', 'btnExportarCarritoPDF', 'btnExportarHistorialCompletoPDF'];
  let sincronizacionInicialEnCurso = true;
  let modulosFallidosSincronizacion = [];

  function actualizarBotonesExportar() {
    BOTONES_EXPORTAR.forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      if (btn.dataset.tituloOriginal === undefined) btn.dataset.tituloOriginal = btn.getAttribute('title') || '';
      if (sincronizacionInicialEnCurso) {
        btn.disabled = true;
        btn.title = 'Sincronizando datos con Supabase, espera un momento...';
      } else if (modulosFallidosSincronizacion.length) {
        btn.disabled = false;
        btn.title = `⚠ No se pudo confirmar la versión más reciente de: ${modulosFallidosSincronizacion.join(', ')}. Se exportará con la copia local de esos módulos.`;
      } else {
        btn.disabled = false;
        btn.title = btn.dataset.tituloOriginal;
      }
    });
  }
  BOTONES_EXPORTAR.forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (modulosFallidosSincronizacion.length) {
        showToast(`⚠ Exportando con datos locales de: ${modulosFallidosSincronizacion.join(', ')} (no se pudo confirmar que sean los más recientes de Supabase).`);
      }
    });
  });
  actualizarBotonesExportar();

  // Arranca con lo que ya había en localStorage (arriba), y en cuanto responda Supabase se
  // actualiza en silencio. Si falla (sin internet, RLS, etc.) la app sigue funcionando con la
  // copia local tal cual estaba — no bloquea nada, pero SÍ se registra en
  // modulosFallidosSincronizacion (cada sincronizarXDesdeSupabase ahora devuelve true/false).
  //
  // FASE B: las 17 tablas ahora exigen sesión autenticada, así que esta cadena YA NO se dispara
  // sola al cargar el script -- se expone como función y auth.js la llama (vía
  // registrarInicioSincronizacion) recién cuando confirma que hay una sesión válida y con
  // window.SUPABASE_USER_ID ya puesto al id real del usuario logueado. Si se llama sin sesión
  // (no debería pasar, pero por si acaso), cada sincronizarXDesdeSupabase simplemente fallará
  // con un error de permisos y quedará registrado en modulosFallidosSincronizacion, igual que
  // cualquier otro fallo de red -- no rompe nada, solo se queda con la copia local.
  function iniciarSincronizacionConSupabase() {
    sincronizacionInicialEnCurso = true;
    modulosFallidosSincronizacion = [];
    actualizarBotonesExportar();

    sincronizarInsumosDesdeSupabase()
      .catch(err => { console.error('Falló la sincronización inicial de Insumos con Supabase:', err); return false; })
      .then(ok => { if (!ok) modulosFallidosSincronizacion.push('Insumos'); return sincronizarRecetasDesdeSupabase(); })
      .catch(err => { console.error('Falló la sincronización inicial de Recetas con Supabase:', err); return false; })
      .then(ok => { if (!ok) modulosFallidosSincronizacion.push('Recetas'); return sincronizarClientesDesdeSupabase(); })
      .catch(err => { console.error('Falló la sincronización inicial de Clientes con Supabase:', err); return false; })
      .then(ok => { if (!ok) modulosFallidosSincronizacion.push('Clientes'); return sincronizarJornadasDesdeSupabase(); })
      .catch(err => { console.error('Falló la sincronización inicial de Jornadas con Supabase:', err); return false; })
      .then(ok => { if (!ok) modulosFallidosSincronizacion.push('Jornadas'); return sincronizarGastosDesdeSupabase(); })
      .catch(err => { console.error('Falló la sincronización inicial de Gastos con Supabase:', err); return false; })
      .then(ok => { if (!ok) modulosFallidosSincronizacion.push('Gastos'); return sincronizarCapitalDesdeSupabase(); })
      .catch(err => { console.error('Falló la sincronización inicial de Capital con Supabase:', err); return false; })
      .then(ok => { if (!ok) modulosFallidosSincronizacion.push('Capital'); return sincronizarPedidosDesdeSupabase(); })
      .catch(err => { console.error('Falló la sincronización inicial de Pedidos con Supabase:', err); return false; })
      .then(ok => { if (!ok) modulosFallidosSincronizacion.push('Pedidos'); return sincronizarDonacionesDesdeSupabase(); })
      .catch(err => { console.error('Falló la sincronización inicial de Donaciones con Supabase:', err); return false; })
      .then(ok => { if (!ok) modulosFallidosSincronizacion.push('Donaciones'); })
      .finally(() => {
        sincronizacionInicialEnCurso = false;
        actualizarBotonesExportar();
        renderStatsFinanzas(); // depende de Jornadas/Gastos/Capital ya sincronizados, por eso va al final
      });
    refrescarCuentaUsuario(); // email + avatar del header -- no depende de la cadena de arriba, corre en paralelo
    actualizarBadgeCarrito(); // insignia del carrito -- tampoco depende de la cadena de arriba
  }
  window.iniciarSincronizacionConSupabase = iniciarSincronizacionConSupabase;
  if (window.registrarInicioSincronizacion) window.registrarInicioSincronizacion(iniciarSincronizacionConSupabase);
})();
