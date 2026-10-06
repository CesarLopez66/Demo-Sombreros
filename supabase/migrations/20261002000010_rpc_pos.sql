-- =============================================================================
-- 0010 · RPC del POS: registrar_venta (atómica e idempotente) y anular_venta
-- =============================================================================

-- ---------------------------------------------------------------------------
-- registrar_venta(payload)
-- Vía de subida del conector PowerSync: una venta completa = una transacción.
-- SECURITY INVOKER: todas las inserciones pasan por RLS del usuario.
-- Idempotente: si el id de la venta ya existe devuelve 'duplicada' sin error.
--
-- payload = {
--   "cliente":  { id, tipo_documento, numero_documento, complemento, razon_social, email, telefono }?,
--   "venta":    { id, sucursal_id, caja_id, sesion_caja_id, numero_venta_local, fecha_emision,
--                 cliente_id?, documento_tipo?, documento_numero?, documento_complemento?, razon_social?,
--                 subtotal, descuento, total, descuento_autorizado_por?, tipo_comprobante, emitida_offline },
--   "detalles": [ { id, variante_id, descripcion, cantidad, precio_unitario, descuento, subtotal } ],
--   "pagos":    [ { id, metodo, monto, monto_recibido?, referencia? } ],
--   "factura":  { id, punto_venta, numero_factura, cuf, cufd, tipo_emision, fecha_emision,
--                 leyenda?, url_qr?, evento_id? }?          -- obligatoria si tipo_comprobante = factura
-- }
-- ---------------------------------------------------------------------------
create or replace function public.registrar_venta(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v        jsonb := p_payload -> 'venta';
  -- nullif: un "cliente": null del JSON llega como jsonb 'null', no como NULL de SQL
  c        jsonb := nullif(p_payload -> 'cliente', 'null'::jsonb);
  f        jsonb := nullif(p_payload -> 'factura', 'null'::jsonb);
  v_id     uuid  := (v ->> 'id')::uuid;
  v_suc    uuid  := (v ->> 'sucursal_id')::uuid;
  v_total  numeric(12,2) := (v ->> 'total')::numeric;
  v_sum_detalle numeric(12,2);
  v_sum_pagos   numeric(12,2);
begin
  perform app.exigir(v_id is not null and v_suc is not null, 'Payload de venta incompleto', '22023');

  if exists (select 1 from public.ventas where id = v_id) then
    return jsonb_build_object('venta_id', v_id, 'resultado', 'duplicada');
  end if;

  select coalesce(sum((d ->> 'subtotal')::numeric), 0) into v_sum_detalle
    from jsonb_array_elements(coalesce(p_payload -> 'detalles', '[]'::jsonb)) d;
  select coalesce(sum((pg ->> 'monto')::numeric), 0) into v_sum_pagos
    from jsonb_array_elements(coalesce(p_payload -> 'pagos', '[]'::jsonb)) pg;

  perform app.exigir(jsonb_array_length(coalesce(p_payload -> 'detalles', '[]'::jsonb)) > 0,
                     'La venta no tiene ítems', '22023');
  perform app.exigir(v_sum_detalle = (v ->> 'subtotal')::numeric,
                     format('Subtotal %s no cuadra con el detalle %s', v ->> 'subtotal', v_sum_detalle), '22023');
  perform app.exigir(v_sum_pagos = v_total,
                     format('Pagos %s no cuadran con el total %s', v_sum_pagos, v_total), '22023');
  perform app.exigir(coalesce(v ->> 'tipo_comprobante', 'factura') <> 'factura' or f is not null,
                     'Una venta facturada debe incluir la factura', '22023');

  if c is not null then
    insert into public.clientes (id, tipo_documento, numero_documento, complemento, razon_social,
                                 email, telefono, sucursal_registro_id)
    values ((c ->> 'id')::uuid, (c ->> 'tipo_documento')::public.tipo_documento_identidad,
            c ->> 'numero_documento', nullif(c ->> 'complemento', ''), c ->> 'razon_social',
            c ->> 'email', c ->> 'telefono', v_suc)
    on conflict (id) do nothing;
  end if;

  insert into public.ventas (
    id, sucursal_id, caja_id, sesion_caja_id, cajero_id, numero_venta_local, fecha_emision,
    cliente_id, documento_tipo, documento_numero, documento_complemento, razon_social,
    subtotal, descuento, total, descuento_autorizado_por, tipo_comprobante, emitida_offline)
  values (
    v_id, v_suc, (v ->> 'caja_id')::uuid, (v ->> 'sesion_caja_id')::uuid,
    coalesce(auth.uid(), (v ->> 'cajero_id')::uuid),
    (v ->> 'numero_venta_local')::bigint,
    coalesce((v ->> 'fecha_emision')::timestamptz, now()),
    (v ->> 'cliente_id')::uuid,
    (v ->> 'documento_tipo')::public.tipo_documento_identidad,
    v ->> 'documento_numero', nullif(v ->> 'documento_complemento', ''), v ->> 'razon_social',
    (v ->> 'subtotal')::numeric, coalesce((v ->> 'descuento')::numeric, 0), v_total,
    (v ->> 'descuento_autorizado_por')::uuid,
    coalesce((v ->> 'tipo_comprobante')::public.tipo_comprobante, 'factura'),
    coalesce((v ->> 'emitida_offline')::boolean, false));

  insert into public.venta_detalles (id, venta_id, sucursal_id, variante_id, descripcion,
                                     cantidad, precio_unitario, descuento, subtotal)
  select coalesce((d ->> 'id')::uuid, gen_random_uuid()), v_id, v_suc, (d ->> 'variante_id')::uuid,
         d ->> 'descripcion', (d ->> 'cantidad')::integer, (d ->> 'precio_unitario')::numeric,
         coalesce((d ->> 'descuento')::numeric, 0), (d ->> 'subtotal')::numeric
    from jsonb_array_elements(p_payload -> 'detalles') d;

  insert into public.venta_pagos (id, venta_id, sucursal_id, metodo, monto, monto_recibido, referencia)
  select coalesce((pg ->> 'id')::uuid, gen_random_uuid()), v_id, v_suc, (pg ->> 'metodo')::public.metodo_pago,
         (pg ->> 'monto')::numeric, (pg ->> 'monto_recibido')::numeric, pg ->> 'referencia'
    from jsonb_array_elements(p_payload -> 'pagos') pg;

  if f is not null then
    insert into public.facturas (id, venta_id, sucursal_id, punto_venta, numero_factura, cuf, cufd,
                                 tipo_emision, fecha_emision, monto_total, leyenda, url_qr, estado, evento_id)
    values (
      coalesce((f ->> 'id')::uuid, gen_random_uuid()), v_id, v_suc, (f ->> 'punto_venta')::integer,
      (f ->> 'numero_factura')::bigint, f ->> 'cuf', f ->> 'cufd',
      (f ->> 'tipo_emision')::public.tipo_emision,
      coalesce((f ->> 'fecha_emision')::timestamptz, (v ->> 'fecha_emision')::timestamptz, now()),
      v_total, f ->> 'leyenda', f ->> 'url_qr',
      case when f ->> 'tipo_emision' = 'en_linea' then 'pendiente' else 'contingencia' end::public.estado_factura,
      (f ->> 'evento_id')::uuid);
  end if;

  return jsonb_build_object('venta_id', v_id, 'resultado', 'registrada');
end;
$$;

-- ---------------------------------------------------------------------------
-- anular_venta: solo Gerente de la sucursal (con MFA) o SuperAdmin.
-- Revierte stock y puntos; si hay factura la marca para anulación en el SIN.
-- ---------------------------------------------------------------------------
create or replace function public.anular_venta(p_venta_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  vta       public.ventas;
  v_puntos  integer;
  v_saldo   integer;
begin
  select * into vta from public.ventas where id = p_venta_id for update;
  perform app.exigir(vta.id is not null, 'Venta inexistente', 'P0002');
  perform app.exigir(app.administra_sucursal(vta.sucursal_id),
                     'Solo el gerente de la sucursal o el SuperAdmin pueden anular ventas');
  perform app.exigir(vta.estado = 'completada', 'La venta ya está anulada', 'P0001');
  perform app.exigir(length(trim(coalesce(p_motivo, ''))) >= 5, 'Indique el motivo de anulación', 'P0001');

  update public.ventas
     set estado = 'anulada', anulada_por = auth.uid(), anulada_en = now(), motivo_anulacion = p_motivo
   where id = vta.id;

  insert into public.movimientos_inventario
    (sucursal_id, variante_id, tipo, cantidad, referencia_tabla, referencia_id, motivo)
  select d.sucursal_id, d.variante_id, 'anulacion_venta', d.cantidad, 'ventas', vta.id, p_motivo
    from public.venta_detalles d where d.venta_id = vta.id;

  -- Reverso de puntos sin dejar saldo negativo si el cliente ya los canjeó.
  if vta.cliente_id is not null then
    select coalesce(sum(puntos), 0) into v_puntos
      from public.movimientos_puntos where venta_id = vta.id;
    select puntos into v_saldo from public.clientes where id = vta.cliente_id for update;
    v_puntos := least(v_puntos, v_saldo);
    if v_puntos > 0 then
      insert into public.movimientos_puntos (cliente_id, venta_id, sucursal_id, tipo, puntos, motivo)
      values (vta.cliente_id, vta.id, vta.sucursal_id, 'reverso', -v_puntos, 'Anulación de venta');
    end if;
  end if;

  update public.facturas
     set estado = 'anulacion_pendiente'
   where venta_id = vta.id and estado not in ('rechazada', 'anulada', 'anulacion_pendiente');

  return jsonb_build_object('venta_id', vta.id, 'resultado', 'anulada');
end;
$$;
