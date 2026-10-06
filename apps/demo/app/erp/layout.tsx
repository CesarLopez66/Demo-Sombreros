'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { InsigniaEntorno } from '@/components/Insignias';
import { recurso } from '@/lib/entorno';
import { ETIQUETA_ROL } from '@/lib/formato';
import { permisos } from '@/lib/permisos';
import { reiniciarDemo, setPerfilErp, useEstado } from '@/lib/store';
import type { Rol, Tienda } from '@/lib/tipos';

const NAV = [
  { grupo: 'General' },
  { href: '/erp', texto: 'Dashboard ejecutivo', ver: 'verVentas' },
  { href: '/erp/catalogo', texto: 'Catálogo matricial' },
  { href: '/erp/stock', texto: 'Stock multisucursal' },
  { href: '/erp/transferencias', texto: 'Transferencias' },
  { grupo: 'Operación' },
  { href: '/erp/taller', texto: 'Taller de producción', ver: 'verTaller' },
  { href: '/erp/fiscal', texto: 'Monitor fiscal SIN', ver: 'verFiscal' },
  { href: '/erp/auditoria', texto: 'Auditoría', ver: 'verAuditoria' },
] as const;

export default function ErpLayout({ children }: { children: React.ReactNode }) {
  const e = useEstado();
  const ruta = usePathname();
  const p = permisos(e);

  return (
    <div className="erp">
      <aside className="erp-lateral">
        <Link href="/" className="erp-marca">
          <img src={recurso('/icono.svg')} width={30} height={30} alt="" />
          <span><strong>Sombrerería</strong><br /><span style={{ fontSize: 12, color: '#a89c8c' }}>ERP</span></span>
        </Link>
        <nav className="erp-nav" aria-label="Módulos">
          {NAV.map((n, i) =>
            'grupo' in n ? (
              <div key={i} className="grupo">{n.grupo}</div>
            ) : (!('ver' in n) || p[n.ver]) && p.accesoErp ? (
              <Link key={n.href} href={n.href} className={ruta === n.href ? 'activo' : ''}>{n.texto}</Link>
            ) : null,
          )}
        </nav>
        <div className="pie" style={{ marginTop: 'auto', padding: '0 8px', display: 'grid', gap: 8 }}>
          <Link href="/pos" style={{ color: '#cfc5b8', fontSize: 13 }}>→ Ir al POS</Link>
          <button className="btn btn-chico" style={{ background: 'transparent', color: '#cfc5b8', borderColor: '#4a3d33' }} onClick={() => reiniciarDemo()}>
            Reiniciar datos demo
          </button>
        </div>
      </aside>

      <div className="erp-principal">
        <header className="erp-cabecera">
          <div className="fila">
            <InsigniaEntorno />
            <span className="tenue">Sesión simulada: {p.usuario}{p.rol === 'superadmin' || p.rol === 'gerente' ? ' · MFA verificado' : ''}</span>
          </div>
          <div className="fila">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Rol
              <select value={p.rol} style={{ width: 210, height: 32 }} onChange={(ev) => setPerfilErp(ev.target.value as Rol, p.sucursal)}>
                {(['superadmin', 'gerente', 'almacen', 'cajero'] as Rol[]).map((r) => <option key={r} value={r}>{ETIQUETA_ROL[r]}</option>)}
              </select>
            </label>
            {(p.rol === 'gerente' || p.rol === 'cajero') && (
              <select value={p.sucursal} style={{ width: 90, height: 32 }} aria-label="Sucursal" onChange={(ev) => setPerfilErp(p.rol, ev.target.value as Tienda)}>
                <option>LPZ</option><option>CBB</option><option>SCZ</option>
              </select>
            )}
          </div>
        </header>
        <main className="erp-contenido">
          {p.accesoErp ? children : (
            <div className="card card-pad pila" style={{ maxWidth: 560 }}>
              <h2>Sin acceso al ERP</h2>
              <p className="muted">El rol Cajero / Vendedor solo opera la PWA del POS de su sucursal. Así lo impone el RLS de la base de datos.</p>
              <Link className="btn btn-primario" style={{ justifySelf: 'start' }} href="/pos">Ir al POS</Link>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
