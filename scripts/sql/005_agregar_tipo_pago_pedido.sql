-- =========================================================
-- Agrega tipo_pago a pedidos (efectivo / deposito / sin especificar).
--
-- Nullable a propósito: los pedidos existentes no tienen este dato y se quedan en null
-- ("sin especificar") hasta que alguien lo marque con el botón de ciclo rápido en la tabla
-- (mismo patrón que "Preparación": sin especificar -> efectivo -> depósito -> sin especificar).
-- No se restringe con CHECK a los dos valores: mismo criterio ya usado en estado_preparacion
-- (texto libre validado en el cliente, no en la base) -- más simple si más adelante se agrega
-- un tercer método de pago, no hace falta migración de esquema.
-- =========================================================

alter table public.pedidos add column if not exists tipo_pago text;

-- guardar_pedido_completo necesita el parámetro nuevo. Agregar un parámetro cambia la firma
-- de la función -- hay que borrar la versión vieja (11 parámetros) antes de crear la nueva (12),
-- igual que se hizo en 003_guardar_pedido_completo_retorna_numero.sql. eliminar_pedido_completo
-- no cambia, no hace falta tocarla.

drop function if exists public.guardar_pedido_completo(
  uuid, uuid, uuid, date, time, boolean, text, text, boolean, uuid, jsonb
);

create or replace function public.guardar_pedido_completo(
  p_id uuid,
  p_user_id uuid,
  p_cliente_id uuid,
  p_fecha_entrega date,
  p_hora_entrega time,
  p_pagado boolean,
  p_tipo_pago text,
  p_estado_preparacion text,
  p_notas text,
  p_cancelado boolean,
  p_jornada_id uuid,
  p_items jsonb   -- [{ "receta_id": "uuid", "cantidad": number, "precio_unitario": number }, ...] en el orden final
)
returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_numero_pedido bigint;
begin
  if exists (select 1 from pedidos where id = p_id) then
    update pedidos set
      cliente_id         = p_cliente_id,
      fecha_entrega      = p_fecha_entrega,
      hora_entrega       = p_hora_entrega,
      pagado             = p_pagado,
      tipo_pago          = p_tipo_pago,
      estado_preparacion = p_estado_preparacion,
      notas              = p_notas,
      cancelado          = p_cancelado,
      jornada_id         = p_jornada_id,
      updated_at         = now()
    where id = p_id
    returning numero_pedido into v_numero_pedido;
  else
    insert into pedidos (
      id, user_id, cliente_id, fecha_entrega, hora_entrega,
      pagado, tipo_pago, estado_preparacion, notas, cancelado, jornada_id, updated_at
    )
    values (
      p_id, p_user_id, p_cliente_id, p_fecha_entrega, p_hora_entrega,
      p_pagado, p_tipo_pago, p_estado_preparacion, p_notas, p_cancelado, p_jornada_id, now()
    )
    returning numero_pedido into v_numero_pedido;
  end if;

  delete from pedido_items where pedido_id = p_id;
  insert into pedido_items (id, pedido_id, receta_id, cantidad, precio_unitario, posicion)
  select gen_random_uuid(), p_id, (elem->>'receta_id')::uuid, (elem->>'cantidad')::numeric, (elem->>'precio_unitario')::numeric, (idx - 1)::integer
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(elem, idx);

  return v_numero_pedido;
end;
$$;

grant execute on function public.guardar_pedido_completo(
  uuid, uuid, uuid, date, time, boolean, text, text, text, boolean, uuid, jsonb
) to anon, authenticated;
