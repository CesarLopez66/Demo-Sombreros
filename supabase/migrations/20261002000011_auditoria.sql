-- =============================================================================
-- 0011 · Auditoría inmutable (logs_auditoria)
-- =============================================================================
-- · Trigger genérico AFTER INSERT/UPDATE/DELETE en tablas sensibles.
-- · Nadie puede editar ni borrar logs: sin políticas RLS de escritura, privilegios
--   revocados y un trigger que bloquea UPDATE/DELETE/TRUNCATE incluso para
--   service_role.

create table public.logs_auditoria (
  id                  bigint generated always as identity primary key,
  tabla               text not null,
  operacion           text not null check (operacion in ('INSERT', 'UPDATE', 'DELETE')),
  registro_id         text,
  datos_anteriores    jsonb,
  datos_nuevos        jsonb,
  campos_modificados  text[],
  usuario_id          uuid,
  usuario_rol         text,
  sucursal_id         uuid,
  origen              text not null,                  -- authenticated / service_role / usuario de BD
  transaccion_id      bigint not null default txid_current(),
  created_at          timestamptz not null default clock_timestamp()
);

create index logs_auditoria_tabla_idx on public.logs_auditoria (tabla, registro_id, created_at desc);
create index logs_auditoria_usuario_idx on public.logs_auditoria (usuario_id, created_at desc);
create index logs_auditoria_sucursal_idx on public.logs_auditoria (sucursal_id, created_at desc);

create or replace function app.tg_registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_campos  text[];
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_campos
      from jsonb_each(v_new) n
     where n.value is distinct from (v_old -> n.key);
    if v_campos is null then
      return null;                                        -- UPDATE sin cambios reales
    end if;
  end if;

  insert into public.logs_auditoria (
    tabla, operacion, registro_id, datos_anteriores, datos_nuevos, campos_modificados,
    usuario_id, usuario_rol, sucursal_id, origen)
  values (
    tg_table_name, tg_op,
    coalesce(v_new ->> 'id', v_old ->> 'id', coalesce(v_new, v_old) ->> 'clave',
             concat_ws(':', coalesce(v_new, v_old) ->> 'sucursal_id', coalesce(v_new, v_old) ->> 'variante_id')),
    v_old, v_new, v_campos,
    auth.uid(), app.rol(),
    coalesce((coalesce(v_new, v_old) ->> 'sucursal_id')::uuid, app.sucursal_id()),
    coalesce(auth.jwt() ->> 'role', session_user::text));

  return null;
end;
$$;

-- Bloqueo absoluto de modificaciones
create or replace function app.tg_logs_auditoria_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'logs_auditoria es inmutable (% bloqueado)', tg_op using errcode = '42501';
end;
$$;

create trigger logs_auditoria_inmutable
  before update or delete on public.logs_auditoria
  for each row execute function app.tg_logs_auditoria_inmutable();

create trigger logs_auditoria_sin_truncate
  before truncate on public.logs_auditoria
  for each statement execute function app.tg_logs_auditoria_inmutable();

revoke all on public.logs_auditoria from public, anon, authenticated, service_role;
grant select on public.logs_auditoria to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tablas auditadas
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'perfiles', 'sucursales', 'parametros',
    'modelos', 'variantes', 'costos_variante',
    'stock', 'movimientos_inventario',
    'clientes', 'movimientos_puntos',
    'cajas', 'sesiones_caja', 'arqueos',
    'ventas', 'venta_detalles', 'venta_pagos',
    'facturas', 'eventos_significativos', 'cufd',
    'transferencias', 'transferencia_detalles',
    'materias_primas', 'movimientos_materia_prima', 'recetas', 'receta_items', 'ordenes_trabajo'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function app.tg_registrar_auditoria()',
      'auditoria_' || t, t);
  end loop;
end;
$$;
