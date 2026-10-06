import type { Metadata, Viewport } from 'next';
import { SoloCliente } from '@/components/SoloCliente';
import { recurso } from '@/lib/entorno';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sombrerería · ERP & POS (demo)',
  description: 'Demo navegable con datos simulados del ERP y POS multisucursal',
  manifest: recurso('/manifest.webmanifest'),
  icons: { icon: recurso('/icono.svg') },
};

export const viewport: Viewport = { themeColor: '#5b3a29', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <SoloCliente>{children}</SoloCliente>
      </body>
    </html>
  );
}
