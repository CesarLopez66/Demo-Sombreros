-- =============================================================================
-- Seed de datos base (desarrollo / homologación)
-- =============================================================================

insert into public.parametros (clave, valor, descripcion) values
  ('max_descuento_cajero_pct', '5',                      'Descuento máximo (%) sin autorización de gerente'),
  ('puntos_bs_por_punto',      '10',                     'Bs de compra por cada punto acumulado'),
  ('valor_punto_bs',           '0.10',                   'Valor en Bs de un punto al canjear'),
  ('inactividad_pos_minutos',  '5',                      'Bloqueo automático del POS por inactividad'),
  ('zona_horaria',             '"America/La_Paz"',       'Zona horaria del negocio'),
  ('nit_emisor',               '"0000000000"',           'NIT de la empresa ante el SIN (completar)'),
  ('razon_social_emisor',      '"SOMBRERERÍA (completar)"', 'Razón social del emisor'),
  ('modalidad_sin',            '"electronica_en_linea"', 'Modalidad de facturación SIN'),
  ('ambiente_sin',             '"pruebas"',              'pruebas | produccion');

insert into public.sucursales (codigo, nombre, departamento, municipio, direccion, tipo, codigo_sucursal_sin) values
  ('LPZ', 'Casa Matriz La Paz', 'La Paz',     'La Paz',     'Calle Sagárnaga (completar)',   'tienda', 0),
  ('CBB', 'Sucursal Cochabamba', 'Cochabamba', 'Cochabamba', 'Av. Heroínas (completar)',      'tienda', 1),
  ('SCZ', 'Sucursal Santa Cruz', 'Santa Cruz', 'Santa Cruz de la Sierra', 'Calle 24 de Septiembre (completar)', 'tienda', 2),
  ('TAL', 'Taller y Almacén Central', 'La Paz', 'El Alto',  'Zona industrial (completar)',   'taller', null);

insert into public.cajas (sucursal_id, codigo, nombre, punto_venta_sin)
select s.id, 'CAJA-0' || n, 'Caja ' || n, n - 1
  from public.sucursales s, generate_series(1, 2) n
 where s.tipo = 'tienda';

-- ---------------------------------------------------------------------------
-- Catálogo matricial
-- ---------------------------------------------------------------------------
insert into public.materiales (nombre) values
  ('Fieltro de lana'), ('Fieltro de pelo de conejo'), ('Paja toquilla'), ('Paño');

insert into public.tallas (codigo, circunferencia_cm, orden) values
  ('54', 54, 1), ('55', 55, 2), ('56', 56, 3), ('57', 57, 4),
  ('58', 58, 5), ('59', 59, 6), ('60', 60, 7), ('61', 61, 8);

insert into public.colores (codigo, nombre, hex) values
  ('NEG', 'Negro',  '#111111'),
  ('CAF', 'Café',   '#5B3A29'),
  ('BEI', 'Beige',  '#D8C3A5'),
  ('GRI', 'Gris',   '#7A7A7A'),
  ('VIN', 'Vino',   '#6D1A2A'),
  ('NAT', 'Natural','#E9DDB8');

insert into public.hormas (codigo, nombre, descripcion) values
  ('OVL', 'Ovalada larga',      'Cabeza alargada'),
  ('OVI', 'Ovalada intermedia', 'Horma estándar'),
  ('RED', 'Redonda',            'Cabeza redonda');

insert into public.modelos (codigo, nombre, categoria, material_id, precio_base, descripcion)
select x.codigo, x.nombre, x.categoria, m.id, x.precio, x.descripcion
  from (values
    ('FED01', 'Fedora Clásico',     'Fedora',    'Fieltro de lana',           280.00, 'Ala 6 cm, cinta grosgrain'),
    ('BOR01', 'Borsalino Premium',  'Borsalino', 'Fieltro de pelo de conejo', 650.00, 'Fieltro de conejo, tafilete de cuero'),
    ('BOM01', 'Bombín Paceño',      'Bombín',    'Fieltro de lana',           420.00, 'Bombín tradicional de chola paceña'),
    ('VAQ01', 'Vaquero Oriental',   'Vaquero',   'Fieltro de lana',           350.00, 'Ala ancha, copa marcada'),
    ('PAN01', 'Panamá Fino',        'Panamá',    'Paja toquilla',             520.00, 'Paja toquilla tejido fino')
  ) as x(codigo, nombre, categoria, material, precio, descripcion)
  join public.materiales m on m.nombre = x.material;

-- Matriz: cada modelo con las tallas 55–60, 3 colores y 2 hormas (el SKU se genera solo)
insert into public.variantes (modelo_id, talla_id, color_id, horma_id, sku, codigo_barras, precio_venta)
select m.id, t.id, c.id, h.id, null, null,
       m.precio_base + case when t.codigo::int >= 60 then 20 else 0 end
  from public.modelos m
  cross join public.tallas t
  cross join public.colores c
  cross join public.hormas h
 where t.codigo between '55' and '60'
   and h.codigo in ('OVI', 'OVL')
   and (   (m.codigo = 'PAN01' and c.codigo in ('NAT', 'BEI', 'NEG'))
        or (m.codigo <> 'PAN01' and c.codigo in ('NEG', 'CAF', 'GRI')));

insert into public.costos_variante (variante_id, costo_estandar)
select v.id, round(v.precio_venta * 0.45, 2) from public.variantes v;

-- Stock inicial (vía kardex) y mínimos por tienda
insert into public.movimientos_inventario (sucursal_id, variante_id, tipo, cantidad, motivo)
select s.id, v.id, 'inventario_inicial',
       case s.codigo when 'LPZ' then 6 when 'CBB' then 4 when 'SCZ' then 4 else 10 end,
       'Carga inicial'
  from public.sucursales s
  cross join public.variantes v;

update public.stock set stock_minimo = 2
 where sucursal_id in (select id from public.sucursales where tipo = 'tienda');

-- ---------------------------------------------------------------------------
-- Taller: materias primas y recetas
-- ---------------------------------------------------------------------------
insert into public.materias_primas (codigo, nombre, categoria, unidad_medida, es_consumible, stock_minimo, proveedor) values
  ('MP-FL-01', 'Cono de fieltro de lana',            'fieltro',       'cono',   true,  30, 'Proveedor (completar)'),
  ('MP-FC-01', 'Cono de fieltro de pelo de conejo',  'fieltro',       'cono',   true,  10, 'Proveedor (completar)'),
  ('MP-PT-01', 'Capelina de paja toquilla',          'paja_toquilla', 'unidad', true,  10, 'Importación Ecuador'),
  ('MP-CI-01', 'Cinta grosgrain 3 cm',               'cinta',         'm',      true,  50, 'Proveedor (completar)'),
  ('MP-TA-01', 'Tafilete de cuero',                  'tafilete',      'unidad', true,  40, 'Proveedor (completar)'),
  ('MP-FO-01', 'Forro de satín',                     'forro',         'unidad', true,  40, 'Proveedor (completar)'),
  ('MP-HO-01', 'Horma de madera (juego tallas)',     'horma',         'unidad', false,  0, 'Taller propio');

insert into public.movimientos_materia_prima (materia_prima_id, tipo, cantidad, costo_unitario, motivo)
select mp.id, 'inventario_inicial', x.cantidad, x.costo, 'Carga inicial'
  from (values
    ('MP-FL-01', 200, 65.00), ('MP-FC-01', 60, 210.00), ('MP-PT-01', 50, 160.00),
    ('MP-CI-01', 500, 4.50),  ('MP-TA-01', 300, 18.00), ('MP-FO-01', 300, 7.00),
    ('MP-HO-01', 12, 350.00)
  ) as x(codigo, cantidad, costo)
  join public.materias_primas mp on mp.codigo = x.codigo;

insert into public.recetas (modelo_id, version, nombre, costo_mano_obra, costo_indirecto, merma_pct)
select m.id, 1, 'Receta estándar ' || m.nombre, x.mo, x.ind, x.merma
  from (values ('FED01', 45, 12, 3), ('BOR01', 80, 20, 2), ('BOM01', 60, 15, 3),
               ('VAQ01', 50, 12, 3), ('PAN01', 70, 15, 5)) as x(codigo, mo, ind, merma)
  join public.modelos m on m.codigo = x.codigo;

insert into public.receta_items (receta_id, materia_prima_id, cantidad)
select r.id, mp.id, x.cantidad
  from (values
    ('FED01', 'MP-FL-01', 1),   ('FED01', 'MP-CI-01', 0.7), ('FED01', 'MP-TA-01', 1), ('FED01', 'MP-FO-01', 1), ('FED01', 'MP-HO-01', 1),
    ('BOR01', 'MP-FC-01', 1),   ('BOR01', 'MP-CI-01', 0.7), ('BOR01', 'MP-TA-01', 1), ('BOR01', 'MP-FO-01', 1), ('BOR01', 'MP-HO-01', 1),
    ('BOM01', 'MP-FL-01', 1),   ('BOM01', 'MP-CI-01', 0.6), ('BOM01', 'MP-TA-01', 1), ('BOM01', 'MP-FO-01', 1), ('BOM01', 'MP-HO-01', 1),
    ('VAQ01', 'MP-FL-01', 1.2), ('VAQ01', 'MP-CI-01', 0.8), ('VAQ01', 'MP-TA-01', 1), ('VAQ01', 'MP-HO-01', 1),
    ('PAN01', 'MP-PT-01', 1),   ('PAN01', 'MP-CI-01', 0.7), ('PAN01', 'MP-TA-01', 1), ('PAN01', 'MP-HO-01', 1)
  ) as x(modelo, mp, cantidad)
  join public.modelos m on m.codigo = x.modelo
  join public.recetas r on r.modelo_id = m.id and r.version = 1
  join public.materias_primas mp on mp.codigo = x.mp;
