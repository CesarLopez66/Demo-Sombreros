-- =============================================================================
-- 0007 · Facturación electrónica en línea (SIN Bolivia)
-- =============================================================================
-- Reparto de responsabilidades:
--   · POS: calcula el CUF con el CUFD vigente (también offline), imprime el
--     comprobante con QR e inserta la fila en `facturas`.
--   · Microservicio NestJS (service_role, vía pooler): arma el XML, lo firma con
--     el certificado (.p12 solo en RAM), lo envía y actualiza estados/logs.
-- Comunicación BD → microservicio: tabla outbox `cola_fiscal` + pg_notify.
-- El microservicio la consume con FOR UPDATE SKIP LOCKED y la pasa a BullMQ.

create type public.estado_factura as enum (
  'pendiente',              -- emitida en línea, aún no enviada
  'contingencia',           -- emitida offline / SIN caído: viaja en paquete
  'enviada',
  'validada',
  'observada',
  'rechazada',
  'anulacion_pendiente',
  'anulada'
);

-- Códigos SIN: 1 en línea, 2 fuera de línea
create type public.tipo_emision as enum ('en_linea', 'fuera_de_linea');

create table public.cuis (
  id              uuid primary key default gen_random_uuid(),
  sucursal_id     uuid not null references public.sucursales (id),
  punto_venta     integer not null,
  codigo          text not null,
  fecha_vigencia  timestamptz not null,
  created_at      timestamptz not null default now()
);

create index cuis_vigente_idx on public.cuis (sucursal_id, punto_venta, fecha_vigencia desc);

-- CUFD diario. El POS guarda en local el último vigente para operar offline.
create table public.cufd (
  id              uuid primary key default gen_random_uuid(),
  sucursal_id     uuid not null references public.sucursales (id),
  punto_venta     integer not null,
  codigo          text not null unique,
  codigo_control  text not null,
  direccion       text,
  fecha_inicio    timestamptz not null default now(),
  fecha_vigencia  timestamptz not null,
  created_at      timestamptz not null default now()
);

create index cufd_vigente_idx on public.cufd (sucursal_id, punto_venta, fecha_vigencia desc);

create type public.estado_evento_significativo as enum (
  'detectado',              -- el POS detectó la caída y lo reportó
  'registrado',             -- el SIN aceptó el evento (codigoRecepcionEventoSignificativo)
  'paquetes_enviados',
  'validado',
  'error'
);

-- codigo_evento según el catálogo paramétrico del SIN (sincronizarParametricaEventosSignificativos):
-- 1 corte de internet, 2 servicio web del SIN inaccesible, ... (validar contra el catálogo vigente).
create table public.eventos_significativos (
  id                          uuid primary key default gen_random_uuid(),
  sucursal_id                 uuid not null references public.sucursales (id),
  punto_venta                 integer not null,
  codigo_evento               smallint not null check (codigo_evento between 1 and 7),
  descripcion                 text not null,
  inicio                      timestamptz not null,
  fin                         timestamptz,
  cufd_evento                 text,                -- CUFD vigente al inicio de la contingencia
  codigo_recepcion_evento     text,
  estado                      public.estado_evento_significativo not null default 'detectado',
  detectado_por               uuid default auth.uid() references auth.users (id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint eventos_rango_valido check (fin is null or fin >= inicio)
);

create index eventos_pendientes_idx on public.eventos_significativos (sucursal_id, estado);

create trigger eventos_significativos_updated_at before update on public.eventos_significativos
  for each row execute function app.tg_updated_at();

create type public.estado_paquete_fiscal as enum ('en_cola', 'enviado', 'validado', 'observado', 'rechazado');

create table public.paquetes_fiscales (
  id                 uuid primary key default gen_random_uuid(),
  evento_id          uuid not null references public.eventos_significativos (id),
  sucursal_id        uuid not null references public.sucursales (id),
  punto_venta        integer not null,
  cantidad_facturas  integer not null check (cantidad_facturas between 1 and 500),   -- límite por paquete del SIN
  estado             public.estado_paquete_fiscal not null default 'en_cola',
  job_id             text,                       -- id del job BullMQ
  hash_archivo       text,                       -- SHA-256 del .tar.gz enviado
  codigo_recepcion   text,
  intentos           integer not null default 0,
  respuesta          jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger paquetes_fiscales_updated_at before update on public.paquetes_fiscales
  for each row execute function app.tg_updated_at();

create table public.facturas (
  id                        uuid primary key default gen_random_uuid(),
  venta_id                  uuid not null unique references public.ventas (id),
  sucursal_id               uuid not null references public.sucursales (id),
  punto_venta               integer not null,
  numero_factura            bigint not null check (numero_factura > 0),
  cuf                       text not null unique,
  cufd                      text not null,
  tipo_emision              public.tipo_emision not null,
  codigo_documento_sector   smallint not null default 1,        -- 1 = compra-venta
  fecha_emision             timestamptz not null,
  monto_total               numeric(12,2) not null check (monto_total >= 0),
  leyenda                   text,
  url_qr                    text,
  estado                    public.estado_factura not null,
  evento_id                 uuid references public.eventos_significativos (id),
  paquete_id                uuid references public.paquetes_fiscales (id),
  xml_storage_path          text,                               -- bucket privado "fiscal"
  codigo_recepcion          text,
  intentos                  integer not null default 0,
  ultimo_error              text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (sucursal_id, punto_venta, numero_factura),
  constraint facturas_estado_inicial_coherente check (
    tipo_emision = 'en_linea' or estado <> 'pendiente'
  )
);

create index facturas_estado_idx on public.facturas (estado, sucursal_id);
create index facturas_paquete_idx on public.facturas (paquete_id);

create trigger facturas_updated_at before update on public.facturas
  for each row execute function app.tg_updated_at();

-- Logs de comunicación SOAP/REST con el SIN (sin datos sensibles ni certificados)
create table public.logs_sin (
  id               bigint generated always as identity primary key,
  sucursal_id      uuid references public.sucursales (id),
  servicio         text not null,                -- FacturacionCodigos, ServicioFacturacionCompraVenta...
  operacion        text not null,                -- cufd, recepcionFactura, recepcionPaqueteFactura...
  factura_id       uuid references public.facturas (id),
  paquete_id       uuid references public.paquetes_fiscales (id),
  evento_id        uuid references public.eventos_significativos (id),
  exito            boolean not null,
  codigo_respuesta text,
  mensajes         jsonb,
  duracion_ms      integer,
  created_at       timestamptz not null default now()
);

create index logs_sin_fecha_idx on public.logs_sin (created_at desc);
create index logs_sin_errores_idx on public.logs_sin (sucursal_id, created_at desc) where not exito;

-- ---------------------------------------------------------------------------
-- Outbox fiscal
-- ---------------------------------------------------------------------------
create type public.tipo_tarea_fiscal as enum ('emitir_factura', 'anular_factura', 'registrar_evento');
create type public.estado_tarea_fiscal as enum ('pendiente', 'tomada', 'procesada', 'error');

create table public.cola_fiscal (
  id                bigint generated always as identity primary key,
  tipo              public.tipo_tarea_fiscal not null,
  referencia_id     uuid not null,
  sucursal_id       uuid references public.sucursales (id),
  payload           jsonb not null default '{}'::jsonb,
  estado            public.estado_tarea_fiscal not null default 'pendiente',
  intentos          integer not null default 0,
  disponible_desde  timestamptz not null default now(),
  ultimo_error      text,
  created_at        timestamptz not null default now(),
  procesada_en      timestamptz
);

create index cola_fiscal_pendientes_idx on public.cola_fiscal (disponible_desde) where estado = 'pendiente';

create or replace function app.encolar_tarea_fiscal(
  p_tipo public.tipo_tarea_fiscal, p_referencia uuid, p_sucursal uuid, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.cola_fiscal (tipo, referencia_id, sucursal_id, payload)
  values (p_tipo, p_referencia, p_sucursal, p_payload);
  perform pg_notify('cola_fiscal', json_build_object('tipo', p_tipo, 'referencia_id', p_referencia)::text);
end;
$$;

-- Factura nueva → tarea de emisión (las de contingencia esperan su paquete)
create or replace function app.tg_facturas_encolar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.estado = 'pendiente' then
    perform app.encolar_tarea_fiscal('emitir_factura', new.id, new.sucursal_id);
  elsif tg_op = 'UPDATE' and new.estado = 'anulacion_pendiente' and old.estado <> 'anulacion_pendiente' then
    perform app.encolar_tarea_fiscal('anular_factura', new.id, new.sucursal_id,
                                     jsonb_build_object('estado_previo', old.estado));
  end if;
  return new;
end;
$$;

create trigger facturas_encolar after insert or update of estado on public.facturas
  for each row execute function app.tg_facturas_encolar();

-- Evento significativo cerrado (fin informado) → registrarlo en el SIN y
-- luego empaquetar sus facturas de contingencia.
create or replace function app.tg_eventos_encolar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fin is not null and new.estado = 'detectado'
     and (tg_op = 'INSERT' or old.fin is null) then
    perform app.encolar_tarea_fiscal('registrar_evento', new.id, new.sucursal_id);
  end if;
  return new;
end;
$$;

create trigger eventos_encolar after insert or update of fin on public.eventos_significativos
  for each row execute function app.tg_eventos_encolar();

-- Los usuarios (POS) solo pueden cerrar un evento informando `fin`.
create or replace function app.tg_eventos_validar_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.es_sistema() then
    return new;
  end if;
  if (new.id, new.sucursal_id, new.punto_venta, new.codigo_evento, new.inicio, new.cufd_evento,
      new.codigo_recepcion_evento, new.estado, new.detectado_por)
     is distinct from
     (old.id, old.sucursal_id, old.punto_venta, old.codigo_evento, old.inicio, old.cufd_evento,
      old.codigo_recepcion_evento, old.estado, old.detectado_por)
     or old.fin is not null then
    raise exception 'Desde el POS solo se puede informar el fin del evento' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger eventos_validar_update before update on public.eventos_significativos
  for each row execute function app.tg_eventos_validar_update();
