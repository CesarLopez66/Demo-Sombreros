'use client';
// Gráficos SVG sin dependencias. Reglas (skill dataviz): un solo eje, líneas de 2px,
// grid tenue, leyenda + etiquetas directas, tooltip al pasar el mouse, texto en
// tinta (nunca del color de la serie).
import { useEffect, useRef, useState } from 'react';

export interface Serie {
  id: string;
  nombre: string;
  color: string;
  valores: number[];
}

function pasoBonito(max: number, n = 4) {
  const bruto = max / n;
  const mag = 10 ** Math.floor(Math.log10(bruto || 1));
  const norm = bruto / mag;
  const paso = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return paso;
}

// Separa las etiquetas directas para que no se encimen (mínimo 14px).
function etiquetasFinales<T extends { y: number }>(items: T[]): T[] {
  const ord = [...items].sort((a, b) => a.y - b.y).map((x) => ({ ...x }));
  for (let i = 1; i < ord.length; i++) if (ord[i].y - ord[i - 1].y < 14) ord[i].y = ord[i - 1].y + 14;
  return ord;
}

export function LineasMulti({
  etiquetas, series, formato, alto = 260,
}: { etiquetas: string[]; series: Serie[]; formato: (n: number) => string; alto?: number }) {
  // El viewBox sigue el ancho real del contenedor: el texto queda en 11px a cualquier tamaño.
  const caja = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(720);
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const ro = new ResizeObserver(([en]) => setAncho(Math.max(320, Math.round(en.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const m = { izq: 64, der: 96, arr: 12, aba: 28 };
  const max = Math.max(1, ...series.flatMap((s) => s.valores));
  const paso = pasoBonito(max);
  const tope = Math.ceil(max / paso) * paso;
  const ticks = Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso);
  const X = (i: number) => m.izq + (i / Math.max(1, etiquetas.length - 1)) * (ancho - m.izq - m.der);
  const Y = (v: number) => alto - m.aba - (v / tope) * (alto - m.arr - m.aba);
  const [hover, setHover] = useState<number | null>(null);

  const alMover = (ev: React.PointerEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * ancho;
    const i = Math.round(((x - m.izq) / (ancho - m.izq - m.der)) * (etiquetas.length - 1));
    setHover(i >= 0 && i < etiquetas.length ? i : null);
  };
  const cadaN = Math.ceil(etiquetas.length / Math.max(3, Math.floor(ancho / 110)));

  return (
    <div ref={caja} style={{ position: 'relative' }}>
      <div className="fila" style={{ gap: 14, marginBottom: 6 }} aria-label="Leyenda">
        {series.map((s) => (
          <span key={s.id} className="fila tenue" style={{ gap: 6, color: 'var(--tinta-2)' }}>
            <span style={{ width: 14, height: 3, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            {s.nombre}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${ancho} ${alto}`} width="100%" role="img" aria-label="Gráfico de líneas"
        onPointerMove={alMover} onPointerLeave={() => setHover(null)} style={{ display: 'block', touchAction: 'none' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.izq} x2={ancho - m.der} y1={Y(t)} y2={Y(t)} stroke="var(--grid)" />
            <text x={m.izq - 8} y={Y(t) + 4} textAnchor="end" fontSize="11" fill="var(--tinta-3)" className="num">{formato(t)}</text>
          </g>
        ))}
        {etiquetas.map((et, i) => (i % cadaN === 0 || i === etiquetas.length - 1) && (
          <text key={i} x={X(i)} y={alto - 8} textAnchor="middle" fontSize="11" fill="var(--tinta-3)">{et}</text>
        ))}
        {series.map((s) => (
          <polyline key={s.id} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
            points={s.valores.map((v, i) => `${X(i)},${Y(v)}`).join(' ')} />
        ))}
        {/* Etiquetas directas al final de cada serie */}
        {etiquetasFinales(series.map((s) => ({ id: s.id, nombre: s.nombre, y: Y(s.valores.at(-1) ?? 0) }))).map((et) => (
          <text key={et.id} x={ancho - m.der + 8} y={et.y + 4} fontSize="11.5" fontWeight="600" fill="var(--tinta-2)">{et.nombre}</text>
        ))}
        {hover !== null && (
          <g>
            <line x1={X(hover)} x2={X(hover)} y1={m.arr} y2={alto - m.aba} stroke="var(--borde-fuerte)" />
            {series.map((s) => (
              <circle key={s.id} cx={X(hover)} cy={Y(s.valores[hover])} r="4.5" fill={s.color} stroke="var(--superficie)" strokeWidth="2" />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="tooltip-graf" style={{ left: `${(X(hover) / ancho) * 100}%`, top: 24, transform: X(hover) > ancho * 0.6 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{etiquetas[hover]}</div>
          {series.map((s) => (
            <div key={s.id} className="fila entre" style={{ gap: 16 }}>
              <span className="fila" style={{ gap: 6 }}><span className="punto" style={{ background: s.color }} />{s.nombre}</span>
              <span className="num">{formato(s.valores[hover])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BarrasH({
  datos, formato, color = 'var(--serie-lpz)', etiquetaExtra,
}: { datos: { id: string; nombre: string; valor: number }[]; formato: (n: number) => string; color?: string; etiquetaExtra?: (id: string) => string }) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="pila" style={{ gap: 10 }} role="list">
      {datos.map((d) => (
        <div key={d.id} role="listitem" onPointerEnter={() => setHover(d.id)} onPointerLeave={() => setHover(null)}
          style={{ display: 'grid', gridTemplateColumns: '150px 1fr 90px', gap: 10, alignItems: 'center', padding: '2px 0', background: hover === d.id ? 'var(--superficie-2)' : undefined, borderRadius: 6 }}>
          <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.nombre}>{d.nombre}</span>
          <div style={{ height: 14, background: 'var(--grid)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${(Math.max(d.valor, 0) / max) * 100}%`, height: '100%', background: color, borderRadius: '0 4px 4px 0' }} />
          </div>
          <span className="num" style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>
            {formato(d.valor)}
            {etiquetaExtra && hover === d.id && <span className="tenue" style={{ display: 'block', fontWeight: 400 }}>{etiquetaExtra(d.id)}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
