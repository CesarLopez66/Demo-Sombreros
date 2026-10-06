-- =============================================================================
-- 0001 · Fundamentos: esquema privado `app`, helpers de JWT/RBAC y utilidades
-- =============================================================================
-- Los roles viven en auth.jwt() -> 'app_metadata' ->> 'rol'. app_metadata solo
-- puede escribirse con la service_role, por lo que el usuario no puede elevarse.
-- El esquema `app` NO se expone en PostgREST: estas funciones no son RPC públicas.

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Lectura de claims
-- ---------------------------------------------------------------------------
create or replace function app.claims_app()
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata', '{}'::jsonb)
$$;

-- Rol efectivo. Un perfil desactivado (activo=false) pierde el rol aunque su
-- token siga vigente hasta expirar.
create or replace function app.rol()
returns text
language sql stable
set search_path = ''
as $$
  select case
    when coalesce((app.claims_app() ->> 'activo')::boolean, true) is false then null
    else nullif(app.claims_app() ->> 'rol', '')
  end
$$;

create or replace function app.sucursal_id()
returns uuid
language sql stable
set search_path = ''
as $$
  select nullif(app.claims_app() ->> 'sucursal_id', '')::uuid
$$;

-- MFA: Supabase emite aal2 cuando la sesión verificó un segundo factor (TOTP).
create or replace function app.mfa_verificado()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

-- Sin claims (conexión directa: migraciones, microservicio fiscal vía pooler)
-- o con service_role → operación de sistema.
create or replace function app.es_sistema()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role'
$$;

-- SuperAdmin y Gerente exigen MFA (aal2): sin segundo factor, la BD los trata
-- como si no tuvieran rol.
create or replace function app.es_superadmin()
returns boolean language sql stable set search_path = ''
as $$ select app.rol() = 'superadmin' and app.mfa_verificado() $$;

create or replace function app.es_gerente()
returns boolean language sql stable set search_path = ''
as $$ select app.rol() = 'gerente' and app.mfa_verificado() $$;

create or replace function app.es_almacen()
returns boolean language sql stable set search_path = ''
as $$ select app.rol() = 'almacen' $$;

create or replace function app.es_cajero()
returns boolean language sql stable set search_path = ''
as $$ select app.rol() = 'cajero' $$;

-- Personal de una sucursal concreta (gerente o cajero) operando SU sucursal.
create or replace function app.opera_sucursal(p_sucursal_id uuid)
returns boolean language sql stable set search_path = ''
as $$
  select (app.es_gerente() or app.es_cajero())
     and p_sucursal_id is not null
     and p_sucursal_id = app.sucursal_id()
$$;

-- Lectura de datos operativos de una sucursal.
-- SuperAdmin y Almacén/Taller tienen visión global; el resto, solo la suya.
create or replace function app.puede_ver_sucursal(p_sucursal_id uuid)
returns boolean language sql stable set search_path = ''
as $$
  select app.es_superadmin() or app.es_almacen() or app.opera_sucursal(p_sucursal_id)
$$;

-- Gerente de la sucursal indicada o SuperAdmin (autorizaciones).
create or replace function app.administra_sucursal(p_sucursal_id uuid)
returns boolean language sql stable set search_path = ''
as $$
  select app.es_superadmin()
      or (app.es_gerente() and p_sucursal_id = app.sucursal_id())
$$;

-- Aserción para funciones RPC con SECURITY DEFINER.
create or replace function app.exigir(p_condicion boolean, p_mensaje text, p_codigo text default '42501')
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_condicion is not true then
    raise exception using message = p_mensaje, errcode = p_codigo;
  end if;
end;
$$;

grant execute on all functions in schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Utilidades de triggers
-- ---------------------------------------------------------------------------
create or replace function app.tg_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Parámetros globales del negocio (clave/valor)
-- ---------------------------------------------------------------------------
create table public.parametros (
  clave        text primary key,
  valor        jsonb not null,
  descripcion  text,
  updated_at   timestamptz not null default now()
);

create trigger parametros_updated_at before update on public.parametros
  for each row execute function app.tg_updated_at();

create or replace function app.parametro_num(p_clave text, p_defecto numeric)
returns numeric
language sql stable
security definer
set search_path = ''
as $$
  select coalesce((select (valor #>> '{}')::numeric from public.parametros where clave = p_clave), p_defecto)
$$;
