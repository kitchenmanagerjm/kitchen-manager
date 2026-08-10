-- =========================================================
-- Funciones RPC para guardar/eliminar un pedido de forma ATÓMICA
-- (pedido + pedido_items en una sola transacción).
--
-- Mismo motivo que 001_guardar_y_eliminar_receta_completa.sql: el cliente (app.js) necesita
-- reemplazar los platos de un pedido (borrar + insertar) y PostgREST no da una transacción real
-- entre llamadas HTTP separadas. Envolviendo todo en UNA función de Postgres, la llamada completa
-- se ejecuta como una sola transacción: si algo falla, TODO se revierte, incluyendo los cambios
-- en la fila de "pedidos".
--
-- DIFERENCIA respecto al patrón de guardar_receta_completa: esa función hace un upsert con
-- "on conflict (id) do update". Acá NO se usa upsert, sino un IF/ELSE explícito (update si el
-- pedido ya existe, insert si no) porque pedidos.numero_pedido es GENERATED ALWAYS AS IDENTITY:
-- un upsert seguiría evaluando el INSERT (y por lo tanto "gastando" un número de la secuencia)
-- cada vez que se EDITA un pedido existente, aunque el resultado final sea un UPDATE. Con el
-- IF/ELSE, editar un pedido nunca toca ni consume numero_pedido — solo se genera uno nuevo
-- cuando el pedido realmente se crea por primera vez.
--
-- Se llama desde el navegador vía supabase-js: supabaseClient.rpc('guardar_pedido_completo', {...})
-- =========================================================

create or replace function public.guardar_pedido_completo(
  p_id uuid,
  p_user_id uuid,
  p_cliente_id uuid,
  p_fecha_entrega date,
  p_hora_entrega time,
  p_pagado boolean,
  p_estado_preparacion text,
  p_notas text,
  p_cancelado boolean,
  p_jornada_id uuid,
  p_items jsonb   -- [{ "receta_id": "uuid", "cantidad": number, "precio_unitario": number }, ...] en el orden final
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from pedidos where id = p_id) then
    update pedidos set
      cliente_id         = p_cliente_id,
      fecha_entrega      = p_fecha_entrega,
      hora_entrega       = p_hora_entrega,
      pagado             = p_pagado,
      estado_preparacion = p_estado_preparacion,
      notas              = p_notas,
      cancelado          = p_cancelado,
      jornada_id         = p_jornada_id,
      updated_at         = now()
    where id = p_id;
  else
    insert into pedidos (
      id, user_id, cliente_id, fecha_entrega, hora_entrega,
      pagado, estado_preparacion, notas, cancelado, jornada_id, updated_at
    )
    values (
      p_id, p_user_id, p_cliente_id, p_fecha_entrega, p_hora_entrega,
      p_pagado, p_estado_preparacion, p_notas, p_cancelado, p_jornada_id, now()
    );
    -- numero_pedido NO se envía: es [auto] (identity), se asigna solo en este INSERT.
  end if;

  delete from pedido_items where pedido_id = p_id;
  insert into pedido_items (id, pedido_id, receta_id, cantidad, precio_unitario, posicion)
  select gen_random_uuid(), p_id, (elem->>'receta_id')::uuid, (elem->>'cantidad')::numeric, (elem->>'precio_unitario')::numeric, (idx - 1)::integer
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(elem, idx);
end;
$$;

grant execute on function public.guardar_pedido_completo(
  uuid, uuid, uuid, date, time, boolean, text, text, boolean, uuid, jsonb
) to anon, authenticated;

-- ---------------------------------------------------------
-- Eliminar definitivamente un pedido (hoy serían 2 llamadas separadas desde app.js: borrar
-- pedido_items, borrar el pedido — mismo riesgo de quedar a medias si la conexión se corta
-- entre medio). Se envuelve igual que eliminar_receta_completa.
-- Esta función es solo para el borrado DEFINITIVO desde la Papelera (eliminarDefinitivoDePapelera).
-- Mover/restaurar de la Papelera sigue siendo un simple update de "deleted_at" en una sola
-- tabla (pedidos), sin necesidad de RPC — igual que en el resto de las entidades ya conectadas.
-- ---------------------------------------------------------
create or replace function public.eliminar_pedido_completo(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from pedido_items where pedido_id = p_id;
  delete from pedidos where id = p_id;
end;
$$;

grant execute on function public.eliminar_pedido_completo(uuid) to anon, authenticated;
