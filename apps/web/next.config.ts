import type { NextConfig } from 'next';

// Every /api/* request is forwarded by src/app/api/[...path]/route.ts (a transparent proxy that
// keeps Host/Origin/cookies intact) to the backend at API_ORIGIN.
const nextConfig: NextConfig = {
  output: 'standalone',
  // Trailing slashes (/admin/, /demo/) are legacy entry points handled by src/proxy.ts.
  skipTrailingSlashRedirect: true,
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
