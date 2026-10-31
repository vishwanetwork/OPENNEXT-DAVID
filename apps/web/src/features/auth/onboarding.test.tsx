import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useSessionStore } from '@/lib/session-store';
import { jsonResponse, mockFetch, renderTerminal, signIn } from '@/test/render';
import { OnboardingView } from './components/onboarding-view';
import { useRegistrationIntent } from './registration-intent';

beforeEach(() => {
  useRegistrationIntent.getState().clear();
  signIn({ onboardingCompleted: false, role: 'buyer' });
});

describe('confirmed first onboarding signal', () => {
  it('marks the one-shot KYB intent only after a confirmed Buyer completion', async () => {
    const user = useSessionStore.getState().user;
    if (!user) throw new Error('Expected test session');
    mockFetch(() => jsonResponse({ user: { ...user, onboardingCompleted: true } }));
    renderTerminal(<OnboardingView user={user} onComplete={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Seller/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Buyer/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(useRegistrationIntent.getState().buyerKybAccount).toBe('u1'));
  });
  it('never marks completion for a mismatched server account', async () => {
    const user = useSessionStore.getState().user;
    if (!user) throw new Error('Expected test session');
    mockFetch(() => jsonResponse({ user: { ...user, id: 'other', onboardingCompleted: true } }));
    renderTerminal(<OnboardingView user={user} onComplete={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Seller/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Buyer/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/Account setup was not confirmed/)).toBeInTheDocument();
    expect(useRegistrationIntent.getState().buyerKybAccount).toBe('');
  });
});
