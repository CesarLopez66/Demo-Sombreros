-- =============================================================================
-- 0014 · Replicación para PowerSync y buckets de Storage
-- =============================================================================

-- PowerSync lee el WAL mediante replicación lógica sobre esta publicación.
-- Solo las tablas que el POS necesita localmente.
-- El rol de replicación se crea a mano en producción (ver README, no se guarda
-- la contraseña en migraciones):
--   create role powersync_role with replication bypassrls login password '***';
--   grant select on all tables in schema public to powersync_role;
create publication powersync for table
  public.sucursales,
  public.parametros,
  public.cajas,
  public.materiales,
  public.tallas,
  public.colores,
  public.hormas,
  public.modelos,
  public.variantes,
  public.stock,
  public.clientes,
  public.sesiones_caja,
  public.ventas,
  public.venta_detalles,
  public.venta_pagos,
  public.facturas,
  public.cufd,
  public.eventos_significativos;

-- ---------------------------------------------------------------------------
-- Storage (solo si el esquema storage existe: entorno Supabase real)
--   productos → imágenes del catálogo, lectura para usuarios autenticados
--   fiscal    → XML firmados y PDFs; solo service_role (microservicio)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Esquema storage no disponible: se omiten buckets';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('productos', 'productos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
         ('fiscal',    'fiscal',    false, 10485760, array['application/xml', 'text/xml', 'application/pdf', 'application/gzip'])
  on conflict (id) do nothing;

  execute $p$
    create policy productos_lectura on storage.objects for select to authenticated
      using (bucket_id = 'productos' and (select app.rol()) is not null)
  $p$;
  execute $p$
    create policy productos_escritura on storage.objects for all to authenticated
      using (bucket_id = 'productos' and (select app.es_superadmin()))
      with check (bucket_id = 'productos' and (select app.es_superadmin()))
  $p$;
  -- bucket "fiscal": sin políticas → solo service_role.
end;
$$;
