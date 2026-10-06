-- =============================================================================
-- 0005 · Clientes centralizados (NIT/CI) y fidelización por puntos
-- =============================================================================

-- Códigos de tipo de documento del SIN: 1 CI, 2 CEX, 3 PAS, 4 OD, 5 NIT
create type public.tipo_documento_identidad as enum ('CI', 'CEX', 'PAS', 'OD', 'NIT');

create table public.clientes (
  id                    uuid primary key default gen_random_uuid(),   -- generado en el POS si es offline
  tipo_documento        public.tipo_documento_identidad not null,
  numero_documento      text not null check (numero_documento ~ '^[0-9A-Za-z-]{1,20}$'),
  complemento           text check (complemento ~ '^[0-9A-Za-z]{1,5}$'),
  razon_social          text not null,
  email                 text,
  telefono              text,
  fecha_nacimiento      date,
  puntos                integer not null default 0 check (puntos >= 0),
  sucursal_registro_id  uuid references public.sucursales (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint clientes_documento_unico unique nulls not distinct (tipo_documento, numero_documento, complemento)
);

create index clientes_razon_social_idx on public.clientes (lower(razon_social));

create trigger clientes_updated_at before update on public.clientes
  for each row execute function app.tg_updated_at();

-- ---------------------------------------------------------------------------
-- Deduplicación offline
-- Dos POS sin conexión pueden registrar el mismo NIT/CI con UUIDs distintos.
-- Al sincronizar, el segundo no falla: se guarda como alias del existente y las
-- ventas que lo referencian se redirigen al cliente canónico.
-- ---------------------------------------------------------------------------
create table public.clientes_alias (
  alias_id    uuid primary key,
  cliente_id  uuid not null references public.clientes (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create or replace function app.tg_clientes_deduplicar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existente uuid;
begin
  select c.id into v_existente
    from public.clientes c
   where c.tipo_documento = new.tipo_documento
     and c.numero_documento = new.numero_documento
     and c.complemento is not distinct from new.complemento;

  if v_existente is null then
    return new;
  end if;

  insert into public.clientes_alias (alias_id, cliente_id)
  values (new.id, v_existente)
  on conflict (alias_id) do nothing;

  -- Completa datos de contacto faltantes sin pisar los existentes.
  update public.clientes c
     set email    = coalesce(c.email, new.email),
         telefono = coalesce(c.telefono, new.telefono)
   where c.id = v_existente;

  return null;  -- descarta la fila duplicada sin error
end;
$$;

create trigger clientes_deduplicar before insert on public.clientes
  for each row execute function app.tg_clientes_deduplicar();

create or replace function app.resolver_cliente(p_cliente_id uuid)
returns uuid
language sql stable
security definer
set search_path = ''
as $$
  select coalesce((select a.cliente_id from public.clientes_alias a where a.alias_id = p_cliente_id), p_cliente_id)
$$;

-- ---------------------------------------------------------------------------
-- Libro de puntos (el saldo en clientes.puntos lo mantiene el trigger)
-- ---------------------------------------------------------------------------
create type public.tipo_movimiento_puntos as enum ('acumulacion', 'canje', 'reverso', 'ajuste');

create table public.movimientos_puntos (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references public.clientes (id),
  venta_id     uuid,                                    -- FK añadida en 0006
  sucursal_id  uuid references public.sucursales (id),
  tipo         public.tipo_movimiento_puntos not null,
  puntos       integer not null check (puntos <> 0),
  motivo       text,
  usuario_id   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);

create index movimientos_puntos_cliente_idx on public.movimientos_puntos (cliente_id, created_at desc);

create or replace function app.tg_aplicar_puntos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- check (puntos >= 0) impide saldos negativos por canjes excesivos
  update public.clientes set puntos = puntos + new.puntos where id = new.cliente_id;
  return new;
end;
$$;

create trigger movimientos_puntos_aplicar after insert on public.movimientos_puntos
  for each row execute function app.tg_aplicar_puntos();

create trigger movimientos_puntos_inmutable before update or delete on public.movimientos_puntos
  for each row execute function app.tg_inmutable();
