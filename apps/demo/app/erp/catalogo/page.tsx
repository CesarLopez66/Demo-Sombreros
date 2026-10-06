'use client';
import { useState } from 'react';
import { fmtBs, fmtN } from '@/lib/formato';
import { permisos } from '@/lib/permisos';
import { setPrecioModelo, useEstado } from '@/lib/store';

export default function Catalogo() {
  const e = useEstado();
  const p = permisos(e);
  const [modelo, setModelo] = useState(e.modelos[0].codigo);
  const [horma, setHorma] = useState('OVI');
  const [precio, setPrecio] = useState('');
  const m = e.modelos.find((x) => x.codigo === modelo)!;
  const variantes = e.variantes.filter((v) => v.modelo === modelo && v.horma === horma);
  const stockTotal = (sku: string) => p.sucursales.reduce((a, s) => a + e.stock[sku][s], 0);

  return (
    <>
      <div className="fila entre">
        <div>
          <h1>Catálogo matricial</h1>
          <p className="muted">Modelo × Talla × Color × Tipo de horma · {fmtN(e.variantes.length)} variantes (SKU)</p>
        </div>
        {p.editarCatalogo && <button className="btn btn-primario" disabled title="Disponible en la Fase 4">+ Nuevo modelo</button>}
      </div>

      <div className="card">
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead><tr><th>Código</th><th>Modelo</th><th>Categoría</th><th>Material</th><th>Colores</th><th className="der">Variantes</th><th className="der">Precio base</th></tr></thead>
            <tbody>
              {e.modelos.map((x) => (
                <tr key={x.codigo} onClick={() => setModelo(x.codigo)} style={{ cursor: 'pointer', background: x.codigo === modelo ? 'var(--acento-suave)' : undefined }}>
                  <td className="num"><b>{x.codigo}</b></td>
                  <td>{x.nombre}</td>
                  <td>{x.categoria}</td>
                  <td>{x.material}</td>
                  <td className="fila" style={{ gap: 4 }}>
                    {x.colores.map((c) => <span key={c} className="punto" title={e.colores[c].nombre} style={{ background: e.colores[c].hex, width: 14, height: 14, border: '1px solid var(--borde-fuerte)' }} />)}
                  </td>
                  <td className="der num">{e.variantes.filter((v) => v.modelo === x.codigo).length}</td>
                  <td className="der num">{fmtBs(x.precio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-cabecera">
          <div>
            <h2>{m.nombre} · matriz de variantes</h2>
            <p className="tenue">Cada celda: SKU, precio{p.verCostos ? ', costo' : ''} y stock total visible para tu rol</p>
          </div>
          <div className="fila">
            {e.hormas.map((h) => (
              <button key={h.codigo} className={`btn btn-chico ${h.codigo === horma ? 'btn-activo' : ''}`} onClick={() => setHorma(h.codigo)}>Horma {h.nombre}</button>
            ))}
          </div>
        </div>
        <div className="card-pad tabla-envoltura">
          <table className="tabla" style={{ minWidth: 760 }}>
            <thead><tr><th>Color \ Talla</th>{e.tallas.map((t) => <th key={t}>{t}</th>)}</tr></thead>
            <tbody>
              {m.colores.map((c) => (
                <tr key={c}>
                  <td><span className="fila" style={{ gap: 6 }}><span className="punto" style={{ background: e.colores[c].hex, width: 12, height: 12, border: '1px solid var(--borde-fuerte)' }} />{e.colores[c].nombre}</span></td>
                  {e.tallas.map((t) => {
                    const v = variantes.find((x) => x.color === c && x.talla === t);
                    if (!v) return <td key={t} />;
                    const st = stockTotal(v.sku);
                    return (
                      <td key={t} style={{ fontSize: 12 }}>
                        <div className="num" style={{ fontWeight: 600 }}>{fmtBs(v.precio)}</div>
                        {p.verCostos && <div className="tenue num">costo {fmtBs(v.costo)}</div>}
                        <div className={st <= e.minimo ? '' : 'tenue'} style={{ color: st <= e.minimo ? 'var(--aviso)' : undefined }}>stock {st}</div>
                        <div className="tenue num" style={{ fontSize: 10.5 }}>{v.sku}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {p.editarCatalogo && (
          <div className="card-pad fila" style={{ borderTop: '1px solid var(--borde)' }}>
            <span className="muted">Precio base de {m.codigo}</span>
            <input className="num" style={{ width: 120 }} placeholder={String(m.precio)} value={precio} inputMode="decimal"
              onChange={(ev) => setPrecio(ev.target.value.replace(/[^\d.]/g, ''))} />
            <button className="btn" disabled={!Number(precio)} onClick={() => { setPrecioModelo(m.codigo, Number(precio), p.usuario); setPrecio(''); }}>
              Actualizar precio
            </button>
            <span className="tenue">La talla 60 suma Bs 20. El cambio queda en la auditoría.</span>
          </div>
        )}
      </div>
    </>
  );
}
