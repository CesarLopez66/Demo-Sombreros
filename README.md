# ERP & POS Multisucursal — Sombrerería Bolivia

Sistema ERP + Punto de Venta offline-first para las sucursales de La Paz (LPZ), Cochabamba (CBB) y Santa Cruz (SCZ), y para el taller/almacén central (TAL), con facturación electrónica en línea del SIN.

```
[POS PWA (BD local)] <──PowerSync──> [Supabase Postgres] <──Pooler :6543──> [ERP Next.js en Vercel]
                                              │
                                 outbox cola_fiscal + pg_notify
                                              ▼
                              [NestJS + BullMQ/Redis (VPS)] <──SOAP/REST──> [SIN Bolivia]
```

## Estado por fase

| Fase | Alcance | Estado |
|---|---|---|
| 1 | Supabase: esquema, RLS, auth/MFA, auditoría y pooler | **Hecha** (34 pruebas automáticas) |
| 2 | PWA POS + PowerSync + impresión térmica de 80 mm | Pendiente |
| 3 | Microservicio fiscal NestJS (firma XML, SOAP, BullMQ) | Pendiente |
| 4 | ERP Next.js (catálogo, stock, transferencias, Kanban, monitor fiscal, analítica) | Pendiente |
| 5 | Pruebas de desconexión, homologación SIN, producción | Pendiente |
| Demo | Frontend navegable de POS y ERP con datos simulados (`apps/demo`) | **Hecha** |

## Demo navegable (solo frontend)

```bash
npm install
npm run demo        # http://localhost:3100 (entorno dev, datos simulados)
npm run demo:prod   # build + start con .env.production
```

Todo corre en el navegador (estado en `localStorage`, sincronizado entre pestañas). PIN de cajero `1234`, PIN de gerente `9999`. El POS tiene un botón **Simular corte de red** para emitir en contingencia, y el ERP un selector de rol que imita lo que el RLS deja ver.

## Entornos

| | dev (local) | prod (nube) |
|---|---|---|
| Variables | `.env.development` (`NEXT_PUBLIC_APP_ENV=dev`) | `.env.production` + secretos en Vercel / VPS |
| Base de datos | Supabase local (`supabase start`) o PGlite (`npm run db:test`) | Supabase Cloud, pooler :6543 |
| Datos | Seed + usuarios demo; la demo usa datos simulados | Datos reales, solo seed base |
| SIN | Simulador SOAP local | Ambiente de pruebas del SIN → producción tras homologar |

El plan detallado de las fases 2 a 5 está en el documento de plan de trabajo.

## Estructura

```
supabase/
  config.toml                 CLI local: pooler transaccional, MFA TOTP, sin registro público
  migrations/                 0001 → 0014 (ver tabla abajo)
  seed.sql                    sucursales, cajas, matriz de productos, stock, materias primas, recetas
  seed_usuarios_demo.sql      usuarios de prueba (solo local)
apps/
  demo/                       demo Next.js (POS + ERP) con datos simulados, puerto 3100
packages/
  shared/                     enums, roles y payloads compartidos (POS / ERP / fiscal)
  db/                         cliente postgres.js para el pooler (prepare:false)
scripts/db-test/              validación de migraciones y pruebas RLS sobre PGlite (sin Docker)
```

| Migración | Contenido |
|---|---|
| 0001 fundamentos | esquema privado `app`, helpers de JWT (`app.rol()`, `app.sucursal_id()`, MFA), `parametros` |
| 0002 sucursales_perfiles | sucursales, perfiles; sincronización perfiles → `app_metadata` del JWT |
| 0003 catalogo_matricial | modelos × tallas × colores × hormas → `variantes` (SKU automático); costos aparte |
| 0004 inventario | `stock` + kardex inmutable `movimientos_inventario` + alertas |
| 0005 clientes_fidelizacion | clientes por NIT/CI, deduplicación offline por alias, libro de puntos |
| 0006 pos_ventas | cajas, sesiones, ventas, detalle, pagos, arqueo ciego |
| 0007 fiscal_sin | CUIS, CUFD, facturas, eventos significativos, paquetes, logs SOAP, outbox `cola_fiscal` |
| 0008 transferencias | flujo solicitada → aprobada → despachada → recibida, con detección de faltantes |
| 0009 produccion_taller | materias primas (costo promedio), recetas/BOM, órdenes Kanban, calculadora de costos |
| 0010 rpc_pos | `registrar_venta` (atómica e idempotente), `anular_venta` |
| 0011 auditoria | `logs_auditoria` inmutable + triggers en 26 tablas sensibles |
| 0012 rls | políticas RLS de todas las tablas y privilegios |
| 0013 vistas_analitica | stock comparativo, ventas diarias, rotación, márgenes, monitor fiscal |
| 0014 powersync_storage | publicación `powersync`, buckets `productos` y `fiscal` |

## Pruebas locales (sin Docker)

```bash
npm install
npm run db:test
```

Aplica las 14 migraciones y el seed sobre PGlite (Postgres 17 en WASM), con un stub mínimo de Supabase (`auth.jwt()`, roles `anon`, `authenticated` y `service_role`). Después ejecuta 34 pruebas que simulan los JWT de cada rol: aislamiento por sucursal, MFA, ventas offline idempotentes, descuentos, anulaciones, arqueo ciego, transferencias con faltantes, Kanban con consumo de BOM e inmutabilidad de la auditoría y del kardex.

Con Docker y la CLI de Supabase también funciona el flujo estándar: `supabase start` y luego `supabase db reset`.

## Despliegue de la Fase 1 en Supabase Cloud

1. `supabase link --project-ref <ref>` y luego `supabase db push` (usa la conexión directa, puerto 5432).
2. En **Authentication → Providers**, desactiva el registro público. En **Auth → MFA**, habilita TOTP.
3. Ejecuta `seed.sql` una sola vez (no ejecutes el seed de usuarios demo).
4. Crea el primer SuperAdmin con la Admin API: `app_metadata: { rol: 'superadmin' }` y `user_metadata: { nombre_completo }`. El trigger crea su perfil.
5. Crea el rol de replicación de PowerSync (la contraseña no se guarda en las migraciones):
   ```sql
   create role powersync_role with replication bypassrls login password '***';
   grant select on all tables in schema public to powersync_role;
   ```
6. Copia `.env.example` a `.env.local`. Vercel usa `DATABASE_URL` (pooler, puerto 6543, `?pgbouncer=true`) y el VPS usa `DIRECT_URL`.

## Decisiones de diseño

- **Roles en el JWT.** `perfiles` es la fuente de verdad. Un trigger copia `rol`, `sucursal_id` y `activo` a `auth.users.raw_app_meta_data`, y RLS los lee con `auth.jwt() -> 'app_metadata'`. Un cambio de rol se aplica cuando se refresca el token (como máximo en 1 h). Desactivar un perfil anula el rol aunque el token siga vigente.
- **MFA en la base de datos.** Para la BD, SuperAdmin y Gerente solo tienen ese rol con una sesión `aal2`. Sin segundo factor no ven ni pueden hacer nada, aunque el frontend falle.
- **Stock solo por kardex.** `stock.cantidad` no se edita directamente; un trigger la actualiza desde `movimientos_inventario`, que es inmutable. Ventas, anulaciones, transferencias y producción generan sus propios movimientos.
- **Offline-first.** El POS genera los UUID. `registrar_venta` inserta cabecera, detalle, pagos y factura en una sola transacción y es idempotente ante reintentos. Una venta offline no se rechaza por falta de stock; queda en negativo y genera una alerta. Si dos POS registran offline el mismo NIT/CI, el segundo cliente se guarda como alias del primero.
- **Arqueo ciego.** El cajero solo declara el efectivo contado. El esperado y la diferencia se guardan en `arqueos`, que solo leen el gerente y el SuperAdmin.
- **Fiscal desacoplado.** El POS calcula el CUF con el CUFD que tiene en caché (también offline) e inserta la factura. El certificado nunca sale del VPS. Una factura nueva o una anulación crea una fila en `cola_fiscal` y emite un `pg_notify`. El microservicio la toma con `FOR UPDATE SKIP LOCKED` y la pasa a BullMQ.
- **Auditoría inmutable.** No hay políticas de escritura, se revocaron los privilegios y triggers bloquean `UPDATE`, `DELETE` y `TRUNCATE` incluso para `service_role` y `postgres`.

## Pendientes para las siguientes fases

- **Fase 2:** reglas de sync de PowerSync por `sucursal_id` del JWT; cifrado de la BD local con una clave derivada del PIN; bloqueo por inactividad (parámetro `inactividad_pos_minutos`); algoritmo del CUF en `packages/shared`; numeración correlativa de facturas por punto de venta en el dispositivo.
- **Fase 3:** consumidor de `cola_fiscal`, generación y firma XML (XAdES) con el .p12 solo en RAM, envío de paquetes de hasta 500 facturas, sincronización de catálogos paramétricos del SIN (los códigos de evento y unidad de medida se validan contra esos catálogos).
- **Fase 4:** `@supabase/ssr` con cookies `HttpOnly`, `Secure` y `SameSite=Strict`; middleware que exige `aal2` a gerentes y SuperAdmin; tipos generados con `npm run db:types`.
- **Antes de producción:** los datos del seed marcados "(completar)" (direcciones, NIT, razón social, proveedores).
