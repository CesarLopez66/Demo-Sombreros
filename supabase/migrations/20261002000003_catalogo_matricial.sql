-- =============================================================================
-- 0003 · Catálogo matricial: Modelo × Talla × Color × Tipo de Horma
-- =============================================================================

create table public.materiales (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,          -- Fieltro de lana, Fieltro de conejo, Paja toquilla...
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.tallas (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text not null unique check (codigo ~ '^[A-Z0-9]{1,4}$'),  -- 55, 56, 57... o S/M/L
  circunferencia_cm  numeric(4,1),
  orden              smallint not null default 0
);

create table public.colores (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique check (codigo ~ '^[A-Z0-9]{2,4}$'),          -- NEG, CAF, BEI
  nombre      text not null,
  hex         text check (hex ~ '^#[0-9A-Fa-f]{6}$'),
  activo      boolean not null default true
);

create table public.hormas (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null unique check (codigo ~ '^[A-Z0-9]{2,4}$'),         -- OVL, RED, OVI
  nombre       text not null,                                                   -- Ovalada larga, Redonda...
  descripcion  text,
  activo       boolean not null default true
);

create table public.modelos (
  id                    uuid primary key default gen_random_uuid(),
  codigo                text not null unique check (codigo ~ '^[A-Z0-9]{2,8}$'),
  nombre                text not null,
  categoria             text not null,          -- Fedora, Borsalino, Bombín, Vaquero, Panamá...
  material_id           uuid not null references public.materiales (id),
  descripcion           text,
  precio_base           numeric(12,2) not null check (precio_base >= 0),
  imagen_path           text,                   -- Storage: bucket "productos"
  -- Homologación de productos con el SIN (se completa tras sincronizar catálogos)
  actividad_economica   text,
  codigo_producto_sin   text,
  unidad_medida_sin     integer,
  activo                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger modelos_updated_at before update on public.modelos
  for each row execute function app.tg_updated_at();

-- Cada celda de la matriz es una variante vendible (SKU).
create table public.variantes (
  id             uuid primary key default gen_random_uuid(),
  modelo_id      uuid not null references public.modelos (id),
  talla_id       uuid not null references public.tallas (id),
  color_id       uuid not null references public.colores (id),
  horma_id       uuid not null references public.hormas (id),
  sku            text not null unique,
  codigo_barras  text not null unique,
  precio_venta   numeric(12,2) not null check (precio_venta >= 0),
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (modelo_id, talla_id, color_id, horma_id)
);

create index variantes_modelo_idx on public.variantes (modelo_id);

create trigger variantes_updated_at before update on public.variantes
  for each row execute function app.tg_updated_at();

-- SKU = MODELO-TALLA-COLOR-HORMA. Precio por defecto = precio_base del modelo.
create or replace function app.tg_variante_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sku is null or new.sku = '' then
    select concat_ws('-', m.codigo, t.codigo, c.codigo, h.codigo)
      into new.sku
      from public.modelos m, public.tallas t, public.colores c, public.hormas h
     where m.id = new.modelo_id and t.id = new.talla_id
       and c.id = new.color_id  and h.id = new.horma_id;
  end if;

  if new.codigo_barras is null or new.codigo_barras = '' then
    new.codigo_barras := new.sku;            -- Code128 admite el SKU alfanumérico
  end if;

  if new.precio_venta is null then
    select m.precio_base into new.precio_venta from public.modelos m where m.id = new.modelo_id;
  end if;

  return new;
end;
$$;

create trigger variantes_defaults before insert on public.variantes
  for each row execute function app.tg_variante_defaults();

-- Costos separados del catálogo para que cajeros/gerentes no los lean (RLS).
create table public.costos_variante (
  variante_id          uuid primary key references public.variantes (id) on delete cascade,
  costo_estandar       numeric(14,4) not null default 0 check (costo_estandar >= 0),
  ultimo_costo_real    numeric(14,4),
  ultimo_costo_en      timestamptz,
  updated_at           timestamptz not null default now()
);

create trigger costos_variante_updated_at before update on public.costos_variante
  for each row execute function app.tg_updated_at();
