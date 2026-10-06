'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { InsigniaTransferencia, Sucursal } from '@/components/Insignias';
import { fmtFechaHora } from '@/lib/formato';
import { permisos } from '@/lib/permisos';
import { avanzarTransferencia, crearTransferencia, useEstado } from '@/lib/store';
import type { CodigoSucursal } from '@/lib/tipos';

const PASOS = ['solicitada', 'aprobada', 'despachada', 'recibida'] as const;

function Transferencias() {
  const e = useEstado();
  const p = permisos(e);
  const params = useSearchParams();
  const skuInicial = params.get('sku') ?? '';

  const visibles = e.transferencias.filter((t) => p.rol !== 'gerente' || t.origen === p.sucursal || t.destino === p.sucursal);
  const [selId, setSelId] = useState<string | null>(skuInicial ? null : visibles[0]?.id ?? null);
  const [nueva, setNueva] = useState(Boolean(skuInicial));
  const [origen, setOrigen] = useState<CodigoSucursal>('TAL');
  const [destino, setDestino] = useState<CodigoSucursal>(p.rol === 'gerente' ? p.sucursal : 'LPZ');
  const [items, setItems] = useState<{ sku: string; solicitada: number }[]>(skuInicial ? [{ sku: skuInicial, solicitada: 3 }] : []);
  const [skuNuevo, setSkuNuevo] = useState('');
  const [cant, setCant] = useState('1');
  const [recibidas, setRecibidas] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const t = visibles.find((x) => x.id === selId);
  const puedeDespachar = (o: CodigoSucursal) => p.rol === 'superadmin' || p.rol === 'almacen' || (p.rol === 'gerente' && o === p.sucursal);
  const puedeRecibir = (d: CodigoSucursal) => p.rol === 'superadmin' || (p.rol === 'gerente' && d === p.sucursal) || (p.rol === 'almacen' && d === 'TAL');

  const accion = (a: 'aprobar' | 'despachar' | 'recibir' | 'cancelar') => {
    if (!t) return;
    const rec = Object.fromEntries(Object.entries(recibidas).map(([k, v]) => [k, Number(v)]));
    const err = avanzarTransferencia(t.id, a, p.usuario, a === 'recibir' ? rec : undefined);
    setError(err);
    setRecibidas({});
  };

  const agregarItem = () => {
    const sku = skuNuevo.trim().toUpperCase();
    if (!e.variantes.some((v) => v.sku === sku) || !Number(cant)) {
      setError('SKU inexistente o cantidad inválida');
      return;
    }
    setItems([...items.filter((i) => i.sku !== sku), { sku, solicitada: Number(cant) }]);
    setSkuNuevo('');
    setError('');
  };

  const enviar = () => {
    crearTransferencia(origen, destino, items, p.usuario);
    setItems([]);
    setNueva(false);
    setSelId(null);
  };

  const indicePaso = (estado: string) => (estado === 'recibida_con_diferencias' ? 3 : PASOS.indexOf(estado as (typeof PASOS)[number]));

  return (
    <>
      <div className="fila entre">
        <div>
          <h1>Transferencias intersucursales</h1>
          <p className="muted">Solicitud → aprobación → despacho → recepción con validación de faltantes</p>
        </div>
        <button className="btn btn-primario" onClick={() => { setNueva(true); setSelId(null); }}>+ Nueva solicitud</button>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(300px, 1fr) minmax(0, 1.4fr)', alignItems: 'start' }}>
        <div className="card">
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead><tr><th>Código</th><th>Ruta</th><th>Estado</th></tr></thead>
              <tbody>
                {visibles.map((x) => (
                  <tr key={x.id} onClick={() => { setSelId(x.id); setNueva(false); setError(''); }}
                    style={{ cursor: 'pointer', background: x.id === selId ? 'var(--acento-suave)' : undefined }}>
                    <td className="num">{x.codigo}</td>
                    <td><span className="fila" style={{ gap: 6 }}><Sucursal codigo={x.origen} /> → <Sucursal codigo={x.destino} /></span></td>
                    <td><InsigniaTransferencia estado={x.estado} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {nueva && (
          <div className="card">
            <div className="card-cabecera"><h2>Nueva solicitud de transferencia</h2></div>
            <div className="card-pad pila">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label>Origen
                  <select value={origen} onChange={(ev) => setOrigen(ev.target.value as CodigoSucursal)}>
                    {(['TAL', 'LPZ', 'CBB', 'SCZ'] as CodigoSucursal[]).filter((s) => s !== destino).map((s) => <option key={s}>{s}</option>)}
                  </select>
                </label>
                <label>Destino
                  <select value={destino} disabled={p.rol === 'gerente'} onChange={(ev) => setDestino(ev.target.value as CodigoSucursal)}>
                    {(['LPZ', 'CBB', 'SCZ', 'TAL'] as CodigoSucursal[]).map((s) => <option key={s}>{s}</option>)}
                  </select>
                </label>
              </div>
              {p.rol === 'gerente' && <p className="tenue">Como gerente solo puedes solicitar mercadería hacia tu sucursal ({p.sucursal}).</p>}
              <div className="fila" style={{ flexWrap: 'nowrap' }}>
                <input placeholder="SKU (ej. FED01-57-NEG-OVI)" value={skuNuevo} onChange={(ev) => setSkuNuevo(ev.target.value)} list="skus" />
                <datalist id="skus">{e.variantes.slice(0, 400).map((v) => <option key={v.sku} value={v.sku} />)}</datalist>
                <input className="num" style={{ width: 80 }} value={cant} onChange={(ev) => setCant(ev.target.value.replace(/\D/g, ''))} aria-label="Cantidad" />
                <button className="btn" onClick={agregarItem}>Agregar</button>
              </div>
              {items.length > 0 && (
                <table className="tabla">
                  <thead><tr><th>SKU</th><th className="der">Cantidad</th><th className="der">Stock en origen</th><th /></tr></thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.sku}>
                        <td className="num">{i.sku}</td>
                        <td className="der num">{i.solicitada}</td>
                        <td className="der num" style={{ color: e.stock[i.sku][origen] < i.solicitada ? 'var(--critico)' : undefined }}>{e.stock[i.sku][origen]}</td>
                        <td><button className="btn btn-chico" onClick={() => setItems(items.filter((x) => x.sku !== i.sku))}>Quitar</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {error && <span className="badge badge-critico">{error}</span>}
              <div className="fila">
                <button className="btn btn-primario" disabled={!items.length || origen === destino} onClick={enviar}>Enviar solicitud</button>
                <button className="btn" onClick={() => setNueva(false)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}

        {!nueva && t && (
          <div className="card">
            <div className="card-cabecera">
              <div>
                <h2 className="num">{t.codigo}</h2>
                <p className="tenue">{t.origen} → {t.destino}</p>
              </div>
              <InsigniaTransferencia estado={t.estado} />
            </div>
            <div className="card-pad pila" style={{ gap: 16 }}>
              {t.estado !== 'cancelada' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }} aria-label="Progreso">
                  {PASOS.map((paso, i) => (
                    <div key={paso} className="pila" style={{ gap: 4 }}>
                      <div style={{ height: 6, borderRadius: 3, background: i <= indicePaso(t.estado) ? 'var(--acento)' : 'var(--grid)' }} />
                      <span className="tenue" style={{ textTransform: 'capitalize' }}>{paso}</span>
                    </div>
                  ))}
                </div>
              )}

              <table className="tabla">
                <thead><tr><th>SKU</th><th className="der">Solicitada</th><th className="der">Despachada</th><th className="der">Recibida</th><th className="der">Diferencia</th></tr></thead>
                <tbody>
                  {t.items.map((i) => {
                    const dif = i.recibida !== undefined && i.despachada !== undefined ? i.recibida - i.despachada : null;
                    return (
                      <tr key={i.sku}>
                        <td className="num">{i.sku}</td>
                        <td className="der num">{i.solicitada}</td>
                        <td className="der num">{i.despachada ?? '—'}</td>
                        <td className="der">
                          {t.estado === 'despachada' && puedeRecibir(t.destino) ? (
                            <input className="num" style={{ width: 70, height: 28, textAlign: 'right' }} placeholder={String(i.despachada)}
                              value={recibidas[i.sku] ?? ''} onChange={(ev) => setRecibidas({ ...recibidas, [i.sku]: ev.target.value.replace(/\D/g, '') })} />
                          ) : <span className="num">{i.recibida ?? '—'}</span>}
                        </td>
                        <td className="der">{dif === null ? '—' : dif === 0 ? <span className="badge badge-bien">0</span> : <span className="badge badge-critico">{dif > 0 ? `+${dif}` : dif} {dif < 0 ? 'faltante' : 'sobrante'}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {error && <span className="badge badge-critico">{error}</span>}
              <div className="fila">
                {t.estado === 'solicitada' && puedeDespachar(t.origen) && <button className="btn btn-primario" onClick={() => accion('aprobar')}>Aprobar</button>}
                {t.estado === 'aprobada' && puedeDespachar(t.origen) && <button className="btn btn-primario" onClick={() => accion('despachar')}>Despachar (descuenta {t.origen})</button>}
                {t.estado === 'despachada' && puedeRecibir(t.destino) && <button className="btn btn-primario" onClick={() => accion('recibir')}>Confirmar recepción en {t.destino}</button>}
                {(t.estado === 'solicitada' || t.estado === 'aprobada') && <button className="btn btn-peligro" onClick={() => accion('cancelar')}>Cancelar</button>}
                {t.estado === 'despachada' && !puedeRecibir(t.destino) && <span className="tenue">Esperando la recepción de {t.destino}.</span>}
                {t.estado === 'solicitada' && !puedeDespachar(t.origen) && <span className="tenue">Esperando la aprobación de {t.origen === 'TAL' ? 'Almacén y Taller' : `Gerente ${t.origen}`}.</span>}
              </div>
              {t.estado === 'despachada' && puedeRecibir(t.destino) && <p className="tenue">Deja vacía la cantidad si llegó lo despachado; si falta algo, escribe lo recibido y se generará una alerta.</p>}

              <div className="pila" style={{ gap: 6, borderTop: '1px solid var(--borde)', paddingTop: 12 }}>
                <h3>Historial</h3>
                {t.historial.map((h, i) => (
                  <div key={i} className="fila" style={{ gap: 10 }}>
                    <span className="tenue num" style={{ width: 90 }}>{fmtFechaHora(h.fecha)}</span>
                    <span>{h.texto}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function Pagina() {
  return <Suspense><Transferencias /></Suspense>;
}
