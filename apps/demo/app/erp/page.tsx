'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BarrasH, LineasMulti } from '@/components/Graficos';
import { COLOR_SUCURSAL, Sucursal } from '@/components/Insignias';
import { fmtBs, fmtBsCorto, fmtFecha, fmtFechaHora, fmtN } from '@/lib/formato';
import { permisos } from '@/lib/permisos';
import { useEstado } from '@/lib/store';
import type { VentaHistorica } from '@/lib/tipos';

const PERIODOS = [7, 30, 60] as const;
const NOMBRE_DEPTO: Record<string, string> = { LPZ: 'La Paz', CBB: 'Cochabamba', SCZ: 'Santa Cruz' };

export default function Dashboard() {
  const e = useEstado();
  const p = permisos(e);
  const [dias, setDias] = useState<(typeof PERIODOS)[number]>(30);

  // Histórico + ventas reales de la demo (POS) en una sola serie.
  const datos = useMemo<VentaHistorica[]>(() => {
    const vivos: VentaHistorica[] = e.ventas
      .filter((v) => v.estado === 'completada')
      .flatMap((v) => v.lineas.map((l) => {
        const variante = e.variantes.find((x) => x.sku === l.sku)!;
        const monto = l.cantidad * l.precio;
        return { fecha: v.fecha.slice(0, 10), sucursal: v.sucursal, modelo: variante.modelo, unidades: l.cantidad, monto, costo: variante.costo * l.cantidad };
      }));
    return [...e.historico, ...vivos].filter((d) => p.tiendas.includes(d.sucursal));
  }, [e.historico, e.ventas, e.variantes, p.tiendas]);

  if (!p.verVentas) {
    return (
      <div className="card card-pad pila" style={{ maxWidth: 600 }}>
        <h2>Dashboard de ventas no disponible para este rol</h2>
        <p className="muted">Almacén y Taller gestiona stock global, producción y despachos. Las ventas y márgenes los ven el SuperAdmin y los gerentes.</p>
        <div className="fila"><Link className="btn" href="/erp/stock">Stock multisucursal</Link><Link className="btn" href="/erp/taller">Taller</Link></div>
      </div>
    );
  }

  const fechas = Array.from({ length: dias }, (_, i) => new Date(Date.now() - (dias - 1 - i) * 864e5).toISOString().slice(0, 10));
  const desde = fechas[0];
  const desdePrevio = new Date(Date.now() - (2 * dias - 1) * 864e5).toISOString().slice(0, 10);
  const periodo = datos.filter((d) => d.fecha >= desde);
  const previo = datos.filter((d) => d.fecha >= desdePrevio && d.fecha < desde);
  const suma = (xs: VentaHistorica[], k: 'monto' | 'unidades' | 'costo') => xs.reduce((a, d) => a + d[k], 0);

  const ventas = suma(periodo, 'monto');
  const ventasPrev = suma(previo, 'monto');
  const unidades = suma(periodo, 'unidades');
  const margen = ventas ? ((ventas - suma(periodo, 'costo')) / ventas) * 100 : 0;
  const delta = ventasPrev ? ((ventas - ventasPrev) / ventasPrev) * 100 : 0;

  const series = p.tiendas.map((s) => ({
    id: s,
    nombre: NOMBRE_DEPTO[s],
    color: COLOR_SUCURSAL[s],
    valores: fechas.map((f) => periodo.filter((d) => d.sucursal === s && d.fecha === f).reduce((a, d) => a + d.monto, 0)),
  }));

  const porModelo = e.modelos.map((m) => {
    const xs = periodo.filter((d) => d.modelo === m.codigo);
    const u = suma(xs, 'unidades');
    const monto = suma(xs, 'monto');
    const stock = e.variantes.filter((v) => v.modelo === m.codigo)
      .reduce((a, v) => a + p.sucursales.reduce((b, s) => b + Math.max(0, e.stock[v.sku][s]), 0), 0);
    return { id: m.codigo, nombre: m.nombre, unidades: u, monto, margen: monto ? ((monto - suma(xs, 'costo')) / monto) * 100 : 0, diasInv: u ? Math.round(stock / (u / dias)) : 0 };
  }).sort((a, b) => b.unidades - a.unidades);

  const arqueos = e.arqueos.filter((a) => p.tiendas.includes(a.sucursal)).slice(0, 6);
  const alertas = e.variantes.reduce((a, v) => a + p.tiendas.filter((s) => e.stock[v.sku][s] <= e.minimo).length, 0);

  return (
    <>
      <div className="fila entre">
        <div>
          <h1>Dashboard ejecutivo</h1>
          <p className="muted">{p.rol === 'gerente' ? `Sucursal ${p.sucursal}` : 'Todas las sucursales'} · últimos {dias} días</p>
        </div>
        <div className="fila" role="group" aria-label="Período">
          {PERIODOS.map((d) => (
            <button key={d} className={`btn btn-chico ${d === dias ? 'btn-activo' : ''}`} onClick={() => setDias(d)}>{d} días</button>
          ))}
        </div>
      </div>

      <div className="grid-kpi">
        <div className="card card-pad">
          <p className="tenue">Ventas</p>
          <h1 className="num" style={{ fontSize: 26 }}>{fmtBsCorto(ventas)}</h1>
          <p className="tenue" style={{ color: delta >= 0 ? 'var(--bien)' : 'var(--critico)' }}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% vs. {dias} días previos
          </p>
        </div>
        <div className="card card-pad"><p className="tenue">Sombreros vendidos</p><h1 className="num" style={{ fontSize: 26 }}>{fmtN(unidades)}</h1><p className="tenue">{(unidades / dias).toFixed(1)} por día</p></div>
        <div className="card card-pad"><p className="tenue">Precio promedio</p><h1 className="num" style={{ fontSize: 26 }}>{fmtBs(unidades ? ventas / unidades : 0)}</h1><p className="tenue">por sombrero</p></div>
        <div className="card card-pad">
          <p className="tenue">Margen bruto</p>
          {p.verCostos ? <h1 className="num" style={{ fontSize: 26 }}>{margen.toFixed(1)}%</h1> : <h1 className="muted" style={{ fontSize: 18, paddingTop: 6 }}>Solo SuperAdmin</h1>}
          <p className="tenue">{p.verCostos ? 'sobre costo estándar' : 'los costos están ocultos por RLS'}</p>
        </div>
        <Link href="/erp/stock" className="card card-pad">
          <p className="tenue">Alertas de stock</p>
          <h1 className="num" style={{ fontSize: 26, color: alertas ? 'var(--aviso)' : undefined }}>{fmtN(alertas)}</h1>
          <p className="tenue">variantes en o bajo el mínimo →</p>
        </Link>
      </div>

      <div className="card">
        <div className="card-cabecera">
          <h2>Ventas diarias por departamento</h2>
          <span className="tenue">Bs por día · pasa el cursor para ver el detalle</span>
        </div>
        <div className="card-pad">
          <LineasMulti etiquetas={fechas.map(fmtFecha)} series={series} formato={fmtBsCorto} />
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-cabecera"><h2>Rotación de modelos</h2><span className="tenue">unidades vendidas · hover: días de inventario</span></div>
          <div className="card-pad">
            <BarrasH datos={porModelo.map((m) => ({ id: m.id, nombre: m.nombre, valor: m.unidades }))} formato={fmtN}
              etiquetaExtra={(id) => `${porModelo.find((m) => m.id === id)!.diasInv} días inv.`} />
          </div>
        </div>
        <div className="card">
          <div className="card-cabecera"><h2>Margen por modelo</h2><span className="tenue">% sobre ventas del período</span></div>
          <div className="card-pad">
            {p.verCostos ? (
              <BarrasH datos={[...porModelo].sort((a, b) => b.margen - a.margen).map((m) => ({ id: m.id, nombre: m.nombre, valor: m.margen }))}
                formato={(n) => `${n.toFixed(1)}%`} color="var(--serie-scz)" />
            ) : (
              <p className="muted">Los costos y márgenes solo los ve el SuperAdmin (y Taller). La tabla de costos está protegida por RLS.</p>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-cabecera"><h2>Arqueos de caja recientes</h2><span className="tenue">resultado del cierre ciego</span></div>
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Sucursal</th><th>Cajero</th><th className="der">Ventas</th><th className="der">Esperado</th><th className="der">Declarado</th><th className="der">Diferencia</th></tr></thead>
            <tbody>
              {arqueos.map((a) => (
                <tr key={a.sesionId}>
                  <td className="num">{fmtFechaHora(a.fecha)}</td>
                  <td><Sucursal codigo={a.sucursal} /></td>
                  <td>{a.cajero}</td>
                  <td className="der num">{a.ventas}</td>
                  <td className="der num">{fmtBs(a.esperado)}</td>
                  <td className="der num">{fmtBs(a.declarado)}</td>
                  <td className="der">
                    {a.diferencia === 0 ? <span className="badge badge-bien">✓ Cuadra</span>
                      : <span className={`badge ${a.diferencia < 0 ? 'badge-critico' : 'badge-aviso'}`}>{a.diferencia < 0 ? '▼ Faltante' : '▲ Sobrante'} {fmtBs(Math.abs(a.diferencia))}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
