'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InsigniaEntorno } from '@/components/Insignias';
import { TecladoPin } from '@/components/TecladoPin';
import { setOnline, useEstado } from '@/lib/store';

const PIN_CAJERO = '1234';
const INACTIVIDAD_MS = 5 * 60 * 1000;

export default function PosLayout({ children }: { children: React.ReactNode }) {
  const e = useEstado();
  const ruta = usePathname();
  const router = useRouter();
  const [bloqueado, setBloqueado] = useState(false);
  const [pin, setPin] = useState('');
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sin caja abierta solo se permite la pantalla de apertura.
  useEffect(() => {
    if (!e.sesion && ruta !== '/pos' && !ruta.startsWith('/pos/ticket')) router.replace('/pos');
  }, [e.sesion, ruta, router]);

  // Bloqueo automático por inactividad (5 min).
  const reiniciarTemporizador = useCallback(() => {
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setBloqueado(true), INACTIVIDAD_MS);
  }, []);
  useEffect(() => {
    if (!e.sesion) return;
    const eventos = ['pointerdown', 'keydown', 'pointermove'] as const;
    eventos.forEach((ev) => window.addEventListener(ev, reiniciarTemporizador));
    reiniciarTemporizador();
    return () => {
      eventos.forEach((ev) => window.removeEventListener(ev, reiniciarTemporizador));
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, [e.sesion, reiniciarTemporizador]);

  useEffect(() => {
    if (pin.length === 4) {
      if (pin === PIN_CAJERO) setBloqueado(false);
      setPin('');
    }
  }, [pin]);

  const pendientes = e.ventas.filter((v) => v.sync === 'pendiente').length;

  return (
    <div className="pos">
      <header className="pos-barra">
        <div className="fila" style={{ gap: 14 }}>
          <Link href="/" className="fila" style={{ gap: 8 }}>
            <img src="/icono.svg" width={28} height={28} alt="" />
            <strong>POS</strong>
          </Link>
          {e.sesion && (
            <span style={{ color: '#cfc5b8' }}>
              {e.sesion.sucursal} · {e.sesion.caja} · {e.sesion.cajero}
            </span>
          )}
          <InsigniaEntorno />
        </div>
        <div className="fila">
          <span className={`badge ${e.online ? 'badge-bien' : 'badge-aviso'}`}>
            <span className="punto" style={{ background: 'currentColor' }} />
            {e.online ? 'En línea' : 'Sin conexión · contingencia'}
          </span>
          {pendientes > 0 && <span className="badge badge-aviso">{pendientes} por sincronizar</span>}
          <button className="btn btn-chico" onClick={() => setOnline(!e.online)}>
            {e.online ? 'Simular corte de red' : 'Restablecer red'}
          </button>
          {e.sesion && (
            <>
              <Link className={`btn btn-chico ${ruta === '/pos/venta' ? 'btn-activo' : ''}`} href="/pos/venta">Terminal</Link>
              <Link className={`btn btn-chico ${ruta === '/pos/historial' ? 'btn-activo' : ''}`} href="/pos/historial">Historial y cierre</Link>
              <button className="btn btn-chico" onClick={() => setBloqueado(true)}>Bloquear</button>
            </>
          )}
        </div>
      </header>
      <div className="pos-cuerpo">{children}</div>

      {bloqueado && (
        <div className="bloqueo" role="dialog" aria-label="Terminal bloqueada">
          <div className="card card-pad pila" style={{ justifyItems: 'center', gap: 16, padding: 28 }}>
            <h2>Terminal bloqueada</h2>
            <p className="muted">Ingresa tu PIN para continuar (demo: 1234)</p>
            <TecladoPin valor={pin} onChange={setPin} />
          </div>
        </div>
      )}
    </div>
  );
}
