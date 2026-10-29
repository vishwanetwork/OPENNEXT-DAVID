import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type {
  BankTransferIntent,
  BankTransferService,
  BuyerKybService,
  BuyerKybStatus,
} from '@/lib/buyer-kyb';
import { queryKeys } from '@/lib/api/query-keys';
import { useSessionStore } from '@/lib/session-store';
import { accountIdentity, initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { renderTerminal, signIn, testQueryClient } from '@/test/render';
import { BankTransferBody } from './components/transfer-modal';
import { useStartBankTransfer } from './hooks';

const intent: BankTransferIntent = {
  confirmed: true,
  accountId: 'u1',
  demo: false,
  id: 'transfer-1',
  purpose: 'topup',
  currency: 'USD',
  amountCents: 10000,
  pricingVersion: 'credit-face-value-v1',
  creditAmountCents: 10000,
  feeAmountCents: 0,
  idempotencyKey: 'create-1',
  reference: 'ONX-100',
  expiresAt: '2099-01-01T00:00:00Z',
};
const request = {
  purpose: 'topup' as const,
  currency: 'USD' as const,
  amountCents: 10000,
  pricingVersion: 'credit-face-value-v1' as const,
  creditAmountCents: 10000,
  feeAmountCents: 0,
  idempotencyKey: 'create-1',
};
const bankService = (): BankTransferService => ({
  create: vi.fn(async () => intent),
  reportSent: vi.fn(async () => ({
    confirmed: true,
    intentId: intent.id,
    status: 'Awaiting payment confirmation' as const,
  })),
});
const kybService = (status: BuyerKybStatus = 'Approved'): BuyerKybService => ({
  load: vi.fn(async () => ({
    confirmed: true,
    accountId: 'u1',
    demo: false,
    verification: {
      id: 'kyb-1',
      accountId: 'u1',
      email: 'ada@example.com',
      mode: 'Auto' as const,
      status,
      revision: 1,
      submittedAt: '2026-10-27T00:00:00Z',
      documents: [],
      company: {
        country: 'SG',
        companyName: 'Example Ltd',
        registrationNumber: '',
        email: '',
        website: '',
        taxId: '',
        monthlyVolumeUsd: '',
        monthlyTransactions: '',
        businessDescription: '',
        incorporationDate: '',
        legalForm: '',
        legalAddress: '',
        phone: '',
      },
    },
  })),
  submit: vi.fn(),
});

function Start() {
  const transfer = useStartBankTransfer();
  return (
    <>
      <button type="button" onClick={() => void transfer.start(request)}>
        Start transfer
      </button>
      <p>{transfer.error}</p>
      <p>{transfer.busy ? 'Busy' : 'Idle'}</p>
    </>
  );
}

beforeEach(() => {
  useWorkspaceStore.setState(initialWorkspace());
  signIn();
});

describe('bank transfer frontend', () => {
  it('fails closed without a payment adapter', () => {
    renderTerminal(<Start />);
    fireEvent.click(screen.getByRole('button', { name: 'Start transfer' }));
    expect(screen.getByText(/Bank transfers are not connected yet/)).toBeInTheDocument();
    expect(useWorkspaceStore.getState().modal).toBeNull();
  });
  it('never calls an injected live service in Demo or exposes bank instructions', () => {
    const bank = bankService();
    renderTerminal(
      <>
        <Start />
        <BankTransferBody id={intent.id} close={vi.fn()} />
      </>,
      { demo: true, slots: { services: { buyerKyb: kybService(), bankTransfer: bank } } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start transfer' }));
    expect(bank.create).not.toHaveBeenCalled();
    expect(screen.queryByText('79211900001010')).not.toBeInTheDocument();
  });
  it('requires fresh approval and caches only a verified receipt', async () => {
    const kyb = kybService();
    const bank = bankService();
    const view = renderTerminal(<Start />, {
      slots: { services: { buyerKyb: kyb, bankTransfer: bank } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start transfer' }));
    await waitFor(() =>
      expect(useWorkspaceStore.getState().modal).toEqual({ type: 'bank-transfer', id: intent.id }),
    );
    expect(kyb.load).toHaveBeenCalled();
    expect(bank.create).toHaveBeenCalledWith(request);
    const identity = accountIdentity(useSessionStore.getState().user, false);
    expect(
      view.queryClient.getQueryData(queryKeys.account.bankTransfer(identity, intent.id)),
    ).toEqual({ intent });
  });
  it('does not submit payment for Reviewing KYB', async () => {
    const bank = bankService();
    renderTerminal(<Start />, {
      slots: { services: { buyerKyb: kybService('Reviewing'), bankTransfer: bank } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start transfer' }));
    expect(
      await screen.findByText(/Approved business verification is required/),
    ).toBeInTheDocument();
    expect(bank.create).not.toHaveBeenCalled();
  });
  it('does not cache a matching-price receipt from another creation request', async () => {
    const bank = bankService();
    bank.create = vi.fn(async () => ({ ...intent, idempotencyKey: 'different-request' }));
    const view = renderTerminal(<Start />, {
      slots: { services: { buyerKyb: kybService(), bankTransfer: bank } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start transfer' }));
    expect(
      await screen.findByText(/bank transfer request could not be verified/),
    ).toBeInTheDocument();
    expect(useWorkspaceStore.getState().modal).toBeNull();
    const identity = accountIdentity(useSessionStore.getState().user, false);
    expect(
      view.queryClient.getQueryData(queryKeys.account.bankTransfer(identity, intent.id)),
    ).toBeUndefined();
  });
  it('discards a late payment response after switching accounts', async () => {
    let complete: ((value: BankTransferIntent) => void) | undefined;
    const bank = bankService();
    bank.create = vi.fn(
      () =>
        new Promise<BankTransferIntent>((resolve) => {
          complete = resolve;
        }),
    );
    renderTerminal(<Start />, {
      slots: { services: { buyerKyb: kybService(), bankTransfer: bank } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start transfer' }));
    await waitFor(() => expect(bank.create).toHaveBeenCalled());
    act(() => signIn({ id: 'u2' }));
    await act(async () => complete?.(intent));
    expect(useWorkspaceStore.getState().modal).toBeNull();
    expect(screen.getByText('Idle')).toBeInTheDocument();
  });
  it('shows bank details only for approved owners and reports pending, never paid', async () => {
    const bank = bankService();
    const kyb = kybService();
    const client = testQueryClient();
    const identity = accountIdentity(useSessionStore.getState().user, false);
    client.setQueryData(queryKeys.account.bankTransfer(identity, intent.id), { intent });
    renderTerminal(<BankTransferBody id={intent.id} close={vi.fn()} />, {
      queryClient: client,
      slots: { services: { buyerKyb: kyb, bankTransfer: bank } },
    });
    expect(await screen.findByText('79211900001010')).toBeInTheDocument();
    expect(screen.getByText('BH10SGBD79211900001010')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'I have made the transfer' }));
    expect(
      await screen.findByRole('heading', { name: 'Awaiting payment confirmation' }),
    ).toBeInTheDocument();
    expect(bank.reportSent).toHaveBeenCalledWith({
      intentId: intent.id,
      idempotencyKey: `report-transfer:${intent.id}`,
    });
    expect(screen.getByText(/No credit or capacity has been issued/)).toBeInTheDocument();
    expect(screen.queryByText('79211900001010')).not.toBeInTheDocument();
  });
  it('does not expose a different account’s cached instructions', async () => {
    const client = testQueryClient();
    const identity = accountIdentity(useSessionStore.getState().user, false);
    client.setQueryData(queryKeys.account.bankTransfer(identity, intent.id), {
      intent: { ...intent, accountId: 'u2' },
    });
    renderTerminal(<BankTransferBody id={intent.id} close={vi.fn()} />, {
      queryClient: client,
      slots: { services: { buyerKyb: kybService(), bankTransfer: bankService() } },
    });
    await waitFor(() =>
      expect(screen.getByText(/Verified payment instructions are unavailable/)).toBeInTheDocument(),
    );
    expect(screen.queryByText('79211900001010')).not.toBeInTheDocument();
  });
  it('retains the same report idempotency key after an unconfirmed response', async () => {
    const bank = bankService();
    bank.reportSent = vi
      .fn()
      .mockResolvedValueOnce({
        confirmed: false,
        intentId: intent.id,
        status: 'Awaiting payment confirmation',
      })
      .mockResolvedValueOnce({
        confirmed: true,
        intentId: intent.id,
        status: 'Awaiting payment confirmation',
      });
    const client = testQueryClient();
    const identity = accountIdentity(useSessionStore.getState().user, false);
    client.setQueryData(queryKeys.account.bankTransfer(identity, intent.id), { intent });
    renderTerminal(<BankTransferBody id={intent.id} close={vi.fn()} />, {
      queryClient: client,
      slots: { services: { buyerKyb: kybService(), bankTransfer: bank } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'I have made the transfer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your transfer report could not be verified.',
    );
    expect(
      screen.queryByRole('heading', { name: 'Awaiting payment confirmation' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'I have made the transfer' }));
    expect(
      await screen.findByRole('heading', { name: 'Awaiting payment confirmation' }),
    ).toBeInTheDocument();
    expect(bank.reportSent).toHaveBeenNthCalledWith(1, {
      intentId: intent.id,
      idempotencyKey: `report-transfer:${intent.id}`,
    });
    expect(bank.reportSent).toHaveBeenNthCalledWith(2, {
      intentId: intent.id,
      idempotencyKey: `report-transfer:${intent.id}`,
    });
  });
});
