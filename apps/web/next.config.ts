import type { NextConfig } from 'next';

// The backend (today the legacy Node preview server under /legacy, later the Python API)
// is a separate long-running process. Every /api/* request is proxied to it so that cookies,
// CSRF and OAuth callbacks stay same-origin on all three hosts.
const API_ORIGIN = (process.env.API_ORIGIN || 'http://127.0.0.1:4189').replace(/\/$/, '');

const nextConfig: NextConfig = {
  output: 'standalone',
  // Trailing slashes (/admin/, /demo/) are legacy entry points handled by src/proxy.ts.
  skipTrailingSlashRedirect: true,
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return {
      beforeFiles: [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }],
      afterFiles: [],
      fallback: [],
    };
  },
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
