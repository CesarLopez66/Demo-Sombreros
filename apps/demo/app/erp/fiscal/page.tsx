'use client';
import Link from 'next/link';
import { useState } from 'react';
import { InsigniaFactura, Sucursal } from '@/components/Insignias';
import { fmtBs, fmtFechaHora, fmtN } from '@/lib/formato';
import { permisos } from '@/lib/permisos';
import { useEstado } from '@/lib/store';

const ETIQUETA_PAQUETE: Record<string, [string, string]> = {
  en_cola: ['En cola (BullMQ)', 'badge-info'],
  enviado: ['Enviado al SIN', 'badge-aviso'],
  validado: ['Validado', 'badge-bien'],
  rechazado: ['Rechazado', 'badge-critico'],
};
const ETIQUETA_EVENTO: Record<string, [string, string]> = {
  detectado: ['Detectado (en curso)', 'badge-aviso'],
  registrado: ['Registrado en el SIN', 'badge-info'],
  paquetes_enviados: ['Paquetes enviados', 'badge-info'],
  validado: ['Validado', 'badge-bien'],
};

export default function MonitorFiscal() {
  const e = useEstado();
  const p = permisos(e);
  const [soloErrores, setSoloErrores] = useState(false);

  if (!p.verFiscal) {
    return (
      <div className="card card-pad pila" style={{ maxWidth: 600 }}>
        <h2>Monitor fiscal no disponible para este rol</h2>
        <p className="muted">Lo consultan el SuperAdmin y los gerentes (de su sucursal).</p>
        <Link className="btn" style={{ justifySelf: 'start' }} href="/erp/stock">Ver stock</Link>
      </div>
    );
  }

  const ventas = e.ventas.filter((v) => p.tiendas.includes(v.sucursal));
  const cuenta = (s: string, estado: string) => ventas.filter((v) => v.sucursal === s && v.factura.estado === estado).length;
  const pendientes = ventas.filter((v) => !['validada', 'anulada'].includes(v.factura.estado));
  const eventos = e.eventos.filter((x) => p.tiendas.includes(x.sucursal));
  const paquetes = e.paquetes.filter((x) => p.tiendas.includes(x.sucursal));
  const logs = e.logsSin.filter((x) => p.tiendas.includes(x.sucursal) && (!soloErrores || !x.exito));
  const eventoActivo = eventos.find((x) => !x.fin);

  return (
    <>
      <div>
        <h1>Monitor fiscal de contingencias SIN</h1>
        <p className="muted">Modalidad electrónica en línea · colas del microservicio fiscal (BullMQ) · logs SOAP</p>
      </div>

      {eventoActivo ? (
        <div className="aviso-banda" style={{ background: 'var(--aviso-fondo)', color: 'var(--aviso)' }}>
          ⚠ Contingencia activa en {eventoActivo.sucursal} desde {fmtFechaHora(eventoActivo.inicio)}: “{eventoActivo.descripcion}”.
          Las facturas se emiten fuera de línea y se enviarán en paquete al restablecerse la conexión.
        </div>
      ) : (
        <div className="aviso-banda" style={{ background: 'var(--bien-fondo)', color: 'var(--bien)' }}>
          ✓ Todas las sucursales emiten en línea. CUFD vigente renovado hoy.
        </div>
      )}

      <div className="card">
        <div className="card-cabecera"><h2>Estado de facturas por sucursal</h2><span className="tenue">incluye el histórico del mes</span></div>
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead><tr><th>Sucursal</th><th className="der">Pendientes</th><th className="der">En contingencia</th><th className="der">Enviadas</th><th className="der">Validadas</th><th className="der">Rechazadas</th><th className="der">Anulación pend.</th><th>CUFD</th></tr></thead>
            <tbody>
              {p.tiendas.map((s) => (
                <tr key={s}>
                  <td><Sucursal codigo={s} /></td>
                  <td className="der num">{cuenta(s, 'pendiente')}</td>
                  <td className="der">{cuenta(s, 'contingencia') ? <span className="badge badge-aviso num">{cuenta(s, 'contingencia')}</span> : <span className="num">0</span>}</td>
                  <td className="der num">{cuenta(s, 'enviada')}</td>
                  <td className="der num">{fmtN(e.facturasHistoricas[s].validadas + cuenta(s, 'validada'))}</td>
                  <td className="der">{e.facturasHistoricas[s].rechazadas ? <span className="badge badge-critico num">{e.facturasHistoricas[s].rechazadas}</span> : <span className="num">0</span>}</td>
                  <td className="der num">{cuenta(s, 'anulacion_pendiente')}</td>
                  <td><span className="badge badge-bien">Vigente</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-cabecera"><h2>Cola de envío</h2><span className="tenue">{pendientes.length} facturas sin validar</span></div>
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead><tr><th>Factura</th><th>Sucursal</th><th>Emisión</th><th className="der">Monto</th><th>Estado</th></tr></thead>
              <tbody>
                {pendientes.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 20 }}>Cola vacía. Vende en el POS para ver facturas pasar por aquí.</td></tr>}
                {pendientes.map((v) => (
                  <tr key={v.id}>
                    <td className="num">Nº {v.factura.numero}</td>
                    <td><Sucursal codigo={v.sucursal} /></td>
                    <td>{v.factura.tipoEmision === 'en_linea' ? 'En línea' : 'Fuera de línea'}</td>
                    <td className="der num">{fmtBs(v.total)}</td>
                    <td><InsigniaFactura estado={v.factura.estado} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-cabecera"><h2>Eventos significativos y paquetes</h2></div>
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead><tr><th>Sucursal</th><th>Evento</th><th>Período</th><th>Estado</th></tr></thead>
              <tbody>
                {eventos.map((x) => {
                  const pk = paquetes.filter((q) => q.eventoId === x.id);
                  return (
                    <tr key={x.id}>
                      <td><Sucursal codigo={x.sucursal} /></td>
                      <td>
                        {x.codigo} · {x.descripcion}
                        {pk.map((q) => (
                          <div key={q.id} className="fila" style={{ gap: 6, marginTop: 4 }}>
                            <span className="tenue">Paquete de {q.cantidad} facturas</span>
                            <span className={`badge ${ETIQUETA_PAQUETE[q.estado][1]}`}>{ETIQUETA_PAQUETE[q.estado][0]}</span>
                          </div>
                        ))}
                      </td>
                      <td className="num tenue">{fmtFechaHora(x.inicio)} → {x.fin ? fmtFechaHora(x.fin) : 'en curso'}</td>
                      <td><span className={`badge ${ETIQUETA_EVENTO[x.estado][1]}`}>{ETIQUETA_EVENTO[x.estado][0]}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-cabecera">
          <h2>Logs de comunicación SOAP</h2>
          <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={soloErrores} onChange={(ev) => setSoloErrores(ev.target.checked)} style={{ width: 16, height: 16 }} />
            Solo errores
          </label>
        </div>
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Sucursal</th><th>Operación</th><th>Resultado</th><th>Mensaje</th></tr></thead>
            <tbody>
              {logs.slice(0, 40).map((l) => (
                <tr key={l.id}>
                  <td className="num">{fmtFechaHora(l.fecha)}</td>
                  <td><Sucursal codigo={l.sucursal} /></td>
                  <td className="num">{l.operacion}</td>
                  <td>{l.exito ? <span className="badge badge-bien">✓ OK</span> : <span className="badge badge-critico">✕ Error</span>}</td>
                  <td>{l.mensaje}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
