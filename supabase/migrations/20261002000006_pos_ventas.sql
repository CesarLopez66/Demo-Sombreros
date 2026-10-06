-- =============================================================================
-- 0006 · POS: cajas, sesiones (apertura/cierre), ventas, pagos y arqueo ciego
-- =============================================================================
-- Diseño offline-first: los IDs (uuid) se generan en el POS, por lo que los
-- reintentos de sincronización son idempotentes. La vía recomendada de subida
-- es la RPC registrar_venta(), que inserta cabecera+detalle+pagos(+factura) en
-- una sola transacción.

create type public.metodo_pago as enum ('efectivo', 'qr', 'tarjeta');
create type public.estado_sesion_caja as enum ('abierta', 'cerrada');
create type public.estado_venta as enum ('completada', 'anulada');
create type public.tipo_comprobante as enum ('factura', 'ticket');

create table public.cajas (
  id               uuid primary key default gen_random_uuid(),
  sucursal_id      uuid not null references public.sucursales (id),
  codigo           text not null,                          -- CAJA-01
  nombre           text not null,
  punto_venta_sin  integer not null check (punto_venta_sin >= 0),
  activa           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (sucursal_id, codigo),
  unique (sucursal_id, punto_venta_sin)
);

create table public.sesiones_caja (
  id                  uuid primary key default gen_random_uuid(),
  caja_id             uuid not null references public.cajas (id),
  sucursal_id         uuid not null references public.sucursales (id),
  cajero_id           uuid not null default auth.uid() references auth.users (id),
  estado              public.estado_sesion_caja not null default 'abierta',
  abierta_en          timestamptz not null default now(),
  cerrada_en          timestamptz,
  monto_inicial       numeric(12,2) not null check (monto_inicial >= 0),
  -- Arqueo ciego: el cajero declara sin ver el monto esperado.
  monto_declarado     numeric(12,2) check (monto_declarado >= 0),
  detalle_declarado   jsonb,                               -- { "200": 3, "100": 5, "0.50": 4, ... }
  observaciones       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint sesiones_cierre_completo check (
    estado = 'abierta' or (cerrada_en is not null and monto_declarado is not null)
  )
);

create unique index sesiones_una_abierta_por_caja on public.sesiones_caja (caja_id) where estado = 'abierta';
create index sesiones_sucursal_idx on public.sesiones_caja (sucursal_id, abierta_en desc);

create trigger sesiones_caja_updated_at before update on public.sesiones_caja
  for each row execute function app.tg_updated_at();

-- Resultado del arqueo: solo gerente/superadmin lo leen (RLS), no el cajero.
create table public.arqueos (
  id                        uuid primary key default gen_random_uuid(),
  sesion_caja_id            uuid not null unique references public.sesiones_caja (id),
  sucursal_id               uuid not null references public.sucursales (id),
  monto_inicial             numeric(12,2) not null,
  ventas_efectivo           numeric(12,2) not null,
  ventas_qr                 numeric(12,2) not null,
  ventas_tarjeta            numeric(12,2) not null,
  monto_esperado_efectivo   numeric(12,2) not null,
  monto_declarado           numeric(12,2) not null,
  diferencia                numeric(12,2) not null,      -- declarado − esperado (negativo = faltante)
  cantidad_ventas           integer not null,
  cantidad_anuladas         integer not null,
  revisado_por              uuid references auth.users (id),
  revisado_en               timestamptz,
  observacion_revision      text,
  created_at                timestamptz not null default now()
);

create table public.ventas (
  id                        uuid primary key default gen_random_uuid(),
  sucursal_id               uuid not null references public.sucursales (id),
  caja_id                   uuid not null references public.cajas (id),
  sesion_caja_id            uuid not null references public.sesiones_caja (id),
  cajero_id                 uuid not null default auth.uid() references auth.users (id),
  numero_venta_local        bigint not null check (numero_venta_local > 0),   -- correlativo por caja
  fecha_emision             timestamptz not null default now(),               -- hora del POS
  cliente_id                uuid references public.clientes (id),
  -- Snapshot del receptor tal como se facturó
  documento_tipo            public.tipo_documento_identidad,
  documento_numero          text,
  documento_complemento     text,
  razon_social              text,
  subtotal                  numeric(12,2) not null check (subtotal >= 0),
  descuento                 numeric(12,2) not null default 0 check (descuento >= 0),
  total                     numeric(12,2) not null check (total >= 0),
  descuento_autorizado_por  uuid references auth.users (id),
  tipo_comprobante          public.tipo_comprobante not null default 'factura',
  estado                    public.estado_venta not null default 'completada',
  emitida_offline           boolean not null default false,
  recibida_en               timestamptz not null default now(),               -- llegada al servidor
  anulada_por               uuid references auth.users (id),
  anulada_en                timestamptz,
  motivo_anulacion          text,
  unique (caja_id, numero_venta_local),
  constraint ventas_total_cuadra check (total = subtotal - descuento),
  constraint ventas_anulacion_completa check (
    estado = 'completada' or (anulada_por is not null and anulada_en is not null and motivo_anulacion is not null)
  )
);

create index ventas_sucursal_fecha_idx on public.ventas (sucursal_id, fecha_emision desc);
create index ventas_sesion_idx on public.ventas (sesion_caja_id);
create index ventas_cliente_idx on public.ventas (cliente_id, fecha_emision desc);

create table public.venta_detalles (
  id               uuid primary key default gen_random_uuid(),
  venta_id         uuid not null references public.ventas (id),
  sucursal_id      uuid not null references public.sucursales (id),
  variante_id      uuid not null references public.variantes (id),
  descripcion      text not null,                     -- snapshot impreso en el comprobante
  cantidad         integer not null check (cantidad > 0),
  precio_unitario  numeric(12,2) not null check (precio_unitario >= 0),
  descuento        numeric(12,2) not null default 0 check (descuento >= 0),
  subtotal         numeric(12,2) not null,
  constraint detalle_subtotal_cuadra check (subtotal = cantidad * precio_unitario - descuento)
);

create index venta_detalles_venta_idx on public.venta_detalles (venta_id);
create index venta_detalles_variante_idx on public.venta_detalles (variante_id);

create table public.venta_pagos (
  id              uuid primary key default gen_random_uuid(),
  venta_id        uuid not null references public.ventas (id),
  sucursal_id     uuid not null references public.sucursales (id),
  metodo          public.metodo_pago not null,
  monto           numeric(12,2) not null check (monto > 0),     -- monto aplicado a la venta
  monto_recibido  numeric(12,2),                                 -- efectivo entregado (para el cambio)
  referencia      text,                                          -- id de transacción QR / voucher
  created_at      timestamptz not null default now()
);

create index venta_pagos_venta_idx on public.venta_pagos (venta_id);

alter table public.movimientos_puntos
  add constraint movimientos_puntos_venta_fk foreign key (venta_id) references public.ventas (id);

-- ---------------------------------------------------------------------------
-- Validaciones de la cabecera de venta
-- ---------------------------------------------------------------------------
create or replace function app.tg_ventas_validar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sesion        public.sesiones_caja%rowtype;
  v_max_desc_pct  numeric;
begin
  new.cliente_id := app.resolver_cliente(new.cliente_id);
  new.recibida_en := now();

  select * into v_sesion from public.sesiones_caja where id = new.sesion_caja_id;

  perform app.exigir(v_sesion.id is not null, 'Sesión de caja inexistente', 'P0001');
  perform app.exigir(v_sesion.caja_id = new.caja_id and v_sesion.sucursal_id = new.sucursal_id,
                     'La sesión no corresponde a la caja/sucursal de la venta', 'P0001');
  -- La cola de PowerSync es FIFO: las ventas de una sesión llegan antes de su cierre.
  perform app.exigir(v_sesion.estado = 'abierta', 'La sesión de caja ya está cerrada', 'P0001');

  -- Descuentos por encima del umbral exigen autorización de gerente/superadmin.
  v_max_desc_pct := app.parametro_num('max_descuento_cajero_pct', 5);
  if new.subtotal > 0 and new.descuento * 100 > new.subtotal * v_max_desc_pct then
    perform app.exigir(
      exists (
        select 1 from public.perfiles p
         where p.id = new.descuento_autorizado_por and p.activo
           and (p.rol = 'superadmin' or (p.rol = 'gerente' and p.sucursal_id = new.sucursal_id))
      ),
      format('Descuento mayor al %s%% requiere autorización de gerente', v_max_desc_pct), 'P0001');
  end if;

  return new;
end;
$$;

create trigger ventas_validar before insert on public.ventas
  for each row execute function app.tg_ventas_validar();

-- Una venta solo cambia por anulación (RPC anular_venta).
create or replace function app.tg_ventas_solo_anulacion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado = 'anulada' then
    raise exception 'La venta % ya está anulada', old.id using errcode = 'P0001';
  end if;
  if (new.id, new.sucursal_id, new.caja_id, new.sesion_caja_id, new.cajero_id, new.numero_venta_local,
      new.fecha_emision, new.cliente_id, new.subtotal, new.descuento, new.total, new.tipo_comprobante)
     is distinct from
     (old.id, old.sucursal_id, old.caja_id, old.sesion_caja_id, old.cajero_id, old.numero_venta_local,
      old.fecha_emision, old.cliente_id, old.subtotal, old.descuento, old.total, old.tipo_comprobante) then
    raise exception 'Una venta registrada no puede modificarse; solo anularse' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger ventas_solo_anulacion before update on public.ventas
  for each row execute function app.tg_ventas_solo_anulacion();

create trigger ventas_sin_borrado before delete on public.ventas
  for each row execute function app.tg_inmutable();
create trigger venta_detalles_inmutable before update or delete on public.venta_detalles
  for each row execute function app.tg_inmutable();
create trigger venta_pagos_inmutable before update or delete on public.venta_pagos
  for each row execute function app.tg_inmutable();

-- Detalle y pagos deben pertenecer a la misma sucursal que la venta.
create or replace function app.tg_hijo_venta_validar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir(
    exists (select 1 from public.ventas v
             where v.id = new.venta_id and v.sucursal_id = new.sucursal_id and v.estado = 'completada'),
    'La venta no existe, está anulada o es de otra sucursal', 'P0001');
  return new;
end;
$$;

create trigger venta_detalles_validar before insert on public.venta_detalles
  for each row execute function app.tg_hijo_venta_validar();
create trigger venta_pagos_validar before insert on public.venta_pagos
  for each row execute function app.tg_hijo_venta_validar();

-- Cada línea vendida descuenta stock de la sucursal.
create or replace function app.tg_venta_detalle_descontar_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.movimientos_inventario
    (sucursal_id, variante_id, tipo, cantidad, referencia_tabla, referencia_id)
  values
    (new.sucursal_id, new.variante_id, 'venta', -new.cantidad, 'ventas', new.venta_id);
  return new;
end;
$$;

create trigger venta_detalles_descontar_stock after insert on public.venta_detalles
  for each row execute function app.tg_venta_detalle_descontar_stock();

-- Fidelización: 1 punto por cada N Bs del total (parámetro puntos_bs_por_punto).
create or replace function app.tg_venta_acumular_puntos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_puntos integer;
begin
  if new.cliente_id is null then
    return new;
  end if;
  v_puntos := floor(new.total / nullif(app.parametro_num('puntos_bs_por_punto', 10), 0));
  if v_puntos > 0 then
    insert into public.movimientos_puntos (cliente_id, venta_id, sucursal_id, tipo, puntos, usuario_id)
    values (new.cliente_id, new.id, new.sucursal_id, 'acumulacion', v_puntos, new.cajero_id);
  end if;
  return new;
end;
$$;

create trigger ventas_acumular_puntos after insert on public.ventas
  for each row execute function app.tg_venta_acumular_puntos();

-- ---------------------------------------------------------------------------
-- Sesiones de caja: el cajero solo puede cerrar (declarar efectivo).
-- ---------------------------------------------------------------------------
create or replace function app.tg_sesiones_caja_validar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.exigir(
      exists (select 1 from public.cajas c where c.id = new.caja_id and c.sucursal_id = new.sucursal_id and c.activa),
      'Caja inexistente, inactiva o de otra sucursal', 'P0001');
    new.estado := 'abierta';
    new.cerrada_en := null;
    new.monto_declarado := null;
    return new;
  end if;

  -- UPDATE
  perform app.exigir(old.estado = 'abierta', 'La sesión ya está cerrada', 'P0001');
  perform app.exigir(
    (new.id, new.caja_id, new.sucursal_id, new.cajero_id, new.abierta_en, new.monto_inicial)
      is not distinct from
    (old.id, old.caja_id, old.sucursal_id, old.cajero_id, old.abierta_en, old.monto_inicial),
    'Solo se puede registrar el cierre de la sesión');

  if new.estado = 'cerrada' then
    new.cerrada_en := coalesce(new.cerrada_en, now());
  end if;
  return new;
end;
$$;

create trigger sesiones_caja_validar before insert or update on public.sesiones_caja
  for each row execute function app.tg_sesiones_caja_validar();

create or replace function app.tg_sesiones_caja_arqueo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_efectivo  numeric(12,2);
  v_qr        numeric(12,2);
  v_tarjeta   numeric(12,2);
  v_ventas    integer;
  v_anuladas  integer;
  v_esperado  numeric(12,2);
begin
  if not (old.estado = 'abierta' and new.estado = 'cerrada') then
    return new;
  end if;

  select coalesce(sum(p.monto) filter (where p.metodo = 'efectivo'), 0),
         coalesce(sum(p.monto) filter (where p.metodo = 'qr'), 0),
         coalesce(sum(p.monto) filter (where p.metodo = 'tarjeta'), 0)
    into v_efectivo, v_qr, v_tarjeta
    from public.venta_pagos p
    join public.ventas v on v.id = p.venta_id
   where v.sesion_caja_id = new.id and v.estado = 'completada';

  select count(*) filter (where v.estado = 'completada'),
         count(*) filter (where v.estado = 'anulada')
    into v_ventas, v_anuladas
    from public.ventas v
   where v.sesion_caja_id = new.id;

  v_esperado := new.monto_inicial + v_efectivo;

  insert into public.arqueos (
    sesion_caja_id, sucursal_id, monto_inicial, ventas_efectivo, ventas_qr, ventas_tarjeta,
    monto_esperado_efectivo, monto_declarado, diferencia, cantidad_ventas, cantidad_anuladas)
  values (
    new.id, new.sucursal_id, new.monto_inicial, v_efectivo, v_qr, v_tarjeta,
    v_esperado, new.monto_declarado, new.monto_declarado - v_esperado, v_ventas, v_anuladas);

  return new;
end;
$$;

create trigger sesiones_caja_arqueo after update on public.sesiones_caja
  for each row execute function app.tg_sesiones_caja_arqueo();
