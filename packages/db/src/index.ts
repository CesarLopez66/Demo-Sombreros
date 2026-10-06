// Cliente PostgreSQL para funciones serverless (Vercel) a través del pooler
// de Supabase en modo transacción (puerto 6543).
//
// Reglas del modo transacción:
//   · prepare: false → el pooler no conserva prepared statements entre transacciones.
//   · max: 1 → cada invocación serverless usa una sola conexión; el pooler multiplexa.
//   · Nada de SET de sesión, LISTEN/NOTIFY ni advisory locks de sesión.
//     Para eso usar DIRECT_URL (microservicio fiscal de larga vida).
//
// Las consultas por aquí NO pasan por RLS (rol postgres): úsese solo para
// reportes/agregados del SuperAdmin en server actions ya autorizadas. Lo que el
// usuario lea con sus propios permisos debe ir por supabase-js con su JWT.
import postgres from 'postgres';

let cliente: postgres.Sql | undefined;

export function sqlPooler(url = process.env.DATABASE_URL): postgres.Sql {
  if (!url) throw new Error('DATABASE_URL no está definida');
  if (!/:6543\//.test(url)) {
    console.warn('[db] DATABASE_URL no apunta al pooler transaccional (puerto 6543)');
  }
  cliente ??= postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: 'require',
  });
  return cliente;
}
