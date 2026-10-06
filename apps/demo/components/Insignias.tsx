import { ENTORNO, DATOS_SIMULADOS } from '@/lib/entorno';
import { ETIQUETA_ESTADO_FACTURA, ETIQUETA_TRANSFERENCIA } from '@/lib/formato';

export function InsigniaEntorno() {
  return (
    <span className={`badge ${ENTORNO === 'prod' ? 'badge-critico' : 'badge-info'}`} title="Entorno activo">
      {ENTORNO.toUpperCase()}
      {/* En prod la fuente es Supabase, pero la conexión llega en las fases 2–4: hasta entonces se avisa. */}
      {DATOS_SIMULADOS ? ' · datos simulados' : ' · servicios aún no conectados'}
    </span>
  );
}

const CLASE_FACTURA: Record<string, string> = {
  pendiente: 'badge-info',
  contingencia: 'badge-aviso',
  enviada: 'badge-info',
  validada: 'badge-bien',
  rechazada: 'badge-critico',
  anulacion_pendiente: 'badge-aviso',
  anulada: '',
};

export function InsigniaFactura({ estado }: { estado: string }) {
  return <span className={`badge ${CLASE_FACTURA[estado] ?? ''}`}>{ETIQUETA_ESTADO_FACTURA[estado] ?? estado}</span>;
}

const CLASE_TRF: Record<string, string> = {
  solicitada: 'badge-info',
  aprobada: 'badge-info',
  despachada: 'badge-aviso',
  recibida: 'badge-bien',
  recibida_con_diferencias: 'badge-critico',
  cancelada: '',
};

export function InsigniaTransferencia({ estado }: { estado: string }) {
  return <span className={`badge ${CLASE_TRF[estado] ?? ''}`}>{ETIQUETA_TRANSFERENCIA[estado] ?? estado}</span>;
}

export const COLOR_SUCURSAL: Record<string, string> = {
  LPZ: 'var(--serie-lpz)',
  CBB: 'var(--serie-cbb)',
  SCZ: 'var(--serie-scz)',
  TAL: 'var(--serie-tal)',
};

export function Sucursal({ codigo }: { codigo: string }) {
  return (
    <span className="fila" style={{ gap: 6, display: 'inline-flex' }}>
      <span className="punto" style={{ background: COLOR_SUCURSAL[codigo] }} />
      {codigo}
    </span>
  );
}
