import 'server-only';
import { normalizeHosts, type HostConfig } from './apps';

/**
 * Server-side runtime configuration, read once per call so one image serves every
 * environment. This is the only module that reads `process.env` for deployment settings.
 */
export interface ServerEnv {
  hosts: HostConfig;
  /** True only behind the production HTTPS reverse proxy: forwarded headers are then trusted. */
  trustProxy: boolean;
  /** Backend origin every /api/* request is forwarded to. */
  apiOrigin: string;
}

export const DEFAULT_API_ORIGIN = 'http://127.0.0.1:4189';

export function serverEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const hosts = normalizeHosts(env);
  return {
    hosts,
    trustProxy: env.OPENNEXT_TRUST_PROXY === '1',
    apiOrigin: (env.API_ORIGIN || DEFAULT_API_ORIGIN).replace(/\/$/, ''),
  };
}

/**
 * Headers forwarded to the backend on behalf of a browser request. The client-facing host is
 * preserved (same-origin checks), and `x-forwarded-*` headers are passed through only behind
 * a trusted proxy; otherwise the synthetic ones Next adds are dropped so the backend sees a
 * direct client (its "localhost administrator" rule depends on that in development).
 */
export function backendHeaders(
  incoming: Headers | Record<string, string>,
  trustProxy: boolean,
  fallbackHost: string,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const entries = incoming instanceof Headers ? [...incoming.entries()] : Object.entries(incoming);
  for (const [key, value] of entries) {
    const name = key.toLowerCase();
    if (HOP_BY_HOP.has(name)) continue;
    if (!trustProxy && (name.startsWith('x-forwarded-') || name === 'forwarded')) continue;
    headers[name] = value;
  }
  headers.host = headers['x-forwarded-host'] || headers.host || fallbackHost;
  return headers;
}

export const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-connection',
  'content-length',
]);
