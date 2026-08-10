#!/usr/bin/env node
'use strict';

/**
 * Migración ÚNICA de datos: export JSON de Costeo de Platos (localStorage) -> Supabase.
 *
 * No usa @supabase/supabase-js a propósito (evita meter node_modules/npm install en un
 * proyecto que hoy es 100% estático) — habla directo con la API REST de PostgREST usando
 * `fetch`, que ya viene incluido en Node 18+.
 *
 * USO:
 *   node scripts/migrar-a-supabase.js ruta/al/export.json              (pide confirmación antes de insertar)
 *   node scripts/migrar-a-supabase.js ruta/al/export.json --dry-run    (solo reporte, nunca inserta nada)
 *
 * Variables de entorno opcionales:
 *   SUPABASE_URL               (default: la URL del proyecto)
 *   SUPABASE_KEY                (default: la clave pública/anon que diste)
 *   SUPABASE_SERVICE_ROLE_KEY   (úsala si la clave pública falla por RLS — ver nota abajo)
 *
 * ESTE SCRIPT NO TOCA localStorage — es un script de Node, no corre en el navegador.
 * Lee un archivo .json que ya exportaste con el botón "Exportar" de la app.
 *
 * LIMITACIÓN IMPORTANTE: el export actual de la app (btnExport, js/app.js) NO incluye el
 * contenido de la Papelera (localStorage "costeo_papelera_v1") — solo exporta lo que está
 * "vivo". Esta migración por lo tanto NO migra elementos que estén hoy en la Papelera;
 * esos se quedan únicamente en el navegador hasta que se decida qué hacer con ellos.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { randomUUID } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vuxrrrcpbrfquublnqon.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  'sb_publishable_75sLmS--x930dxnDbhKLrw_3zHNY4Qk';
const USER_ID = '00000000-0000-0000-0000-000000000001';
const BATCH_SIZE = 500;

// ---------------- argumentos ----------------
const args = process.argv.slice(2);
const jsonPath = args.find(a => !a.startsWith('--'));
const soloReporte = args.includes('--dry-run');

if (!jsonPath) {
  console.error('Uso: node scripts/migrar-a-supabase.js ruta/al/export.json [--dry-run]');
  process.exit(1);
}

// ---------------- leer el export ----------------
let data;
try {
  data = JSON.parse(fs.readFileSync(path.resolve(jsonPath), 'utf8'));
} catch (e) {
  console.error(`No se pudo leer/parsear "${jsonPath}": ${e.message}`);
  process.exit(1);
}

const srcInsumos = data.insumos || [];
const srcRecetas = data.recetas || [];
const srcClientes = data.clientes || [];
const srcJornadas = data.jornadas || [];
const srcPedidos = data.pedidos || [];
const srcGastos = data.gastos || [];
const srcCapital = data.capitalMovimientos || [];
const srcCatInsumos = data.categoriasInsumos || [];
const srcCatRecetas = data.categoriasRecetas || [];
const srcCatGastos = data.categoriasGastos || [];

// ---------------- helpers ----------------
// Los campos de texto opcionales en el origen SIEMPRE llegan como string ("" cuando no
// tienen valor, nunca null/undefined excepto receta.foto) — así que acá se mantienen como
// string ("" si no hay valor) en vez de convertirlos a null. Esto es seguro sin importar si
// la columna destino es NOT NULL DEFAULT '' (como resultó ser "proveedor") o nullable: un
// string vacío es válido en ambos casos, mientras que null solo lo es en el segundo.
function texto(v) {
  return typeof v === 'string' ? v : '';
}
function numeroODefault(v, def) {
  return typeof v === 'number' && isFinite(v) ? v : def;
}
// Corrige el bug "0 || null" de currentFormReceta() en el código FUENTE: acá NO repetimos
// ese patrón. Si el valor ya llegó como null (porque el bug ya se comió un posible 0 antes
// de exportar), no hay forma de recuperarlo — pero de aquí en adelante un 0 real sí se guarda
// como 0, nunca se convierte en null.
function precioVentaSeguro(v) {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

const advertencias = []; // { tipo, detalle }
function advertir(tipo, detalle) {
  advertencias.push({ tipo, detalle });
}

// ---------------- 1) categorías (sin relación real con insumos/recetas/gastos: son texto libre) ----------------
function filasCategorias(nombres) {
  return nombres.map(nombre => ({ id: randomUUID(), user_id: USER_ID, nombre }));
}
const filasCatInsumos = filasCategorias(srcCatInsumos);
const filasCatRecetas = filasCategorias(srcCatRecetas);
const filasCatGastos = filasCategorias(srcCatGastos);

// detectar insumos/recetas/gastos que usan una categoría que ya no está en la lista canónica
// (no es un error fatal — la app actual tampoco valida esto — pero vale la pena avisar)
function advertirCategoriaHuerfana(entidad, nombreEntidad, categoria, listaCanonica) {
  if (categoria && !listaCanonica.includes(categoria)) {
    advertir('categoria_huerfana', `${entidad} "${nombreEntidad}" usa categoría "${categoria}", que no está en la lista de categorías`);
  }
}

// ---------------- 2) insumos ----------------
const insumoMap = new Map(); // id viejo -> uuid nuevo
const filasInsumos = srcInsumos.map(i => {
  const nuevoId = randomUUID();
  insumoMap.set(i.id, nuevoId);
  advertirCategoriaHuerfana('Insumo', i.nombre, i.categoria, srcCatInsumos);
  const fila = {
    id: nuevoId,
    user_id: USER_ID,
    nombre: i.nombre,
    categoria: texto(i.categoria),
    unidad: i.unidad,
    precio: numeroODefault(i.precio, 0),
    proveedor: texto(i.proveedor),
  };
  // "actualizado" es el ÚNICO timestamp real que existe en el insumo fuente — lo usamos
  // como created_at Y updated_at porque no hay forma de distinguir cuándo se creó de
  // cuándo se editó por última vez (el código fuente solo guardaba uno).
  if (i.actualizado) {
    fila.created_at = i.actualizado;
    fila.updated_at = i.actualizado;
  }
  return fila;
});

// ---------------- 3) clientes ----------------
const clienteMap = new Map();
const filasClientes = srcClientes.map(c => {
  const nuevoId = randomUUID();
  clienteMap.set(c.id, nuevoId);
  return {
    id: nuevoId,
    user_id: USER_ID,
    nombre: c.nombre,
    telefono: texto(c.telefono),
    direccion: texto(c.direccion),
    notas: texto(c.notas),
    // sin created_at/updated_at: no existe ese dato en el cliente fuente, se deja que la
    // columna use su propio DEFAULT (probablemente now()) en vez de forzar un valor falso.
  };
});

// ---------------- 4) jornadas ----------------
const jornadaMap = new Map();
const filasJornadas = srcJornadas.map(j => {
  const nuevoId = randomUUID();
  jornadaMap.set(j.id, nuevoId);
  return {
    id: nuevoId,
    user_id: USER_ID,
    nombre: j.nombre,
    tipo: j.tipo,
    fecha: j.fecha || null,
    ingreso_manual: numeroODefault(j.ingresoManual, 0),
    notas: texto(j.notas),
  };
});

// ---------------- 5) recetas ----------------
const recetaMap = new Map();
const filasRecetas = srcRecetas.map(r => {
  const nuevoId = randomUUID();
  recetaMap.set(r.id, nuevoId);
  advertirCategoriaHuerfana('Receta', r.nombre, r.categoria, srcCatRecetas);
  return {
    id: nuevoId,
    user_id: USER_ID,
    nombre: r.nombre,
    categoria: texto(r.categoria),
    porciones: numeroODefault(r.porciones, 1),
    margen_pct: numeroODefault(r.margenPct, 0),
    precio_venta: precioVentaSeguro(r.precioVenta),
    foto: texto(r.foto),
    descripcion: texto(r.descripcion),
    preparacion: texto(r.preparacion),
  };
});

// ---------------- 6) receta_ingredientes + 7) receta_otros_costos ----------------
const filasRecetaIngredientes = [];
const filasRecetaOtrosCostos = [];
srcRecetas.forEach(r => {
  const recetaIdNuevo = recetaMap.get(r.id);
  (r.ingredientes || []).forEach((ing, idx) => {
    const insumoIdNuevo = insumoMap.get(ing.insumoId);
    if (!insumoIdNuevo) {
      advertir(
        'ingrediente_huerfano',
        `Receta "${r.nombre}": ingrediente en posición ${idx} referencia un insumo que no existe (insumoId viejo: ${ing.insumoId}). Se omite esta fila.`
      );
      return; // no se puede insertar sin insumo_id válido (FK)
    }
    filasRecetaIngredientes.push({
      id: randomUUID(),
      receta_id: recetaIdNuevo,
      insumo_id: insumoIdNuevo,
      cantidad: numeroODefault(ing.cantidad, 0),
      unidad: ing.unidad,
      posicion: idx,
    });
  });
  (r.costosAdicionales || []).forEach((costo, idx) => {
    filasRecetaOtrosCostos.push({
      id: randomUUID(),
      receta_id: recetaIdNuevo,
      concepto: costo.concepto || '(sin nombre)',
      cantidad: numeroODefault(costo.cantidad, 0),
      precio_unitario: numeroODefault(costo.precioUnitario, 0),
      posicion: idx,
    });
  });
});

// ---------------- 8) pedidos + 9) pedido_items ----------------
const pedidoMap = new Map();
const filasPedidos = [];
const filasPedidoItems = [];
let pedidosOmitidos = 0;
let itemsOmitidos = 0;

// se insertan en el mismo orden en que la propia app los muestra (por fecha+hora de entrega),
// para que si numero_pedido se autogenera de forma secuencial, quede en un orden razonable.
const pedidosOrdenados = srcPedidos.slice().sort((a, b) =>
  `${a.fechaEntrega || ''}${a.horaEntrega || ''}`.localeCompare(`${b.fechaEntrega || ''}${b.horaEntrega || ''}`)
);

pedidosOrdenados.forEach(p => {
  const clienteIdNuevo = clienteMap.get(p.clienteId);
  if (!clienteIdNuevo) {
    advertir(
      'pedido_sin_cliente',
      `Pedido #${p.numeroPedido || '(sin número)'}: referencia un cliente que no existe (clienteId viejo: ${p.clienteId}). Se omite el pedido completo (y sus platos).`
    );
    pedidosOmitidos++;
    return;
  }

  let jornadaIdNuevo = null;
  if (p.jornadaId) {
    jornadaIdNuevo = jornadaMap.get(p.jornadaId) || null;
    if (!jornadaIdNuevo) {
      advertir(
        'pedido_jornada_huerfana',
        `Pedido #${p.numeroPedido || '(sin número)'}: referencia una jornada que no existe (jornadaId viejo: ${p.jornadaId}). Se inserta el pedido sin jornada.`
      );
    }
  }

  const nuevoId = randomUUID();
  pedidoMap.set(p.id, nuevoId);
  filasPedidos.push({
    id: nuevoId,
    user_id: USER_ID,
    // numero_pedido: NO se envía — la columna es [auto] en el esquema nuevo, se asigna sola.
    // Si más adelante quieres preservar el número histórico exacto, hay que insertar con
    // OVERRIDING SYSTEM VALUE (si la columna es GENERATED ALWAYS) — avísame y lo ajustamos.
    cliente_id: clienteIdNuevo,
    fecha_entrega: p.fechaEntrega || null,
    hora_entrega: p.horaEntrega || null,
    pagado: !!p.pagado,
    estado_preparacion: p.estadoPreparacion || 'sin_accion',
    notas: texto(p.notas),
    cancelado: !!p.cancelado,
    jornada_id: jornadaIdNuevo,
  });

  (p.items || []).forEach((it, idx) => {
    const recetaIdNuevo = recetaMap.get(it.recetaId);
    if (!recetaIdNuevo) {
      advertir(
        'pedido_item_huerfano',
        `Pedido #${p.numeroPedido || '(sin número)'}: plato en posición ${idx} referencia una receta que no existe (recetaId viejo: ${it.recetaId}). Se omite esta fila.`
      );
      itemsOmitidos++;
      return;
    }
    filasPedidoItems.push({
      id: randomUUID(),
      pedido_id: nuevoId,
      receta_id: recetaIdNuevo,
      cantidad: numeroODefault(it.cantidad, 0),
      // el precio congelado del pedido viejo se preserva tal cual, no se recalcula con el
      // precio actual de la receta (ver PASO anterior de "precios congelados" en la app).
      precio_unitario: numeroODefault(it.precioUnitario, 0),
      posicion: idx,
    });
  });
});

// ---------------- 10) gastos ----------------
const filasGastos = srcGastos.map(g => {
  advertirCategoriaHuerfana('Gasto', g.concepto, g.categoria, srcCatGastos);
  let jornadaIdNuevo = null;
  if (g.jornadaId) {
    jornadaIdNuevo = jornadaMap.get(g.jornadaId) || null;
    if (!jornadaIdNuevo) {
      advertir('gasto_jornada_huerfana', `Gasto "${g.concepto}": referencia una jornada que no existe (jornadaId viejo: ${g.jornadaId}). Se inserta sin jornada.`);
    }
  }
  return {
    id: randomUUID(),
    user_id: USER_ID,
    fecha: g.fecha || null,
    categoria: texto(g.categoria),
    concepto: g.concepto || '(sin concepto)',
    monto: numeroODefault(g.monto, 0),
    jornada_id: jornadaIdNuevo,
  };
});

// ---------------- 11) capital_movimientos ----------------
// OJO: la fuente usa el campo "nota" (singular); la tabla destino usa "notas" (plural,
// consistente con clientes/pedidos/jornadas) — se traduce el nombre acá.
const filasCapital = srcCapital.map(m => ({
  id: randomUUID(),
  user_id: USER_ID,
  tipo: m.tipo,
  fecha: m.fecha || null,
  monto: numeroODefault(m.monto, 0),
  notas: texto(m.nota),
}));

// ---------------- resumen ----------------
const tablas = [
  { nombre: 'categorias_insumos', filas: filasCatInsumos },
  { nombre: 'categorias_recetas', filas: filasCatRecetas },
  { nombre: 'categorias_gastos', filas: filasCatGastos },
  { nombre: 'insumos', filas: filasInsumos },
  { nombre: 'clientes', filas: filasClientes },
  { nombre: 'jornadas', filas: filasJornadas },
  { nombre: 'recetas', filas: filasRecetas },
  { nombre: 'receta_ingredientes', filas: filasRecetaIngredientes },
  { nombre: 'receta_otros_costos', filas: filasRecetaOtrosCostos },
  { nombre: 'pedidos', filas: filasPedidos },
  { nombre: 'pedido_items', filas: filasPedidoItems },
  { nombre: 'gastos', filas: filasGastos },
  { nombre: 'capital_movimientos', filas: filasCapital },
];

console.log('\n=== Resumen de la migración ===');
console.log(`Archivo leído: ${jsonPath}`);
console.log(`Exportado desde la app el: ${data.exportadoEn || '(no indicado)'}\n`);
console.table(tablas.map(t => ({ tabla: t.nombre, filas_a_insertar: t.filas.length })));

if (pedidosOmitidos || itemsOmitidos) {
  console.log(`\n⚠ Pedidos omitidos por completo (sin cliente válido): ${pedidosOmitidos}`);
  console.log(`⚠ Platos de pedido omitidos (receta inválida): ${itemsOmitidos}`);
}

if (advertencias.length) {
  console.log(`\n=== Advertencias (${advertencias.length}) — no detienen la migración, pero revísalas ===`);
  advertencias.forEach((a, i) => console.log(`${i + 1}. [${a.tipo}] ${a.detalle}`));
} else {
  console.log('\nSin advertencias — no se encontraron referencias huérfanas ni categorías inconsistentes.');
}

console.log(`\nDestino: ${SUPABASE_URL}`);
console.log(`user_id usado en todas las filas: ${USER_ID}`);
console.log(`Usando clave: ${SUPABASE_KEY.slice(0, 14)}... (${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role via env' : process.env.SUPABASE_KEY ? 'SUPABASE_KEY via env' : 'clave pública por defecto'})`);

if (soloReporte) {
  console.log('\n--dry-run: no se insertó nada. Fin.');
  process.exit(0);
}

// ---------------- confirmación interactiva ----------------
function preguntar(mensaje) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(mensaje, respuesta => { rl.close(); resolve(respuesta); }));
}

async function insertarLote(tabla, filas) {
  if (!filas.length) return;
  for (let i = 0; i < filas.length; i += BATCH_SIZE) {
    const lote = filas.slice(i, i + BATCH_SIZE);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(lote),
    });
    if (!res.ok) {
      const textoError = await res.text().catch(() => '');
      throw new Error(
        `Falló el insert en "${tabla}" (filas ${i}-${i + lote.length - 1} de ${filas.length}): ` +
        `HTTP ${res.status} ${res.statusText}\n${textoError}\n\n` +
        `Si el error menciona "row-level security" / "permission denied": la clave pública no ` +
        `tiene permiso de escritura bajo las políticas RLS actuales. Reintenta poniendo la ` +
        `service_role key en la variable de entorno SUPABASE_SERVICE_ROLE_KEY (Project Settings → API ` +
        `en el dashboard de Supabase) — NUNCA la pongas en el frontend, solo úsala para scripts como este.`
      );
    }
    console.log(`  ✓ ${tabla}: ${Math.min(i + BATCH_SIZE, filas.length)}/${filas.length} filas`);
  }
}

async function main() {
  const respuesta = await preguntar('\n¿Insertar estas filas en Supabase? Escribe SI para continuar: ');
  if (respuesta.trim().toUpperCase() !== 'SI') {
    console.log('Cancelado. No se insertó nada.');
    return;
  }

  console.log('\nInsertando (en orden de dependencia, se detiene ante el primer error)...');
  for (const t of tablas) {
    console.log(`\n${t.nombre}:`);
    await insertarLote(t.nombre, t.filas);
  }

  // guarda el mapa de ids viejo->nuevo para referencia futura (auditoría, o por si algo
  // hay que corregir a mano). No se usa en la migración misma, es solo un registro.
  const mapaPath = path.join(path.dirname(path.resolve(jsonPath)), `migracion-mapa-ids-${Date.now()}.json`);
  fs.writeFileSync(mapaPath, JSON.stringify({
    insumos: Object.fromEntries(insumoMap),
    clientes: Object.fromEntries(clienteMap),
    jornadas: Object.fromEntries(jornadaMap),
    recetas: Object.fromEntries(recetaMap),
    pedidos: Object.fromEntries(pedidoMap),
  }, null, 2));

  console.log(`\n✅ Migración completa. Mapa de ids viejo→nuevo guardado en: ${mapaPath}`);
  console.log('El localStorage del navegador no fue tocado por este script.');
}

main().catch(err => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
