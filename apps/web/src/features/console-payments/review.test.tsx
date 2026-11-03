import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  adapter,
  direct,
  input,
  receipt,
  topup,
  type PaymentReviewReceipt,
} from '@/test/payment-review-fixture';
import { renderConsole } from '@/test/render';
import { PaymentReviewQueue } from './page';
import { confirmedPaymentDecision, confirmedPaymentRecords, reviewable } from './validation';

async function confirmButton() {
  fireEvent.click(await screen.findByRole('button', { name: 'Completed' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox'));
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Completed' }));
  });
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('payment review amounts and acknowledgments', () => {
  it('confirms order-linked floating funding without accepting it for historical payments', () => {
    const row = {
      ...direct,
      fundingPolicy: 'spot-hourly-v1' as const,
      fundingOrderId: 'funding-1',
      orderId: 'opennext-funding-1',
    };
    const result: PaymentReviewReceipt = {
      ...receipt(row, input),
      directPayResolution: undefined,
      creditAmountCents: 0,
      ledgerPosted: true,
      provisioningQueued: true,
      fundingResolution: {
        policy: 'spot-hourly-v1',
        fundingOrderId: 'funding-1',
        orderId: row.orderId,
        outcome: 'funded',
      },
    };
    expect(confirmedPaymentDecision(result, row, input)).toBe(true);
    expect(confirmedPaymentDecision(result, direct, input)).toBe(false);
    expect(confirmedPaymentDecision({ ...result, ledgerPosted: false }, row, input)).toBe(false);
    expect(
      confirmedPaymentDecision(
        {
          ...result,
          fundingResolution: {
            policy: 'spot-hourly-v1',
            fundingOrderId: 'another-order',
            orderId: row.orderId,
            outcome: 'funded',
          },
        },
        row,
        input,
      ),
    ).toBe(false);
    expect(
      confirmedPaymentDecision(
        {
          ...result,
          provisioningQueued: false,
          creditAmountCents: row.amountCents,
          fundingResolution: {
            policy: 'spot-hourly-v1',
            fundingOrderId: 'funding-1',
            orderId: row.orderId,
            outcome: 'credited',
          },
        },
        row,
        input,
      ),
    ).toBe(true);
  });
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
  it('requires paid continuation rather than automatic provisioning, and neither for Failed', () => {
    const ack = receipt(direct, input);
    expect(confirmedPaymentDecision(ack, direct, input)).toBe(true);
    expect(confirmedPaymentDecision({ ...ack, provisioningQueued: true }, direct, input)).toBe(
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
    expect(screen.queryByRole('button', { name: 'Completed' })).not.toBeInTheDocument();
    expect(screen.queryByText(/0 pending/)).not.toBeInTheDocument();
  });
  it('shows the requested columns, confirmed balance and only accepts a complete server receipt', async () => {
    const service = adapter();
    renderConsole(<PaymentReviewQueue kind="topup" service={service} />);
    expect(await screen.findByText('$100.00')).toBeInTheDocument();
    expect(screen.getByText('$25.00')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((node) => node.textContent)).toEqual([
      'Account #',
      'Top-up Amount',
      'Current Credit',
      'Action',
    ]);
    expect(screen.queryByRole('columnheader', { name: 'OpenNEXT Fee' })).not.toBeInTheDocument();
    await confirmButton();
    expect(
      await screen.findByText(
        'Top-up completed. Credit has been added; notification and email have been queued.',
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
    fireEvent.click(await screen.findByRole('button', { name: 'Failed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(service.decide).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a reason');
    fireEvent.change(screen.getByRole('textbox', { name: 'Failure reason' }), {
      target: { value: 'The bank reference does not match.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
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
        'Failed. The reason has been queued for the customer notification and email.',
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
    fireEvent.click(await screen.findByRole('button', { name: 'Completed' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Completed' }));
    expect(service.decide).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('independently verified');
  });
  it('uses the new completion capability without invoking old auto-provisioning', async () => {
    const service = adapter(direct);
    renderConsole(<PaymentReviewQueue kind="direct_pay" service={service} />);
    await confirmButton();
    expect(
      await screen.findByText(/Payment completed. Notification and email include/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
    expect(service.completeDirectPay).toHaveBeenCalledTimes(1);
    expect(service.decide).not.toHaveBeenCalled();
    expect(screen.getAllByRole('columnheader').map((node) => node.textContent)).toEqual([
      'Order',
      'Payment Amount',
      'Account #',
      'Email',
      'Action',
    ]);
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
    fireEvent.click(within(dialog).getByRole('button', { name: 'Completed' }));
    await waitFor(() => expect(service.decide).toHaveBeenCalledTimes(2));
    expect(service.decide.mock.calls[0]?.[0].idempotencyKey).toBe(
      service.decide.mock.calls[1]?.[0].idempotencyKey,
    );
    expect(
      screen.queryByText(
        'Top-up completed. Credit has been added; notification and email have been queued.',
      ),
    ).not.toBeInTheDocument();
  });
  it('keeps legacy amounts visible and disables unsupported versioned decisions', async () => {
    renderConsole(
      <PaymentReviewQueue
        kind="topup"
        service={adapter({ ...topup, pricingVersion: 'legacy-credit-v1' })}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Completed' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Failed' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'View request PAY-1' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('not re-priced');
  });
  it('drops private data and late decision effects on operator-session replacement', async () => {
    const old = adapter();
    const next = {
      ...adapter({ ...topup, accountNumber: 'ON-2002', email: 'next@example.com' }),
      sessionScope: 'operator-b',
    };
    next.list.mockResolvedValue({
      confirmed: true,
      sessionScope: 'operator-b',
      records: [{ ...topup, accountNumber: 'ON-2002', email: 'next@example.com' }],
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
    expect(await screen.findByText('ON-2002')).toBeInTheDocument();
    await act(async () => {
      resolve(receipt(topup, old.decide.mock.calls[0]?.[0] ?? input));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('buyer@example.com')).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'Top-up completed. Credit has been added; notification and email have been queued.',
      ),
    ).not.toBeInTheDocument();
  });
});
