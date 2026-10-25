import 'server-only';
import { headers } from 'next/headers';
import type { AppKind } from './apps';
import { APP_HEADERS } from '@/proxy';
import { serverEnv } from './env';

export interface RequestApp {
  app: AppKind;
  base: string;
  demo: boolean;
  host: string;
}

/**
 * Reads the application tags set by `src/proxy.ts`. Falls back to the given app when the
 * route is rendered outside the proxy (tests, direct internal paths).
 */
export async function requestApp(fallback: AppKind): Promise<RequestApp> {
  const list = await headers();
  const app = (list.get(APP_HEADERS.app) as AppKind | null) || fallback;
  const base = list.get(APP_HEADERS.base) ?? (fallback === 'site' ? '' : `/${fallback}`);
  return { app, base, demo: list.get(APP_HEADERS.demo) === '1', host: list.get(APP_HEADERS.host) || '' };
}

export { serverEnv };
