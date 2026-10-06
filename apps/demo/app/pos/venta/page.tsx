'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { fmtBs } from '@/lib/formato';
import { registrarVenta, useEstado } from '@/lib/store';
import type { LineaVenta, MetodoPago } from '@/lib/tipos';

const PIN_GERENTE = '9999';
const MAX_DESC_PCT = 5;
type TipoDoc = 'CI' | 'NIT' | 'CEX' | 'PAS';

export default function Terminal() {
  const e = useEstado();
  const router = useRouter();
  const s = e.sesion;
  const [modelo, setModelo] = useState(e.modelos[0].codigo);
  const [horma, setHorma] = useState('OVI');
  const [busqueda, setBusqueda] = useState('');
  const [carrito, setCarrito] = useState<LineaVenta[]>([]);
  const [descuento, setDescuento] = useState('');
  const [pinGerente, setPinGerente] = useState('');
  const [tipoDoc, setTipoDoc] = useState<TipoDoc>('CI');
  const [documento, setDocumento] = useState('');
  const [razon, setRazon] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [recibido, setRecibido] = useState('');
  const [referencia, setReferencia] = useState('');
  const [aviso, setAviso] = useState('');

  const m = e.modelos.find((x) => x.codigo === modelo)!;
  const variantesPorCelda = useMemo(() => {
    const mapa = new Map<string, (typeof e.variantes)[number]>();
    for (const v of e.variantes) if (v.modelo === modelo && v.horma === horma) mapa.set(`${v.color}|${v.talla}`, v);
    return mapa;
  }, [e.variantes, modelo, horma]);

  const resultados = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    if (q.length < 2) return [];
    return e.variantes
      .filter((v) => v.sku.includes(q) || e.modelos.find((x) => x.codigo === v.modelo)!.nombre.toUpperCase().includes(q))
      .slice(0, 8);
  }, [busqueda, e.variantes, e.modelos]);

  if (!s) return null;

  const stockDe = (sku: string) => e.stock[sku][s.sucursal];
  const enCarrito = (sku: string) => carrito.find((l) => l.sku === sku)?.cantidad ?? 0;

  const agregar = (sku: string) => {
    const v = e.variantes.find((x) => x.sku === sku);
    if (!v) return;
    const nombre = e.modelos.find((x) => x.codigo === v.modelo)!.nombre;
    if (stockDe(sku) - enCarrito(sku) <= 0) setAviso(`Sin stock registrado de ${sku}: se venderá y quedará en alerta de stock negativo.`);
    setCarrito((c) => {
      const ex = c.find((l) => l.sku === sku);
      if (ex) return c.map((l) => (l.sku === sku ? { ...l, cantidad: l.cantidad + 1 } : l));
      return [...c, { sku, descripcion: `${nombre} T${v.talla} ${e.colores[v.color].nombre} ${v.horma}`, cantidad: 1, precio: v.precio }];
    });
  };
  const cambiarCantidad = (sku: string, d: number) =>
    setCarrito((c) => c.map((l) => (l.sku === sku ? { ...l, cantidad: l.cantidad + d } : l)).filter((l) => l.cantidad > 0));

  const subtotal = carrito.reduce((a, l) => a + l.cantidad * l.precio, 0);
  const desc = Math.min(Number(descuento) || 0, subtotal);
  const total = subtotal - desc;
  const requiereGerente = subtotal > 0 && desc > (subtotal * MAX_DESC_PCT) / 100;
  const gerenteOk = !requiereGerente || pinGerente === PIN_GERENTE;
  const cambio = metodo === 'efectivo' ? (Number(recibido) || 0) - total : 0;
  const pagoOk = metodo !== 'efectivo' || (Number(recibido) || 0) >= total;
  const clienteOk = documento.trim() !== '' && razon.trim() !== '';
  const puedeCobrar = carrito.length > 0 && gerenteOk && pagoOk && clienteOk;

  const buscarCliente = (doc: string) => {
    setDocumento(doc);
    const c = e.clientes.find((x) => x.documento === doc.trim());
    if (c) {
      setTipoDoc(c.tipoDocumento);
      setRazon(c.razonSocial);
    }
  };
  const clienteExistente = e.clientes.find((x) => x.documento === documento.trim());

  const cobrar = () => {
    const id = registrarVenta({
      lineas: carrito,
      descuento: desc,
      cliente: { tipoDocumento: tipoDoc, documento: documento.trim(), razonSocial: razon.trim().toUpperCase() },
      pagos: [{ metodo, monto: total, recibido: metodo === 'efectivo' ? Number(recibido) : undefined }],
    });
    router.push(`/pos/ticket?id=${id}`);
  };

  const alEnter = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key !== 'Enter') return;
    const exacto = e.variantes.find((v) => v.sku === busqueda.trim().toUpperCase());
    if (exacto) {
      agregar(exacto.sku);
      setBusqueda('');
    } else if (resultados[0]) {
      agregar(resultados[0].sku);
      setBusqueda('');
    }
  };

  return (
    <div className="terminal">
      {/* ------------------------------------------------ Catálogo */}
      <section className="pila">
        <div className="card card-pad pila" style={{ position: 'relative' }}>
          <input
            autoFocus
            placeholder="Escanea el código de barras o busca por SKU / modelo (Enter agrega)"
            value={busqueda}
            onChange={(ev) => setBusqueda(ev.target.value)}
            onKeyDown={alEnter}
            style={{ height: 44, fontSize: 15 }}
          />
          {resultados.length > 0 && (
            <div className="card" style={{ position: 'absolute', left: 18, right: 18, top: 64, zIndex: 4, padding: 4 }}>
              {resultados.map((v) => (
                <button key={v.sku} className="btn" style={{ width: '100%', justifyContent: 'space-between', border: 'none' }}
                  onClick={() => { agregar(v.sku); setBusqueda(''); }}>
                  <span className="num">{v.sku}</span>
                  <span className="muted">stock {stockDe(v.sku)} · {fmtBs(v.precio)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="fila">
            {e.modelos.map((x) => (
              <button key={x.codigo} className={`btn ${x.codigo === modelo ? 'btn-activo' : ''}`} onClick={() => setModelo(x.codigo)}>
                {x.nombre}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-cabecera">
            <div>
              <h2>{m.nombre}</h2>
              <p className="tenue">{m.categoria} · {m.material} · desde {fmtBs(m.precio)} (T60 +Bs 20)</p>
            </div>
            <div className="fila" role="group" aria-label="Tipo de horma">
              <span className="tenue">Horma</span>
              {e.hormas.map((h) => (
                <button key={h.codigo} className={`btn btn-chico ${h.codigo === horma ? 'btn-activo' : ''}`} onClick={() => setHorma(h.codigo)}>
                  {h.nombre}
                </button>
              ))}
            </div>
          </div>
          <div className="card-pad tabla-envoltura">
            <table className="matriz">
              <thead>
                <tr>
                  <th />
                  {e.tallas.map((t) => <th key={t}>Talla {t}</th>)}
                </tr>
              </thead>
              <tbody>
                {m.colores.map((c) => (
                  <tr key={c}>
                    <th style={{ textAlign: 'left' }}>
                      <span className="fila" style={{ gap: 6 }}>
                        <span className="punto" style={{ background: e.colores[c].hex, width: 12, height: 12, border: '1px solid var(--borde-fuerte)' }} />
                        {e.colores[c].nombre}
                      </span>
                    </th>
                    {e.tallas.map((t) => {
                      const v = variantesPorCelda.get(`${c}|${t}`);
                      if (!v) return <td key={t} />;
                      const disp = stockDe(v.sku) - enCarrito(v.sku);
                      return (
                        <td key={t}>
                          <button className="celda" onClick={() => agregar(v.sku)} title={v.sku}>
                            <span className="num" style={{ fontWeight: 600 }}>{disp}</span>
                            <span className="stk">en stock</span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="tenue" style={{ marginTop: 8 }}>Toca una celda para agregar al carrito. Stock de {s.sucursal}.</p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Carrito y cobro */}
      <aside className="card" style={{ position: 'sticky', top: 12 }}>
        <div className="card-cabecera">
          <h2>Venta #{e.contadores[s.sucursal].venta + 1}</h2>
          {carrito.length > 0 && <button className="btn btn-chico" onClick={() => setCarrito([])}>Vaciar</button>}
        </div>
        <div className="card-pad pila" style={{ gap: 14 }}>
          {aviso && <div className="aviso-banda" style={{ background: 'var(--aviso-fondo)', color: 'var(--aviso)' }} onClick={() => setAviso('')}>⚠ {aviso}</div>}
          {carrito.length === 0 ? (
            <p className="muted" style={{ padding: '18px 0', textAlign: 'center' }}>Carrito vacío</p>
          ) : (
            <div className="pila" style={{ gap: 8 }}>
              {carrito.map((l) => (
                <div key={l.sku} className="fila entre" style={{ flexWrap: 'nowrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 550 }}>{l.descripcion}</div>
                    <div className="tenue num">{l.sku} · {fmtBs(l.precio)}</div>
                  </div>
                  <div className="fila" style={{ flexWrap: 'nowrap', gap: 6 }}>
                    <button className="btn btn-chico" onClick={() => cambiarCantidad(l.sku, -1)} aria-label="Quitar uno">−</button>
                    <span className="num" style={{ minWidth: 18, textAlign: 'center' }}>{l.cantidad}</span>
                    <button className="btn btn-chico" onClick={() => cambiarCantidad(l.sku, 1)} aria-label="Agregar uno">+</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pila" style={{ gap: 6, borderTop: '1px solid var(--borde)', paddingTop: 12 }}>
            <div className="fila entre"><span className="muted">Subtotal</span><span className="num">{fmtBs(subtotal)}</span></div>
            <div className="fila entre">
              <span className="muted">Descuento (Bs)</span>
              <input className="num" style={{ width: 110, height: 30, textAlign: 'right' }} inputMode="decimal" value={descuento}
                onChange={(ev) => setDescuento(ev.target.value.replace(/[^\d.]/g, ''))} placeholder="0" />
            </div>
            {requiereGerente && (
              <div className="aviso-banda" style={{ background: gerenteOk ? 'var(--bien-fondo)' : 'var(--aviso-fondo)', color: gerenteOk ? 'var(--bien)' : 'var(--aviso)', display: 'grid' }}>
                <span>Descuento mayor al {MAX_DESC_PCT}%: requiere autorización del gerente.</span>
                {!gerenteOk && (
                  <input type="password" inputMode="numeric" placeholder="PIN del gerente (demo 9999)" value={pinGerente}
                    onChange={(ev) => setPinGerente(ev.target.value)} style={{ height: 30 }} />
                )}
                {gerenteOk && <span>✓ Autorizado por Gerente {s.sucursal}</span>}
              </div>
            )}
            <div className="fila entre" style={{ fontSize: 20, fontWeight: 700 }}><span>Total</span><span className="num">{fmtBs(total)}</span></div>
          </div>

          <div className="pila" style={{ gap: 8, borderTop: '1px solid var(--borde)', paddingTop: 12 }}>
            <h3>Datos de facturación</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8 }}>
              <select value={tipoDoc} onChange={(ev) => setTipoDoc(ev.target.value as TipoDoc)} aria-label="Tipo de documento">
                <option>CI</option><option>NIT</option><option>CEX</option><option>PAS</option>
              </select>
              <input placeholder="Número de NIT / CI" value={documento} onChange={(ev) => buscarCliente(ev.target.value)} inputMode="numeric" />
            </div>
            <input placeholder="Razón social / nombre" value={razon} onChange={(ev) => setRazon(ev.target.value)} />
            <div className="fila entre">
              <span className="tenue">
                {clienteExistente ? `Cliente registrado · ${clienteExistente.puntos} puntos` : documento ? 'Cliente nuevo: se registrará' : ''}
              </span>
              <button className="btn btn-chico" onClick={() => { setTipoDoc('CI'); setDocumento('0'); setRazon('S/N'); }}>Sin nombre (S/N)</button>
            </div>
          </div>

          <div className="pila" style={{ gap: 8, borderTop: '1px solid var(--borde)', paddingTop: 12 }}>
            <h3>Forma de pago</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {([['efectivo', 'Efectivo'], ['qr', 'QR Simple'], ['tarjeta', 'Tarjeta']] as const).map(([k, t]) => (
                <button key={k} className={`btn ${metodo === k ? 'btn-activo' : ''}`} onClick={() => setMetodo(k)}>{t}</button>
              ))}
            </div>
            {metodo === 'efectivo' && (
              <div className="fila entre">
                <input className="num" style={{ width: 150 }} placeholder="Recibido (Bs)" inputMode="decimal" value={recibido}
                  onChange={(ev) => setRecibido(ev.target.value.replace(/[^\d.]/g, ''))} />
                <span className="num" style={{ fontWeight: 600 }}>Cambio: {fmtBs(Math.max(0, cambio))}</span>
              </div>
            )}
            {metodo === 'qr' && <input placeholder="Nro. de transacción QR (opcional)" value={referencia} onChange={(ev) => setReferencia(ev.target.value)} />}
            {metodo === 'tarjeta' && <input placeholder="Nro. de voucher POS (opcional)" value={referencia} onChange={(ev) => setReferencia(ev.target.value)} />}
          </div>

          <button className="btn btn-primario btn-grande" disabled={!puedeCobrar} onClick={cobrar}>
            Cobrar {fmtBs(total)}
          </button>
          {!e.online && <p className="tenue" style={{ textAlign: 'center' }}>Sin conexión: la factura se emitirá en contingencia.</p>}
        </div>
      </aside>
    </div>
  );
}
