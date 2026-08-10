-- =========================================================
-- Índice único parcial: como máximo UNA Jornada tipo "venta_regular" por día (por usuario).
--
-- Motivo (Jornada híbrida): al crear/editar un pedido, si no se elige una Jornada manualmente,
-- app.js resuelve o crea automáticamente la Jornada "venta_regular" de esa fecha_entrega
-- (resolverOCrearJornadaVentaRegular). Ese "buscar y si no existe crear" hecho solo en el
-- cliente no puede prevenir del todo una condición de carrera: si dos pedidos del mismo día se
-- guardan en el mismo instante desde dos pestañas/dispositivos distintos, ambos podrían
-- consultar "no existe" antes de que el otro termine de crearla, y quedar dos Jornadas
-- "venta_regular" duplicadas para el mismo día.
--
-- Este índice hace que Supabase rechace el segundo insert (error 23505, unique_violation).
-- app.js captura ese código específico y, en vez de fallar, vuelve a consultar y usa la
-- Jornada que "ganó" la carrera -- ver resolverOCrearJornadaVentaRegular en app.js.
--
-- Parcial (where tipo = 'venta_regular' and deleted_at is null) porque:
--  - Solo aplica a "venta_regular" -- puede haber varias Jornadas tipo "evento" el mismo día
--    (ej. una boda y un cumpleaños el mismo sábado), eso es válido y no debe bloquearse.
--  - Ignora las que están en la Papelera (deleted_at) -- si se borra la Jornada del día y se
--    crea una nueva para esa misma fecha, no debe chocar con la vieja ya eliminada.
-- =========================================================

create unique index if not exists jornadas_venta_regular_por_dia
  on public.jornadas (user_id, fecha)
  where tipo = 'venta_regular' and deleted_at is null;
