-- =============================================================================
-- 0012 · Row Level Security y privilegios
-- =============================================================================
-- Matriz de acceso (resumen):
--   SuperAdmin (MFA) ...... todo, todas las sucursales
--   Gerente (MFA) ......... su sucursal: lectura operativa, caja, arqueos, anulaciones,
--                           recepción de transferencias
--   Almacén/Taller ........ stock global, materias primas, producción, despachos
--   Cajero ................ su sucursal: ventas, clientes, sesiones de caja, facturas
-- service_role (microservicio fiscal) tiene BYPASSRLS en Supabase.
-- Las llamadas helper se envuelven en (select ...) para que Postgres las evalúe
-- una sola vez por consulta (initPlan) y no por fila.

-- ---------------------------------------------------------------------------
-- Privilegios base: anon no toca nada
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

grant execute on function public.registrar_venta(jsonb)                       to authenticated, service_role;
grant execute on function public.anular_venta(uuid, text)                     to authenticated, service_role;
grant execute on function public.aprobar_transferencia(uuid)                  to authenticated, service_role;
grant execute on function public.despachar_transferencia(uuid, jsonb)         to authenticated, service_role;
grant execute on function public.recibir_transferencia(uuid, jsonb, text)     to authenticated, service_role;
grant execute on function public.cancelar_transferencia(uuid, text)           to authenticated, service_role;
grant execute on function public.calcular_costo_receta(uuid, integer)         to authenticated, service_role;

-- Personal que atiende clientes
create or replace function app.es_personal_venta()
returns boolean language sql stable set search_path = ''
as $$ select app.es_superadmin() or app.es_gerente() or app.es_cajero() $$;

create or replace function app.es_produccion()
returns boolean language sql stable set search_path = ''
as $$ select app.es_superadmin() or app.es_almacen() $$;

-- Activar RLS en todas las tablas de public
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Configuración y catálogos: lectura para todo usuario autenticado con rol,
-- escritura solo SuperAdmin.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['parametros', 'sucursales', 'materiales', 'tallas', 'colores', 'hormas', 'modelos', 'variantes'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select app.rol()) is not null)',
      t || '_lectura', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using ((select app.es_superadmin())) with check ((select app.es_superadmin()))',
      t || '_superadmin', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Perfiles
-- ---------------------------------------------------------------------------
create policy perfiles_lectura on public.perfiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select app.es_superadmin())
    or ((select app.es_gerente()) and sucursal_id = (select app.sucursal_id()))
  );

create policy perfiles_superadmin on public.perfiles for all to authenticated
  using ((select app.es_superadmin())) with check ((select app.es_superadmin()));

-- ---------------------------------------------------------------------------
-- Costos (ocultos a cajeros y gerentes)
-- ---------------------------------------------------------------------------
create policy costos_lectura on public.costos_variante for select to authenticated
  using ((select app.es_produccion()));
create policy costos_escritura on public.costos_variante for all to authenticated
  using ((select app.es_superadmin())) with check ((select app.es_superadmin()));

-- ---------------------------------------------------------------------------
-- Inventario
-- ---------------------------------------------------------------------------
create policy stock_lectura on public.stock for select to authenticated
  using ((select app.puede_ver_sucursal(sucursal_id)));

-- Solo stock_minimo es editable (la cantidad la protege un trigger).
create policy stock_minimo_edicion on public.stock for update to authenticated
  using ((select app.es_almacen()) or (select app.administra_sucursal(sucursal_id)))
  with check ((select app.es_almacen()) or (select app.administra_sucursal(sucursal_id)));

create policy movimientos_inv_lectura on public.movimientos_inventario for select to authenticated
  using ((select app.puede_ver_sucursal(sucursal_id)));

create policy movimientos_inv_ajustes on public.movimientos_inventario for insert to authenticated
  with check (
    usuario_id = (select auth.uid())
    and tipo in ('ajuste_positivo', 'ajuste_negativo', 'inventario_inicial')
    and ((select app.es_produccion()) or (tipo <> 'inventario_inicial' and (select app.administra_sucursal(sucursal_id))))
  );

create policy alertas_lectura on public.alertas_inventario for select to authenticated
  using (
    (select app.es_produccion())
    or (sucursal_id is not null and (select app.administra_sucursal(sucursal_id)))
  );

create policy alertas_atender on public.alertas_inventario for update to authenticated
  using ((select app.es_produccion()) or (sucursal_id is not null and (select app.administra_sucursal(sucursal_id))))
  with check ((select app.es_produccion()) or (sucursal_id is not null and (select app.administra_sucursal(sucursal_id))));

-- ---------------------------------------------------------------------------
-- Clientes (registro centralizado, visible desde todas las sucursales)
-- ---------------------------------------------------------------------------
create policy clientes_lectura on public.clientes for select to authenticated
  using ((select app.es_personal_venta()));
create policy clientes_alta on public.clientes for insert to authenticated
  with check ((select app.es_personal_venta()));
create policy clientes_edicion on public.clientes for update to authenticated
  using ((select app.es_personal_venta())) with check ((select app.es_personal_venta()));
create policy clientes_borrado on public.clientes for delete to authenticated
  using ((select app.es_superadmin()));

create policy clientes_alias_lectura on public.clientes_alias for select to authenticated
  using ((select app.es_personal_venta()));

create policy puntos_lectura on public.movimientos_puntos for select to authenticated
  using ((select app.es_personal_venta()));
create policy puntos_ajuste on public.movimientos_puntos for insert to authenticated
  with check (
    tipo in ('canje', 'ajuste')
    and usuario_id = (select auth.uid())
    and ((select app.es_superadmin()) or (select app.administra_sucursal(sucursal_id)))
  );

-- ---------------------------------------------------------------------------
-- POS: cajas, sesiones, arqueos, ventas
-- ---------------------------------------------------------------------------
create policy cajas_lectura on public.cajas for select to authenticated
  using ((select app.puede_ver_sucursal(sucursal_id)));
create policy cajas_superadmin on public.cajas for all to authenticated
  using ((select app.es_superadmin())) with check ((select app.es_superadmin()));

create policy sesiones_lectura on public.sesiones_caja for select to authenticated
  using ((select app.puede_ver_sucursal(sucursal_id)));
create policy sesiones_apertura on public.sesiones_caja for insert to authenticated
  with check ((select app.opera_sucursal(sucursal_id)) and cajero_id = (select auth.uid()));
create policy sesiones_cierre on public.sesiones_caja for update to authenticated
  using (
    estado = 'abierta'
    and (cajero_id = (select auth.uid()) or (select app.administra_sucursal(sucursal_id)))
  )
  with check (cajero_id = (select auth.uid()) or (select app.administra_sucursal(sucursal_id)));

create policy arqueos_lectura on public.arqueos for select to authenticated
  using ((select app.administra_sucursal(sucursal_id)));
create policy arqueos_revision on public.arqueos for update to authenticated
  using ((select app.administra_sucursal(sucursal_id)))
  with check ((select app.administra_sucursal(sucursal_id)));

-- La revisión solo firma el arqueo; los montos no se tocan.
create or replace function app.tg_arqueos_solo_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['revisado_por', 'revisado_en', 'observacion_revision'])
     is distinct from (to_jsonb(old) - array['revisado_por', 'revisado_en', 'observacion_revision']) then
    raise exception 'Los montos del arqueo no pueden modificarse' using errcode = '42501';
  end if;
  new.revisado_por := auth.uid();
  new.revisado_en := now();
  return new;
end;
$$;

create trigger arqueos_solo_revision before update on public.arqueos
  for each row execute function app.tg_arqueos_solo_revision();

create policy ventas_lectura on public.ventas for select to authenticated
  using ((select app.puede_ver_sucursal(sucursal_id)));
create policy ventas_registro on public.ventas for insert to authenticated
  with check ((select app.opera_sucursal(sucursal_id)) and cajero_id = (select auth.uid()));

create policy venta_detalles_lectura on public.venta_detalles for select to authenticated
  using ((select app.puede_ver_sucursal(sucursal_id)));
create policy venta_detalles_registro on public.venta_detalles for insert to authenticated
  with check ((select app.opera_sucursal(sucursal_id)));

create policy venta_pagos_lectura on public.venta_pagos for select to authenticated
  using ((select app.puede_ver_sucursal(sucursal_id)));
create policy venta_pagos_registro on public.venta_pagos for insert to authenticated
  with check ((select app.opera_sucursal(sucursal_id)));

-- ---------------------------------------------------------------------------
-- Fiscal
-- ---------------------------------------------------------------------------
create policy cuis_lectura on public.cuis for select to authenticated
  using ((select app.administra_sucursal(sucursal_id)));

-- El POS necesita el CUFD vigente (código de control) para emitir offline.
create policy cufd_lectura on public.cufd for select to authenticated
  using ((select app.es_superadmin()) or (select app.opera_sucursal(sucursal_id)));

create policy facturas_lectura on public.facturas for select to authenticated
  using ((select app.puede_ver_sucursal(sucursal_id)));
create policy facturas_emision on public.facturas for insert to authenticated
  with check ((select app.opera_sucursal(sucursal_id)) and estado in ('pendiente', 'contingencia'));

create policy eventos_lectura on public.eventos_significativos for select to authenticated
  using ((select app.puede_ver_sucursal(sucursal_id)));
create policy eventos_reporte on public.eventos_significativos for insert to authenticated
  with check ((select app.opera_sucursal(sucursal_id)) and estado = 'detectado');
create policy eventos_cierre on public.eventos_significativos for update to authenticated
  using ((select app.opera_sucursal(sucursal_id)))
  with check ((select app.opera_sucursal(sucursal_id)));

create policy paquetes_lectura on public.paquetes_fiscales for select to authenticated
  using ((select app.administra_sucursal(sucursal_id)));

create policy logs_sin_lectura on public.logs_sin for select to authenticated
  using ((select app.es_superadmin()) or (sucursal_id is not null and (select app.administra_sucursal(sucursal_id))));

create policy cola_fiscal_lectura on public.cola_fiscal for select to authenticated
  using ((select app.es_superadmin()));

-- ---------------------------------------------------------------------------
-- Transferencias
-- ---------------------------------------------------------------------------
create policy transferencias_lectura on public.transferencias for select to authenticated
  using (
    (select app.es_produccion())
    or ((select app.es_gerente()) and (select app.sucursal_id()) in (origen_id, destino_id))
  );

-- Gerente solicita hacia su sucursal; almacén/superadmin, entre cualesquiera.
create policy transferencias_solicitud on public.transferencias for insert to authenticated
  with check (
    estado = 'solicitada'
    and solicitado_por = (select auth.uid())
    and ((select app.es_produccion()) or ((select app.es_gerente()) and destino_id = (select app.sucursal_id())))
  );

create policy transferencias_edicion on public.transferencias for update to authenticated
  using (solicitado_por = (select auth.uid()) or (select app.es_superadmin()))
  with check (solicitado_por = (select auth.uid()) or (select app.es_superadmin()));

create policy transferencia_detalles_lectura on public.transferencia_detalles for select to authenticated
  using (exists (select 1 from public.transferencias t where t.id = transferencia_id));

create policy transferencia_detalles_edicion on public.transferencia_detalles for all to authenticated
  using (exists (select 1 from public.transferencias t where t.id = transferencia_id
                  and (t.solicitado_por = (select auth.uid()) or (select app.es_produccion()))))
  with check (exists (select 1 from public.transferencias t where t.id = transferencia_id
                  and (t.solicitado_por = (select auth.uid()) or (select app.es_produccion()))));

-- ---------------------------------------------------------------------------
-- Producción y taller (SuperAdmin + Almacén/Taller)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['materias_primas', 'recetas', 'receta_items'] loop
    execute format(
      'create policy %I on public.%I for all to authenticated
         using ((select app.es_produccion())) with check ((select app.es_produccion()))',
      t || '_produccion', t);
  end loop;
end;
$$;

create policy ordenes_lectura on public.ordenes_trabajo for select to authenticated
  using ((select app.es_produccion()));
create policy ordenes_alta on public.ordenes_trabajo for insert to authenticated
  with check ((select app.es_produccion()));
create policy ordenes_movimiento on public.ordenes_trabajo for update to authenticated
  using ((select app.es_produccion())) with check ((select app.es_produccion()));

create policy ot_historial_lectura on public.ordenes_trabajo_historial for select to authenticated
  using ((select app.es_produccion()));

create policy mov_mp_lectura on public.movimientos_materia_prima for select to authenticated
  using ((select app.es_produccion()));
create policy mov_mp_registro on public.movimientos_materia_prima for insert to authenticated
  with check (
    (select app.es_produccion())
    and usuario_id = (select auth.uid())
    and tipo in ('inventario_inicial', 'compra', 'ajuste_positivo', 'ajuste_negativo')
  );

-- ---------------------------------------------------------------------------
-- Auditoría: lectura exclusiva del SuperAdmin; SIN políticas de escritura.
-- ---------------------------------------------------------------------------
create policy logs_auditoria_lectura on public.logs_auditoria for select to authenticated
  using ((select app.es_superadmin()));
