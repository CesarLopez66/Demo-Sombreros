'use client';
import { fmtFechaHora } from '@/lib/formato';
import { permisos } from '@/lib/permisos';
import { useEstado } from '@/lib/store';

export default function Auditoria() {
  const e = useEstado();
  const p = permisos(e);
  if (!p.verAuditoria) {
    return (
      <div className="card card-pad pila" style={{ maxWidth: 600 }}>
        <h2>Auditoría solo para el SuperAdmin</h2>
        <p className="muted">La tabla logs_auditoria solo la lee el SuperAdmin con MFA, y nadie puede modificarla ni borrarla.</p>
      </div>
    );
  }
  return (
    <>
      <div>
        <h1>Auditoría</h1>
        <p className="muted">Registro inmutable de acciones sensibles (ventas, anulaciones, precios, cajas, transferencias, producción)</p>
      </div>
      <div className="card">
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead>
            <tbody>
              {e.auditoria.map((a) => (
                <tr key={a.id}>
                  <td className="num">{fmtFechaHora(a.fecha)}</td>
                  <td>{a.usuario}</td>
                  <td>{a.accion}</td>
                  <td>{a.detalle}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
