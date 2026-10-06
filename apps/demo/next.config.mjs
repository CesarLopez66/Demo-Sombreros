// GitHub Pages: export estático servido bajo /<repo>. Se activa con
// NEXT_PUBLIC_BASE_PATH (lo define el workflow); en local la demo sigue en /.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const exportEstatico = process.env.EXPORT_ESTATICO === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  ...(exportEstatico
    ? { output: 'export', basePath, trailingSlash: true, images: { unoptimized: true } }
    : {
        // headers() no existe en un export estático: solo aplica con `next start`.
        async headers() {
          return [
            {
              source: '/(.*)',
              headers: [
                { key: 'X-Frame-Options', value: 'DENY' },
                { key: 'X-Content-Type-Options', value: 'nosniff' },
                { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
