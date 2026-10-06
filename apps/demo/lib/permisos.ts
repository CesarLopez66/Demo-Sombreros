// Réplica en el frontend de lo que el RLS de la Fase 1 deja ver a cada rol.
// En prod esto NO es la barrera de seguridad (lo es la BD); aquí solo simula.
import type { CodigoSucursal, Estado, Tienda } from './tipos';

export function permisos(e: Estado) {
  const { rol, sucursal } = e.perfilErp;
  const global = rol === 'superadmin' || rol === 'almacen';
  const sucursales: CodigoSucursal[] = global ? ['LPZ', 'CBB', 'SCZ', 'TAL'] : rol === 'gerente' ? [sucursal] : [];
  const tiendas: Tienda[] = global ? ['LPZ', 'CBB', 'SCZ'] : rol === 'gerente' ? [sucursal] : [];
  return {
    rol,
    sucursal,
    sucursales,
    tiendas,
    accesoErp: rol !== 'cajero',
    verCostos: rol === 'superadmin' || rol === 'almacen',
    verVentas: rol === 'superadmin' || rol === 'gerente',
    verTaller: rol === 'superadmin' || rol === 'almacen',
    verFiscal: rol === 'superadmin' || rol === 'gerente',
    verAuditoria: rol === 'superadmin',
    editarCatalogo: rol === 'superadmin',
    usuario:
      rol === 'superadmin' ? 'Propietario' : rol === 'almacen' ? 'Encargado Taller' : rol === 'gerente' ? `Gerente ${sucursal}` : `Cajero ${sucursal}`,
  };
}
