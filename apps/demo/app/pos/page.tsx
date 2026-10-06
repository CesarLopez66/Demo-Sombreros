'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { TecladoPin } from '@/components/TecladoPin';
import { abrirCaja, useEstado } from '@/lib/store';
import type { Tienda } from '@/lib/tipos';

const CAJEROS: Record<Tienda, string> = { LPZ: 'Cajero La Paz', CBB: 'Cajero Cochabamba', SCZ: 'Cajero Santa Cruz' };

export default function AperturaCaja() {
  const e = useEstado();
  const router = useRouter();
  const [sucursal, setSucursal] = useState<Tienda>('LPZ');
  const [caja, setCaja] = useState('CAJA-01');
  const [monto, setMonto] = useState('300');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (e.sesion) router.replace('/pos/venta');
  }, [e.sesion, router]);

  const abrir = () => {
    if (pin !== '1234') {
      setError('PIN incorrecto (demo: 1234)');
      setPin('');
      return;
    }
    abrirCaja(CAJEROS[sucursal], sucursal, caja, Number(monto) || 0);
    router.push('/pos/venta');
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: 'calc(100vh - 90px)' }}>
      <div className="card" style={{ width: 'min(760px, 100%)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <div className="card-pad pila" style={{ gap: 14, padding: 24, borderRight: '1px solid var(--borde)' }}>
          <div>
            <h1>Apertura de caja</h1>
            <p className="muted">Inicio de turno del cajero</p>
          </div>
          <label>Sucursal
            <select value={sucursal} onChange={(ev) => setSucursal(ev.target.value as Tienda)}>
              <option value="LPZ">LPZ · Casa Matriz La Paz</option>
              <option value="CBB">CBB · Sucursal Cochabamba</option>
              <option value="SCZ">SCZ · Sucursal Santa Cruz</option>
            </select>
          </label>
          <label>Caja / punto de venta SIN
            <select value={caja} onChange={(ev) => setCaja(ev.target.value)}>
              <option value="CAJA-01">CAJA-01 · PV 0</option>
              <option value="CAJA-02">CAJA-02 · PV 1</option>
            </select>
          </label>
          <label>Cajero
            <input value={CAJEROS[sucursal]} readOnly />
          </label>
          <label>Saldo inicial en efectivo (Bs)
            <input className="num" inputMode="decimal" value={monto} onChange={(ev) => setMonto(ev.target.value.replace(/[^\d.]/g, ''))} />
          </label>
          <div className="aviso-banda" style={{ background: e.online ? 'var(--bien-fondo)' : 'var(--aviso-fondo)', color: e.online ? 'var(--bien)' : 'var(--aviso)' }}>
            <span className="punto" style={{ background: 'currentColor', marginTop: 5 }} />
            <span>
              {e.online
                ? 'Conectado. CUFD vigente sincronizado; las facturas se envían en línea.'
                : 'Sin conexión. Se emitirá en contingencia con el último CUFD y se sincronizará al volver la red.'}
            </span>
          </div>
        </div>
        <div className="card-pad pila" style={{ justifyItems: 'center', alignContent: 'center', gap: 16, padding: 24 }}>
          <h2>PIN del cajero</h2>
          <TecladoPin valor={pin} onChange={(v) => { setPin(v); setError(''); }} />
          {error && <span className="badge badge-critico">{error}</span>}
          <button className="btn btn-primario btn-grande" style={{ width: 236 }} disabled={pin.length !== 4} onClick={abrir}>
            Abrir caja
          </button>
          <p className="tenue">Demo: PIN 1234</p>
        </div>
      </div>
    </div>
  );
}
