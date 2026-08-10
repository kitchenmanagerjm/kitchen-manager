#!/usr/bin/env node
'use strict';

/**
 * SOLO LECTURA. Compara los pedidos del export local (localStorage) contra lo que hay HOY en
 * Supabase, para detectar:
 *   1) Pedidos que existen SOLO en local (creados durante pruebas después de la migración del Paso 1)
 *   2) Pedidos que existen en AMBOS lados pero tienen diferencias (cliente, platos/cantidades/
 *      precios, o estado de pago/preparación/cancelado)
 *
 * No inserta ni actualiza NADA en Supabase, ni toca el export. Es el mismo primer paso que ya
 * usamos con subir-recetas-nuevas.js: reporte primero, decidir después, escribir en un paso aparte.
 *
 * CÓMO SE EMPAREJA UN PEDIDO LOCAL CON UNO DE SUPABASE
 * Pedidos todavía no está conectado a Supabase, así que pedido.id en localStorage sigue siendo
 * el id VIEJO (formato uid()) — no el uuid que Supabase le asignó en la migración del Paso 1.
 * Pero Clientes, Recetas y Jornadas SÍ ya están conectados, y cuando se conectó cada uno se
 * reconcilió por nombre toda referencia que existiera en otros módulos todavía locales —
 * incluyendo pedido.clienteId, pedido.items[].recetaId y pedido.jornadaId. Es decir: HOY esos
 * campos ya deberían ser uuids de Supabase válidos, aunque el pedido.id en sí no lo sea.
 * Por eso la clave de emparejamiento es (cliente_id efectivo, fecha_entrega, hora_entrega) — no
 * el id del pedido. Si el clienteId local no resuelve directo (referencia rota / nunca
 * reconciliada), se intenta una vez por nombre como red de seguridad, igual que en
 * subir-recetas-nuevas.js, y se marca la fila para que la revises a mano.
 *
 * USO:
 *   node scripts/comparar-pedidos.js ruta/al/export.json
 *
 * Variables de entorno opcionales: SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_ROLE_KEY
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vuxrrrcpbrfquublnqon.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  'sb_publishable_75sLmS--x930dxnDbhKLrw_3zHNY4Qk';
const USER_ID = '00000000-0000-0000-0000-000000000001';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function esUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error('Uso: node scripts/comparar-pedidos.js ruta/al/export.json');
  process.exit(1);
}

function headers() {
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
}
async function supabaseGet(tabla, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?${query}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET ${tabla} falló: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

function norm(s) {
  return (s || '').trim().toLowerCase();
}
function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}
// Supabase devuelve "hora_entrega" (columna "time") como "12:00:00"; el export local la guarda
// como "12:00" (input type="time" del navegador). Se recorta a "HH:MM" en ambos lados para que
// la clave de emparejamiento no falle por esto.
function normHora(v) {
  return typeof v === 'string' ? v.slice(0, 5) : '';
}

async function main() {
  const data = JSON.parse(fs.readFileSync(path.resolve(jsonPath), 'utf8'));
  const pedidosLocales = data.pedidos || [];
  const clientesLocales = data.clientes || [];
  const recetasLocales = data.recetas || [];
  const jornadasLocales = data.jornadas || [];

  console.log(`Export leído: ${jsonPath}`);
  console.log(`Exportado desde la app el: ${data.exportadoEn || '(no indicado)'}`);
  console.log(`Pedidos en el export local: ${pedidosLocales.length}`);

  console.log('\nLeyendo estado actual de Supabase...');
  const [pedidosSb, itemsSb, clientesSb, recetasSb, jornadasSb] = await Promise.all([
    supabaseGet('pedidos', `user_id=eq.${USER_ID}&select=*`),
    supabaseGet('pedido_items', 'select=*'),
    supabaseGet('clientes', `user_id=eq.${USER_ID}&select=id,nombre,deleted_at`),
    supabaseGet('recetas', `user_id=eq.${USER_ID}&select=id,nombre,deleted_at`),
    supabaseGet('jornadas', `user_id=eq.${USER_ID}&select=id,nombre,deleted_at`),
  ]);
  console.log(`Pedidos en Supabase: ${pedidosSb.length} (incluye los que estén en la Papelera allá)`);

  const clienteNombrePorId = new Map(clientesSb.map(c => [c.id, c.nombre]));
  const clienteIdPorNombre = new Map(clientesSb.map(c => [norm(c.nombre), c.id]));
  const recetaNombrePorId = new Map(recetasSb.map(r => [r.id, r.nombre]));
  const recetaIdPorNombre = new Map(recetasSb.map(r => [norm(r.nombre), r.id]));
  const jornadaNombrePorId = new Map(jornadasSb.map(j => [j.id, j.nombre]));
  const jornadaIdPorNombre = new Map(jornadasSb.map(j => [norm(j.nombre), j.id]));

  const clienteLocalPorId = new Map(clientesLocales.map(c => [c.id, c]));
  const recetaLocalPorId = new Map(recetasLocales.map(r => [r.id, r]));
  const jornadaLocalPorId = new Map(jornadasLocales.map(j => [j.id, j]));

  const itemsPorPedidoSb = new Map();
  itemsSb.forEach(it => {
    if (!itemsPorPedidoSb.has(it.pedido_id)) itemsPorPedidoSb.set(it.pedido_id, []);
    itemsPorPedidoSb.get(it.pedido_id).push(it);
  });

  function resolverClienteIdEfectivo(p) {
    if (esUuid(p.clienteId) && clienteNombrePorId.has(p.clienteId)) return { id: p.clienteId, viaNombre: false };
    const local = clienteLocalPorId.get(p.clienteId);
    if (local) {
      const idPorNombre = clienteIdPorNombre.get(norm(local.nombre));
      if (idPorNombre) return { id: idPorNombre, viaNombre: true };
    }
    return { id: null, viaNombre: false };
  }

  function resolverRecetaIdEfectivo(it) {
    if (esUuid(it.recetaId) && recetaNombrePorId.has(it.recetaId)) return { id: it.recetaId, viaNombre: false };
    const local = recetaLocalPorId.get(it.recetaId);
    if (local) {
      const idPorNombre = recetaIdPorNombre.get(norm(local.nombre));
      if (idPorNombre) return { id: idPorNombre, viaNombre: true };
    }
    return { id: null, viaNombre: false };
  }

  function resolverJornadaIdEfectivo(jornadaIdLocal) {
    if (!jornadaIdLocal) return { id: null };
    if (esUuid(jornadaIdLocal) && jornadaNombrePorId.has(jornadaIdLocal)) return { id: jornadaIdLocal };
    const local = jornadaLocalPorId.get(jornadaIdLocal);
    if (local) {
      const idPorNombre = jornadaIdPorNombre.get(norm(local.nombre));
      if (idPorNombre) return { id: idPorNombre };
    }
    return { id: null };
  }

  const claveSb = p => `${p.cliente_id}|${p.fecha_entrega || ''}|${normHora(p.hora_entrega)}`;
  const sbPorClave = new Map();
  pedidosSb.forEach(p => {
    const k = claveSb(p);
    if (!sbPorClave.has(k)) sbPorClave.set(k, []);
    sbPorClave.get(k).push(p);
  });

  const nuevos = [];
  const conDiferencias = [];
  const ambiguos = [];
  const sinResolver = [];
  const emparejadosSbIds = new Set();

  pedidosLocales.forEach(p => {
    const { id: clienteIdEfectivo, viaNombre } = resolverClienteIdEfectivo(p);
    if (!clienteIdEfectivo) {
      sinResolver.push({ pedido: p, motivo: 'no se pudo determinar el cliente en Supabase (ni por id ni por nombre)' });
      return;
    }

    const k = `${clienteIdEfectivo}|${p.fechaEntrega || ''}|${normHora(p.horaEntrega)}`;
    const candidatos = sbPorClave.get(k) || [];

    if (candidatos.length === 0) {
      nuevos.push(p);
      return;
    }
    if (candidatos.length > 1) {
      ambiguos.push({ pedido: p, candidatos });
      candidatos.forEach(c => emparejadosSbIds.add(c.id));
      return;
    }

    const sb = candidatos[0];
    emparejadosSbIds.add(sb.id);

    const diffs = [];

    if (!!p.pagado !== !!sb.pagado) diffs.push(`pagado: local=${!!p.pagado} vs Supabase=${!!sb.pagado}`);
    if ((p.estadoPreparacion || 'sin_accion') !== (sb.estado_preparacion || 'sin_accion')) {
      diffs.push(`estadoPreparacion: local="${p.estadoPreparacion || 'sin_accion'}" vs Supabase="${sb.estado_preparacion || 'sin_accion'}"`);
    }
    if (!!p.cancelado !== !!sb.cancelado) diffs.push(`cancelado: local=${!!p.cancelado} vs Supabase=${!!sb.cancelado}`);
    if ((p.notas || '') !== (sb.notas || '')) diffs.push(`notas: local="${p.notas || ''}" vs Supabase="${sb.notas || ''}"`);

    const { id: jornadaIdEfectivoLocal } = resolverJornadaIdEfectivo(p.jornadaId);
    if ((jornadaIdEfectivoLocal || null) !== (sb.jornada_id || null)) {
      const nombreLocal = jornadaIdEfectivoLocal ? (jornadaNombrePorId.get(jornadaIdEfectivoLocal) || jornadaIdEfectivoLocal) : '(sin jornada)';
      const nombreSb = sb.jornada_id ? (jornadaNombrePorId.get(sb.jornada_id) || sb.jornada_id) : '(sin jornada)';
      diffs.push(`jornada: local="${nombreLocal}" vs Supabase="${nombreSb}"`);
    }

    const itemsLocales = p.items || [];
    const itemsSbDelPedido = (itemsPorPedidoSb.get(sb.id) || []).slice().sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0));
    const diferenciasItems = [];
    const maxLen = Math.max(itemsLocales.length, itemsSbDelPedido.length);

    for (let i = 0; i < maxLen; i++) {
      const li = itemsLocales[i];
      const si = itemsSbDelPedido[i];
      if (li && !si) {
        const nombre = recetaLocalPorId.get(li.recetaId)?.nombre || li.recetaId;
        diferenciasItems.push(`  + item local #${i + 1} sin equivalente en Supabase: plato="${nombre}", cantidad=${li.cantidad}, precioUnitario=${li.precioUnitario}`);
        continue;
      }
      if (si && !li) {
        const nombre = recetaNombrePorId.get(si.receta_id) || si.receta_id;
        diferenciasItems.push(`  + item #${i + 1} existe en Supabase pero no en local: plato="${nombre}", cantidad=${si.cantidad}, precio_unitario=${si.precio_unitario}`);
        continue;
      }
      const { id: recetaIdEfectiva } = resolverRecetaIdEfectivo(li);
      const nombreRecetaLocal = recetaLocalPorId.get(li.recetaId)?.nombre || li.recetaId;
      const nombreRecetaSb = recetaNombrePorId.get(si.receta_id) || si.receta_id;
      const partes = [];
      if (recetaIdEfectiva !== si.receta_id) partes.push(`plato: local="${nombreRecetaLocal}" vs Supabase="${nombreRecetaSb}"`);
      if (num(li.cantidad) !== num(si.cantidad)) partes.push(`cantidad: local=${num(li.cantidad)} vs Supabase=${num(si.cantidad)}`);
      if (num(li.precioUnitario) !== num(si.precio_unitario)) partes.push(`precioUnitario: local=${num(li.precioUnitario)} vs Supabase=${num(si.precio_unitario)}`);
      if (partes.length) diferenciasItems.push(`  item #${i + 1} ("${nombreRecetaLocal}"): ${partes.join(' | ')}`);
    }

    if (diferenciasItems.length) diffs.push(`items:\n${diferenciasItems.join('\n')}`);

    if (diffs.length) conDiferencias.push({ local: p, sb, diffs, viaNombre });
  });

  const sbSinPar = pedidosSb.filter(p => !emparejadosSbIds.has(p.id));

  console.log(`\n=== 1) Pedidos NUEVOS — solo en local (${nuevos.length}) ===`);
  if (!nuevos.length) console.log('  (ninguno)');
  nuevos.forEach(p => {
    const clienteNombre = clienteLocalPorId.get(p.clienteId)?.nombre || p.clienteId;
    console.log(
      `  - #${p.numeroPedido ?? '(sin número)'} · cliente="${clienteNombre}" · ${p.fechaEntrega || '(sin fecha)'} ${p.horaEntrega || ''} · ` +
      `${(p.items || []).length} plato(s) · pagado=${!!p.pagado} · cancelado=${!!p.cancelado} · prep=${p.estadoPreparacion || 'sin_accion'}`
    );
  });

  console.log(`\n=== 2) Pedidos con DIFERENCIAS — existen en ambos lados (${conDiferencias.length}) ===`);
  if (!conDiferencias.length) console.log('  (ninguno)');
  conDiferencias.forEach(({ local, sb, diffs, viaNombre }) => {
    const clienteNombre = clienteNombrePorId.get(sb.cliente_id) || '(desconocido)';
    console.log(`\n  Pedido Supabase #${sb.numero_pedido} (id ${sb.id}) ↔ local id ${local.id}${viaNombre ? '  [emparejado por nombre de cliente, no coincidió el id]' : ''}`);
    console.log(`  Cliente: ${clienteNombre} · ${sb.fecha_entrega || ''} ${sb.hora_entrega || ''}`);
    diffs.forEach(d => console.log(`    - ${d}`));
  });

  if (ambiguos.length) {
    console.log(`\n=== ⚠ AMBIGUOS — misma clave (cliente+fecha+hora) con varios candidatos en Supabase (${ambiguos.length}) ===`);
    console.log('  No se compararon automáticamente. Revísalos a mano:');
    ambiguos.forEach(({ pedido, candidatos }) => {
      const clienteNombre = clienteLocalPorId.get(pedido.clienteId)?.nombre || pedido.clienteId;
      console.log(`  - Pedido local id ${pedido.id} (cliente="${clienteNombre}", ${pedido.fechaEntrega || ''} ${pedido.horaEntrega || ''}) coincide con: ${candidatos.map(c => `#${c.numero_pedido}(${c.id})`).join(', ')}`);
    });
  }

  if (sinResolver.length) {
    console.log(`\n=== ⚠ SIN RESOLVER — no se pudo determinar el cliente en Supabase (${sinResolver.length}) ===`);
    console.log('  No se compararon ni se marcaron como nuevos. Revísalos a mano:');
    sinResolver.forEach(({ pedido, motivo }) => {
      console.log(`  - Pedido local id ${pedido.id} (#${pedido.numeroPedido ?? '?'}): ${motivo}`);
    });
  }

  if (sbSinPar.length) {
    console.log(`\n=== ℹ Pedidos en Supabase que no encontré en el export local (${sbSinPar.length}) ===`);
    console.log('  Informativo, no necesariamente un problema: puede ser normal si hoy están en la Papelera LOCAL (el export no incluye la Papelera). Revisa si te sorprende alguno:');
    sbSinPar.forEach(p => {
      const clienteNombre = clienteNombrePorId.get(p.cliente_id) || p.cliente_id;
      console.log(`  - #${p.numero_pedido} (id ${p.id}) · cliente="${clienteNombre}" · ${p.fecha_entrega || ''} ${p.hora_entrega || ''}${p.deleted_at ? ' · [en Papelera en Supabase]' : ''}`);
    });
  }

  console.log('\nSolo lectura: no se insertó ni modificó nada en Supabase ni en el export.');
}

main().catch(err => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
