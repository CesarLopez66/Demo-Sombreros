-- =============================================================================
-- 0004 · Inventario multisucursal: stock, kardex de movimientos y alertas
-- =============================================================================
-- Regla: `stock` NUNCA se escribe directamente. Toda variación entra como una
-- fila en `movimientos_inventario` (kardex inmutable) y un trigger actualiza el
-- saldo. Ventas, transferencias y producción generan sus movimientos solos.

create type public.tipo_movimiento_inventario as enum (
  'inventario_inicial',
  'venta',
  'anulacion_venta',
  'transferencia_salida',
  'transferencia_entrada',
  'produccion',
  'ajuste_positivo',
  'ajuste_negativo'
);

create table public.stock (
  sucursal_id   uuid not null references public.sucursales (id),
  variante_id   uuid not null references public.variantes (id),
  -- Puede quedar negativo: una venta offline no se rechaza por stock (se alerta).
  cantidad      integer not null default 0,
  stock_minimo  integer not null default 0 check (stock_minimo >= 0),
  updated_at    timestamptz not null default now(),
  primary key (sucursal_id, variante_id)
);

create index stock_variante_idx on public.stock (variante_id);

create table public.movimientos_inventario (
  id                uuid primary key default gen_random_uuid(),
  sucursal_id       uuid not null references public.sucursales (id),
  variante_id       uuid not null references public.variantes (id),
  tipo              public.tipo_movimiento_inventario not null,
  cantidad          integer not null,
  saldo_resultante  integer,
  referencia_tabla  text,
  referencia_id     uuid,
  motivo            text,
  usuario_id        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  constraint movimientos_signo_valido check (
    case
      when tipo in ('venta', 'transferencia_salida', 'ajuste_negativo') then cantidad < 0
      else cantidad > 0
    end
  ),
  constraint movimientos_ajuste_con_motivo check (
    tipo not in ('ajuste_positivo', 'ajuste_negativo') or length(trim(coalesce(motivo, ''))) > 0
  )
);

create index movimientos_inv_sucursal_variante_idx
  on public.movimientos_inventario (sucursal_id, variante_id, created_at desc);
create index movimientos_inv_referencia_idx
  on public.movimientos_inventario (referencia_tabla, referencia_id);

create type public.tipo_alerta_inventario as enum (
  'stock_bajo',
  'stock_negativo',
  'faltante_transferencia',
  'sobrante_transferencia',
  'materia_prima_baja'
);

create table public.alertas_inventario (
  id                uuid primary key default gen_random_uuid(),
  sucursal_id       uuid references public.sucursales (id),
  variante_id       uuid references public.variantes (id),
  materia_prima_id  uuid,                                   -- FK añadida en 0009
  tipo              public.tipo_alerta_inventario not null,
  mensaje           text not null,
  datos             jsonb not null default '{}'::jsonb,
  atendida          boolean not null default false,
  atendida_por      uuid references auth.users (id),
  atendida_en       timestamptz,
  created_at        timestamptz not null default now()
);

create index alertas_abiertas_idx on public.alertas_inventario (sucursal_id, tipo) where not atendida;

-- ---------------------------------------------------------------------------
-- Aplica el movimiento al saldo (BEFORE INSERT: así guarda saldo_resultante)
-- ---------------------------------------------------------------------------
create or replace function app.tg_aplicar_movimiento_inventario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saldo   integer;
  v_minimo  integer;
begin
  insert into public.stock as s (sucursal_id, variante_id, cantidad)
  values (new.sucursal_id, new.variante_id, new.cantidad)
  on conflict (sucursal_id, variante_id)
  do update set cantidad = s.cantidad + excluded.cantidad, updated_at = now()
  returning s.cantidad, s.stock_minimo into v_saldo, v_minimo;

  new.saldo_resultante := v_saldo;

  if new.cantidad < 0 then
    if v_saldo < 0 then
      perform app.abrir_alerta_stock(new.sucursal_id, new.variante_id, 'stock_negativo', v_saldo, v_minimo);
    elsif v_saldo <= v_minimo and v_minimo > 0 then
      perform app.abrir_alerta_stock(new.sucursal_id, new.variante_id, 'stock_bajo', v_saldo, v_minimo);
    end if;
  end if;

  return new;
end;
$$;

-- Evita duplicar alertas abiertas del mismo tipo para la misma celda.
create or replace function app.abrir_alerta_stock(
  p_sucursal_id uuid, p_variante_id uuid, p_tipo public.tipo_alerta_inventario,
  p_saldo integer, p_minimo integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.alertas_inventario a
     where a.sucursal_id = p_sucursal_id and a.variante_id = p_variante_id
       and a.tipo = p_tipo and not a.atendida
  ) then
    return;
  end if;

  insert into public.alertas_inventario (sucursal_id, variante_id, tipo, mensaje, datos)
  select p_sucursal_id, p_variante_id, p_tipo,
         format('%s en %s: %s (saldo %s, mínimo %s)',
                case p_tipo when 'stock_negativo' then 'Stock negativo' else 'Stock bajo' end,
                s.codigo, v.sku, p_saldo, p_minimo),
         jsonb_build_object('saldo', p_saldo, 'minimo', p_minimo)
    from public.sucursales s, public.variantes v
   where s.id = p_sucursal_id and v.id = p_variante_id;
end;
$$;

create trigger movimientos_inventario_aplicar
  before insert on public.movimientos_inventario
  for each row execute function app.tg_aplicar_movimiento_inventario();

-- El kardex es inmutable para todos (las correcciones son ajustes nuevos).
create or replace function app.tg_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'La tabla % es inmutable: % no permitido', tg_table_name, tg_op
    using errcode = '42501';
end;
$$;

create trigger movimientos_inventario_inmutable
  before update or delete on public.movimientos_inventario
  for each row execute function app.tg_inmutable();

-- Solo se permite tocar stock_minimo desde fuera; la cantidad la maneja el kardex.
create or replace function app.tg_stock_proteger_cantidad()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cantidad is distinct from old.cantidad and pg_trigger_depth() = 1 then
    raise exception 'stock.cantidad solo cambia mediante movimientos_inventario'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger stock_proteger_cantidad
  before update on public.stock
  for each row execute function app.tg_stock_proteger_cantidad();
