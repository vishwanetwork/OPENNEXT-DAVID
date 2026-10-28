import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { BuyerKybSnapshot } from '@/lib/buyer-kyb';
import { useSessionStore } from '@/lib/session-store';
import { accountIdentity, initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { renderTerminal, signIn } from '@/test/render';
import { BuyerKybContent, BuyerKybGate } from './index';
import { serviceFixture, snapshotFixture } from './test-fixtures';

beforeEach(() => {
  useWorkspaceStore.setState(initialWorkspace());
  signIn();
});

const context = { orderId: 'ORDER-42', purchaseReference: undefined, spotCheckout: false };
const returnIntent = () => ({
  identity: accountIdentity(useSessionStore.getState().user, false),
  context,
});

describe('account-bound KYB return intent', () => {
  it('preserves the original order linkage through the KYB gate and fresh approval', async () => {
    const gate = renderTerminal(
      <BuyerKybGate returnTo="topup" topupContext={context}>
        Payment
      </BuyerKybGate>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Complete KYB' }));
    const modal = useWorkspaceStore.getState().modal;
    if (modal?.type !== 'buyer-kyb') throw new Error('KYB modal was not opened.');
    expect(modal.topupReturn).toEqual(returnIntent());
    gate.unmount();
    const service = serviceFixture('Approved');
    renderTerminal(<BuyerKybContent returnTo={modal.returnTo} topupReturn={modal.topupReturn} />, {
      slots: { services: { buyerKyb: service } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to add credit' }));
    await waitFor(() =>
      expect(useWorkspaceStore.getState().modal).toEqual({ type: 'pay-start', ...context }),
    );
  });
  it('clears a captured order intent when the account changes during revalidation', async () => {
    const intent = returnIntent();
    const service = serviceFixture('Approved');
    useWorkspaceStore.getState().openModal('buyer-kyb', { returnTo: 'topup', topupReturn: intent });
    renderTerminal(<BuyerKybContent returnTo="topup" topupReturn={intent} />, {
      slots: { services: { buyerKyb: service } },
    });
    await screen.findByText('Your business is verified.');
    let finish: (snapshot: BuyerKybSnapshot) => void = () => undefined;
    service.load = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to add credit' }));
    act(() => signIn({ id: 'another-buyer' }));
    await act(async () => finish(snapshotFixture('Approved')));
    await waitFor(() => expect(useWorkspaceStore.getState().modal).toBeNull());
    expect(
      screen.queryByRole('button', { name: 'Continue to add credit' }),
    ).not.toBeInTheDocument();
  });
  it('does not resume an order when the refreshed KYB is no longer approved', async () => {
    const service = serviceFixture('Approved');
    const intent = returnIntent();
    useWorkspaceStore.getState().openModal('buyer-kyb', { returnTo: 'topup', topupReturn: intent });
    renderTerminal(<BuyerKybContent returnTo="topup" topupReturn={intent} />, {
      slots: { services: { buyerKyb: service } },
    });
    await screen.findByText('Your business is verified.');
    service.load = async () => snapshotFixture('Reviewing');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to add credit' }));
    await screen.findByText('Your KYB is under review.');
    expect(useWorkspaceStore.getState().modal?.type).toBe('buyer-kyb');
  });
});
