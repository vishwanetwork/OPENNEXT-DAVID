import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type {
  PaymentReviewDecision,
  PaymentReviewReceipt,
  PaymentReviewRecord,
  PaymentReviewService,
} from '@/lib/payment-review';
import { renderConsole } from '@/test/render';
import { PaymentReviewQueue } from './page';
import { confirmedPaymentDecision, confirmedPaymentRecords, reviewable } from './validation';

const topup: PaymentReviewRecord = {
  id: 'PAY-1',
  accountId: 'buyer-1',
  email: 'buyer@example.com',
  revision: 1,
  kind: 'topup',
  status: 'Pending',
  currency: 'USD',
  amountCents: 10000,
  creditAmountCents: 10000,
  feeAmountCents: 0,
  reference: 'REF-1',
  submittedAt: '2026-10-29T01:00:00Z',
  pricingVersion: 'credit-face-value-v1',
};
const direct: PaymentReviewRecord = {
  ...topup,
  kind: 'direct_pay',
  orderId: 'ORDER-1',
  pricingVersion: 'order-total-v1',
  creditAmountCents: undefined,
  feeAmountCents: undefined,
};
const input: PaymentReviewDecision = {
  caseId: topup.id,
  accountId: topup.accountId,
  expectedRevision: 1,
  idempotencyKey: 'decision-1',
  decision: 'Confirm',
  fundsVerified: true,
  reason: '',
};
function receipt(row: PaymentReviewRecord, request: PaymentReviewDecision): PaymentReviewReceipt {
  return {
    confirmed: true,
    currency: row.currency,
    pricingVersion: row.pricingVersion,
    caseId: row.id,
    accountId: row.accountId,
    revision: row.revision + 1,
    idempotencyKey: request.idempotencyKey,
    status: request.decision === 'Fail' ? 'Failed' : 'Confirmed',
    notificationQueued: true,
    emailQueued: true,
    amountCents: row.amountCents,
    creditAmountCents:
      request.decision === 'Confirm' && row.kind === 'topup' ? (row.creditAmountCents ?? 0) : 0,
    feeAmountCents:
      request.decision === 'Confirm' && row.kind === 'topup' ? (row.feeAmountCents ?? 0) : 0,
    ledgerPosted: request.decision === 'Confirm' && row.kind === 'topup',
    provisioningQueued: request.decision === 'Confirm' && row.kind === 'direct_pay',
  };
}
function adapter(row = topup) {
  return {
    sessionScope: 'operator-a',
    list: vi
      .fn<PaymentReviewService['list']>()
      .mockResolvedValue({ confirmed: true, sessionScope: 'operator-a', records: [row] }),
    decide: vi
      .fn<PaymentReviewService['decide']>()
      .mockImplementation(async (request) => receipt(row, request)),
  };
}
async function confirmButton(label = 'Add Credit') {
  fireEvent.click(await screen.findByRole('button', { name: label }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox'));
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole('button', { name: label === 'Add Credit' ? label : 'Confirm' }),
    );
  });
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('payment review amounts and acknowledgments', () => {
  it('credits top-ups one-to-one and rejects any fee deduction or uplift', () => {
    expect(reviewable(topup)).toBe(true);
    expect(reviewable({ ...topup, amountCents: 10500, feeAmountCents: 500 })).toBe(false);
    expect(reviewable({ ...topup, amountCents: 0, creditAmountCents: 0 })).toBe(false);
    expect(reviewable({ ...topup, amountCents: 10.5, creditAmountCents: 10.5 })).toBe(false);
    expect(reviewable({ ...topup, creditAmountCents: 9975, feeAmountCents: 525 })).toBe(false);
    expect(reviewable({ ...topup, pricingVersion: 'legacy-credit-v1' })).toBe(false);
  });
  it('requires owner, next revision, request key, ledger and both communication outboxes', () => {
    const ack = receipt(topup, input);
    expect(confirmedPaymentDecision(ack, topup, input)).toBe(true);
    for (const change of [
      { accountId: 'other' },
      { caseId: 'other' },
      { revision: 1 },
      { idempotencyKey: 'other' },
      { notificationQueued: false },
      { emailQueued: false },
      { creditAmountCents: 9975 },
      { feeAmountCents: 525 },
      { ledgerPosted: false },
      { provisioningQueued: true },
      { pricingVersion: 'legacy-credit-v1' as const },
    ])
      expect(confirmedPaymentDecision({ ...ack, ...change }, topup, input)).toBe(false);
  });
  it('requires provisioning rather than credit posting for Direct Pay and neither for Fail', () => {
    const ack = receipt(direct, input);
    expect(confirmedPaymentDecision(ack, direct, input)).toBe(true);
    expect(confirmedPaymentDecision({ ...ack, provisioningQueued: false }, direct, input)).toBe(
      false,
    );
    const fail = {
      ...input,
      decision: 'Fail' as const,
      fundsVerified: false,
      reason: 'Funds not received.',
    };
    expect(confirmedPaymentDecision(receipt(direct, fail), direct, fail)).toBe(true);
    expect(
      confirmedPaymentDecision({ ...receipt(direct, fail), ledgerPosted: true }, direct, fail),
    ).toBe(false);
  });
  it('rejects wrong-session, mixed-purpose and duplicate private queue data', () => {
    const response = { confirmed: true, sessionScope: 'operator-a', records: [topup] };
    expect(confirmedPaymentRecords(response, 'topup', 'operator-a')).toHaveLength(1);
    expect(() => confirmedPaymentRecords(response, 'topup', 'operator-b')).toThrow();
    expect(() =>
      confirmedPaymentRecords({ ...response, records: [direct] }, 'topup', 'operator-a'),
    ).toThrow();
    expect(() =>
      confirmedPaymentRecords({ ...response, records: [topup, topup] }, 'topup', 'operator-a'),
    ).toThrow();
  });
});

describe('Console payment review', () => {
  it('fails closed without an adapter and does not report a zero pending count', () => {
    renderConsole(<PaymentReviewQueue kind="topup" />);
    expect(screen.getByText(/Awaiting backend · Verified payment/)).toHaveAttribute(
      'role',
      'status',
    );
    expect(screen.queryByRole('button', { name: 'Add Credit' })).not.toBeInTheDocument();
    expect(screen.queryByText(/0 pending/)).not.toBeInTheDocument();
  });
  it('shows equal received and credited amounts and confirms only a complete server receipt', async () => {
    const service = adapter();
    renderConsole(<PaymentReviewQueue kind="topup" service={service} />);
    expect(await screen.findAllByText('$100.00')).toHaveLength(2);
    expect(screen.queryByRole('columnheader', { name: 'OpenNEXT Fee' })).not.toBeInTheDocument();
    await confirmButton();
    expect(
      await screen.findByText(
        'Decision confirmed. Account notification and email have been queued.',
      ),
    ).toBeInTheDocument();
    expect(service.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: topup.accountId,
        expectedRevision: 1,
        decision: 'Confirm',
        fundsVerified: true,
      }),
    );
  });
  it('requires a Fail reason and sends it without adding Credit', async () => {
    const service = adapter();
    renderConsole(<PaymentReviewQueue kind="topup" service={service} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Fail' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(service.decide).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a reason');
    fireEvent.change(screen.getByRole('textbox', { name: 'Failure reason' }), {
      target: { value: 'The bank reference does not match.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(service.decide).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'Fail',
          fundsVerified: false,
          reason: 'The bank reference does not match.',
        }),
      ),
    );
    expect(
      await screen.findByText(
        'Decision confirmed. Account notification and email have been queued.',
      ),
    ).toBeInTheDocument();
  });
  it('rejects a top-up returned by the Direct Pay service', async () => {
    const service = adapter();
    renderConsole(<PaymentReviewQueue kind="direct_pay" service={service} />);
    // A top-up record cannot be used on the Direct Pay screen.
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be verified');
    expect(service.decide).not.toHaveBeenCalled();
  });
  it('requires independently verified funds before Confirm', async () => {
    const service = adapter(direct);
    renderConsole(<PaymentReviewQueue kind="direct_pay" service={service} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    expect(service.decide).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('independently verified');
  });
  it('uses Confirm for Direct Pay and queues provisioning, never fabricating a running instance', async () => {
    const service = adapter(direct);
    renderConsole(<PaymentReviewQueue kind="direct_pay" service={service} />);
    await confirmButton('Confirm');
    expect(
      await screen.findByText(/Decision confirmed. Provisioning is queued/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
  });
  it('keeps an incomplete acknowledgment unresolved and reuses the same retry key', async () => {
    const service = adapter();
    service.decide.mockImplementation(async (request) => ({
      ...receipt(topup, request),
      emailQueued: false,
    }));
    renderConsole(<PaymentReviewQueue kind="topup" service={service} />);
    await confirmButton();
    expect(await screen.findByRole('alert')).toHaveTextContent('not fully confirmed');
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add Credit' }));
    await waitFor(() => expect(service.decide).toHaveBeenCalledTimes(2));
    expect(service.decide.mock.calls[0]?.[0].idempotencyKey).toBe(
      service.decide.mock.calls[1]?.[0].idempotencyKey,
    );
    expect(
      screen.queryByText('Decision confirmed. Account notification and email have been queued.'),
    ).not.toBeInTheDocument();
  });
  it('keeps legacy amounts visible and disables unsupported versioned decisions', async () => {
    renderConsole(
      <PaymentReviewQueue
        kind="topup"
        service={adapter({ ...topup, pricingVersion: 'legacy-credit-v1' })}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Add Credit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Fail' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('not re-priced');
  });
  it('drops private data and late decision effects on operator-session replacement', async () => {
    const old = adapter();
    const next = {
      ...adapter({ ...topup, email: 'next@example.com' }),
      sessionScope: 'operator-b',
    };
    next.list.mockResolvedValue({
      confirmed: true,
      sessionScope: 'operator-b',
      records: [{ ...topup, email: 'next@example.com' }],
    });
    let resolve: (value: PaymentReviewReceipt) => void = () => {};
    old.decide.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    function Harness() {
      const [switched, setSwitched] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setSwitched(true)}>
            Switch operator
          </button>
          <PaymentReviewQueue kind="topup" service={switched ? next : old} />
        </>
      );
    }
    renderConsole(<Harness />);
    await confirmButton();
    fireEvent.click(screen.getByRole('button', { name: 'Switch operator' }));
    expect(await screen.findByText('next@example.com')).toBeInTheDocument();
    await act(async () => {
      resolve(receipt(topup, old.decide.mock.calls[0]?.[0] ?? input));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('buyer@example.com')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Decision confirmed. Account notification and email have been queued.'),
    ).not.toBeInTheDocument();
  });
});
