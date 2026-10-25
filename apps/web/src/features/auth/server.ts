import 'server-only';
import { cookies, headers } from 'next/headers';
import { SessionResponse, type SessionUser } from '@opennext/contracts';

const API_ORIGIN = (process.env.API_ORIGIN || 'http://127.0.0.1:4189').replace(/\/$/, '');

/**
 * Reads the verified session on the server (forwarding the browser's cookies to the backend)
 * so the first render already knows whether to show the sign-in view. Returns null when the
 * backend is unreachable or the visitor is anonymous.
 */
export async function getServerSession(host: string): Promise<SessionUser | null> {
  try {
    const cookie = (await cookies()).toString();
    const forwarded = (await headers()).get('x-forwarded-proto') || 'http';
    const response = await fetch(`${API_ORIGIN}/api/auth/session`, {
      headers: {
        cookie,
        'x-forwarded-host': host,
        'x-forwarded-proto': forwarded,
        accept: 'application/json',
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
