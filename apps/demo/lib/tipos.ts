export type CodigoSucursal = 'LPZ' | 'CBB' | 'SCZ' | 'TAL';
export type Tienda = Exclude<CodigoSucursal, 'TAL'>;
export type Rol = 'superadmin' | 'gerente' | 'almacen' | 'cajero';
export type MetodoPago = 'efectivo' | 'qr' | 'tarjeta';
export type EstadoFactura =
  | 'pendiente'
  | 'contingencia'
  | 'enviada'
  | 'validada'
  | 'rechazada'
  | 'anulacion_pendiente'
  | 'anulada';
export type EtapaProduccion = 'preparacion' | 'hormado_prensado' | 'costura_adorno' | 'control_calidad' | 'en_stock';
export type EstadoTransferencia =
  | 'solicitada'
  | 'aprobada'
  | 'despachada'
  | 'recibida'
  | 'recibida_con_diferencias'
  | 'cancelada';

export interface Sucursal {
  codigo: CodigoSucursal;
  nombre: string;
  departamento: string;
  tipo: 'tienda' | 'taller';
}

export interface Modelo {
  codigo: string;
  nombre: string;
  categoria: string;
  material: string;
  precio: number;
  colores: string[];
}

export interface Variante {
  sku: string;
  modelo: string;
  talla: string;
  color: string;
  horma: string;
  precio: number;
  costo: number;
}

export interface Cliente {
  id: string;
  tipoDocumento: 'CI' | 'NIT' | 'CEX' | 'PAS';
  documento: string;
  razonSocial: string;
  puntos: number;
}

export interface LineaVenta {
  sku: string;
  descripcion: string;
  cantidad: number;
  precio: number;
}

export interface Factura {
  numero: number;
  cuf: string;
  cufd: string;
  estado: EstadoFactura;
  tipoEmision: 'en_linea' | 'fuera_de_linea';
}

export interface Venta {
  id: string;
  numero: number;
  sucursal: Tienda;
  caja: string;
  cajero: string;
  fecha: string;
  cliente: { tipoDocumento: string; documento: string; razonSocial: string } | null;
  clienteId: string | null;
  lineas: LineaVenta[];
  subtotal: number;
  descuento: number;
  total: number;
  pagos: { metodo: MetodoPago; monto: number; recibido?: number }[];
  estado: 'completada' | 'anulada';
  sync: 'pendiente' | 'sincronizada';
  factura: Factura;
  sesionId: string;
}

export interface SesionCaja {
  id: string;
  sucursal: Tienda;
  caja: string;
  cajero: string;
  montoInicial: number;
  abiertaEn: string;
  cerradaEn?: string;
  montoDeclarado?: number;
}

export interface Arqueo {
  sesionId: string;
  sucursal: Tienda;
  cajero: string;
  fecha: string;
  esperado: number;
  declarado: number;
  diferencia: number;
  ventas: number;
}

export interface Transferencia {
  id: string;
  codigo: string;
  origen: CodigoSucursal;
  destino: CodigoSucursal;
  estado: EstadoTransferencia;
  items: { sku: string; solicitada: number; despachada?: number; recibida?: number }[];
  historial: { fecha: string; texto: string }[];
}

export interface MateriaPrima {
  codigo: string;
  nombre: string;
  categoria: string;
  unidad: string;
  stock: number;
  minimo: number;
  costo: number;
  consumible: boolean;
}

export interface Receta {
  modelo: string;
  manoObra: number;
  indirecto: number;
  mermaPct: number;
  items: { mp: string; cantidad: number }[];
}

export interface OrdenTrabajo {
  id: string;
  codigo: string;
  sku: string;
  cantidad: number;
  aprobadas?: number;
  etapa: EtapaProduccion;
  prioridad: number;
  responsable: string;
  compromiso: string;
  materialesConsumidos: boolean;
  costoUnitario?: number;
}

export interface EventoSignificativo {
  id: string;
  sucursal: Tienda;
  codigo: number;
  descripcion: string;
  inicio: string;
  fin?: string;
  estado: 'detectado' | 'registrado' | 'paquetes_enviados' | 'validado';
}

export interface PaqueteFiscal {
  id: string;
  sucursal: Tienda;
  eventoId: string;
  cantidad: number;
  estado: 'en_cola' | 'enviado' | 'validado' | 'rechazado';
  creado: string;
}

export interface LogSin {
  id: string;
  fecha: string;
  sucursal: Tienda;
  operacion: string;
  exito: boolean;
  mensaje: string;
}

export interface VentaHistorica {
  fecha: string;
  sucursal: Tienda;
  modelo: string;
  unidades: number;
  monto: number;
  costo: number;
}

export interface Auditoria {
  id: string;
  fecha: string;
  usuario: string;
  accion: string;
  detalle: string;
}

export interface Estado {
  version: number;
  sucursales: Sucursal[];
  modelos: Modelo[];
  tallas: string[];
  hormas: { codigo: string; nombre: string }[];
  colores: Record<string, { nombre: string; hex: string }>;
  variantes: Variante[];
  stock: Record<string, Record<CodigoSucursal, number>>;
  minimo: number;
  clientes: Cliente[];
  ventas: Venta[];
  historico: VentaHistorica[];
  sesion: SesionCaja | null;
  sesionesCerradas: SesionCaja[];
  arqueos: Arqueo[];
  contadores: Record<Tienda, { venta: number; factura: number }>;
  online: boolean;
  transferencias: Transferencia[];
  materias: MateriaPrima[];
  recetas: Receta[];
  ordenes: OrdenTrabajo[];
  eventos: EventoSignificativo[];
  paquetes: PaqueteFiscal[];
  logsSin: LogSin[];
  facturasHistoricas: Record<Tienda, { validadas: number; rechazadas: number }>;
  auditoria: Auditoria[];
  /** Sesión simulada del ERP: emula lo que el RLS dejaría ver a cada rol. */
  perfilErp: { rol: Rol; sucursal: Tienda };
}
