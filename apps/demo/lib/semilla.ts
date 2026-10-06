// Datos simulados deterministas (misma semilla = mismos datos en cada reinicio).
// Reflejan supabase/seed.sql: sucursales, matriz de productos, taller y recetas.
import type { CodigoSucursal, Estado, Tienda, Variante, VentaHistorica } from './tipos';

export const VERSION_DATOS = 2;

function prng(semilla: number) {
  let a = semilla;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TIENDAS: Tienda[] = ['LPZ', 'CBB', 'SCZ'];

export function crearEstadoInicial(): Estado {
  const r = prng(2026);
  const ent = (min: number, max: number) => Math.floor(r() * (max - min + 1)) + min;

  const modelos = [
    { codigo: 'FED01', nombre: 'Fedora Clásico', categoria: 'Fedora', material: 'Fieltro de lana', precio: 280, colores: ['NEG', 'CAF', 'GRI'] },
    { codigo: 'BOR01', nombre: 'Borsalino Premium', categoria: 'Borsalino', material: 'Fieltro de pelo de conejo', precio: 650, colores: ['NEG', 'CAF', 'GRI'] },
    { codigo: 'BOM01', nombre: 'Bombín Paceño', categoria: 'Bombín', material: 'Fieltro de lana', precio: 420, colores: ['NEG', 'CAF', 'GRI'] },
    { codigo: 'VAQ01', nombre: 'Vaquero Oriental', categoria: 'Vaquero', material: 'Fieltro de lana', precio: 350, colores: ['NEG', 'CAF', 'GRI'] },
    { codigo: 'PAN01', nombre: 'Panamá Fino', categoria: 'Panamá', material: 'Paja toquilla', precio: 520, colores: ['NAT', 'BEI', 'NEG'] },
  ];
  const tallas = ['55', '56', '57', '58', '59', '60'];
  const hormas = [
    { codigo: 'OVI', nombre: 'Ovalada intermedia' },
    { codigo: 'OVL', nombre: 'Ovalada larga' },
  ];
  const colores = {
    NEG: { nombre: 'Negro', hex: '#1d1d1b' },
    CAF: { nombre: 'Café', hex: '#5b3a29' },
    GRI: { nombre: 'Gris', hex: '#7a7a7a' },
    BEI: { nombre: 'Beige', hex: '#d8c3a5' },
    NAT: { nombre: 'Natural', hex: '#e9ddb8' },
  };

  const variantes: Variante[] = [];
  for (const m of modelos)
    for (const t of tallas)
      for (const c of m.colores)
        for (const h of hormas) {
          const precio = m.precio + (Number(t) >= 60 ? 20 : 0);
          variantes.push({
            sku: `${m.codigo}-${t}-${c}-${h.codigo}`,
            modelo: m.codigo,
            talla: t,
            color: c,
            horma: h.codigo,
            precio,
            costo: Math.round(precio * (0.38 + r() * 0.12)),
          });
        }

  const stock: Estado['stock'] = {};
  for (const v of variantes) {
    stock[v.sku] = { LPZ: ent(2, 9), CBB: ent(1, 7), SCZ: ent(1, 7), TAL: ent(3, 14) };
  }

  // 60 días de ventas agregadas por sucursal y modelo (alimenta el dashboard)
  const historico: VentaHistorica[] = [];
  const peso: Record<Tienda, number> = { LPZ: 1.35, CBB: 1, SCZ: 0.9 };
  const popularidad: Record<string, number> = { FED01: 1.6, BOR01: 0.6, BOM01: 1.3, VAQ01: 1.1, PAN01: 0.7 };
  const hoy = new Date();
  hoy.setHours(12, 0, 0, 0);
  for (let d = 59; d >= 0; d--) {
    const fecha = new Date(hoy.getTime() - d * 864e5);
    const finde = [0, 6].includes(fecha.getDay()) ? 1.5 : 1;
    for (const s of TIENDAS)
      for (const m of modelos) {
        const unidades = Math.max(0, Math.round((r() * 2.4 + 0.2) * peso[s] * popularidad[m.codigo] * finde - 0.6));
        if (!unidades) continue;
        const monto = unidades * m.precio;
        historico.push({
          fecha: fecha.toISOString().slice(0, 10),
          sucursal: s,
          modelo: m.codigo,
          unidades,
          monto,
          costo: Math.round(monto * (0.4 + r() * 0.08)),
        });
      }
  }

  const iso = (diasAtras: number, horas = 0) => new Date(Date.now() - diasAtras * 864e5 - horas * 36e5).toISOString();
  const sku = (i: number) => variantes[i].sku;

  return {
    version: VERSION_DATOS,
    sucursales: [
      { codigo: 'LPZ', nombre: 'Casa Matriz La Paz', departamento: 'La Paz', tipo: 'tienda' },
      { codigo: 'CBB', nombre: 'Sucursal Cochabamba', departamento: 'Cochabamba', tipo: 'tienda' },
      { codigo: 'SCZ', nombre: 'Sucursal Santa Cruz', departamento: 'Santa Cruz', tipo: 'tienda' },
      { codigo: 'TAL', nombre: 'Taller y Almacén Central', departamento: 'La Paz', tipo: 'taller' },
    ],
    modelos,
    tallas,
    hormas,
    colores,
    variantes,
    stock,
    minimo: 2,
    clientes: [
      { id: 'c1', tipoDocumento: 'CI', documento: '4789123', razonSocial: 'MAMANI QUISPE JUANA', puntos: 84 },
      { id: 'c2', tipoDocumento: 'NIT', documento: '1020304025', razonSocial: 'TURISMO ANDINO SRL', puntos: 312 },
      { id: 'c3', tipoDocumento: 'CI', documento: '6012458', razonSocial: 'ROJAS VARGAS CARLOS', puntos: 45 },
      { id: 'c4', tipoDocumento: 'CI', documento: '3349871', razonSocial: 'GUTIÉRREZ CHOQUE ROSA', puntos: 128 },
    ],
    ventas: [],
    historico,
    sesion: null,
    sesionesCerradas: [],
    arqueos: [
      { sesionId: 'h1', sucursal: 'LPZ', cajero: 'Cajero La Paz', fecha: iso(1, 2), esperado: 3840, declarado: 3840, diferencia: 0, ventas: 11 },
      { sesionId: 'h2', sucursal: 'CBB', cajero: 'Cajero Cochabamba', fecha: iso(1, 3), esperado: 2210, declarado: 2190, diferencia: -20, ventas: 7 },
      { sesionId: 'h3', sucursal: 'SCZ', cajero: 'Cajero Santa Cruz', fecha: iso(1, 2), esperado: 1960, declarado: 1960, diferencia: 0, ventas: 6 },
    ],
    contadores: { LPZ: { venta: 0, factura: 1520 }, CBB: { venta: 0, factura: 980 }, SCZ: { venta: 0, factura: 870 } },
    online: true,
    transferencias: [
      {
        id: 't1', codigo: 'TRF-20260930-00001', origen: 'TAL', destino: 'SCZ', estado: 'despachada',
        items: [{ sku: sku(2), solicitada: 6, despachada: 6 }, { sku: sku(40), solicitada: 4, despachada: 4 }],
        historial: [{ fecha: iso(3), texto: 'Solicitada por Gerente Santa Cruz' }, { fecha: iso(2), texto: 'Aprobada y despachada por Taller' }],
      },
      {
        id: 't2', codigo: 'TRF-20261001-00002', origen: 'LPZ', destino: 'CBB', estado: 'solicitada',
        items: [{ sku: sku(73), solicitada: 3 }],
        historial: [{ fecha: iso(1), texto: 'Solicitada por Gerente Cochabamba' }],
      },
      {
        id: 't3', codigo: 'TRF-20260925-00003', origen: 'TAL', destino: 'LPZ', estado: 'recibida_con_diferencias',
        items: [{ sku: sku(12), solicitada: 5, despachada: 5, recibida: 4 }],
        historial: [{ fecha: iso(7), texto: 'Solicitada' }, { fecha: iso(6), texto: 'Despachada' }, { fecha: iso(5), texto: 'Recibida: faltante de 1 unidad' }],
      },
    ],
    materias: [
      { codigo: 'MP-FL-01', nombre: 'Cono de fieltro de lana', categoria: 'Fieltro', unidad: 'cono', stock: 188, minimo: 30, costo: 65, consumible: true },
      { codigo: 'MP-FC-01', nombre: 'Cono de fieltro de pelo de conejo', categoria: 'Fieltro', unidad: 'cono', stock: 14, minimo: 10, costo: 210, consumible: true },
      { codigo: 'MP-PT-01', nombre: 'Capelina de paja toquilla', categoria: 'Paja toquilla', unidad: 'unidad', stock: 9, minimo: 10, costo: 160, consumible: true },
      { codigo: 'MP-CI-01', nombre: 'Cinta grosgrain 3 cm', categoria: 'Cinta', unidad: 'm', stock: 432, minimo: 50, costo: 4.5, consumible: true },
      { codigo: 'MP-TA-01', nombre: 'Tafilete de cuero', categoria: 'Tafilete', unidad: 'unidad', stock: 266, minimo: 40, costo: 18, consumible: true },
      { codigo: 'MP-FO-01', nombre: 'Forro de satín', categoria: 'Forro', unidad: 'unidad', stock: 281, minimo: 40, costo: 7, consumible: true },
      { codigo: 'MP-HO-01', nombre: 'Horma de madera (juego tallas)', categoria: 'Horma', unidad: 'unidad', stock: 12, minimo: 0, costo: 350, consumible: false },
    ],
    recetas: [
      { modelo: 'FED01', manoObra: 45, indirecto: 12, mermaPct: 3, items: [{ mp: 'MP-FL-01', cantidad: 1 }, { mp: 'MP-CI-01', cantidad: 0.7 }, { mp: 'MP-TA-01', cantidad: 1 }, { mp: 'MP-FO-01', cantidad: 1 }, { mp: 'MP-HO-01', cantidad: 1 }] },
      { modelo: 'BOR01', manoObra: 80, indirecto: 20, mermaPct: 2, items: [{ mp: 'MP-FC-01', cantidad: 1 }, { mp: 'MP-CI-01', cantidad: 0.7 }, { mp: 'MP-TA-01', cantidad: 1 }, { mp: 'MP-FO-01', cantidad: 1 }, { mp: 'MP-HO-01', cantidad: 1 }] },
      { modelo: 'BOM01', manoObra: 60, indirecto: 15, mermaPct: 3, items: [{ mp: 'MP-FL-01', cantidad: 1 }, { mp: 'MP-CI-01', cantidad: 0.6 }, { mp: 'MP-TA-01', cantidad: 1 }, { mp: 'MP-FO-01', cantidad: 1 }, { mp: 'MP-HO-01', cantidad: 1 }] },
      { modelo: 'VAQ01', manoObra: 50, indirecto: 12, mermaPct: 3, items: [{ mp: 'MP-FL-01', cantidad: 1.2 }, { mp: 'MP-CI-01', cantidad: 0.8 }, { mp: 'MP-TA-01', cantidad: 1 }, { mp: 'MP-HO-01', cantidad: 1 }] },
      { modelo: 'PAN01', manoObra: 70, indirecto: 15, mermaPct: 5, items: [{ mp: 'MP-PT-01', cantidad: 1 }, { mp: 'MP-CI-01', cantidad: 0.7 }, { mp: 'MP-TA-01', cantidad: 1 }, { mp: 'MP-HO-01', cantidad: 1 }] },
    ],
    ordenes: [
      { id: 'o1', codigo: 'OT-20260928-00011', sku: sku(0), cantidad: 12, etapa: 'preparacion', prioridad: 2, responsable: 'Don Félix', compromiso: iso(-3).slice(0, 10), materialesConsumidos: false },
      { id: 'o2', codigo: 'OT-20260927-00010', sku: sku(75), cantidad: 8, etapa: 'hormado_prensado', prioridad: 1, responsable: 'Doña Marta', compromiso: iso(-1).slice(0, 10), materialesConsumidos: true },
      { id: 'o3', codigo: 'OT-20260926-00009', sku: sku(36), cantidad: 6, etapa: 'costura_adorno', prioridad: 3, responsable: 'Don Félix', compromiso: iso(-2).slice(0, 10), materialesConsumidos: true },
      { id: 'o4', codigo: 'OT-20260925-00008', sku: sku(148), cantidad: 5, etapa: 'control_calidad', prioridad: 2, responsable: 'Doña Marta', compromiso: iso(0).slice(0, 10), materialesConsumidos: true },
      { id: 'o5', codigo: 'OT-20260929-00012', sku: sku(110), cantidad: 10, etapa: 'preparacion', prioridad: 3, responsable: 'Juan C.', compromiso: iso(-5).slice(0, 10), materialesConsumidos: false },
    ],
    eventos: [
      { id: 'e1', sucursal: 'SCZ', codigo: 1, descripcion: 'Corte del servicio de internet', inicio: iso(2, 5), fin: iso(2, 3), estado: 'validado' },
    ],
    paquetes: [{ id: 'p1', sucursal: 'SCZ', eventoId: 'e1', cantidad: 9, estado: 'validado', creado: iso(2, 3) }],
    logsSin: [
      { id: 'l1', fecha: iso(0, 1), sucursal: 'LPZ', operacion: 'cufd', exito: true, mensaje: 'CUFD renovado para PV 0' },
      { id: 'l2', fecha: iso(1, 6), sucursal: 'CBB', operacion: 'recepcionFactura', exito: false, mensaje: 'Código 1037: NIT del receptor inválido (se emitió con NIT observado)' },
      { id: 'l3', fecha: iso(2, 3), sucursal: 'SCZ', operacion: 'recepcionPaqueteFactura', exito: true, mensaje: 'Paquete de 9 facturas validado' },
      { id: 'l4', fecha: iso(2, 3), sucursal: 'SCZ', operacion: 'registroEventoSignificativo', exito: true, mensaje: 'Evento 1 registrado' },
    ],
    facturasHistoricas: {
      LPZ: { validadas: 1520, rechazadas: 0 },
      CBB: { validadas: 979, rechazadas: 1 },
      SCZ: { validadas: 870, rechazadas: 0 },
    },
    auditoria: [
      { id: 'a1', fecha: iso(1, 2), usuario: 'Gerente Cochabamba', accion: 'Revisión de arqueo', detalle: 'Faltante de Bs 20 aceptado con observación' },
      { id: 'a2', fecha: iso(2, 1), usuario: 'Propietario', accion: 'Cambio de precio', detalle: 'BOR01: Bs 620 → Bs 650' },
    ],
    perfilErp: { rol: 'superadmin', sucursal: 'LPZ' },
  };
}

export const ETAPAS = [
  { id: 'preparacion', nombre: 'Preparación' },
  { id: 'hormado_prensado', nombre: 'Hormado / Prensado' },
  { id: 'costura_adorno', nombre: 'Costura / Adorno' },
  { id: 'control_calidad', nombre: 'Control de calidad' },
  { id: 'en_stock', nombre: 'En stock' },
] as const;

export const SUCURSALES_CODIGOS: CodigoSucursal[] = ['LPZ', 'CBB', 'SCZ', 'TAL'];
