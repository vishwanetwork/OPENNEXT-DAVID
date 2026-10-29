import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { useRegistrationIntent } from '@/features/auth';
import { useSessionStore } from '@/lib/session-store';
import { initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { renderTerminal, signIn } from '@/test/render';
import { BuyerKybOnboardingPrompt } from './index';

beforeEach(() => {
  signIn();
  useWorkspaceStore.setState(initialWorkspace());
  useRegistrationIntent.getState().clear();
});
function completeRegistration() {
  const user = useSessionStore.getState().user;
  if (!user) throw new Error('Missing test user');
  useRegistrationIntent.getState().completed({ ...user, onboardingCompleted: false }, user);
}

describe('first Buyer Terminal entry prompt', () => {
  it('does not prompt an existing account at login', () => {
    renderTerminal(<BuyerKybOnboardingPrompt />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('does not expose the registration prompt in the public Demo', () => {
    completeRegistration();
    renderTerminal(<BuyerKybOnboardingPrompt />, { demo: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useRegistrationIntent.getState().buyerKybAccount).toBe('');
  });
  it('offers Complete KYB and Skip for now only once after registration', () => {
    completeRegistration();
    const view = renderTerminal(<BuyerKybOnboardingPrompt />);
    expect(screen.getByRole('button', { name: 'Complete KYB' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.unmount();
    renderTerminal(<BuyerKybOnboardingPrompt />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('opens the shared KYB flow and consumes the prompt', () => {
    completeRegistration();
    renderTerminal(<BuyerKybOnboardingPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Complete KYB' }));
    expect(useWorkspaceStore.getState().modal).toEqual({ type: 'buyer-kyb' });
    expect(useRegistrationIntent.getState().buyerKybAccount).toBe('');
  });
  it('drops an old account prompt on sign-out and never revives it on login', () => {
    completeRegistration();
    renderTerminal(<BuyerKybOnboardingPrompt />);
    act(() => useSessionStore.getState().markExpired());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => signIn());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
