'use client';

export function TecladoPin({ valor, onChange, largo = 4 }: { valor: string; onChange: (v: string) => void; largo?: number }) {
  const pulsar = (d: string) => valor.length < largo && onChange(valor + d);
  return (
    <div className="pila" style={{ justifyItems: 'center' }}>
      <div className="fila" style={{ gap: 12, height: 20 }} aria-label="PIN ingresado">
        {Array.from({ length: largo }, (_, i) => (
          <span key={i} className="punto" style={{ width: 14, height: 14, background: i < valor.length ? 'var(--acento)' : 'var(--borde-fuerte)' }} />
        ))}
      </div>
      <div className="teclado">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="btn" onClick={() => pulsar(d)}>{d}</button>
        ))}
        <button type="button" className="btn" onClick={() => onChange('')} aria-label="Borrar todo">C</button>
        <button type="button" className="btn" onClick={() => pulsar('0')}>0</button>
        <button type="button" className="btn" onClick={() => onChange(valor.slice(0, -1))} aria-label="Borrar">⌫</button>
      </div>
    </div>
  );
}
