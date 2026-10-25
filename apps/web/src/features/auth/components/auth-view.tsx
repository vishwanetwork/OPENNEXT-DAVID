'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SessionUser } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { useSessionStore } from '@/lib/session-store';
import { authApi } from '../api';
import { useRoleIntent } from '../hooks';
import { AuthError, AuthShell, SubmitButton } from './auth-shell';
import { GitHubIcon, GoogleIcon } from '@/components/icons';

export type AuthMode = 'signin' | 'signup' | 'verify';

export function fieldError(name: string, raw: string): string {
  const value = raw.trim();
  if (name === 'email')
    return !value
      ? 'Enter your email address.'
      : value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ? 'Enter a valid email address, like you@company.com.'
        : '';
  if (name === 'code')
    return !value
      ? 'Enter the verification code from your email.'
      : !/^[0-9]{6,8}$/.test(value)
        ? 'The verification code is 6 to 8 digits.'
        : '';
  return '';
}

export interface AuthViewProps {
  initialMode?: AuthMode;
  onLogin: (user: SessionUser) => void;
  onBack: () => void;
  onMode?: (mode: AuthMode) => void;
}

/** Sign in / create account / verify code. Identity is verified by the server session. */
export function AuthView({ initialMode = 'signin', onLogin, onBack, onMode }: AuthViewProps) {
  const api = useApi();
  const setUser = useSessionStore((s) => s.setUser);
  const intent = useRoleIntent();
  const [mode, setMode] = useState<AuthMode>(initialMode === 'verify' ? 'signin' : initialMode);
  const [email, setEmail] = useState('');
  const [challenge, setChallenge] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstInput.current?.focus();
  }, [mode]);
  useEffect(() => {
    if (error) errorRef.current?.querySelector<HTMLElement>('[data-auth-error]')?.focus();
  }, [error]);

  const switchMode = (next: AuthMode) => {
    setError('');
    onMode?.(next);
    setMode(next);
  };
  const provider = async (name: 'google' | 'github') => {
    setError('');
    setBusy(true);
    try {
      const config = await authApi.config(api);
      if (!config.providers?.[name])
        throw new Error(
          (name === 'google' ? 'Google' : 'GitHub') +
            ' sign-in is not configured yet. Please contact OpenNEXT support.',
        );
      // The OAuth start endpoint is served by the backend (not a Next route).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/api/auth/oauth/' + name + '/start';
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  };
  const submitEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get('email') || '');
    const message = fieldError('email', value);
    if (message) return setError(message);
    setError('');
    setBusy(true);
    try {
      const result = await authApi.requestEmailCode(api, value.trim());
      setEmail(value.trim());
      setChallenge(result.challengeId);
      setMode('verify');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submitCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get('code') || '');
    const message = fieldError('code', value);
    if (message) return setError(message);
    setError('');
    setBusy(true);
    try {
      const user = await authApi.verifyEmailCode(api, challenge, value);
      intent.bind(user);
      setUser(user);
      onLogin(user);
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  };

  if (mode === 'verify')
    return (
      <AuthShell onBack={onBack}>
        <div className="onx-auth-kicker">Verify your email</div>
        <h1>Check your inbox.</h1>
        <p className="onx-auth-subtitle">
          Enter the verification code sent to <strong>{email}</strong>. The code expires in 10
          minutes.
        </p>
        <form data-auth-verify noValidate onSubmit={submitCode}>
          <label className="onx-auth-field">
            <span>Verification code</span>
            <input
              ref={firstInput}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,8}"
              minLength={6}
              maxLength={8}
              placeholder="Enter your verification code"
              required
              aria-invalid={error ? 'true' : undefined}
              onInput={() => error && setError('')}
            />
          </label>
          <div ref={errorRef}>
            <AuthError message={error} />
          </div>
          <SubmitButton disabled={busy}>Verify and continue</SubmitButton>
        </form>
        <div className="onx-auth-account-switch">
          <button
            type="button"
            className="onx-auth-link"
            data-auth-mode="signin"
            onClick={() => switchMode('signin')}
          >
            Use another email or request a new code
          </button>
        </div>
      </AuthShell>
    );

  return (
    <AuthShell onBack={onBack}>
      <div className="onx-auth-kicker">Your capacity workspace</div>
      <h1>{mode === 'signup' ? 'Start with OpenNEXT.' : 'Welcome back.'}</h1>
      <p className="onx-auth-subtitle">
        Sign in securely to source, compare and manage AI capacity.
      </p>
      <div className="onx-auth-providers">
        <button
          className="onx-auth-provider onx-auth-google"
          type="button"
          data-auth-provider="google"
          disabled={busy}
          onClick={() => provider('google')}
        >
          <GoogleIcon />
          <span>Continue with Google</span>
        </button>
        <button
          className="onx-auth-provider onx-auth-github"
          type="button"
          data-auth-provider="github"
          disabled={busy}
          onClick={() => provider('github')}
        >
          <GitHubIcon />
          <span>Continue with GitHub</span>
        </button>
      </div>
      <p className="onx-auth-smallnote">
        Your account is verified by your sign-in provider. OpenNEXT never asks for your Google or
        GitHub password.
      </p>
      <div className="onx-auth-divider">or continue with email</div>
      <form data-auth-email noValidate onSubmit={submitEmail}>
        <label className="onx-auth-field">
          <span>Email address</span>
          <input
            ref={firstInput}
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
            maxLength={254}
            defaultValue={email}
            aria-invalid={error ? 'true' : undefined}
            onInput={() => error && setError('')}
          />
        </label>
        <div ref={errorRef}>
          <AuthError message={error} />
        </div>
        <SubmitButton disabled={busy}>Send verification code</SubmitButton>
      </form>
      <p className="onx-auth-smallnote">
        We will email you a one-time code. No password is required.
      </p>
      <div className="onx-auth-account-switch">
        {mode === 'signup' ? 'Already have an account?' : 'New to OpenNEXT?'}{' '}
        <button
          className="onx-auth-link"
          type="button"
          data-auth-mode={mode === 'signup' ? 'signin' : 'signup'}
          onClick={() => switchMode(mode === 'signup' ? 'signin' : 'signup')}
        >
          {mode === 'signup' ? 'Sign in' : 'Create account'}
        </button>
      </div>
      <details className="onx-auth-other">
        <summary>Other sign-in options</summary>
        <div className="onx-auth-other-options">
          <button type="button" disabled>
            Microsoft
          </button>
          <button type="button" disabled>
            Company SSO
          </button>
          <button type="button" disabled>
            Passkey
          </button>
        </div>
        <p className="onx-auth-smallnote">Additional verified sign-in methods are coming soon.</p>
      </details>
    </AuthShell>
  );
}
