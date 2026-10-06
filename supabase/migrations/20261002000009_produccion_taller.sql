-- =============================================================================
-- 0009 · Producción y taller: materias primas, recetas (BOM), órdenes Kanban
-- =============================================================================

create type public.categoria_materia_prima as enum (
  'fieltro', 'paja_toquilla', 'cinta', 'tafilete', 'horma', 'forro', 'adorno', 'insumo', 'otro'
);

create table public.materias_primas (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique,
  nombre          text not null,
  categoria       public.categoria_materia_prima not null,
  unidad_medida   text not null,                       -- unidad, m, m2, kg, cono
  -- Las hormas son herramientas reutilizables: no se descuentan al producir.
  es_consumible   boolean not null default true,
  costo_unitario  numeric(14,4) not null default 0 check (costo_unitario >= 0),   -- costo promedio ponderado
  stock_actual    numeric(14,3) not null default 0 check (stock_actual >= 0),
  stock_minimo    numeric(14,3) not null default 0 check (stock_minimo >= 0),
  proveedor       text,
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger materias_primas_updated_at before update on public.materias_primas
  for each row execute function app.tg_updated_at();

alter table public.alertas_inventario
  add constraint alertas_materia_prima_fk foreign key (materia_prima_id) references public.materias_primas (id);

create type public.tipo_movimiento_mp as enum (
  'inventario_inicial', 'compra', 'consumo_produccion', 'ajuste_positivo', 'ajuste_negativo'
);

create table public.movimientos_materia_prima (
  id                uuid primary key default gen_random_uuid(),
  materia_prima_id  uuid not null references public.materias_primas (id),
  tipo              public.tipo_movimiento_mp not null,
  cantidad          numeric(14,3) not null,
  costo_unitario    numeric(14,4),                     -- obligatorio en compras
  saldo_resultante  numeric(14,3),
  orden_trabajo_id  uuid,                              -- FK abajo
  motivo            text,
  usuario_id        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  constraint mov_mp_signo_valido check (
    case when tipo in ('consumo_produccion', 'ajuste_negativo') then cantidad < 0 else cantidad > 0 end
  ),
  constraint mov_mp_compra_con_costo check (tipo <> 'compra' or costo_unitario is not null)
);

create index mov_mp_materia_idx on public.movimientos_materia_prima (materia_prima_id, created_at desc);

-- Aplica el movimiento; en compras recalcula el costo promedio ponderado.
create or replace function app.tg_aplicar_movimiento_mp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mp public.materias_primas;
begin
  select * into mp from public.materias_primas where id = new.materia_prima_id for update;

  perform app.exigir(mp.stock_actual + new.cantidad >= 0,
    format('Stock insuficiente de %s (%s): disponible %s %s, requerido %s',
           mp.nombre, mp.codigo, mp.stock_actual, mp.unidad_medida, -new.cantidad), 'P0001');

  update public.materias_primas
     set stock_actual   = mp.stock_actual + new.cantidad,
         costo_unitario = case
           when new.tipo in ('compra', 'inventario_inicial') and new.costo_unitario is not null
             then round((mp.stock_actual * mp.costo_unitario + new.cantidad * new.costo_unitario)
                        / (mp.stock_actual + new.cantidad), 4)
           else mp.costo_unitario end
   where id = mp.id;

  new.saldo_resultante := mp.stock_actual + new.cantidad;

  if new.cantidad < 0 and new.saldo_resultante <= mp.stock_minimo and mp.stock_minimo > 0
     and not exists (select 1 from public.alertas_inventario a
                      where a.materia_prima_id = mp.id and a.tipo = 'materia_prima_baja' and not a.atendida) then
    insert into public.alertas_inventario (materia_prima_id, tipo, mensaje, datos)
    values (mp.id, 'materia_prima_baja',
            format('Materia prima baja: %s (%s %s, mínimo %s)', mp.nombre, new.saldo_resultante, mp.unidad_medida, mp.stock_minimo),
            jsonb_build_object('saldo', new.saldo_resultante, 'minimo', mp.stock_minimo));
  end if;

  return new;
end;
$$;

create trigger movimientos_mp_aplicar before insert on public.movimientos_materia_prima
  for each row execute function app.tg_aplicar_movimiento_mp();
create trigger movimientos_mp_inmutable before update or delete on public.movimientos_materia_prima
  for each row execute function app.tg_inmutable();

-- stock_actual / costo_unitario solo cambian por movimientos.
create or replace function app.tg_mp_proteger_saldo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1
     and (new.stock_actual is distinct from old.stock_actual or new.costo_unitario is distinct from old.costo_unitario) then
    raise exception 'stock_actual y costo_unitario solo cambian mediante movimientos_materia_prima'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger materias_primas_proteger_saldo before update on public.materias_primas
  for each row execute function app.tg_mp_proteger_saldo();

-- ---------------------------------------------------------------------------
-- Recetas / BOM por modelo (versionadas; una activa por modelo)
-- ---------------------------------------------------------------------------
create table public.recetas (
  id                uuid primary key default gen_random_uuid(),
  modelo_id         uuid not null references public.modelos (id),
  version           integer not null default 1 check (version > 0),
  nombre            text not null,
  costo_mano_obra   numeric(12,2) not null default 0 check (costo_mano_obra >= 0),   -- por unidad
  costo_indirecto   numeric(12,2) not null default 0 check (costo_indirecto >= 0),   -- por unidad
  merma_pct         numeric(5,2) not null default 0 check (merma_pct between 0 and 100),
  activa            boolean not null default true,
  notas             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (modelo_id, version)
);

create unique index recetas_una_activa_por_modelo on public.recetas (modelo_id) where activa;

create trigger recetas_updated_at before update on public.recetas
  for each row execute function app.tg_updated_at();

create table public.receta_items (
  id                uuid primary key default gen_random_uuid(),
  receta_id         uuid not null references public.recetas (id) on delete cascade,
  materia_prima_id  uuid not null references public.materias_primas (id),
  cantidad          numeric(14,4) not null check (cantidad > 0),      -- por unidad producida
  unique (receta_id, materia_prima_id)
);

-- ---------------------------------------------------------------------------
-- Órdenes de trabajo (tablero Kanban)
-- ---------------------------------------------------------------------------
create type public.etapa_produccion as enum (
  'preparacion', 'hormado_prensado', 'costura_adorno', 'control_calidad', 'en_stock'
);

create sequence public.ordenes_trabajo_correlativo;

create table public.ordenes_trabajo (
  id                     uuid primary key default gen_random_uuid(),
  codigo                 text not null unique
                         default 'OT-' || to_char(now() at time zone 'America/La_Paz', 'YYYYMMDD')
                                 || '-' || lpad(nextval('public.ordenes_trabajo_correlativo')::text, 5, '0'),
  variante_id            uuid not null references public.variantes (id),
  receta_id              uuid not null references public.recetas (id),
  cantidad               integer not null check (cantidad > 0),
  cantidad_aprobada_qa   integer check (cantidad_aprobada_qa >= 0),
  etapa                  public.etapa_produccion not null default 'preparacion',
  prioridad              smallint not null default 3 check (prioridad between 1 and 5),
  sucursal_destino_id    uuid not null references public.sucursales (id),
  responsable_id         uuid references auth.users (id),
  fecha_compromiso       date,
  materiales_consumidos  boolean not null default false,
  -- Costos reales congelados al consumir materiales
  costo_materiales       numeric(14,2),
  costo_mano_obra        numeric(14,2),
  costo_indirecto        numeric(14,2),
  costo_unitario_real    numeric(14,4),
  notas                  text,
  creada_por             uuid default auth.uid() references auth.users (id),
  completada_en          timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint ot_qa_no_excede check (cantidad_aprobada_qa is null or cantidad_aprobada_qa <= cantidad)
);

create index ordenes_trabajo_etapa_idx on public.ordenes_trabajo (etapa, prioridad);

create trigger ordenes_trabajo_updated_at before update on public.ordenes_trabajo
  for each row execute function app.tg_updated_at();

alter table public.movimientos_materia_prima
  add constraint mov_mp_orden_fk foreign key (orden_trabajo_id) references public.ordenes_trabajo (id);

create table public.ordenes_trabajo_historial (
  id               uuid primary key default gen_random_uuid(),
  orden_id         uuid not null references public.ordenes_trabajo (id),
  etapa_anterior   public.etapa_produccion,
  etapa_nueva      public.etapa_produccion not null,
  usuario_id       uuid default auth.uid(),
  comentario       text,
  created_at       timestamptz not null default now()
);

create index ot_historial_orden_idx on public.ordenes_trabajo_historial (orden_id, created_at);

-- La receta debe ser del mismo modelo que la variante a fabricar.
create or replace function app.tg_ot_validar_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir(
    exists (select 1 from public.recetas r join public.variantes v on v.modelo_id = r.modelo_id
             where r.id = new.receta_id and v.id = new.variante_id),
    'La receta no corresponde al modelo de la variante', 'P0001');
  new.etapa := 'preparacion';
  new.materiales_consumidos := false;
  return new;
end;
$$;

create trigger ordenes_trabajo_validar_insert before insert on public.ordenes_trabajo
  for each row execute function app.tg_ot_validar_insert();

-- Movimiento en el Kanban: un paso adelante (o uno atrás para retrabajo).
--  · Al salir de Preparación se consumen materias primas según BOM y se congela el costo.
--  · Al llegar a En stock ingresan los sombreros aprobados por QA a la sucursal destino.
create or replace function app.tg_ot_transicion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orden_ant  integer := array_position(enum_range(null::public.etapa_produccion), old.etapa);
  v_orden_nue  integer := array_position(enum_range(null::public.etapa_produccion), new.etapa);
  r            public.recetas;
  v_costo_mat  numeric(14,2) := 0;
  it           record;
  v_cant       numeric(14,3);
  v_buenas     integer;
begin
  -- Campos calculados: nadie los escribe a mano.
  perform app.exigir(
    (new.materiales_consumidos, new.costo_materiales, new.costo_mano_obra, new.costo_indirecto,
     new.costo_unitario_real, new.completada_en)
      is not distinct from
    (old.materiales_consumidos, old.costo_materiales, old.costo_mano_obra, old.costo_indirecto,
     old.costo_unitario_real, old.completada_en),
    'Los costos y el cierre de la orden se calculan automáticamente');
  -- Qué y cuánto se fabrica solo se corrige antes de consumir materiales.
  perform app.exigir(
    not old.materiales_consumidos
      or (new.variante_id, new.receta_id, new.cantidad) is not distinct from (old.variante_id, old.receta_id, old.cantidad),
    'No se puede cambiar variante, receta ni cantidad después de consumir materiales', 'P0001');
  if (new.variante_id, new.receta_id) is distinct from (old.variante_id, old.receta_id) then
    perform app.exigir(
      exists (select 1 from public.recetas r join public.variantes v on v.modelo_id = r.modelo_id
               where r.id = new.receta_id and v.id = new.variante_id),
      'La receta no corresponde al modelo de la variante', 'P0001');
  end if;

  if new.etapa = old.etapa then
    return new;
  end if;

  perform app.exigir(old.etapa <> 'en_stock', 'La orden ya fue cerrada en stock', 'P0001');
  perform app.exigir(abs(v_orden_nue - v_orden_ant) = 1,
                     'Solo se puede mover la orden una etapa adelante o atrás', 'P0001');

  if old.etapa = 'preparacion' and new.etapa = 'hormado_prensado' and not old.materiales_consumidos then
    select * into r from public.recetas where id = new.receta_id;

    for it in
      select ri.materia_prima_id, ri.cantidad, mp.costo_unitario
        from public.receta_items ri
        join public.materias_primas mp on mp.id = ri.materia_prima_id
       where ri.receta_id = r.id and mp.es_consumible
    loop
      v_cant := round(it.cantidad * new.cantidad * (1 + r.merma_pct / 100), 3);
      insert into public.movimientos_materia_prima (materia_prima_id, tipo, cantidad, orden_trabajo_id, motivo)
      values (it.materia_prima_id, 'consumo_produccion', -v_cant, new.id, 'Consumo ' || new.codigo);
      v_costo_mat := v_costo_mat + v_cant * it.costo_unitario;
    end loop;

    new.materiales_consumidos := true;
    new.costo_materiales := v_costo_mat;
    new.costo_mano_obra := r.costo_mano_obra * new.cantidad;
    new.costo_indirecto := r.costo_indirecto * new.cantidad;
  end if;

  if new.etapa = 'en_stock' then
    v_buenas := coalesce(new.cantidad_aprobada_qa, new.cantidad);
    perform app.exigir(v_buenas > 0, 'QA no aprobó ninguna unidad', 'P0001');

    -- El costo real se reparte entre las unidades aprobadas (las mermas de QA lo encarecen).
    new.costo_unitario_real := round(
      (coalesce(new.costo_materiales, 0) + coalesce(new.costo_mano_obra, 0) + coalesce(new.costo_indirecto, 0)) / v_buenas, 4);
    new.completada_en := now();

    insert into public.movimientos_inventario
      (sucursal_id, variante_id, tipo, cantidad, referencia_tabla, referencia_id, motivo)
    values (new.sucursal_destino_id, new.variante_id, 'produccion', v_buenas, 'ordenes_trabajo', new.id, new.codigo);

    insert into public.costos_variante (variante_id, costo_estandar, ultimo_costo_real, ultimo_costo_en)
    values (new.variante_id, new.costo_unitario_real, new.costo_unitario_real, now())
    on conflict (variante_id) do update
      set ultimo_costo_real = excluded.ultimo_costo_real, ultimo_costo_en = excluded.ultimo_costo_en;
  end if;

  insert into public.ordenes_trabajo_historial (orden_id, etapa_anterior, etapa_nueva)
  values (new.id, old.etapa, new.etapa);

  return new;
end;
$$;

create trigger ordenes_trabajo_transicion before update on public.ordenes_trabajo
  for each row execute function app.tg_ot_transicion();

-- ---------------------------------------------------------------------------
-- Calculadora de costos por receta (BOM)
-- ---------------------------------------------------------------------------
create or replace function public.calcular_costo_receta(p_receta_id uuid, p_cantidad integer default 1)
returns table (
  materia_prima_id  uuid,
  codigo            text,
  nombre            text,
  unidad_medida     text,
  cantidad          numeric,
  costo_unitario    numeric,
  subtotal          numeric
)
language sql stable
security invoker
set search_path = ''
as $$
  select mp.id, mp.codigo, mp.nombre, mp.unidad_medida,
         round(ri.cantidad * p_cantidad * (1 + r.merma_pct / 100), 4),
         mp.costo_unitario,
         case when mp.es_consumible
              then round(ri.cantidad * p_cantidad * (1 + r.merma_pct / 100) * mp.costo_unitario, 2)
              else 0 end
    from public.recetas r
    join public.receta_items ri on ri.receta_id = r.id
    join public.materias_primas mp on mp.id = ri.materia_prima_id
   where r.id = p_receta_id
   order by mp.categoria, mp.nombre
$$;

create view public.v_costos_recetas
with (security_invoker = true)
as
select r.id                                       as receta_id,
       m.id                                       as modelo_id,
       m.codigo                                   as modelo_codigo,
       m.nombre                                   as modelo,
       r.version,
       r.activa,
       coalesce(mat.costo_materiales, 0)          as costo_materiales,
       r.costo_mano_obra,
       r.costo_indirecto,
       coalesce(mat.costo_materiales, 0) + r.costo_mano_obra + r.costo_indirecto as costo_total_unitario,
       m.precio_base,
       case when m.precio_base > 0 then
         round((m.precio_base - (coalesce(mat.costo_materiales, 0) + r.costo_mano_obra + r.costo_indirecto))
               / m.precio_base * 100, 2)
       end                                        as margen_pct
  from public.recetas r
  join public.modelos m on m.id = r.modelo_id
  left join lateral (
    select sum(ri.cantidad * (1 + r.merma_pct / 100) * mp.costo_unitario) as costo_materiales
      from public.receta_items ri
      join public.materias_primas mp on mp.id = ri.materia_prima_id
     where ri.receta_id = r.id and mp.es_consumible
  ) mat on true;
