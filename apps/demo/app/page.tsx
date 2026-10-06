'use client';
import Link from 'next/link';
import { InsigniaEntorno } from '@/components/Insignias';
import { reiniciarDemo } from '@/lib/store';

export default function Inicio() {
  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '48px 20px', display: 'grid', gap: 28 }}>
      <div className="fila entre">
        <div className="fila" style={{ gap: 12 }}>
          <img src="/icono.svg" width={44} height={44} alt="" />
          <div>
            <h1>Sombrerería · ERP &amp; POS multisucursal</h1>
            <p className="muted">La Paz · Cochabamba · Santa Cruz · Taller central</p>
          </div>
        </div>
        <InsigniaEntorno />
      </div>

      <div className="grid-2">
        <Link href="/pos" className="card card-pad pila" style={{ gap: 10 }}>
          <span className="badge">PWA · offline-first</span>
          <h2 style={{ fontSize: 20 }}>Punto de Venta</h2>
          <p className="muted">
            Apertura de caja con PIN, terminal táctil con matriz talla × color, NIT/CI, cobro mixto, ticket de 80 mm con QR del SIN,
            modo sin conexión y cierre ciego de caja.
          </p>
          <span className="btn btn-primario" style={{ justifySelf: 'start' }}>Abrir POS →</span>
        </Link>
        <Link href="/erp" className="card card-pad pila" style={{ gap: 10 }}>
          <span className="badge">Web · Vercel</span>
          <h2 style={{ fontSize: 20 }}>ERP administrativo</h2>
          <p className="muted">
            Dashboard ejecutivo, catálogo matricial, stock comparativo, transferencias, Kanban del taller con costos por receta
            y monitor fiscal de contingencias.
          </p>
          <span className="btn btn-primario" style={{ justifySelf: 'start' }}>Abrir ERP →</span>
        </Link>
      </div>

      <div className="card card-pad pila" style={{ gap: 8 }}>
        <h3>Cómo recorrer la demo</h3>
        <ol className="muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          <li>Abre el POS en una pestaña y el ERP en otra: los cambios se reflejan en vivo entre ambas.</li>
          <li>En el POS, abre caja (PIN <b>1234</b>), vende y luego activa <b>“Simular corte de red”</b> para emitir en contingencia.</li>
          <li>Restablece la red y mira en el ERP → Monitor fiscal cómo se registra el evento y se valida el paquete.</li>
          <li>En el ERP cambia el rol simulado (arriba a la derecha) para ver lo que cada rol puede ver.</li>
        </ol>
        <p className="tenue">
          Todo corre en tu navegador con datos simulados; no se conecta a Supabase, PowerSync ni al SIN.
        </p>
        <div>
          <button className="btn btn-chico" onClick={() => reiniciarDemo()}>Reiniciar datos de la demo</button>
        </div>
      </div>
    </main>
  );
}
