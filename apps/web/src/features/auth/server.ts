import 'server-only';
import { cookies, headers } from 'next/headers';
import { SessionResponse, type SessionUser } from '@opennext/contracts';
import { backendHeaders, serverEnv } from '@/lib/env';

/**
 * Reads the verified session on the server (forwarding the browser's cookies to the backend)
 * so the first render already knows whether to show the sign-in view. Uses the same header
 * policy as the /api pass-through. Returns null when the backend is unreachable or anonymous.
 */
export async function getServerSession(host: string): Promise<SessionUser | null> {
  try {
    const { apiOrigin, trustProxy } = serverEnv();
    const incoming = await headers();
    const forwarded = backendHeaders(incoming, trustProxy, host);
    const response = await fetch(`${apiOrigin}/api/auth/session`, {
      headers: {
        cookie: (await cookies()).toString(),
        accept: 'application/json',
        ...(forwarded['x-forwarded-host'] ? { 'x-forwarded-host': forwarded['x-forwarded-host'] } : {}),
        ...(forwarded['x-forwarded-proto'] ? { 'x-forwarded-proto': forwarded['x-forwarded-proto'] } : {}),
        ...(forwarded['x-forwarded-for'] ? { 'x-forwarded-for': forwarded['x-forwarded-for'] } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    return SessionResponse.parse(await response.json()).user;
  } catch {
    return null;
  }
}
