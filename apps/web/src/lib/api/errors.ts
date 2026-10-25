import { ApiError } from './client';

export interface ErrorDescription {
  message: string;
  status: number;
  code?: string;
  /** True for connection failures and time-outs (status 0). */
  network: boolean;
}

/** Normalises anything thrown by an API call or a feature into one presentable shape. */
export function describeError(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): ErrorDescription {
  if (error instanceof ApiError)
    return {
      message: error.message || fallback,
      status: error.status,
      code: error.code,
      network: error.status === 0,
    };
  if (error instanceof Error)
    return { message: error.message || fallback, status: 0, network: false };
  if (typeof error === 'string' && error) return { message: error, status: 0, network: false };
  return { message: fallback, status: 0, network: false };
}

export const isUnauthorized = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);
export const isConflict = (error: unknown) => error instanceof ApiError && error.status === 409;
