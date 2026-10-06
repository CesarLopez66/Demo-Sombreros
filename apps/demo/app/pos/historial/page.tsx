'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { InsigniaFactura } from '@/components/Insignias';
import { fmtBs, fmtFechaHora } from '@/lib/formato';
import { anularVenta, cerrarCaja, useEstado } from '@/lib/store';

const DENOMINACIONES = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1];

export default function Historial() {
  const e = useEstado();
  const router = useRouter();
  const s = e.sesion;
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [anulando, setAnulando] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [motivo, setMotivo] = useState('');
  const [confirmarCierre, setConfirmarCierre] = useState(false);

  if (!s) return null;
  const ventas = e.ventas.filter((v) => v.sesionId === s.id);
  const pendientes = ventas.filter((v) => v.sync === 'pendiente').length;
  const contingencia = ventas.filter((v) => v.factura.estado === 'contingencia').length;
  const declarado = DENOMINACIONES.reduce((a, d) => a + d * (Number(conteo[d]) || 0), 0);
  const completadas = ventas.filter((v) => v.estado === 'completada');

  const confirmarAnulacion = () => {
    if (!anulando || pin !== '9999' || motivo.trim().length < 5) return;
    anularVenta(anulando, `Gerente ${s.sucursal}`, motivo.trim());
    setAnulando(null);
    setPin('');
    setMotivo('');
  };

  const cerrar = () => {
    cerrarCaja(Math.round(declarado * 100) / 100);
    router.replace('/pos');
  };

  return (
    <div className="pila" style={{ gap: 16, maxWidth: 1200, margin: '0 auto' }}>
      <div className="grid-kpi">
        <div className="card card-pad"><p className="tenue">Ventas del turno</p><h1 className="num">{completadas.length}</h1></div>
        <div className="card card-pad"><p className="tenue">Pendientes de sincronizar</p><h1 className="num" style={{ color: pendientes ? 'var(--aviso)' : undefined }}>{pendientes}</h1></div>
        <div className="card card-pad"><p className="tenue">Facturas en contingencia</p><h1 className="num" style={{ color: contingencia ? 'var(--aviso)' : undefined }}>{contingencia}</h1></div>
        <div className="card card-pad"><p className="tenue">Apertura</p><h2 className="num">{fmtFechaHora(s.abiertaEn)}</h2><p className="tenue">Saldo inicial {fmtBs(s.montoInicial)}</p></div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(300px, 1fr)', alignItems: 'start' }}>
        <div className="card">
          <div className="card-cabecera">
            <h2>Historial local del turno</h2>
            <span className="tenue">Base local del dispositivo · se sincroniza con PowerSync</span>
          </div>
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead>
                <tr><th>#</th><th>Hora</th><th>Cliente</th><th className="der">Total</th><th>Pago</th><th>Factura</th><th>Sync</th><th /></tr>
              </thead>
              <tbody>
                {ventas.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>Aún no hay ventas en este turno.</td></tr>}
                {ventas.map((v) => (
                  <tr key={v.id} style={{ opacity: v.estado === 'anulada' ? 0.55 : 1 }}>
                    <td className="num">{v.numero}</td>
                    <td className="num">{fmtFechaHora(v.fecha)}</td>
                    <td>{v.cliente?.razonSocial}</td>
                    <td className="der num">{fmtBs(v.total)}</td>
                    <td>{v.pagos.map((p) => p.metodo).join(', ')}</td>
                    <td><InsigniaFactura estado={v.factura.estado} /></td>
                    <td>{v.sync === 'pendiente' ? <span className="badge badge-aviso">⟳ Pendiente</span> : <span className="badge badge-bien">✓</span>}</td>
                    <td className="fila" style={{ flexWrap: 'nowrap', gap: 6 }}>
                      <Link className="btn btn-chico" href={`/pos/ticket/${v.id}`}>Ticket</Link>
                      {v.estado === 'completada' && <button className="btn btn-chico btn-peligro" onClick={() => setAnulando(v.id)}>Anular</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-cabecera"><h2>Arqueo ciego y cierre</h2></div>
          <div className="card-pad pila">
            <p className="muted">Cuenta el efectivo de la caja. El monto esperado no se muestra: el resultado lo revisa el gerente.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {DENOMINACIONES.map((d) => (
                <label key={d} style={{ gridTemplateColumns: '70px 1fr', alignItems: 'center', display: 'grid' }}>
                  <span className="num">Bs {d >= 1 ? d : d.toFixed(2)}</span>
                  <input className="num" inputMode="numeric" placeholder="0" value={conteo[d] ?? ''} style={{ height: 32 }}
                    onChange={(ev) => setConteo({ ...conteo, [d]: ev.target.value.replace(/\D/g, '') })} />
                </label>
              ))}
            </div>
            <div className="fila entre" style={{ fontSize: 18, fontWeight: 700 }}><span>Efectivo contado</span><span className="num">{fmtBs(declarado)}</span></div>
            {pendientes > 0 && (
              <div className="aviso-banda" style={{ background: 'var(--aviso-fondo)', color: 'var(--aviso)' }}>
                Hay {pendientes} ventas sin sincronizar. Se enviarán antes del cierre cuando vuelva la red (la cola es FIFO).
              </div>
            )}
            {!confirmarCierre ? (
              <button className="btn btn-primario" onClick={() => setConfirmarCierre(true)}>Cerrar caja</button>
            ) : (
              <div className="pila" style={{ gap: 8 }}>
                <p>¿Confirmas el cierre con <b className="num">{fmtBs(declarado)}</b> declarados?</p>
                <div className="fila">
                  <button className="btn btn-primario" onClick={cerrar}>Sí, cerrar caja</button>
                  <button className="btn" onClick={() => setConfirmarCierre(false)}>Volver</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {anulando && (
        <div className="modal-fondo" onClick={() => setAnulando(null)}>
          <div className="card modal" onClick={(ev) => ev.stopPropagation()}>
            <div className="card-cabecera"><h2>Anular venta</h2></div>
            <div className="card-pad pila">
              <p className="muted">La anulación requiere autorización del gerente. Repone el stock, revierte los puntos y envía la anulación al SIN.</p>
              <label>Motivo<input value={motivo} onChange={(ev) => setMotivo(ev.target.value)} placeholder="Ej.: error en la talla" /></label>
              <label>PIN del gerente (demo 9999)<input type="password" inputMode="numeric" value={pin} onChange={(ev) => setPin(ev.target.value)} /></label>
              <div className="fila">
                <button className="btn btn-peligro" disabled={pin !== '9999' || motivo.trim().length < 5} onClick={confirmarAnulacion}>Anular venta</button>
                <button className="btn" onClick={() => setAnulando(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
