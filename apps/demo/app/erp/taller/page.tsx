'use client';
import Link from 'next/link';
import { useState } from 'react';
import { fmtBs, fmtFecha } from '@/lib/formato';
import { permisos } from '@/lib/permisos';
import { ETAPAS } from '@/lib/semilla';
import { costoReceta, crearOrden, moverOrden, useEstado } from '@/lib/store';
import type { EtapaProduccion, OrdenTrabajo } from '@/lib/tipos';

const ORDEN: EtapaProduccion[] = ETAPAS.map((x) => x.id);

export default function Taller() {
  const e = useEstado();
  const p = permisos(e);
  const [error, setError] = useState('');
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<EtapaProduccion | null>(null);
  const [qa, setQa] = useState<{ orden: OrdenTrabajo; aprobadas: string } | null>(null);
  const [modeloCalc, setModeloCalc] = useState(e.modelos[0].codigo);
  const [cantCalc, setCantCalc] = useState('10');
  const [nueva, setNueva] = useState({ sku: '', cantidad: '10', responsable: 'Don Félix' });

  if (!p.verTaller) {
    return (
      <div className="card card-pad pila" style={{ maxWidth: 600 }}>
        <h2>Taller no disponible para este rol</h2>
        <p className="muted">La producción la gestionan el SuperAdmin y Almacén y Taller.</p>
        <Link className="btn" style={{ justifySelf: 'start' }} href="/erp/stock">Ver stock</Link>
      </div>
    );
  }

  const mover = (o: OrdenTrabajo, dir: 1 | -1) => {
    const destino = ORDEN[ORDEN.indexOf(o.etapa) + dir];
    if (destino === 'en_stock') {
      setQa({ orden: o, aprobadas: String(o.cantidad) });
      return;
    }
    setError(moverOrden(o.id, dir));
  };

  const soltar = (etapa: EtapaProduccion) => {
    const o = e.ordenes.find((x) => x.id === arrastrando);
    setSobre(null);
    setArrastrando(null);
    if (!o) return;
    const dif = ORDEN.indexOf(etapa) - ORDEN.indexOf(o.etapa);
    if (dif === 1 || dif === -1) mover(o, dif);
    else if (dif !== 0) setError('Solo se puede mover una etapa adelante o atrás (retrabajo).');
  };

  const calc = costoReceta(e, modeloCalc);
  const nCalc = Number(cantCalc) || 1;
  const precioModelo = e.modelos.find((m) => m.codigo === modeloCalc)!.precio;
  const hoy = new Date().toISOString().slice(0, 10);
  const nombreModelo = (sku: string) => e.modelos.find((m) => m.codigo === sku.split('-')[0])!.nombre;

  return (
    <>
      <div className="fila entre">
        <div>
          <h1>Taller de producción</h1>
          <p className="muted">Arrastra las órdenes entre etapas. Al salir de Preparación se descuentan materias primas según la receta.</p>
        </div>
      </div>
      {error && <div className="aviso-banda" style={{ background: 'var(--critico-fondo)', color: 'var(--critico)' }} onClick={() => setError('')}>✕ {error}</div>}

      <div className="kanban">
        {ETAPAS.map((col) => {
          const ordenes = e.ordenes.filter((o) => o.etapa === col.id).sort((a, b) => a.prioridad - b.prioridad);
          return (
            <section key={col.id} className={`kanban-col ${sobre === col.id ? 'sobre' : ''}`}
              onDragOver={(ev) => { ev.preventDefault(); setSobre(col.id); }} onDragLeave={() => setSobre(null)} onDrop={() => soltar(col.id)}>
              <div className="fila entre"><h3>{col.nombre}</h3><span className="badge">{ordenes.length}</span></div>
              {ordenes.map((o) => {
                const atrasada = o.etapa !== 'en_stock' && o.compromiso < hoy;
                return (
                  <article key={o.id} className="tarjeta-ot" draggable={o.etapa !== 'en_stock'} onDragStart={() => setArrastrando(o.id)}>
                    <div className="fila entre"><span className="num tenue">{o.codigo}</span>{o.prioridad === 1 && <span className="badge badge-critico">Urgente</span>}</div>
                    <strong>{nombreModelo(o.sku)}</strong>
                    <span className="num tenue">{o.sku}</span>
                    <div className="fila entre">
                      <span className="num">{o.etapa === 'en_stock' ? `${o.aprobadas}/${o.cantidad} aprobadas` : `${o.cantidad} u.`}</span>
                      <span className={atrasada ? 'badge badge-aviso' : 'tenue'}>{atrasada ? 'Atrasada · ' : ''}{fmtFecha(o.compromiso)}</span>
                    </div>
                    <div className="fila entre">
                      <span className="tenue">{o.responsable}</span>
                      {o.materialesConsumidos && o.etapa !== 'en_stock' && <span className="badge badge-info">MP consumida</span>}
                      {o.costoUnitario !== undefined && p.verCostos && <span className="badge badge-bien num">{fmtBs(o.costoUnitario)}/u</span>}
                    </div>
                    {o.etapa !== 'en_stock' && (
                      <div className="fila entre">
                        <button className="btn btn-chico" disabled={o.etapa === 'preparacion'} onClick={() => mover(o, -1)} aria-label="Etapa anterior">←</button>
                        <button className="btn btn-chico" onClick={() => mover(o, 1)}>Avanzar →</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-cabecera"><h2>Calculadora de costos (BOM)</h2></div>
          <div className="card-pad pila">
            <div className="fila" style={{ flexWrap: 'nowrap' }}>
              <select value={modeloCalc} onChange={(ev) => setModeloCalc(ev.target.value)} aria-label="Modelo">
                {e.modelos.map((m) => <option key={m.codigo} value={m.codigo}>{m.nombre}</option>)}
              </select>
              <input className="num" style={{ width: 90 }} value={cantCalc} onChange={(ev) => setCantCalc(ev.target.value.replace(/\D/g, ''))} aria-label="Cantidad" />
              <span className="tenue">unidades</span>
            </div>
            {calc && (
              <table className="tabla">
                <thead><tr><th>Insumo</th><th className="der">Cantidad</th><th className="der">Costo u.</th><th className="der">Subtotal</th></tr></thead>
                <tbody>
                  {calc.lineas.map((l) => (
                    <tr key={l.mp.codigo}>
                      <td>{l.mp.nombre}{!l.mp.consumible && <span className="tenue"> (herramienta)</span>}</td>
                      <td className="der num">{l.mp.consumible ? `${(l.cantidad * nCalc).toFixed(2)} ${l.mp.unidad}` : 'reutilizable'}</td>
                      <td className="der num">{fmtBs(l.mp.costo)}</td>
                      <td className="der num">{fmtBs(l.subtotal * nCalc)}</td>
                    </tr>
                  ))}
                  <tr><td colSpan={3}>Mano de obra</td><td className="der num">{fmtBs(calc.receta.manoObra * nCalc)}</td></tr>
                  <tr><td colSpan={3}>Costos indirectos</td><td className="der num">{fmtBs(calc.receta.indirecto * nCalc)}</td></tr>
                  <tr><td colSpan={3}><b>Costo total ({nCalc} u.) · merma {calc.receta.mermaPct}% incluida</b></td><td className="der num"><b>{fmtBs(calc.total * nCalc)}</b></td></tr>
                  <tr><td colSpan={3}>Costo unitario vs. precio {fmtBs(precioModelo)}</td><td className="der num">{fmtBs(calc.total)} · margen {(((precioModelo - calc.total) / precioModelo) * 100).toFixed(1)}%</td></tr>
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="pila" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-cabecera"><h2>Materias primas</h2></div>
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead><tr><th>Insumo</th><th className="der">Stock</th><th className="der">Mínimo</th><th className="der">Costo prom.</th></tr></thead>
                <tbody>
                  {e.materias.map((m) => (
                    <tr key={m.codigo}>
                      <td>{m.nombre}<div className="tenue">{m.codigo} · {m.categoria}</div></td>
                      <td className="der">{m.consumible && m.stock <= m.minimo ? <span className="badge badge-aviso num">! {m.stock} {m.unidad}</span> : <span className="num">{m.stock} {m.unidad}</span>}</td>
                      <td className="der num">{m.minimo}</td>
                      <td className="der num">{fmtBs(m.costo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-cabecera"><h2>Nueva orden de trabajo</h2></div>
            <div className="card-pad pila">
              <label>Variante (SKU)
                <input list="skus-ot" value={nueva.sku} onChange={(ev) => setNueva({ ...nueva, sku: ev.target.value.toUpperCase() })} placeholder="FED01-57-NEG-OVI" />
                <datalist id="skus-ot">{e.variantes.map((v) => <option key={v.sku} value={v.sku} />)}</datalist>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label>Cantidad<input className="num" value={nueva.cantidad} onChange={(ev) => setNueva({ ...nueva, cantidad: ev.target.value.replace(/\D/g, '') })} /></label>
                <label>Responsable
                  <select value={nueva.responsable} onChange={(ev) => setNueva({ ...nueva, responsable: ev.target.value })}>
                    <option>Don Félix</option><option>Doña Marta</option><option>Juan C.</option>
                  </select>
                </label>
              </div>
              <button className="btn btn-primario" style={{ justifySelf: 'start' }}
                disabled={!e.variantes.some((v) => v.sku === nueva.sku) || !Number(nueva.cantidad)}
                onClick={() => {
                  crearOrden(nueva.sku, Number(nueva.cantidad), nueva.responsable, new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
                  setNueva({ ...nueva, sku: '' });
                }}>
                Crear orden
              </button>
            </div>
          </div>
        </div>
      </div>

      {qa && (
        <div className="modal-fondo" onClick={() => setQa(null)}>
          <div className="card modal" onClick={(ev) => ev.stopPropagation()}>
            <div className="card-cabecera"><h2>Cierre de control de calidad</h2></div>
            <div className="card-pad pila">
              <p className="muted">{qa.orden.codigo} · {qa.orden.cantidad} unidades. Las aprobadas ingresan al stock del taller; el costo real se reparte entre ellas.</p>
              <label>Unidades aprobadas por QA
                <input className="num" value={qa.aprobadas} onChange={(ev) => setQa({ ...qa, aprobadas: ev.target.value.replace(/\D/g, '') })} />
              </label>
              <div className="fila">
                <button className="btn btn-primario" disabled={!Number(qa.aprobadas) || Number(qa.aprobadas) > qa.orden.cantidad}
                  onClick={() => { setError(moverOrden(qa.orden.id, 1, Number(qa.aprobadas))); setQa(null); }}>
                  Ingresar a stock
                </button>
                <button className="btn" onClick={() => setQa(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
