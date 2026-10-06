-- =============================================================================
-- 0013 · Vistas para el ERP (consola de stock, monitor fiscal, analítica)
-- =============================================================================
-- Todas con security_invoker: respetan el RLS de quien consulta. Por eso un
-- gerente solo ve su sucursal y los márgenes salen vacíos para quien no puede
-- leer costos.

-- Consola de stock comparativa LPZ vs CBB vs SCZ (+ taller)
create view public.v_stock_comparativo
with (security_invoker = true)
as
select v.id                 as variante_id,
       v.sku,
       m.codigo             as modelo_codigo,
       m.nombre             as modelo,
       t.codigo             as talla,
       c.nombre             as color,
       h.nombre             as horma,
       coalesce(sum(s.cantidad) filter (where su.codigo = 'LPZ'), 0) as lpz,
       coalesce(sum(s.cantidad) filter (where su.codigo = 'CBB'), 0) as cbb,
       coalesce(sum(s.cantidad) filter (where su.codigo = 'SCZ'), 0) as scz,
       coalesce(sum(s.cantidad) filter (where su.tipo = 'taller'), 0) as taller,
       coalesce(sum(s.cantidad), 0)                                   as total,
       bool_or(s.cantidad <= s.stock_minimo and s.stock_minimo > 0)   as alguna_bajo_minimo,
       bool_or(s.cantidad < 0)                                        as alguna_negativa
  from public.variantes v
  join public.modelos m on m.id = v.modelo_id
  join public.tallas  t on t.id = v.talla_id
  join public.colores c on c.id = v.color_id
  join public.hormas  h on h.id = v.horma_id
  left join public.stock s       on s.variante_id = v.id
  left join public.sucursales su on su.id = s.sucursal_id
 where v.activo
 group by v.id, v.sku, m.codigo, m.nombre, t.codigo, t.orden, c.nombre, h.nombre;

-- Ventas diarias por sucursal / departamento (zona horaria Bolivia)
create view public.v_ventas_diarias
with (security_invoker = true)
as
select (v.fecha_emision at time zone 'America/La_Paz')::date as fecha,
       s.id            as sucursal_id,
       s.codigo        as sucursal,
       s.departamento,
       count(*)                                         as cantidad_ventas,
       sum(v.total)                                     as total_vendido,
       round(avg(v.total), 2)                           as ticket_promedio,
       sum(v.descuento)                                 as total_descuentos
  from public.ventas v
  join public.sucursales s on s.id = v.sucursal_id
 where v.estado = 'completada'
 group by 1, s.id, s.codigo, s.departamento;

create view public.v_ventas_por_metodo_pago
with (security_invoker = true)
as
select (v.fecha_emision at time zone 'America/La_Paz')::date as fecha,
       v.sucursal_id,
       p.metodo,
       count(distinct v.id) as cantidad_ventas,
       sum(p.monto)         as monto
  from public.venta_pagos p
  join public.ventas v on v.id = p.venta_id
 where v.estado = 'completada'
 group by 1, 2, 3;

-- Rotación por modelo: unidades vendidas 30/90 días vs. stock actual
create view public.v_rotacion_modelos
with (security_invoker = true)
as
with vendidas as (
  select vr.modelo_id,
         sum(d.cantidad) filter (where v.fecha_emision >= now() - interval '30 days') as u30,
         sum(d.cantidad) filter (where v.fecha_emision >= now() - interval '90 days') as u90
    from public.venta_detalles d
    join public.ventas v     on v.id = d.venta_id and v.estado = 'completada'
    join public.variantes vr on vr.id = d.variante_id
   where v.fecha_emision >= now() - interval '90 days'
   group by vr.modelo_id
), existencias as (
  select vr.modelo_id, sum(greatest(s.cantidad, 0)) as stock
    from public.stock s
    join public.variantes vr on vr.id = s.variante_id
   group by vr.modelo_id
)
select m.id                              as modelo_id,
       m.codigo,
       m.nombre,
       m.categoria,
       coalesce(vd.u30, 0)               as unidades_30d,
       coalesce(vd.u90, 0)               as unidades_90d,
       coalesce(e.stock, 0)              as stock_actual,
       case when coalesce(vd.u90, 0) > 0
            then round(coalesce(e.stock, 0) / (vd.u90 / 90.0), 1) end as dias_inventario
  from public.modelos m
  left join vendidas vd   on vd.modelo_id = m.id
  left join existencias e on e.modelo_id = m.id;

-- Margen por línea vendida (requiere poder leer costos_variante)
create view public.v_margenes_ventas
with (security_invoker = true)
as
select (v.fecha_emision at time zone 'America/La_Paz')::date as fecha,
       v.sucursal_id,
       vr.modelo_id,
       d.variante_id,
       sum(d.cantidad)                                           as unidades,
       sum(d.subtotal)                                           as ingreso,
       sum(d.cantidad * cv.costo_estandar)                       as costo,
       sum(d.subtotal) - sum(d.cantidad * cv.costo_estandar)     as margen,
       case when sum(d.subtotal) > 0
            then round((sum(d.subtotal) - sum(d.cantidad * cv.costo_estandar)) / sum(d.subtotal) * 100, 2)
       end                                                       as margen_pct
  from public.venta_detalles d
  join public.ventas v           on v.id = d.venta_id and v.estado = 'completada'
  join public.variantes vr       on vr.id = d.variante_id
  join public.costos_variante cv on cv.variante_id = d.variante_id
 group by 1, 2, 3, 4;

-- Monitor fiscal de contingencias
create view public.v_monitor_fiscal
with (security_invoker = true)
as
select s.id     as sucursal_id,
       s.codigo as sucursal,
       count(*) filter (where f.estado = 'pendiente')            as pendientes,
       count(*) filter (where f.estado = 'contingencia')         as en_contingencia,
       count(*) filter (where f.estado = 'enviada')              as enviadas,
       count(*) filter (where f.estado = 'validada')             as validadas,
       count(*) filter (where f.estado in ('observada', 'rechazada')) as con_error,
       count(*) filter (where f.estado = 'anulacion_pendiente')  as anulaciones_pendientes,
       min(f.fecha_emision) filter (where f.estado in ('pendiente', 'contingencia')) as pendiente_mas_antigua
  from public.sucursales s
  left join public.facturas f on f.sucursal_id = s.id
 where s.tipo = 'tienda'
 group by s.id, s.codigo;
