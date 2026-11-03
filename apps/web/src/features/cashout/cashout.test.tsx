import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderTerminal, signIn } from '@/test/render';
import { useSessionStore } from '@/lib/session-store';
import { CashoutForm } from './components/cashout-form';
import { CashoutHistory } from './components/history';
import { kybFixture, receiptFixture, snapshotFixture } from './test-fixtures';

beforeEach(() => {
  signIn();
});

function fillForm() {
  fireEvent.change(screen.getByLabelText('Cashout amount (USD)'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Bank name'), { target: { value: 'Example Bank' } });
  fireEvent.change(screen.getByLabelText('Bank country'), { target: { value: 'GB' } });
  fireEvent.change(screen.getByLabelText('Bank address'), {
    target: { value: '2 Bank Road, London' },
  });
  fireEvent.change(screen.getByLabelText('Account number (or provide IBAN)'), {
    target: { value: '12345678' },
  });
  fireEvent.change(screen.getByLabelText('SWIFT / BIC'), { target: { value: 'EXAMGB2L' } });
  fireEvent.click(screen.getByRole('checkbox'));
}

describe('Buyer Cashout', () => {
  it('fails closed without the service and never treats available Credit as withdrawable', () => {
    renderTerminal(<CashoutForm kyb={kybFixture} close={vi.fn()} />, {
      billing: { availableCredit: 500 },
    });
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(screen.getByLabelText('Bank name')).toBeDisabled();
    expect(screen.getByText(/Cashout processing is not connected/)).toBeInTheDocument();
    expect(screen.queryByText('$500.00')).not.toBeInTheDocument();
  });
  it('locks the verified beneficiary and submits only one reserved, owner-bound request', async () => {
    const submit = vi.fn().mockResolvedValue(receiptFixture);
    renderTerminal(<CashoutForm kyb={kybFixture} close={vi.fn()} />, {
      slots: { services: { cashout: { load: async () => snapshotFixture, submit } } },
    });
    await screen.findByText('$100.00');
    expect(screen.getByLabelText('Beneficiary legal name (approved KYB)')).toHaveAttribute(
      'readonly',
    );
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByText('Cashout request submitted');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      accountId: 'u1',
      amountCents: 10000,
      idempotencyKey: 'server-issued-key',
      expectedKybRevision: 2,
      bank: { beneficiaryName: 'Example Limited' },
    });
  });
  it('reuses the same server-issued key and unchanged input after an ambiguous failure', async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error('Connection interrupted'))
      .mockResolvedValueOnce(receiptFixture);
    renderTerminal(<CashoutForm kyb={kybFixture} close={vi.fn()} />, {
      slots: { services: { cashout: { load: async () => snapshotFixture, submit } } },
    });
    await screen.findByText('$100.00');
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByText('Connection interrupted');
    expect(screen.getByLabelText('Cashout amount (USD)')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
    await screen.findByText('Cashout request submitted');
    expect(submit.mock.calls[0]?.[0]).toEqual(submit.mock.calls[1]?.[0]);
  });
  it('does not show private cashout history after the account session expires', async () => {
    renderTerminal(<CashoutHistory />, {
      slots: {
        services: {
          cashout: {
            load: async () => ({ ...snapshotFixture, requests: [receiptFixture.request] }),
            submit: vi.fn(),
          },
        },
      },
    });
    await screen.findByText('Example Bank · ****5678');
    act(() => useSessionStore.getState().markExpired());
    await waitFor(() =>
      expect(screen.queryByText('Example Bank · ****5678')).not.toBeInTheDocument(),
    );
  });
  it('does not call real cashout services in Demo', () => {
    const load = vi.fn();
    renderTerminal(<CashoutHistory />, {
      demo: true,
      slots: { services: { cashout: { load, submit: vi.fn() } } },
    });
    expect(load).not.toHaveBeenCalled();
    expect(screen.getByText(/Cashout processing is not connected/)).toBeInTheDocument();
  });
  it('does not load buyer withdrawals for a seller', () => {
    signIn({ role: 'seller' });
    const load = vi.fn();
    renderTerminal(<CashoutHistory />, {
      slots: { services: { cashout: { load, submit: vi.fn() } } },
    });
    expect(load).not.toHaveBeenCalled();
  });
});
