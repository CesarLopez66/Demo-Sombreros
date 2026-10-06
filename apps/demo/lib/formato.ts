const bs = new Intl.NumberFormat('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const entero = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 0 });

export const fmtBs = (n: number) => `Bs ${bs.format(n)}`;
export const fmtBsCorto = (n: number) =>
  n >= 1_000_000 ? `Bs ${(n / 1_000_000).toFixed(1)} M` : n >= 10_000 ? `Bs ${(n / 1000).toFixed(1)} mil` : `Bs ${entero.format(n)}`;
export const fmtN = (n: number) => entero.format(n);

export const fmtFechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-BO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export const fmtFecha = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-BO', { day: '2-digit', month: 'short' });

export const ETIQUETA_ESTADO_FACTURA: Record<string, string> = {
  pendiente: 'Pendiente',
  contingencia: 'Contingencia',
  enviada: 'Enviada',
  validada: 'Validada',
  rechazada: 'Rechazada',
  anulacion_pendiente: 'Anulación pendiente',
  anulada: 'Anulada',
};

export const ETIQUETA_TRANSFERENCIA: Record<string, string> = {
  solicitada: 'Solicitada',
  aprobada: 'Aprobada',
  despachada: 'Despachada',
  recibida: 'Recibida',
  recibida_con_diferencias: 'Con diferencias',
  cancelada: 'Cancelada',
};

export const ETIQUETA_ROL: Record<string, string> = {
  superadmin: 'SuperAdmin / Propietario',
  gerente: 'Gerente de sucursal',
  almacen: 'Almacén y Taller',
  cajero: 'Cajero / Vendedor',
};
