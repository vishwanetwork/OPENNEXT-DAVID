import 'server-only';
import { appOrigins, normalizeHosts, type AppOrigins, type HostConfig } from './apps';

/** Server-side runtime configuration. Read per request so one image serves every environment. */
export interface ServerEnv {
  hosts: HostConfig;
  origins: AppOrigins;
  trustProxy: boolean;
}

export function serverEnv(): ServerEnv {
  const hosts = normalizeHosts(process.env);
  return { hosts, origins: appOrigins(hosts), trustProxy: process.env.OPENNEXT_TRUST_PROXY === '1' };
}
