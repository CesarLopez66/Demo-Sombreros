-- =============================================================================
-- 0008 · Transferencias intersucursales
-- =============================================================================
-- Flujo: solicitada → aprobada → despachada → recibida | recibida_con_diferencias
--        (cancelada solo antes del despacho)
-- La creación usa INSERT con RLS; cada transición es una RPC con controles.

create type public.estado_transferencia as enum (
  'solicitada', 'aprobada', 'despachada', 'recibida', 'recibida_con_diferencias', 'cancelada'
);

create sequence public.transferencias_correlativo;

create table public.transferencias (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null unique
                   default 'TRF-' || to_char(now() at time zone 'America/La_Paz', 'YYYYMMDD')
                           || '-' || lpad(nextval('public.transferencias_correlativo')::text, 5, '0'),
  origen_id        uuid not null references public.sucursales (id),
  destino_id       uuid not null references public.sucursales (id),
  estado           public.estado_transferencia not null default 'solicitada',
  solicitado_por   uuid not null default auth.uid() references auth.users (id),
  aprobado_por     uuid references auth.users (id),
  despachado_por   uuid references auth.users (id),
  recibido_por     uuid references auth.users (id),
  solicitado_en    timestamptz not null default now(),
  aprobado_en      timestamptz,
  despachado_en    timestamptz,
  recibido_en      timestamptz,
  notas            text,
  notas_recepcion  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint transferencias_origen_distinto check (origen_id <> destino_id)
);

create index transferencias_origen_idx on public.transferencias (origen_id, estado);
create index transferencias_destino_idx on public.transferencias (destino_id, estado);

create trigger transferencias_updated_at before update on public.transferencias
  for each row execute function app.tg_updated_at();

create table public.transferencia_detalles (
  id                   uuid primary key default gen_random_uuid(),
  transferencia_id     uuid not null references public.transferencias (id) on delete cascade,
  variante_id          uuid not null references public.variantes (id),
  cantidad_solicitada  integer not null check (cantidad_solicitada > 0),
  cantidad_despachada  integer check (cantidad_despachada >= 0),
  cantidad_recibida    integer check (cantidad_recibida >= 0),
  diferencia           integer generated always as (cantidad_recibida - cantidad_despachada) stored,
  unique (transferencia_id, variante_id)
);

-- Las filas solo se crean/editan mientras la transferencia está 'solicitada'
-- (las cantidades despachadas/recibidas las escriben las RPC).
create or replace function app.tg_transferencia_detalle_editable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_estado public.estado_transferencia;
begin
  -- Las RPC (SECURITY DEFINER) corren como owner y escriben las cantidades.
  if current_user in ('postgres', 'supabase_admin') or app.es_sistema() then
    return coalesce(new, old);
  end if;
  select estado into v_estado from public.transferencias
   where id = coalesce(new.transferencia_id, old.transferencia_id);
  perform app.exigir(v_estado = 'solicitada',
                     'Solo se pueden editar ítems de una transferencia en estado solicitada', 'P0001');
  if tg_op <> 'DELETE' then
    new.cantidad_despachada := null;
    new.cantidad_recibida := null;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger transferencia_detalles_editable
  before insert or update or delete on public.transferencia_detalles
  for each row execute function app.tg_transferencia_detalle_editable();

-- Quien despacha: almacén/superadmin o gerente de la sucursal de origen.
create or replace function app.puede_despachar(p_origen uuid)
returns boolean language sql stable set search_path = ''
as $$ select app.es_superadmin() or app.es_almacen() or (app.es_gerente() and p_origen = app.sucursal_id()) $$;

-- Quien recibe: superadmin, gerente del destino, o almacén si el destino es el taller.
create or replace function app.puede_recibir(p_destino uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select app.es_superadmin()
      or (app.es_gerente() and p_destino = app.sucursal_id())
      or (app.es_almacen() and exists (select 1 from public.sucursales s where s.id = p_destino and s.tipo = 'taller'))
$$;

-- ---------------------------------------------------------------------------
-- RPC: aprobar
-- ---------------------------------------------------------------------------
create or replace function public.aprobar_transferencia(p_transferencia_id uuid)
returns public.transferencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transferencias;
begin
  select * into t from public.transferencias where id = p_transferencia_id for update;
  perform app.exigir(t.id is not null, 'Transferencia inexistente', 'P0002');
  perform app.exigir(app.puede_despachar(t.origen_id), 'No autorizado para aprobar esta transferencia');
  perform app.exigir(t.estado = 'solicitada', 'Solo se aprueban transferencias solicitadas', 'P0001');
  perform app.exigir(exists (select 1 from public.transferencia_detalles d where d.transferencia_id = t.id),
                     'La transferencia no tiene ítems', 'P0001');

  update public.transferencias
     set estado = 'aprobada', aprobado_por = auth.uid(), aprobado_en = now()
   where id = t.id
  returning * into t;
  return t;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: despachar. p_items = [{ "variante_id": uuid, "cantidad": int }, ...]
-- Si p_items es null se despacha exactamente lo solicitado.
-- ---------------------------------------------------------------------------
create or replace function public.despachar_transferencia(p_transferencia_id uuid, p_items jsonb default null)
returns public.transferencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  t      public.transferencias;
  d      record;
  v_cant integer;
  v_disp integer;
begin
  select * into t from public.transferencias where id = p_transferencia_id for update;
  perform app.exigir(t.id is not null, 'Transferencia inexistente', 'P0002');
  perform app.exigir(app.puede_despachar(t.origen_id), 'No autorizado para despachar desde esta sucursal');
  perform app.exigir(t.estado = 'aprobada', 'Solo se despachan transferencias aprobadas', 'P0001');

  for d in select * from public.transferencia_detalles where transferencia_id = t.id for update loop
    v_cant := coalesce(
      (select (i ->> 'cantidad')::integer from jsonb_array_elements(p_items) i
        where (i ->> 'variante_id')::uuid = d.variante_id),
      case when p_items is null then d.cantidad_solicitada else 0 end);

    perform app.exigir(v_cant >= 0, 'Cantidad despachada inválida', 'P0001');

    if v_cant > 0 then
      select coalesce(s.cantidad, 0) into v_disp
        from public.stock s where s.sucursal_id = t.origen_id and s.variante_id = d.variante_id
        for update;
      perform app.exigir(coalesce(v_disp, 0) >= v_cant,
                         format('Stock insuficiente en origen para la variante %s (disponible %s, pedido %s)',
                                d.variante_id, coalesce(v_disp, 0), v_cant), 'P0001');

      insert into public.movimientos_inventario
        (sucursal_id, variante_id, tipo, cantidad, referencia_tabla, referencia_id)
      values (t.origen_id, d.variante_id, 'transferencia_salida', -v_cant, 'transferencias', t.id);
    end if;

    update public.transferencia_detalles set cantidad_despachada = v_cant where id = d.id;
  end loop;

  update public.transferencias
     set estado = 'despachada', despachado_por = auth.uid(), despachado_en = now()
   where id = t.id
  returning * into t;
  return t;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: recibir (validación de lo recibido vs. lo despachado)
-- p_items = [{ "variante_id": uuid, "cantidad": int }]; null = todo conforme.
-- ---------------------------------------------------------------------------
create or replace function public.recibir_transferencia(
  p_transferencia_id uuid, p_items jsonb default null, p_notas text default null)
returns public.transferencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  t              public.transferencias;
  d              record;
  v_cant         integer;
  v_diferencias  boolean := false;
begin
  select * into t from public.transferencias where id = p_transferencia_id for update;
  perform app.exigir(t.id is not null, 'Transferencia inexistente', 'P0002');
  perform app.exigir(app.puede_recibir(t.destino_id), 'No autorizado para recibir en esta sucursal');
  perform app.exigir(t.estado = 'despachada', 'Solo se reciben transferencias despachadas', 'P0001');

  for d in select * from public.transferencia_detalles where transferencia_id = t.id for update loop
    v_cant := coalesce(
      (select (i ->> 'cantidad')::integer from jsonb_array_elements(p_items) i
        where (i ->> 'variante_id')::uuid = d.variante_id),
      case when p_items is null then d.cantidad_despachada else 0 end);

    perform app.exigir(v_cant >= 0, 'Cantidad recibida inválida', 'P0001');

    if v_cant > 0 then
      insert into public.movimientos_inventario
        (sucursal_id, variante_id, tipo, cantidad, referencia_tabla, referencia_id)
      values (t.destino_id, d.variante_id, 'transferencia_entrada', v_cant, 'transferencias', t.id);
    end if;

    update public.transferencia_detalles set cantidad_recibida = v_cant where id = d.id;

    if v_cant <> d.cantidad_despachada then
      v_diferencias := true;
      insert into public.alertas_inventario (sucursal_id, variante_id, tipo, mensaje, datos)
      select t.destino_id, d.variante_id,
             case when v_cant < d.cantidad_despachada then 'faltante_transferencia'
                  else 'sobrante_transferencia' end::public.tipo_alerta_inventario,
             format('%s: %s %s despachado %s, recibido %s', t.codigo, v.sku,
                    case when v_cant < d.cantidad_despachada then 'FALTANTE.' else 'SOBRANTE.' end,
                    d.cantidad_despachada, v_cant),
             jsonb_build_object('transferencia_id', t.id, 'origen_id', t.origen_id,
                                'despachado', d.cantidad_despachada, 'recibido', v_cant)
        from public.variantes v where v.id = d.variante_id;
    end if;
  end loop;

  update public.transferencias
     set estado = case when v_diferencias then 'recibida_con_diferencias' else 'recibida' end::public.estado_transferencia,
         recibido_por = auth.uid(), recibido_en = now(), notas_recepcion = p_notas
   where id = t.id
  returning * into t;
  return t;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: cancelar (antes del despacho)
-- ---------------------------------------------------------------------------
create or replace function public.cancelar_transferencia(p_transferencia_id uuid, p_motivo text)
returns public.transferencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transferencias;
begin
  select * into t from public.transferencias where id = p_transferencia_id for update;
  perform app.exigir(t.id is not null, 'Transferencia inexistente', 'P0002');
  perform app.exigir(
    app.puede_despachar(t.origen_id) or t.solicitado_por = auth.uid(),
    'No autorizado para cancelar esta transferencia');
  perform app.exigir(t.estado in ('solicitada', 'aprobada'), 'Solo se cancela antes del despacho', 'P0001');
  perform app.exigir(length(trim(coalesce(p_motivo, ''))) > 0, 'Indique el motivo de cancelación', 'P0001');

  update public.transferencias
     set estado = 'cancelada', notas = concat_ws(E'\n', notas, 'CANCELADA: ' || p_motivo)
   where id = t.id
  returning * into t;
  return t;
end;
$$;

-- Las transiciones solo pasan por las RPC (que corren como owner).
create or replace function app.tg_transferencias_validar_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'supabase_admin') and not app.es_sistema() then
    if new.estado is distinct from old.estado
       or (new.origen_id, new.destino_id, new.solicitado_por) is distinct from (old.origen_id, old.destino_id, old.solicitado_por)
       or old.estado <> 'solicitada' then
      raise exception 'Use las funciones aprobar/despachar/recibir/cancelar_transferencia'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger transferencias_validar_update before update on public.transferencias
  for each row execute function app.tg_transferencias_validar_update();
