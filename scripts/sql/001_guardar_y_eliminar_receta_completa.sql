-- =========================================================
-- Funciones RPC para guardar/eliminar una receta de forma ATÓMICA
-- (receta + receta_ingredientes + receta_otros_costos en una sola transacción).
--
-- Motivo: el cliente (app.js) hace varias llamadas REST separadas para reemplazar
-- ingredientes/otros costos (borrar + insertar). PostgREST no da una transacción real
-- entre llamadas HTTP distintas — si una falla a la mitad, la receta puede quedar sin
-- ingredientes o con duplicados. Envolviendo todo en UNA función de Postgres, la llamada
-- completa se ejecuta como una sola transacción: si algo falla (red, FK inválida, lo que
-- sea), TODO se revierte, incluyendo los cambios en la fila de "recetas".
--
-- Se llaman desde el navegador vía supabase-js: supabaseClient.rpc('guardar_receta_completa', {...})
-- =========================================================

create or replace function public.guardar_receta_completa(
  p_id uuid,
  p_user_id uuid,
  p_nombre text,
  p_categoria text,
  p_porciones integer,
  p_margen_pct numeric,
  p_precio_venta numeric,
  p_foto text,
  p_descripcion text,
  p_preparacion text,
  p_ingredientes jsonb,   -- [{ "insumo_id": "uuid", "cantidad": number, "unidad": "kg" }, ...] en el orden final
  p_otros_costos jsonb    -- [{ "concepto": text, "cantidad": number, "precio_unitario": number }, ...] en el orden final
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  insert into recetas (id, user_id, nombre, categoria, porciones, margen_pct, precio_venta, foto, descripcion, preparacion, updated_at)
  values (p_id, p_user_id, p_nombre, p_categoria, p_porciones, p_margen_pct, p_precio_venta, p_foto, p_descripcion, p_preparacion, now())
  on conflict (id) do update set
    nombre        = excluded.nombre,
    categoria     = excluded.categoria,
    porciones     = excluded.porciones,
    margen_pct    = excluded.margen_pct,
    precio_venta  = excluded.precio_venta,
    foto          = excluded.foto,
    descripcion   = excluded.descripcion,
    preparacion   = excluded.preparacion,
    updated_at    = now();

  delete from receta_ingredientes where receta_id = p_id;
  insert into receta_ingredientes (id, receta_id, insumo_id, cantidad, unidad, posicion)
  select gen_random_uuid(), p_id, (elem->>'insumo_id')::uuid, (elem->>'cantidad')::numeric, elem->>'unidad', (idx - 1)::integer
  from jsonb_array_elements(coalesce(p_ingredientes, '[]'::jsonb)) with ordinality as t(elem, idx);

  delete from receta_otros_costos where receta_id = p_id;
  insert into receta_otros_costos (id, receta_id, concepto, cantidad, precio_unitario, posicion)
  select gen_random_uuid(), p_id, elem->>'concepto', (elem->>'cantidad')::numeric, (elem->>'precio_unitario')::numeric, (idx - 1)::integer
  from jsonb_array_elements(coalesce(p_otros_costos, '[]'::jsonb)) with ordinality as t(elem, idx);
end;
$$;

grant execute on function public.guardar_receta_completa(
  uuid, uuid, text, text, integer, numeric, numeric, text, text, text, jsonb, jsonb
) to anon, authenticated;

-- ---------------------------------------------------------
-- Eliminar definitivamente una receta (hoy también son 3 llamadas separadas desde
-- app.js: borrar ingredientes, borrar otros costos, borrar la receta — mismo riesgo de
-- quedar a medias si la conexión se corta entre medio). Se envuelve igual.
-- ---------------------------------------------------------
create or replace function public.eliminar_receta_completa(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from receta_ingredientes where receta_id = p_id;
  delete from receta_otros_costos where receta_id = p_id;
  delete from recetas where id = p_id;
end;
$$;

grant execute on function public.eliminar_receta_completa(uuid) to anon, authenticated;
