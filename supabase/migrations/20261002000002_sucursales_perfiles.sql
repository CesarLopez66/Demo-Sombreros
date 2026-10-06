-- =============================================================================
-- 0002 · Sucursales, perfiles de usuario y sincronización de roles al JWT
-- =============================================================================

create type public.rol_usuario as enum ('superadmin', 'gerente', 'almacen', 'cajero');
create type public.tipo_sucursal as enum ('tienda', 'taller');

create table public.sucursales (
  id                   uuid primary key default gen_random_uuid(),
  codigo               text not null unique check (codigo ~ '^[A-Z]{3}$'),   -- LPZ, CBB, SCZ, TAL
  nombre               text not null,
  departamento         text not null,
  municipio            text,
  direccion            text not null,
  telefono             text,
  tipo                 public.tipo_sucursal not null default 'tienda',
  codigo_sucursal_sin  integer unique check (codigo_sucursal_sin >= 0),      -- 0 = casa matriz
  activa               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger sucursales_updated_at before update on public.sucursales
  for each row execute function app.tg_updated_at();

create table public.perfiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  nombre_completo  text not null,
  ci               text,
  rol              public.rol_usuario not null,
  sucursal_id      uuid references public.sucursales (id),
  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Gerentes y cajeros siempre pertenecen a una sucursal.
  constraint perfiles_sucursal_requerida
    check (rol in ('superadmin', 'almacen') or sucursal_id is not null)
);

create index perfiles_sucursal_idx on public.perfiles (sucursal_id);

create trigger perfiles_updated_at before update on public.perfiles
  for each row execute function app.tg_updated_at();

-- ---------------------------------------------------------------------------
-- perfiles → auth.users.raw_app_meta_data
-- La tabla perfiles es la fuente de verdad; los claims viajan en el JWT en el
-- siguiente refresh del token (≤ jwt_expiry).
-- ---------------------------------------------------------------------------
create or replace function app.tg_sincronizar_claims()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codigo text;
begin
  select s.codigo into v_codigo from public.sucursales s where s.id = new.sucursal_id;

  update auth.users u
     set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object(
                                  'rol',             new.rol,
                                  'sucursal_id',     new.sucursal_id,
                                  'sucursal_codigo', v_codigo,
                                  'activo',          new.activo)
   where u.id = new.id;

  return new;
end;
$$;

create trigger perfiles_sincronizar_claims
  after insert or update of rol, sucursal_id, activo on public.perfiles
  for each row execute function app.tg_sincronizar_claims();

-- ---------------------------------------------------------------------------
-- auth.users → perfiles
-- El alta de usuarios la hace el SuperAdmin desde el ERP (server action con
-- service_role) enviando app_metadata { rol, sucursal_id } y
-- user_metadata { nombre_completo }. El registro público está deshabilitado.
-- ---------------------------------------------------------------------------
create or replace function app.tg_crear_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.raw_app_meta_data ? 'rol' then
    insert into public.perfiles (id, nombre_completo, rol, sucursal_id)
    values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data ->> 'nombre_completo', ''), new.email, 'Sin nombre'),
      (new.raw_app_meta_data ->> 'rol')::public.rol_usuario,
      nullif(new.raw_app_meta_data ->> 'sucursal_id', '')::uuid
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

create trigger auth_users_crear_perfil
  after insert on auth.users
  for each row execute function app.tg_crear_perfil();
