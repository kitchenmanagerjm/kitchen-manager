#!/usr/bin/env node
'use strict';

/**
 * Sube a Supabase las recetas que existen SOLO en localStorage (creadas/editadas después
 * de la migración del Paso 1, antes de conectar el módulo de Recetas). NO toca recetas que
 * ya existen en Supabase (esas se detectan por id y se dejan intactas, aunque el contenido
 * local haya cambiado — este script es solo para recetas nuevas, no para sincronizar ediciones).
 *
 * Requiere que Insumos YA esté conectado a Supabase (ver js/app.js) — los ingredientes de la
 * receta nueva deben referenciar insumos que ya existan allá por id. Si no los encuentra por
 * id, intenta una vez por nombre como red de seguridad, y avisa.
 *
 * USO:
 *   node scripts/subir-recetas-nuevas.js ruta/al/export.json --dry-run   (solo reporte)
 *   node scripts/subir-recetas-nuevas.js ruta/al/export.json             (reporte + pide "SI")
 *
 * Variables de entorno opcionales: SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_ROLE_KEY
 * (mismo esquema que scripts/migrar-a-supabase.js).
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

const args = process.argv.slice(2);
const jsonPath = args.find(a => !a.startsWith('--'));
const soloReporte = args.includes('--dry-run');

if (!jsonPath) {
  console.error('Uso: node scripts/subir-recetas-nuevas.js ruta/al/export.json [--dry-run]');
  process.exit(1);
}

function headers() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function supabaseGet(tabla, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?${query}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET ${tabla} falló: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

async function supabaseInsert(tabla, filas) {
  if (!filas.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify(filas),
  });
  if (!res.ok) throw new Error(`INSERT ${tabla} falló: HTTP ${res.status} ${await res.text().catch(() => '')}`);
}

function numeroODefault(v, def) {
  return typeof v === 'number' && isFinite(v) ? v : def;
}
function precioVentaSeguro(v) {
  return typeof v === 'number' && isFinite(v) ? v : null;
}
function texto(v) {
  return typeof v === 'string' ? v : '';
}

async function main() {
  const data = JSON.parse(fs.readFileSync(path.resolve(jsonPath), 'utf8'));
  const recetasLocales = data.recetas || [];
  const pedidosLocales = data.pedidos || [];

  console.log('Leyendo estado actual de Supabase...');
  const [recetasSupabase, insumosSupabase] = await Promise.all([
    supabaseGet('recetas', `user_id=eq.${USER_ID}&select=id,nombre,deleted_at`),
    supabaseGet('insumos', `user_id=eq.${USER_ID}&select=id,nombre&deleted_at=is.null`),
  ]);

  const idsRecetasSupabase = new Set(recetasSupabase.map(r => r.id));
  const nombreRecetaSupabase = new Map(recetasSupabase.map(r => [r.nombre.trim().toLowerCase(), r]));
  const idsInsumosSupabase = new Set(insumosSupabase.map(i => i.id));
  const nombreInsumoSupabase = new Map(insumosSupabase.map(i => [i.nombre.trim().toLowerCase(), i.id]));

  const nuevas = [];        // recetas locales que hay que crear en Supabase
  const ambiguas = [];      // mismo nombre ya existe en Supabase con OTRO id -> no se toca, se avisa
  const advertencias = [];

  recetasLocales.forEach(r => {
    if (idsRecetasSupabase.has(r.id)) return; // ya existe, no se toca (no sincronizamos ediciones acá)

    const porNombre = nombreRecetaSupabase.get(r.nombre.trim().toLowerCase());
    if (porNombre) {
      ambiguas.push({ nombre: r.nombre, idLocal: r.id, idSupabase: porNombre.id, deletedAt: porNombre.deleted_at });
      return;
    }
    nuevas.push(r);
  });

  console.log(`\n=== Recetas encontradas SOLO en localStorage: ${nuevas.length} ===`);
  nuevas.forEach(r => {
    console.log(`  - "${r.nombre}" (${(r.ingredientes || []).length} ingrediente(s), ${(r.costosAdicionales || []).length} otro(s) costo(s))`);
  });

  if (ambiguas.length) {
    console.log(`\n⚠ ${ambiguas.length} receta(s) local(es) tienen el MISMO NOMBRE que una receta que ya existe en Supabase, pero con id distinto — no se tocan, revísalas a mano:`);
    ambiguas.forEach(a => console.log(`  - "${a.nombre}" (id local ${a.idLocal} vs id Supabase ${a.idSupabase}${a.deletedAt ? ', que está en la Papelera allá' : ''})`));
  }

  if (!nuevas.length) {
    console.log('\nNada para subir. Fin.');
    return;
  }

  // preparar filas a insertar + detectar ingredientes que no resuelven a un insumo válido
  const filasRecetas = [];
  const filasIngredientes = [];
  const filasOtrosCostos = [];
  const recetaIdMap = new Map(); // id local -> uuid nuevo (para el aviso de pedidos, al final)

  nuevas.forEach(r => {
    const nuevoId = randomUUID();
    recetaIdMap.set(r.id, nuevoId);
    filasRecetas.push({
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
    });

    (r.ingredientes || []).forEach((ing, idx) => {
      let insumoId = idsInsumosSupabase.has(ing.insumoId) ? ing.insumoId : null;
      if (!insumoId) {
        // red de seguridad: el insumo local ya debería tener el id real de Supabase (Insumos
        // ya está conectado), pero por si acaso se intenta una vez por nombre.
        const insumoLocal = (data.insumos || []).find(i => i.id === ing.insumoId);
        if (insumoLocal) insumoId = nombreInsumoSupabase.get(insumoLocal.nombre.trim().toLowerCase()) || null;
        if (insumoId) {
          advertencias.push(`Receta "${r.nombre}", ingrediente #${idx + 1}: no se encontró el insumo por id, se resolvió por nombre ("${insumoLocal.nombre}"). Revísalo.`);
        } else {
          advertencias.push(`Receta "${r.nombre}", ingrediente #${idx + 1}: NO se pudo resolver el insumo (ni por id ni por nombre) — se omite esta fila.`);
          return;
        }
      }
      filasIngredientes.push({
        id: randomUUID(),
        receta_id: nuevoId,
        insumo_id: insumoId,
        cantidad: numeroODefault(ing.cantidad, 0),
        unidad: ing.unidad,
        posicion: idx,
      });
    });

    (r.costosAdicionales || []).forEach((costo, idx) => {
      filasOtrosCostos.push({
        id: randomUUID(),
        receta_id: nuevoId,
        concepto: costo.concepto || '(sin nombre)',
        cantidad: numeroODefault(costo.cantidad, 0),
        precio_unitario: numeroODefault(costo.precioUnitario, 0),
        posicion: idx,
      });
    });
  });

  // aviso informativo (no se corrige acá): pedidos locales que ya usan el id VIEJO de
  // alguna receta nueva. Pedidos todavía no está conectado, así que esto no rompe nada
  // hoy — es solo para que no te sorprenda cuando migres Pedidos más adelante.
  nuevas.forEach(r => {
    const usosEnPedidos = pedidosLocales.filter(p => (p.items || []).some(it => it.recetaId === r.id)).length;
    if (usosEnPedidos) {
      advertencias.push(`Receta "${r.nombre}": ${usosEnPedidos} pedido(s) local(es) ya la referencian por su id viejo (${r.id}). Cuando conectes Pedidos vamos a necesitar reconciliar esto también (mismo patrón que ya usamos para Insumos).`);
    }
  });

  console.log(`\n=== Resumen a insertar ===`);
  console.table([
    { tabla: 'recetas', filas: filasRecetas.length },
    { tabla: 'receta_ingredientes', filas: filasIngredientes.length },
    { tabla: 'receta_otros_costos', filas: filasOtrosCostos.length },
  ]);

  if (advertencias.length) {
    console.log(`\n=== Advertencias (${advertencias.length}) ===`);
    advertencias.forEach((a, i) => console.log(`${i + 1}. ${a}`));
  } else {
    console.log('\nSin advertencias.');
  }

  if (soloReporte) {
    console.log('\n--dry-run: no se insertó nada. Fin.');
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const respuesta = await new Promise(resolve => rl.question('\n¿Insertar esto en Supabase? Escribe SI para continuar: ', r => { rl.close(); resolve(r); }));
  if (respuesta.trim().toUpperCase() !== 'SI') {
    console.log('Cancelado. No se insertó nada.');
    return;
  }

  console.log('\nInsertando...');
  await supabaseInsert('recetas', filasRecetas);
  console.log(`  ✓ recetas: ${filasRecetas.length}`);
  await supabaseInsert('receta_ingredientes', filasIngredientes);
  console.log(`  ✓ receta_ingredientes: ${filasIngredientes.length}`);
  await supabaseInsert('receta_otros_costos', filasOtrosCostos);
  console.log(`  ✓ receta_otros_costos: ${filasOtrosCostos.length}`);

  console.log('\n✅ Listo. Mapa de ids (local -> Supabase) para esta corrida:');
  console.log(Object.fromEntries(recetaIdMap));
  console.log('\nEl localStorage del navegador no fue tocado por este script.');
}

main().catch(err => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
