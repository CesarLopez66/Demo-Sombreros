// Tipos y constantes de dominio compartidos por POS, ERP y microservicio fiscal.
// Deben coincidir con los enums de supabase/migrations (los tipos completos de
// tablas se generan con `npm run db:types` en database.types.ts).

export const ROLES = ['superadmin', 'gerente', 'almacen', 'cajero'] as const;
export type Rol = (typeof ROLES)[number];

/** Roles que la BD solo reconoce con sesión MFA (aal2). */
export const ROLES_CON_MFA: readonly Rol[] = ['superadmin', 'gerente'];

export const SUCURSALES = ['LPZ', 'CBB', 'SCZ', 'TAL'] as const;
export type CodigoSucursal = (typeof SUCURSALES)[number];

/** Claims que la BD escribe en auth.users.raw_app_meta_data (ver 0002). */
export interface AppMetadata {
  rol: Rol;
  sucursal_id: string | null;
  sucursal_codigo: CodigoSucursal | null;
  activo: boolean;
}

export const METODOS_PAGO = ['efectivo', 'qr', 'tarjeta'] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];

export const TIPOS_DOCUMENTO = ['CI', 'CEX', 'PAS', 'OD', 'NIT'] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

/** Código numérico del SIN para cada tipo de documento de identidad. */
export const CODIGO_SIN_DOCUMENTO: Record<TipoDocumento, number> = { CI: 1, CEX: 2, PAS: 3, OD: 4, NIT: 5 };

/** Columnas del tablero Kanban del taller, en orden. */
export const ETAPAS_PRODUCCION = [
  'preparacion',
  'hormado_prensado',
  'costura_adorno',
  'control_calidad',
  'en_stock',
] as const;
export type EtapaProduccion = (typeof ETAPAS_PRODUCCION)[number];

export const ETIQUETAS_ETAPA: Record<EtapaProduccion, string> = {
  preparacion: 'Preparación',
  hormado_prensado: 'Hormado / Prensado',
  costura_adorno: 'Costura / Adorno',
  control_calidad: 'Control de calidad',
  en_stock: 'En stock',
};

export const ESTADOS_TRANSFERENCIA = [
  'solicitada',
  'aprobada',
  'despachada',
  'recibida',
  'recibida_con_diferencias',
  'cancelada',
] as const;
export type EstadoTransferencia = (typeof ESTADOS_TRANSFERENCIA)[number];

export const ESTADOS_FACTURA = [
  'pendiente',
  'contingencia',
  'enviada',
  'validada',
  'observada',
  'rechazada',
  'anulacion_pendiente',
  'anulada',
] as const;
export type EstadoFactura = (typeof ESTADOS_FACTURA)[number];

/** Payload de la RPC public.registrar_venta (ver 0010_rpc_pos.sql). */
export interface PayloadVenta {
  cliente?: {
    id: string;
    tipo_documento: TipoDocumento;
    numero_documento: string;
    complemento?: string | null;
    razon_social: string;
    email?: string | null;
    telefono?: string | null;
  } | null;
  venta: {
    id: string;
    sucursal_id: string;
    caja_id: string;
    sesion_caja_id: string;
    numero_venta_local: number;
    fecha_emision: string;
    cliente_id?: string | null;
    documento_tipo?: TipoDocumento | null;
    documento_numero?: string | null;
    documento_complemento?: string | null;
    razon_social?: string | null;
    subtotal: number;
    descuento: number;
    total: number;
    descuento_autorizado_por?: string | null;
    tipo_comprobante: 'factura' | 'ticket';
    emitida_offline: boolean;
  };
  detalles: Array<{
    id: string;
    variante_id: string;
    descripcion: string;
    cantidad: number;
    precio_unitario: number;
    descuento: number;
    subtotal: number;
  }>;
  pagos: Array<{
    id: string;
    metodo: MetodoPago;
    monto: number;
    monto_recibido?: number | null;
    referencia?: string | null;
  }>;
  factura?: {
    id: string;
    punto_venta: number;
    numero_factura: number;
    cuf: string;
    cufd: string;
    tipo_emision: 'en_linea' | 'fuera_de_linea';
    fecha_emision: string;
    leyenda?: string | null;
    url_qr?: string | null;
    evento_id?: string | null;
  } | null;
}
