'use client';

import { AsyncButton } from '@/components/ui/async-feedback';
import { useState } from 'react';
import type { SessionUser } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { useSessionStore } from '@/lib/session-store';
import { authApi } from '../api';
import { useRoleIntent } from '../hooks';
import { allowedRole, type Role } from '../role-intent';
import { useRegistrationIntent } from '../registration-intent';
import { AuthError, AuthShell } from './auth-shell';
import { ArrowIcon, CheckIcon } from '@/components/icons';

export interface OnboardingViewProps {
  user: SessionUser;
  onComplete: (user: SessionUser) => void;
  onBack: () => void;
}

/** First-workspace setup: choose Buyer or Seller, then the one-time promotional credit screen. */
export function OnboardingView({ user, onComplete, onBack }: OnboardingViewProps) {
  const api = useApi();
  const setUser = useSessionStore((s) => s.setUser);
  const intent = useRoleIntent();
  const [stage, setStage] = useState<'role' | 'reward'>('role');
  const [role, setRole] = useState<Role | ''>(intent.preferred(user) === 'buyer' ? 'buyer' : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const open = (
    <button
      className="onx-auth-submit"
      type="button"
      data-onboarding-complete
      onClick={() => onComplete(user)}
    >
      Open Terminal <ArrowIcon />
    </button>
  );
  if (user.onboardingCompleted && stage !== 'reward')
    return (
      <AuthShell onBack={onBack}>
        <div className="onx-auth-kicker">Your workspace is ready</div>
        <h1>Welcome back.</h1>
        <p className="onx-auth-subtitle">Continue to your existing OpenNEXT workspace.</p>
        {open}
      </AuthShell>
    );
  if (stage === 'reward' && user.onboardingCompleted)
    return (
      <AuthShell onBack={onBack}>
        <div className="onx-auth-success-icon">
          <CheckIcon />
        </div>
        <div className="onx-auth-kicker">Welcome to OpenNEXT</div>
        <h1>
          Your first $100.
          <br />
          On us.
        </h1>
        <p className="onx-auth-subtitle">
          A one-time <strong>$100 promotional credit</strong> has been added to your account.
        </p>
        <div className="onx-auth-reward">
          <span>Promotional credit</span>
          <strong>$100.00</strong>
          <small>
            For eligible OpenNEXT purchases. Non-withdrawable and non-transferable. Future funding
            is available in Billing.
          </small>
        </div>
        {open}
      </AuthShell>
    );

  const choose = (value: Role) => {
    if (intent.set(value, user)) setRole(value);
  };
  const next = async () => {
    setError('');
    if (user.onboardingCompleted || !allowedRole(role))
      return setError('Choose Buyer for your first workspace setup.');
    setBusy(true);
    try {
      const result = await authApi.onboarding(api, role as Role);
      if (
        !result ||
        result.id !== user.id ||
        !result.onboardingCompleted ||
        !allowedRole(result.role)
      )
        throw new Error(
          'Account setup was not confirmed. Refresh your session before trying again.',
        );
      const current = useSessionStore.getState();
      if (current.status !== 'verified' || current.user?.id !== user.id) return;
      intent.bind(result);
      useRegistrationIntent.getState().completed(user, result);
      setUser(result);
      setStage('reward');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell onBack={onBack}>
      <div className="onx-auth-kicker">Set up your workspace</div>
      <h1>
        How will you
        <br />
        use OpenNEXT?
      </h1>
      <p className="onx-auth-subtitle">
        Signed in as <strong>{user.email}</strong>. Set up your Buyer workspace.
      </p>
      <div className="onx-auth-roles" role="group" aria-label="Choose your role">
        <AsyncButton
          busy={busy}
          type="button"
          className="onx-auth-role"
          data-onboarding-role="buyer"
          aria-pressed={role === 'buyer'}
          disabled={busy}
          onClick={() => choose('buyer')}
        >
          <strong>Buyer</strong>
          <span>Find GPU capacity, request quotes and manage your resources.</span>
          <i aria-hidden="true" />
        </AsyncButton>
        <AsyncButton
          busy={busy}
          type="button"
          className="onx-auth-role"
          data-onboarding-role="seller"
          aria-pressed={role === 'seller'}
          disabled
          aria-disabled="true"
        >
          <strong>Seller</strong>
          <span>Verify your business, list available capacity and respond to demand.</span>
          <i aria-hidden="true" />
        </AsyncButton>
        <button type="button" className="onx-auth-role" disabled aria-disabled="true">
          <strong>
            Broker <small>Coming soon</small>
          </strong>
          <span>Broker access is not available yet.</span>
        </button>
      </div>
      <AuthError message={error} />
      <AsyncButton
        busy={busy}
        className="onx-auth-submit"
        type="button"
        data-onboarding-next
        disabled={!role || busy}
        onClick={next}
      >
        Next <ArrowIcon />
      </AsyncButton>
      <p className="onx-auth-smallnote">
        Complete setup to receive a one-time $100 promotional credit. Promotional credit cannot be
        withdrawn.
      </p>
    </AuthShell>
  );
}
