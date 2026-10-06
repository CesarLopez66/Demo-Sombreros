'use client';
import Link from 'next/link';
import { useState } from 'react';
import { COLOR_SUCURSAL } from '@/components/Insignias';
import { fmtN } from '@/lib/formato';
import { permisos } from '@/lib/permisos';
import { useEstado } from '@/lib/store';

export default function Stock() {
  const e = useEstado();
  const p = permisos(e);
  const [modelo, setModelo] = useState('');
  const [soloAlertas, setSoloAlertas] = useState(false);
  const [q, setQ] = useState('');
  const cols = p.sucursales;

  const filas = e.variantes
    .filter((v) => !modelo || v.modelo === modelo)
    .filter((v) => !q || v.sku.includes(q.toUpperCase()))
    .map((v) => {
      const porSuc = cols.map((s) => e.stock[v.sku][s]);
      const alerta = cols.some((s) => s !== 'TAL' && e.stock[v.sku][s] <= e.minimo);
      return { v, porSuc, total: porSuc.reduce((a, b) => a + b, 0), alerta };
    })
    .filter((f) => !soloAlertas || f.alerta);

  const resumen = cols.map((s) => ({
    s,
    unidades: e.variantes.reduce((a, v) => a + e.stock[v.sku][s], 0),
    bajo: s === 'TAL' ? 0 : e.variantes.filter((v) => e.stock[v.sku][s] <= e.minimo).length,
    negativo: e.variantes.filter((v) => e.stock[v.sku][s] < 0).length,
  }));

  const celda = (n: number, s: string) => {
    if (n < 0) return <span className="badge badge-critico num">✕ {n}</span>;
    if (s !== 'TAL' && n <= e.minimo) return <span className="badge badge-aviso num">! {n}</span>;
    return <span className="num">{n}</span>;
  };

  return (
    <>
      <div>
        <h1>Consola de stock multisucursal</h1>
        <p className="muted">Comparativo por variante · mínimo por tienda: {e.minimo} unidades{p.rol === 'gerente' ? ` · tu rol solo ve ${p.sucursal}` : ''}</p>
      </div>

      <div className="grid-kpi">
        {resumen.map((r) => (
          <div key={r.s} className="card card-pad" style={{ borderTop: `3px solid ${COLOR_SUCURSAL[r.s]}` }}>
            <p className="tenue">{e.sucursales.find((x) => x.codigo === r.s)!.nombre}</p>
            <h1 className="num">{fmtN(r.unidades)}</h1>
            <p className="tenue">
              {r.s === 'TAL' ? 'producto terminado en taller' : `${r.bajo} variantes en o bajo el mínimo`}
              {r.negativo > 0 && <span style={{ color: 'var(--critico)' }}> · {r.negativo} negativas</span>}
            </p>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-cabecera">
          <div className="fila">
            <input placeholder="Buscar SKU…" value={q} onChange={(ev) => setQ(ev.target.value)} style={{ width: 200, height: 32 }} />
            <select value={modelo} onChange={(ev) => setModelo(ev.target.value)} style={{ width: 200, height: 32 }} aria-label="Modelo">
              <option value="">Todos los modelos</option>
              {e.modelos.map((m) => <option key={m.codigo} value={m.codigo}>{m.nombre}</option>)}
            </select>
            <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={soloAlertas} onChange={(ev) => setSoloAlertas(ev.target.checked)} style={{ width: 16, height: 16 }} />
              Solo con alerta
            </label>
          </div>
          <span className="tenue">{filas.length} variantes</span>
        </div>
        <div className="tabla-envoltura" style={{ maxHeight: 620, overflowY: 'auto' }}>
          <table className="tabla">
            <thead style={{ position: 'sticky', top: 0 }}>
              <tr>
                <th>SKU</th><th>Modelo</th><th>Talla</th><th>Color</th><th>Horma</th>
                {cols.map((s) => <th key={s} className="der"><span className="fila" style={{ gap: 6, justifyContent: 'flex-end' }}><span className="punto" style={{ background: COLOR_SUCURSAL[s] }} />{s}</span></th>)}
                <th className="der">Total</th><th />
              </tr>
            </thead>
            <tbody>
              {filas.map(({ v, porSuc, total, alerta }) => (
                <tr key={v.sku}>
                  <td className="num">{v.sku}</td>
                  <td>{e.modelos.find((m) => m.codigo === v.modelo)!.nombre}</td>
                  <td className="num">{v.talla}</td>
                  <td>{e.colores[v.color].nombre}</td>
                  <td>{v.horma}</td>
                  {porSuc.map((n, i) => <td key={cols[i]} className="der">{celda(n, cols[i])}</td>)}
                  <td className="der num"><b>{total}</b></td>
                  <td>{alerta && (p.rol === 'gerente' || p.rol === 'superadmin' || p.rol === 'almacen') && (
                    <Link className="btn btn-chico" href={`/erp/transferencias?sku=${v.sku}`}>Reponer</Link>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
