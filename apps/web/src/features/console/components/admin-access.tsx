'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { AdminSessionOk } from '@opennext/contracts';
import { ApiError } from '@/lib/api/client';
import { useApi } from '@/components/providers/api-context';

/** True when a request failed because the administrator session is missing or expired. */
export const isAccessError = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);

/**
 * Exchanges the server administrator token for the short-lived HttpOnly session cookie
 * (`POST /api/admin/pricing/session`). The same session authorises every protected console API.
 */
export function useAdminLogin(onConnected?: () => void | Promise<void>) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) =>
      AdminSessionOk.parse(await api.post('/api/admin/pricing/session', { token })),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await onConnected?.();
    },
  });
}

/**
 * Token form shared by the console pages. Each page supplies its own wrapper markup/copy;
 * the input is cleared before the request is sent, exactly like the legacy modules.
 */
export function AdminLoginForm({
  intro,
  inputClassName = '',
  buttonClassName = 'btn primary',
  errorClassName = 'market-console-error',
  labelClassName = '',
  onConnected,
}: {
  intro?: React.ReactNode;
  inputClassName?: string;
  buttonClassName?: string;
  errorClassName?: string;
  labelClassName?: string;
  onConnected?: () => void | Promise<void>;
}) {
  const login = useAdminLogin(onConnected);
  const [token, setToken] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (login.isPending) return;
    const value = token;
    setToken('');
    login.mutate(value);
  };
  return (
    <form onSubmit={submit} data-admin-login>
      {intro}
      <label className={labelClassName}>
        Administrator token
        <input
          className={inputClassName}
          name="token"
          type="password"
          autoComplete="new-password"
          required
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </label>
      <p className={errorClassName} role="alert" hidden={!login.isError}>
        {login.error instanceof Error ? login.error.message : ''}
      </p>
      <button type="submit" className={buttonClassName} disabled={login.isPending}>
        Connect
      </button>
    </form>
  );
}
