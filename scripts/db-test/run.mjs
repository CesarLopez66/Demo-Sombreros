// Valida migraciones + seed en PGlite (Postgres WASM, sin Docker) y ejecuta
// pruebas de RLS y de reglas de negocio simulando JWT de Supabase.
//   npm run db:test
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (...p) => readFileSync(join(raiz, ...p), 'utf8');

const db = new PGlite();

async function aplicar(nombre, sql) {
  try {
    await db.exec(sql);
    console.log(`  ✓ ${nombre}`);
  } catch (e) {
    console.error(`  ✗ ${nombre}\n    ${e.message}`);
    process.exit(1);
  }
}

console.log('Migraciones');
await aplicar('stub supabase', leer('scripts', 'db-test', 'supabase-stub.sql'));
const migraciones = readdirSync(join(raiz, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
for (const m of migraciones) await aplicar(m, leer('supabase', 'migrations', m));
await aplicar('seed.sql', leer('supabase', 'seed.sql'));

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const uno = async (sql, params) => (await db.query(sql, params)).rows[0];
const suc = {};
for (const r of (await db.query('select id, codigo from public.sucursales')).rows) suc[r.codigo] = r.id;

const usuarios = {};
async function crearUsuario(clave, rol, sucursal) {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values ($1, $2, $3, $4)`,
    [id, `${clave}@test.bo`, { rol, sucursal_id: sucursal ? suc[sucursal] : null }, { nombre_completo: clave }],
  );
  usuarios[clave] = id;
}

// Ejecuta fn como `authenticated` con los claims que emitiría Supabase.
// Siempre hace rollback salvo persistir=true.
async function como(clave, fn, { aal = 'aal2', persistir = true } = {}) {
  const u = await uno('select raw_app_meta_data as app from auth.users where id = $1', [usuarios[clave]]);
  const claims = { sub: usuarios[clave], role: 'authenticated', aal, app_metadata: u.app };
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await tx.query('set local role authenticated');
    const r = await fn(tx);
    if (!persistir) await tx.rollback();
    return r;
  });
}

let ok = 0;
let fallos = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    ok++;
    console.log(`  ✓ ${nombre}`);
  } catch (e) {
    fallos++;
    console.error(`  ✗ ${nombre}\n    ${e.message}`);
  }
}
function igual(real, esperado, msg = '') {
  if (String(real) !== String(esperado)) throw new Error(`${msg} esperado=${esperado} real=${real}`);
}
async function debeFallar(promesa, patron) {
  try {
    await promesa;
  } catch (e) {
    if (patron && !patron.test(e.message)) throw new Error(`falló con otro error: ${e.message}`);
    return;
  }
  throw new Error('se esperaba un error y la operación tuvo éxito');
}

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------
await crearUsuario('propietario', 'superadmin', null);
await crearUsuario('gerenteLPZ', 'gerente', 'LPZ');
await crearUsuario('cajeroLPZ', 'cajero', 'LPZ');
await crearUsuario('gerenteCBB', 'gerente', 'CBB');
await crearUsuario('cajeroSCZ', 'cajero', 'SCZ');
await crearUsuario('taller', 'almacen', 'TAL');

const cajaLPZ = (await uno(`select id from public.cajas where sucursal_id = $1 and codigo = 'CAJA-01'`, [suc.LPZ])).id;
const cajaCBB = (await uno(`select id from public.cajas where sucursal_id = $1 and codigo = 'CAJA-01'`, [suc.CBB])).id;
const variante = await uno(`select id, sku, precio_venta from public.variantes where sku like 'FED01-57-NEG-OVI'`);
const stockLPZ = async () =>
  (await uno('select cantidad from public.stock where sucursal_id = $1 and variante_id = $2', [suc.LPZ, variante.id])).cantidad;

function payloadVenta({ sesion, numero, cantidad = 1, descuento = 0, cliente = null, autoriza = null }) {
  const subtotal = Number(variante.precio_venta) * cantidad;
  const total = subtotal - descuento;
  return {
    cliente,
    venta: {
      id: randomUUID(), sucursal_id: suc.LPZ, caja_id: cajaLPZ, sesion_caja_id: sesion, numero_venta_local: numero,
      fecha_emision: new Date().toISOString(), cliente_id: cliente?.id ?? null,
      subtotal, descuento, total, descuento_autorizado_por: autoriza, tipo_comprobante: 'factura', emitida_offline: true,
    },
    detalles: [{ id: randomUUID(), variante_id: variante.id, descripcion: variante.sku, cantidad,
                 precio_unitario: variante.precio_venta, descuento: 0, subtotal }],
    pagos: [{ id: randomUUID(), metodo: 'efectivo', monto: total, monto_recibido: total }],
    factura: { id: randomUUID(), punto_venta: 0, numero_factura: numero, cuf: `CUF${randomUUID().replaceAll('-', '')}`,
               cufd: 'CUFD-DEMO', tipo_emision: 'fuera_de_linea', fecha_emision: new Date().toISOString() },
  };
}

console.log('\nAuth y claims');
await prueba('alta en auth.users crea perfil y sincroniza claims', async () => {
  const p = await uno('select rol, sucursal_id from public.perfiles where id = $1', [usuarios.cajeroLPZ]);
  igual(p.rol, 'cajero');
  const u = await uno('select raw_app_meta_data as a from auth.users where id = $1', [usuarios.cajeroLPZ]);
  igual(u.a.sucursal_codigo, 'LPZ', 'sucursal_codigo en app_metadata');
});

console.log('\nRLS de lectura');
await prueba('cajero LPZ solo ve stock de LPZ', async () => {
  const r = await como('cajeroLPZ', (tx) => tx.query('select distinct sucursal_id from public.stock'));
  igual(r.rows.length, 1); igual(r.rows[0].sucursal_id, suc.LPZ);
});
await prueba('cajero no ve costos ni auditoría', async () => {
  const [c, a] = await como('cajeroLPZ', async (tx) => [
    (await tx.query('select count(*)::int n from public.costos_variante')).rows[0].n,
    (await tx.query('select count(*)::int n from public.logs_auditoria')).rows[0].n,
  ]);
  igual(c, 0, 'costos'); igual(a, 0, 'auditoría');
});
await prueba('superadmin sin MFA (aal1) no ve costos; con aal2 sí', async () => {
  const sin = await como('propietario', (tx) => tx.query('select count(*)::int n from public.costos_variante'), { aal: 'aal1' });
  const con = await como('propietario', (tx) => tx.query('select count(*)::int n from public.costos_variante'));
  igual(sin.rows[0].n, 0, 'aal1'); if (con.rows[0].n === 0) throw new Error('aal2 debería ver costos');
});
await prueba('almacén ve stock de todas las sucursales', async () => {
  const r = await como('taller', (tx) => tx.query('select count(distinct sucursal_id)::int n from public.stock'));
  igual(r.rows[0].n, 4);
});
await prueba('anon no puede leer nada', async () => {
  await debeFallar(db.transaction(async (tx) => {
    await tx.query('set local role anon');
    await tx.query('select * from public.variantes limit 1');
  }), /permission denied/);
});

console.log('\nPOS: caja y ventas');
const sesion = randomUUID();
await prueba('cajero abre caja en su sucursal', async () => {
  await como('cajeroLPZ', (tx) => tx.query(
    `insert into public.sesiones_caja (id, caja_id, sucursal_id, cajero_id, monto_inicial) values ($1, $2, $3, $4, 200)`,
    [sesion, cajaLPZ, suc.LPZ, usuarios.cajeroLPZ]));
});
await prueba('cajero LPZ no puede abrir caja en CBB', async () => {
  await debeFallar(como('cajeroLPZ', (tx) => tx.query(
    `insert into public.sesiones_caja (caja_id, sucursal_id, cajero_id, monto_inicial) values ($1, $2, $3, 0)`,
    [cajaCBB, suc.CBB, usuarios.cajeroLPZ])), /row-level security/);
});

const cliente = { id: randomUUID(), tipo_documento: 'CI', numero_documento: '4789123', complemento: null, razon_social: 'MAMANI QUISPE' };
let ventaId;
await prueba('registrar_venta: stock, puntos, outbox fiscal y auditoría', async () => {
  const antes = await stockLPZ();
  const p = payloadVenta({ sesion, numero: 1, cantidad: 2, cliente });
  ventaId = p.venta.id;
  const r = await como('cajeroLPZ', (tx) => tx.query('select public.registrar_venta($1) r', [p]));
  igual(r.rows[0].r.resultado, 'registrada');
  igual(await stockLPZ(), antes - 2, 'stock');
  const pts = await uno('select puntos from public.clientes where id = $1', [cliente.id]);
  igual(pts.puntos, Math.floor((Number(variante.precio_venta) * 2) / 10), 'puntos');
  const f = await uno(`select estado from public.facturas where venta_id = $1`, [ventaId]);
  igual(f.estado, 'contingencia');
  const aud = await uno(`select count(*)::int n from public.logs_auditoria where tabla = 'ventas' and registro_id = $1`, [ventaId]);
  igual(aud.n, 1, 'log de auditoría');
  // reintento de sincronización
  const r2 = await como('cajeroLPZ', (tx) => tx.query('select public.registrar_venta($1) r', [p]));
  igual(r2.rows[0].r.resultado, 'duplicada');
});
await prueba('venta online encola tarea fiscal', async () => {
  const p = payloadVenta({ sesion, numero: 2 });
  p.factura.tipo_emision = 'en_linea';
  await como('cajeroLPZ', (tx) => tx.query('select public.registrar_venta($1)', [p]));
  const t = await uno(`select tipo from public.cola_fiscal c join public.facturas f on f.id = c.referencia_id where f.venta_id = $1`, [p.venta.id]);
  igual(t.tipo, 'emitir_factura');
});
await prueba('descuento > 5% sin autorización de gerente es rechazado', async () => {
  const p = payloadVenta({ sesion, numero: 3, descuento: 50 });
  await debeFallar(como('cajeroLPZ', (tx) => tx.query('select public.registrar_venta($1)', [p])), /autorización de gerente/);
});
await prueba('descuento > 5% autorizado por gerente LPZ es aceptado', async () => {
  const p = payloadVenta({ sesion, numero: 3, descuento: 50, autoriza: usuarios.gerenteLPZ });
  await como('cajeroLPZ', (tx) => tx.query('select public.registrar_venta($1)', [p]));
});
await prueba('pagos que no cuadran con el total son rechazados', async () => {
  const p = payloadVenta({ sesion, numero: 4 });
  p.pagos[0].monto = 1;
  await debeFallar(como('cajeroLPZ', (tx) => tx.query('select public.registrar_venta($1)', [p])), /no cuadran/);
});
await prueba('cajero SCZ no puede registrar ventas de LPZ', async () => {
  const p = payloadVenta({ sesion, numero: 5 });
  await debeFallar(como('cajeroSCZ', (tx) => tx.query('select public.registrar_venta($1)', [p])), /row-level security/);
});
await prueba('cliente duplicado offline (otro UUID) se fusiona por alias', async () => {
  const dup = { ...cliente, id: randomUUID(), razon_social: 'MAMANI Q.' };
  const p = payloadVenta({ sesion, numero: 6, cliente: dup });
  await como('cajeroLPZ', (tx) => tx.query('select public.registrar_venta($1)', [p]));
  const v = await uno('select cliente_id from public.ventas where id = $1', [p.venta.id]);
  igual(v.cliente_id, cliente.id, 'venta redirigida al cliente canónico');
});
await prueba('cajero no puede modificar una venta', async () => {
  await debeFallar(como('cajeroLPZ', (tx) => tx.query(`update public.ventas set total = 1 where id = $1 returning id`, [ventaId])
    .then((r) => { if (r.rows.length === 0) throw new Error('row-level security: sin filas'); })), /row-level security|inmutable|no puede/);
});

console.log('\nAnulación');
await prueba('gerente sin MFA no puede anular', async () => {
  await debeFallar(como('gerenteLPZ', (tx) => tx.query(`select public.anular_venta($1, 'Error de talla')`, [ventaId]), { aal: 'aal1' }), /gerente/);
});
await prueba('gerente de otra sucursal no puede anular', async () => {
  await debeFallar(como('gerenteCBB', (tx) => tx.query(`select public.anular_venta($1, 'Error de talla')`, [ventaId])), /gerente/);
});
await prueba('gerente LPZ con MFA anula: repone stock, revierte puntos, factura a anulación', async () => {
  const antes = await stockLPZ();
  const ptsAntes = (await uno('select puntos from public.clientes where id = $1', [cliente.id])).puntos;
  const ptsVenta = (await uno('select puntos from public.movimientos_puntos where venta_id = $1', [ventaId])).puntos;
  await como('gerenteLPZ', (tx) => tx.query(`select public.anular_venta($1, 'Error de talla')`, [ventaId]));
  igual(await stockLPZ(), antes + 2, 'stock repuesto');
  igual((await uno('select estado from public.facturas where venta_id = $1', [ventaId])).estado, 'anulacion_pendiente');
  igual((await uno('select puntos from public.clientes where id = $1', [cliente.id])).puntos, ptsAntes - ptsVenta, 'puntos');
});

console.log('\nArqueo ciego');
await prueba('cierre genera arqueo invisible para el cajero y visible para el gerente', async () => {
  await como('cajeroLPZ', (tx) => tx.query(
    `update public.sesiones_caja set estado = 'cerrada', monto_declarado = 500 where id = $1`, [sesion]));
  const vistoCajero = await como('cajeroLPZ', (tx) => tx.query('select * from public.arqueos'));
  igual(vistoCajero.rows.length, 0, 'cajero');
  const a = (await como('gerenteLPZ', (tx) => tx.query('select * from public.arqueos where sesion_caja_id = $1', [sesion]))).rows[0];
  const esperado = await uno(`
    select 200 + coalesce(sum(p.monto), 0) e from public.venta_pagos p join public.ventas v on v.id = p.venta_id
     where v.sesion_caja_id = $1 and v.estado = 'completada' and p.metodo = 'efectivo'`, [sesion]);
  igual(Number(a.monto_esperado_efectivo), Number(esperado.e), 'esperado');
  igual(Number(a.diferencia), 500 - Number(esperado.e), 'diferencia');
});
await prueba('no se registran ventas en una sesión cerrada', async () => {
  await debeFallar(como('cajeroLPZ', (tx) => tx.query('select public.registrar_venta($1)', [payloadVenta({ sesion, numero: 7 })])), /cerrada/);
});
await prueba('gerente no puede alterar montos del arqueo', async () => {
  await debeFallar(como('gerenteLPZ', (tx) => tx.query('update public.arqueos set diferencia = 0 where sesion_caja_id = $1', [sesion])), /no pueden modificarse/);
});

console.log('\nTransferencias');
let trf;
await prueba('gerente CBB solicita LPZ → CBB', async () => {
  trf = (await como('gerenteCBB', (tx) => tx.query(
    `insert into public.transferencias (origen_id, destino_id, solicitado_por) values ($1, $2, $3) returning id, codigo`,
    [suc.LPZ, suc.CBB, usuarios.gerenteCBB]))).rows[0];
  await como('gerenteCBB', (tx) => tx.query(
    `insert into public.transferencia_detalles (transferencia_id, variante_id, cantidad_solicitada) values ($1, $2, 3)`,
    [trf.id, variante.id]));
  if (!/^TRF-\d{8}-\d{5}$/.test(trf.codigo)) throw new Error(`código ${trf.codigo}`);
});
await prueba('gerente CBB no puede aprobar (no es el origen)', async () => {
  await debeFallar(como('gerenteCBB', (tx) => tx.query('select public.aprobar_transferencia($1)', [trf.id])), /No autorizado/);
});
await prueba('gerente CBB no puede saltarse el flujo con UPDATE directo', async () => {
  await debeFallar(como('gerenteCBB', (tx) => tx.query(`update public.transferencias set estado = 'recibida' where id = $1`, [trf.id])), /Use las funciones/);
});
await prueba('almacén aprueba y despacha (descuenta origen)', async () => {
  const antes = await stockLPZ();
  await como('taller', (tx) => tx.query('select public.aprobar_transferencia($1)', [trf.id]));
  await como('taller', (tx) => tx.query('select public.despachar_transferencia($1)', [trf.id]));
  igual(await stockLPZ(), antes - 3);
});
await prueba('recepción con faltante: alerta y estado recibida_con_diferencias', async () => {
  const r = await como('gerenteCBB', (tx) => tx.query('select (public.recibir_transferencia($1, $2)).estado',
    [trf.id, [{ variante_id: variante.id, cantidad: 2 }]]));
  igual(r.rows[0].estado, 'recibida_con_diferencias');
  const al = await uno(`select count(*)::int n from public.alertas_inventario where tipo = 'faltante_transferencia' and sucursal_id = $1`, [suc.CBB]);
  igual(al.n, 1);
  const d = await uno('select diferencia from public.transferencia_detalles where transferencia_id = $1', [trf.id]);
  igual(d.diferencia, -1);
});
await prueba('despacho con stock insuficiente es rechazado', async () => {
  const t = (await como('taller', (tx) => tx.query(
    `insert into public.transferencias (origen_id, destino_id, solicitado_por) values ($1, $2, $3) returning id`,
    [suc.SCZ, suc.LPZ, usuarios.taller]))).rows[0];
  await como('taller', (tx) => tx.query(
    `insert into public.transferencia_detalles (transferencia_id, variante_id, cantidad_solicitada) values ($1, $2, 999)`, [t.id, variante.id]));
  await como('taller', (tx) => tx.query('select public.aprobar_transferencia($1)', [t.id]));
  await debeFallar(como('taller', (tx) => tx.query('select public.despachar_transferencia($1)', [t.id])), /Stock insuficiente/);
});

console.log('\nProducción');
await prueba('Kanban: consumo BOM, costo real e ingreso a stock del taller', async () => {
  const rec = await uno(`select r.id from public.recetas r join public.modelos m on m.id = r.modelo_id where m.codigo = 'FED01'`);
  const fieltroAntes = Number((await uno(`select stock_actual from public.materias_primas where codigo = 'MP-FL-01'`)).stock_actual);
  const hormaAntes = Number((await uno(`select stock_actual from public.materias_primas where codigo = 'MP-HO-01'`)).stock_actual);
  const stockTal = async () => (await uno('select cantidad from public.stock where sucursal_id = $1 and variante_id = $2', [suc.TAL, variante.id])).cantidad;
  const antes = await stockTal();

  const ot = (await como('taller', (tx) => tx.query(
    `insert into public.ordenes_trabajo (variante_id, receta_id, cantidad, sucursal_destino_id) values ($1, $2, 10, $3) returning id`,
    [variante.id, rec.id, suc.TAL]))).rows[0];

  await debeFallar(como('taller', (tx) => tx.query(`update public.ordenes_trabajo set etapa = 'control_calidad' where id = $1`, [ot.id])), /una etapa/);
  await debeFallar(como('taller', (tx) => tx.query(`update public.ordenes_trabajo set costo_materiales = 1 where id = $1`, [ot.id])), /automáticamente/);

  await como('taller', (tx) => tx.query(`update public.ordenes_trabajo set etapa = 'hormado_prensado' where id = $1`, [ot.id]));
  const fieltroDespues = Number((await uno(`select stock_actual from public.materias_primas where codigo = 'MP-FL-01'`)).stock_actual);
  igual(fieltroDespues, fieltroAntes - 10.3, 'fieltro consumido (10 × 1.03 merma)');
  igual(Number((await uno(`select stock_actual from public.materias_primas where codigo = 'MP-HO-01'`)).stock_actual), hormaAntes, 'horma no consumible');

  for (const etapa of ['costura_adorno', 'control_calidad']) {
    await como('taller', (tx) => tx.query(`update public.ordenes_trabajo set etapa = $2 where id = $1`, [ot.id, etapa]));
  }
  await como('taller', (tx) => tx.query(`update public.ordenes_trabajo set cantidad_aprobada_qa = 9, etapa = 'en_stock' where id = $1`, [ot.id]));
  igual(await stockTal(), antes + 9, 'stock taller');
  const o = await uno('select costo_unitario_real, costo_materiales from public.ordenes_trabajo where id = $1', [ot.id]);
  if (!(Number(o.costo_unitario_real) > 0)) throw new Error('costo unitario real no calculado');
  const h = await uno('select count(*)::int n from public.ordenes_trabajo_historial where orden_id = $1', [ot.id]);
  igual(h.n, 4, 'historial');
});
await prueba('calculadora de costos por receta', async () => {
  const r = await como('taller', (tx) => tx.query(`select * from public.v_costos_recetas where modelo_codigo = 'FED01'`));
  if (!(Number(r.rows[0].costo_total_unitario) > 0)) throw new Error('costo total no calculado');
  const c = await como('cajeroLPZ', (tx) => tx.query(`select count(*)::int n from public.v_costos_recetas`));
  igual(c.rows[0].n, 0, 'cajero no ve costos de recetas');
});

console.log('\nInmutabilidad');
await prueba('logs_auditoria no se puede modificar ni borrar (ni como postgres)', async () => {
  await debeFallar(db.query('update public.logs_auditoria set tabla = $1', ['x']), /inmutable/);
  await debeFallar(db.query('delete from public.logs_auditoria'), /inmutable/);
  await debeFallar(db.query('truncate public.logs_auditoria'), /inmutable/);
  await debeFallar(como('propietario', (tx) => tx.query('delete from public.logs_auditoria')), /permission denied|inmutable/);
});
await prueba('kardex inmutable y stock.cantidad protegida', async () => {
  await debeFallar(db.query('update public.movimientos_inventario set cantidad = 1'), /inmutable/);
  await debeFallar(como('taller', (tx) => tx.query('update public.stock set cantidad = 1000 where sucursal_id = $1', [suc.LPZ])), /movimientos_inventario/);
});
await prueba('ajuste de inventario requiere motivo y queda en kardex', async () => {
  await debeFallar(como('gerenteLPZ', (tx) => tx.query(
    `insert into public.movimientos_inventario (sucursal_id, variante_id, tipo, cantidad, usuario_id) values ($1, $2, 'ajuste_negativo', -1, $3)`,
    [suc.LPZ, variante.id, usuarios.gerenteLPZ])), /movimientos_ajuste_con_motivo/);
  await como('gerenteLPZ', (tx) => tx.query(
    `insert into public.movimientos_inventario (sucursal_id, variante_id, tipo, cantidad, usuario_id, motivo) values ($1, $2, 'ajuste_negativo', -1, $3, 'Sombrero dañado')`,
    [suc.LPZ, variante.id, usuarios.gerenteLPZ]));
});

console.log('\nVistas ERP');
await prueba('gerente LPZ ve solo LPZ en ventas diarias; superadmin ve stock comparativo', async () => {
  const v = await como('gerenteLPZ', (tx) => tx.query('select distinct sucursal from public.v_ventas_diarias'));
  igual(v.rows.map((r) => r.sucursal).join(','), 'LPZ');
  const s = await como('propietario', (tx) => tx.query('select lpz, cbb, scz, taller from public.v_stock_comparativo where variante_id = $1', [variante.id]));
  igual(s.rows.length, 1);
});

console.log(`\n${ok} pruebas OK, ${fallos} fallidas`);
process.exit(fallos ? 1 : 0);
