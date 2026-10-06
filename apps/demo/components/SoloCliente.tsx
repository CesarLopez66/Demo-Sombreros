'use client';
import { useEffect, useState, type ReactNode } from 'react';

// Los datos simulados viven en localStorage: se renderiza solo en el cliente
// para evitar diferencias de hidratación con el HTML del servidor.
export function SoloCliente({ children }: { children: ReactNode }) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  return montado ? <>{children}</> : null;
}
