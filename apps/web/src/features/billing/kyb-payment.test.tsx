import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderTerminal, signIn } from '@/test/render';
import { initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { PaymentAmount, PaymentMethod } from './components/payment-flow';
import { paymentIdentity, usePaymentStore } from './payments';
import { useSessionStore } from '@/lib/session-store';

beforeEach(() => {
  useWorkspaceStore.setState(initialWorkspace());
  signIn();
  useWorkspaceStore.getState().applySession(useSessionStore.getState().user);
  usePaymentStore.getState().setDraft(null);
});

describe('bank-only credit top-up', () => {
  it('selects Other when entering a custom amount and preserves the chosen total', () => {
    renderTerminal(<PaymentAmount />);
    fireEvent.change(screen.getByRole('spinbutton', { name: /Other amount/ }), {
      target: { value: '125.50' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Process' }));
    expect(usePaymentStore.getState().draft?.amount).toBe(125.5);
    expect(useWorkspaceStore.getState().modal?.type).toBe('payment-method');
  });
  it('offers only bank transfer and disables payment without connected services', () => {
    const user = useSessionStore.getState().user;
    usePaymentStore.getState().setDraft({
      amount: 500,
      orderId: null,
      purchaseReference: '',
      idempotencyKey: 'topup-1',
      owner: paymentIdentity(user, 'buyer', user?.id, false),
    });
    renderTerminal(<PaymentMethod />);
    expect(screen.getByRole('radio', { name: /Bank transfer/ })).toBeChecked();
    expect(screen.queryByRole('radio', { name: /Credit card|PayPal/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Proceed to payment' })).toBeDisabled();
    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.queryByText(/OpenNEXT Fee/)).not.toBeInTheDocument();
    expect(screen.queryByText('$525.00')).not.toBeInTheDocument();
  });
});
