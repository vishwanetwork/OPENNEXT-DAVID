/**
 * Single HTTP client for every backend call made by the browser.
 *
 * - All paths are `/api/...`; the Next route handler `app/api/[...path]/route.ts` passes them
 *   through to the backend unchanged (same origin, same cookies).
 * - Cookies carry the session; mutating requests add the session's CSRF token.
 * - In the isolated demo workspace, sandboxed namespaces are rewritten to `/api/demo/...`,
 *   administrative APIs are refused locally and nothing can write outside the sandbox.
 */

export class ApiError extends Error {
  status: number;
  code?: string;
  payload?: unknown;
  constructor(message: string, status: number, payload?: unknown, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
    this.code = code;
  }
}

export type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ApiRequestOptions {
  method?: ApiMethod;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Default `same-origin` keeps cookies on the three hosts. */
  credentials?: RequestCredentials;
}

export interface ApiClientOptions {
  /** `true` turns on the demo sandbox namespace rules. */
  demo?: boolean;
  /** Returns the CSRF token of the verified session, if any. */
  csrfToken?: () => string | undefined;
  /** Hook for sandbox session expiry (401 in demo mode). */
  onUnauthorized?: (path: string) => void;
  fetch?: typeof fetch;
}

const DEMO_SANDBOX = /^\/api\/(auth|marketplace|billing|contact)(?:\/|$)/;
const DEMO_BLOCKED = /^\/api\/(admin|internal)(?:\/|$)/;

export const DEMO_UNAVAILABLE = 'DEMO_ACTION_UNAVAILABLE';

export function demoPath(path: string, method: ApiMethod): { path: string } | { blocked: string } {
  if (DEMO_BLOCKED.test(path))
    return { blocked: 'Administration and infrastructure access are not available in the demo.' };
  if (DEMO_SANDBOX.test(path)) return { path: path.replace(/^\/api\//, '/api/demo/') };
  if (method !== 'GET' && !/^\/api\/demo\//.test(path))
    return {
      blocked: 'This action is not available in the demo. No real transaction was submitted.',
    };
  return { path };
}

export interface ApiClient {
  readonly demo: boolean;
  request<T = unknown>(path: string, options?: ApiRequestOptions): Promise<T>;
  get<T = unknown>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<T>;
  post<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  patch<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  delete<T = unknown>(
    path: string,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>,
  ): Promise<T>;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const doFetch = options.fetch || ((input, init) => fetch(input, init));
  const demo = Boolean(options.demo);

  async function request<T>(rawPath: string, init: ApiRequestOptions = {}): Promise<T> {
    if (!/^\/api\//.test(rawPath)) throw new ApiError('Invalid API endpoint.', 400);
    const method = init.method || 'GET';
    let path = rawPath;
    if (demo) {
      const mapped = demoPath(rawPath, method);
      if ('blocked' in mapped) throw new ApiError(mapped.blocked, 403, undefined, DEMO_UNAVAILABLE);
      path = mapped.path;
    }
    const headers: Record<string, string> = { ...init.headers };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      const token = options.csrfToken?.();
      if (token) headers['X-CSRF-Token'] = token;
    }
    const controller = init.signal ? null : new AbortController();
    const timer =
      controller && init.timeoutMs ? setTimeout(() => controller.abort(), init.timeoutMs) : null;
    let response: Response;
    try {
      response = await doFetch(path, {
        method,
        headers,
        credentials: init.credentials || 'same-origin',
        cache: 'no-store',
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: init.signal || controller?.signal,
      });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw new ApiError('The request timed out.', 0);
      throw new ApiError('Unable to reach OpenNEXT. Check your connection and try again.', 0);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      if (demo && response.status === 401) options.onUnauthorized?.(path);
      const message =
        (payload &&
        typeof payload === 'object' &&
        typeof (payload as { error?: unknown }).error === 'string'
          ? (payload as { error: string }).error
          : null) || 'The request could not be completed.';
      const code =
        payload &&
        typeof payload === 'object' &&
        typeof (payload as { code?: unknown }).code === 'string'
          ? (payload as { code: string }).code
          : undefined;
      throw new ApiError(message, response.status, payload, code);
    }
    return payload as T;
  }

  return {
    demo,
    request,
    get: (path, o) => request(path, { ...o, method: 'GET' }),
    post: (path, body, o) => request(path, { ...o, method: 'POST', body: body ?? {} }),
    patch: (path, body, o) => request(path, { ...o, method: 'PATCH', body: body ?? {} }),
    delete: (path, o) => request(path, { ...o, method: 'DELETE' }),
  };
}
