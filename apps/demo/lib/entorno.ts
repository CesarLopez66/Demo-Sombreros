// Entorno activo. `next dev` carga .env.development (dev) y `next build/start`
// carga .env.production (prod). Las fases 2–4 elegirán aquí la fuente de datos:
// mock (dev/demo) o Supabase + PowerSync (prod).
export type Entorno = 'dev' | 'prod';

export const ENTORNO: Entorno = process.env.NEXT_PUBLIC_APP_ENV === 'prod' ? 'prod' : 'dev';
export const FUENTE_DATOS = process.env.NEXT_PUBLIC_DATA_SOURCE ?? 'mock';
export const DATOS_SIMULADOS = FUENTE_DATOS === 'mock';
