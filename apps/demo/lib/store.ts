'use client';
// Store de la demo: estado en memoria + localStorage, sincronizado entre
// pestañas (abre el POS en una y el ERP en otra y verás los cambios en vivo).
// Emula las reglas de la BD de la Fase 1 (kardex, puntos, contingencias).
import { useSyncExternalStore } from 'react';
import { crearEstadoInicial, VERSION_DATOS } from './semilla';
import type {
  CodigoSucursal, Estado, EtapaProduccion, LineaVenta, MetodoPago, Rol, Tienda, Venta,
} from './tipos';

const CLAVE = 'sombreros-demo-v1';
let estado: Estado | null = null;
const oyentes = new Set<() => void>();

function cargar(): Estado {
  if (estado) return estado;
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (crudo) {
      const e = JSON.parse(crudo) as Estado;
      if (e.version === VERSION_DATOS) return (estado = e);
    }
  } catch {
    /* sin storage: datos frescos */
  }
  return (estado = crearEstadoInicial());
}

function emitir() {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(estado));
  } catch {
    /* modo privado: la demo sigue en memoria */
  }
  oyentes.forEach((f) => f());
}

function suscribir(f: () => void) {
  oyentes.add(f);
  const alCambiarOtraPestana = (ev: StorageEvent) => {
    if (ev.key !== CLAVE || !ev.newValue) return;
    estado = JSON.parse(ev.newValue) as Estado;
    oyentes.forEach((g) => g());
  };
  window.addEventListener('storage', alCambiarOtraPestana);
  return () => {
    oyentes.delete(f);
    window.removeEventListener('storage', alCambiarOtraPestana);
  };
}

export function useEstado(): Estado {
  return useSyncExternalStore(suscribir, cargar, cargar);
}

function mutar(fn: (e: Estado) => void) {
  const copia = structuredClone(cargar());
  fn(copia);
  estado = copia;
  emitir();
}

const uid = () => crypto.randomUUID();
const ahora = () => new Date().toISOString();
const hex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

function auditar(e: Estado, usuario: string, accion: string, detalle: string) {
  e.auditoria.unshift({ id: uid(), fecha: ahora(), usuario, accion, detalle });
}

function logSin(e: Estado, sucursal: Tienda, operacion: string, exito: boolean, mensaje: string) {
  e.logsSin.unshift({ id: uid(), fecha: ahora(), sucursal, operacion, exito, mensaje });
}

export function reiniciarDemo() {
  estado = crearEstadoInicial();
  emitir();
}

export function setPerfilErp(rol: Rol, sucursal: Tienda) {
  mutar((e) => {
    e.perfilErp = { rol, sucursal };
  });
}

export function setPrecioModelo(modelo: string, precio: number, usuario: string) {
  mutar((e) => {
    const m = e.modelos.find((x) => x.codigo === modelo);
    if (!m || precio <= 0) return;
    auditar(e, usuario, 'Cambio de precio', `${modelo}: Bs ${m.precio} → Bs ${precio}`);
    m.precio = precio;
    for (const v of e.variantes) if (v.modelo === modelo) v.precio = precio + (Number(v.talla) >= 60 ? 20 : 0);
  });
}

// ---------------------------------------------------------------------------
// POS
// ---------------------------------------------------------------------------
export function abrirCaja(cajero: string, sucursal: Tienda, caja: string, montoInicial: number) {
  mutar((e) => {
    e.sesion = { id: uid(), sucursal, caja, cajero, montoInicial, abiertaEn: ahora() };
    auditar(e, cajero, 'Apertura de caja', `${sucursal} ${caja} con Bs ${montoInicial}`);
  });
}

export function cerrarCaja(declarado: number) {
  mutar((e) => {
    const s = e.sesion;
    if (!s) return;
    const ventas = e.ventas.filter((v) => v.sesionId === s.id && v.estado === 'completada');
    const efectivo = ventas.flatMap((v) => v.pagos).filter((p) => p.metodo === 'efectivo').reduce((a, p) => a + p.monto, 0);
    const esperado = s.montoInicial + efectivo;
    e.arqueos.unshift({
      sesionId: s.id, sucursal: s.sucursal, cajero: s.cajero, fecha: ahora(),
      esperado, declarado, diferencia: declarado - esperado, ventas: ventas.length,
    });
    e.sesionesCerradas.unshift({ ...s, cerradaEn: ahora(), montoDeclarado: declarado });
    e.sesion = null;
    auditar(e, s.cajero, 'Cierre de caja', `${s.sucursal} ${s.caja}: declarado Bs ${declarado}`);
  });
}

export interface NuevaVenta {
  lineas: LineaVenta[];
  descuento: number;
  cliente: { tipoDocumento: 'CI' | 'NIT' | 'CEX' | 'PAS'; documento: string; razonSocial: string } | null;
  pagos: { metodo: MetodoPago; monto: number; recibido?: number }[];
}

export function registrarVenta(nv: NuevaVenta): string {
  const id = uid();
  mutar((e) => {
    const s = e.sesion;
    if (!s) throw new Error('No hay caja abierta');
    const c = e.contadores[s.sucursal];
    c.venta += 1;
    c.factura += 1;
    const subtotal = nv.lineas.reduce((a, l) => a + l.cantidad * l.precio, 0);
    const total = subtotal - nv.descuento;

    let clienteId: string | null = null;
    if (nv.cliente && nv.cliente.documento !== '0') {
      let cli = e.clientes.find((x) => x.tipoDocumento === nv.cliente!.tipoDocumento && x.documento === nv.cliente!.documento);
      if (!cli) {
        cli = { id: uid(), ...nv.cliente, puntos: 0 };
        e.clientes.push(cli);
      }
      cli.puntos += Math.floor(total / 10);
      clienteId = cli.id;
    }

    const venta: Venta = {
      id, numero: c.venta, sucursal: s.sucursal, caja: s.caja, cajero: s.cajero, fecha: ahora(),
      cliente: nv.cliente, clienteId, lineas: nv.lineas, subtotal, descuento: nv.descuento, total,
      pagos: nv.pagos, estado: 'completada', sync: e.online ? 'sincronizada' : 'pendiente', sesionId: s.id,
      factura: {
        numero: c.factura,
        cuf: hex(20),
        cufd: `BQUFDQ${hex(6)}`,
        estado: e.online ? 'pendiente' : 'contingencia',
        tipoEmision: e.online ? 'en_linea' : 'fuera_de_linea',
      },
    };
    e.ventas.unshift(venta);
    for (const l of nv.lineas) e.stock[l.sku][s.sucursal] -= l.cantidad;
  });

  // Simula el microservicio fiscal: la factura en línea se valida en segundos.
  if (cargar().online) {
    setTimeout(() => {
      mutar((e) => {
        const v = e.ventas.find((x) => x.id === id);
        if (!v || v.factura.estado !== 'pendiente') return;
        v.factura.estado = 'validada';
        logSin(e, v.sucursal, 'recepcionFactura', true, `Factura ${v.factura.numero} validada`);
      });
    }, 2500);
  }
  return id;
}

export function anularVenta(id: string, autoriza: string, motivo: string) {
  mutar((e) => {
    const v = e.ventas.find((x) => x.id === id);
    if (!v || v.estado === 'anulada') return;
    v.estado = 'anulada';
    v.factura.estado = 'anulacion_pendiente';
    for (const l of v.lineas) e.stock[l.sku][v.sucursal] += l.cantidad;
    const cli = e.clientes.find((c) => c.id === v.clienteId);
    if (cli) cli.puntos = Math.max(0, cli.puntos - Math.floor(v.total / 10));
    auditar(e, autoriza, 'Anulación de venta', `${v.sucursal} venta #${v.numero} (Bs ${v.total}): ${motivo}`);
  });
  setTimeout(() => {
    mutar((e) => {
      const v = e.ventas.find((x) => x.id === id);
      if (!v || v.factura.estado !== 'anulacion_pendiente' || !e.online) return;
      v.factura.estado = 'anulada';
      logSin(e, v.sucursal, 'anulacionFactura', true, `Factura ${v.factura.numero} anulada`);
    });
  }, 3000);
}

/** Corta o restablece la red del POS. Al volver: sync, evento significativo y paquete. */
export function setOnline(online: boolean) {
  const suc: Tienda = cargar().sesion?.sucursal ?? 'LPZ';
  if (!online) {
    mutar((e) => {
      e.online = false;
      e.eventos.unshift({
        id: uid(), sucursal: suc, codigo: 1, descripcion: 'Corte del servicio de internet',
        inicio: ahora(), estado: 'detectado',
      });
    });
    return;
  }

  let paqueteId = '';
  mutar((e) => {
    e.online = true;
    for (const v of e.ventas) if (v.sync === 'pendiente') v.sync = 'sincronizada';
    const ev = e.eventos.find((x) => !x.fin);
    if (!ev) return;
    ev.fin = ahora();
    ev.estado = 'registrado';
    logSin(e, ev.sucursal, 'registroEventoSignificativo', true, `Evento ${ev.codigo} registrado (${ev.descripcion})`);
    const pendientes = e.ventas.filter((v) => v.factura.estado === 'contingencia' && v.sucursal === ev.sucursal);
    if (pendientes.length) {
      paqueteId = uid();
      e.paquetes.unshift({ id: paqueteId, sucursal: ev.sucursal, eventoId: ev.id, cantidad: pendientes.length, estado: 'en_cola', creado: ahora() });
    }
  });
  if (!paqueteId) return;

  setTimeout(() => mutar((e) => {
    const p = e.paquetes.find((x) => x.id === paqueteId);
    if (p) p.estado = 'enviado';
    for (const v of e.ventas) if (v.factura.estado === 'contingencia') v.factura.estado = 'enviada';
  }), 1500);
  setTimeout(() => mutar((e) => {
    const p = e.paquetes.find((x) => x.id === paqueteId);
    if (!p) return;
    p.estado = 'validado';
    for (const v of e.ventas) if (v.factura.estado === 'enviada') v.factura.estado = 'validada';
    const ev = e.eventos.find((x) => x.id === p.eventoId);
    if (ev) ev.estado = 'validado';
    logSin(e, p.sucursal, 'recepcionPaqueteFactura', true, `Paquete de ${p.cantidad} facturas validado`);
  }), 4500);
}

// ---------------------------------------------------------------------------
// Transferencias
// ---------------------------------------------------------------------------
export function crearTransferencia(origen: CodigoSucursal, destino: CodigoSucursal, items: { sku: string; solicitada: number }[], usuario: string) {
  mutar((e) => {
    const n = e.transferencias.length + 1;
    const fecha = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    e.transferencias.unshift({
      id: uid(), codigo: `TRF-${fecha}-${String(n).padStart(5, '0')}`, origen, destino, estado: 'solicitada', items,
      historial: [{ fecha: ahora(), texto: `Solicitada por ${usuario}` }],
    });
    auditar(e, usuario, 'Solicitud de transferencia', `${origen} → ${destino}`);
  });
}

export function avanzarTransferencia(id: string, accion: 'aprobar' | 'despachar' | 'recibir' | 'cancelar', usuario: string, recibidas?: Record<string, number>) {
  let error = '';
  mutar((e) => {
    const t = e.transferencias.find((x) => x.id === id);
    if (!t) return;
    if (accion === 'aprobar') {
      t.estado = 'aprobada';
      t.historial.push({ fecha: ahora(), texto: `Aprobada por ${usuario}` });
    } else if (accion === 'despachar') {
      const falta = t.items.find((i) => e.stock[i.sku][t.origen] < i.solicitada);
      if (falta) {
        error = `Stock insuficiente en ${t.origen} para ${falta.sku} (hay ${e.stock[falta.sku][t.origen]})`;
        return;
      }
      for (const i of t.items) {
        i.despachada = i.solicitada;
        e.stock[i.sku][t.origen] -= i.solicitada;
      }
      t.estado = 'despachada';
      t.historial.push({ fecha: ahora(), texto: `Despachada por ${usuario}` });
    } else if (accion === 'recibir') {
      let diferencias = 0;
      for (const i of t.items) {
        i.recibida = recibidas?.[i.sku] ?? i.despachada ?? 0;
        e.stock[i.sku][t.destino] += i.recibida;
        diferencias += Math.abs(i.recibida - (i.despachada ?? 0));
      }
      t.estado = diferencias ? 'recibida_con_diferencias' : 'recibida';
      t.historial.push({ fecha: ahora(), texto: diferencias ? `Recibida con ${diferencias} unidad(es) de diferencia` : `Recibida conforme por ${usuario}` });
    } else {
      t.estado = 'cancelada';
      t.historial.push({ fecha: ahora(), texto: `Cancelada por ${usuario}` });
    }
    auditar(e, usuario, `Transferencia: ${accion}`, t.codigo);
  });
  return error;
}

// ---------------------------------------------------------------------------
// Taller
// ---------------------------------------------------------------------------
export function costoReceta(e: Estado, modelo: string) {
  const r = e.recetas.find((x) => x.modelo === modelo);
  if (!r) return null;
  const lineas = r.items.map((it) => {
    const mp = e.materias.find((m) => m.codigo === it.mp)!;
    const cantidad = it.cantidad * (1 + r.mermaPct / 100);
    return { mp, cantidad, subtotal: mp.consumible ? cantidad * mp.costo : 0 };
  });
  const materiales = lineas.reduce((a, l) => a + l.subtotal, 0);
  return { receta: r, lineas, materiales, total: materiales + r.manoObra + r.indirecto };
}

const ORDEN_ETAPAS: EtapaProduccion[] = ['preparacion', 'hormado_prensado', 'costura_adorno', 'control_calidad', 'en_stock'];

export function moverOrden(id: string, dir: 1 | -1, aprobadas?: number): string {
  let error = '';
  mutar((e) => {
    const o = e.ordenes.find((x) => x.id === id);
    if (!o || o.etapa === 'en_stock') return;
    const idx = ORDEN_ETAPAS.indexOf(o.etapa) + dir;
    if (idx < 0) return;
    const nueva = ORDEN_ETAPAS[idx];
    const modelo = o.sku.split('-')[0];
    const costo = costoReceta(e, modelo);

    if (o.etapa === 'preparacion' && nueva === 'hormado_prensado' && !o.materialesConsumidos && costo) {
      const falta = costo.lineas.find((l) => l.mp.consumible && l.mp.stock < l.cantidad * o.cantidad);
      if (falta) {
        error = `Stock insuficiente de ${falta.mp.nombre}: hay ${falta.mp.stock} ${falta.mp.unidad}, se necesitan ${(falta.cantidad * o.cantidad).toFixed(1)}`;
        return;
      }
      for (const l of costo.lineas) if (l.mp.consumible) {
        const mp = e.materias.find((m) => m.codigo === l.mp.codigo)!;
        mp.stock = Math.round((mp.stock - l.cantidad * o.cantidad) * 100) / 100;
      }
      o.materialesConsumidos = true;
    }
    if (nueva === 'en_stock') {
      const buenas = aprobadas ?? o.cantidad;
      o.aprobadas = buenas;
      e.stock[o.sku].TAL += buenas;
      o.costoUnitario = costo ? Math.round((costo.total * o.cantidad) / Math.max(buenas, 1)) : undefined;
    }
    o.etapa = nueva;
    auditar(e, 'Encargado Taller', 'Orden de trabajo', `${o.codigo} → ${nueva}`);
  });
  return error;
}

export function crearOrden(sku: string, cantidad: number, responsable: string, compromiso: string) {
  mutar((e) => {
    const n = e.ordenes.length + 13;
    const fecha = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    e.ordenes.push({
      id: uid(), codigo: `OT-${fecha}-${String(n).padStart(5, '0')}`, sku, cantidad, etapa: 'preparacion',
      prioridad: 3, responsable, compromiso, materialesConsumidos: false,
    });
  });
}
