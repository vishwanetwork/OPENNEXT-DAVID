import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type {
  PaymentReviewDecision,
  PaymentReviewReceipt,
  PaymentReviewRecord,
  PaymentReviewService,
} from '@/lib/payment-review';
import { renderConsole } from '@/test/render';
import { PaymentDecisionDialog } from './decision-dialog';
import { PaymentReviewQueue } from './page';
import { PaymentRequestTable } from './request-table';
import { canComplete, confirmedPaymentDecision } from './validation';

const topup: PaymentReviewRecord = {
  id: 'PAY-TOPUP',
  accountId: 'opaque-user-1',
  accountNumber: 'ON-1042',
  currentCreditCents: 2000,
  email: 'buyer@example.com',
  revision: 1,
  kind: 'topup',
  status: 'Pending',
  currency: 'USD',
  amountCents: 10000,
  creditAmountCents: 10000,
  feeAmountCents: 0,
  reference: 'BANK-TOPUP',
  submittedAt: '2026-10-01T08:00:00Z',
  pricingVersion: 'credit-face-value-v1',
};
const direct: PaymentReviewRecord = {
  ...topup,
  id: 'PAY-DIRECT',
  kind: 'direct_pay',
  amountCents: 10500,
  creditAmountCents: undefined,
  feeAmountCents: undefined,
  pricingVersion: 'order-total-v1',
  orderId: 'ORDER-PAID',
  offerId: 'OFFER-ORIGINAL',
};
const input: PaymentReviewDecision = {
  caseId: direct.id,
  accountId: direct.accountId,
  expectedRevision: 1,
  idempotencyKey: 'complete-original-payment',
  decision: 'Confirm',
  fundsVerified: true,
  reason: '',
};
function receipt(row: PaymentReviewRecord, decision: PaymentReviewDecision): PaymentReviewReceipt {
  const failed = decision.decision === 'Fail';
  return {
    confirmed: true,
    currency: row.currency,
    pricingVersion: row.pricingVersion,
    caseId: row.id,
    accountId: row.accountId,
    revision: row.revision + 1,
    idempotencyKey: decision.idempotencyKey,
    status: failed ? 'Failed' : 'Confirmed',
    notificationQueued: true,
    emailQueued: true,
    amountCents: row.amountCents,
    creditAmountCents: failed ? 0 : row.amountCents,
    feeAmountCents: 0,
    ledgerPosted: !failed,
    provisioningQueued: false,
    ...(!failed && row.kind === 'direct_pay'
      ? {
          directPayResolution: {
            policy: 'recheck-before-purchase-v1' as const,
            orderId: row.orderId ?? '',
            offerId: row.offerId ?? '',
            availabilityCheckedAt: '2026-10-02T08:00:00Z',
            outcome: 'credited' as const,
          },
        }
      : {}),
  };
}
function paidResume(): PaymentReviewReceipt {
  return {
    ...receipt(direct, input),
    creditAmountCents: 0,
    ledgerPosted: false,
    directPayResolution: {
      policy: 'recheck-before-purchase-v1',
      orderId: 'ORDER-PAID',
      offerId: 'OFFER-ORIGINAL',
      availabilityCheckedAt: '2026-10-02T08:00:00Z',
      outcome: 'awaiting_customer_order',
      purchaseIntentId: 'PAID-INTENT-ONCE',
    },
  };
}
function adapter(row: PaymentReviewRecord) {
  return {
    sessionScope: 'operator-session',
    list: vi.fn<PaymentReviewService['list']>().mockResolvedValue({
      confirmed: true,
      sessionScope: 'operator-session',
      records: [row],
    }),
    decide: vi
      .fn<PaymentReviewService['decide']>()
      .mockImplementation(async (decision) => receipt(row, decision)),
  };
}
function requestRow(id: string) {
  const row = screen.getByRole('button', { name: `View request ${id}` }).closest('tr');
  if (!row) throw new Error('Request row is missing');
  return row;
}
function submitCompletion() {
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Completed' }));
}

describe('Direct Pay completion safety', () => {
  it('blocks the old automatic-provisioning adapter while keeping Failed available', async () => {
    const service = adapter(direct);
    renderConsole(<PaymentReviewQueue kind="direct_pay" service={service} />);
    const completed = await screen.findByRole('button', { name: 'Completed' }, { timeout: 5000 });
    expect(completed).toBeDisabled();
    fireEvent.click(completed);
    expect(service.decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Failure reason' }), {
      target: { value: 'Bank reference does not match the transfer.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(service.decide).toHaveBeenCalledTimes(1));
    expect(service.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'Fail',
        fundsVerified: false,
        reason: 'Bank reference does not match the transfer.',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('cannot invoke the old decision even if the completion dialog is directly submitted', async () => {
    const service = adapter(direct);
    renderConsole(
      <PaymentDecisionDialog
        record={direct}
        decision="Confirm"
        service={service}
        onClose={vi.fn()}
        onConfirmed={vi.fn()}
        onAccessDenied={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    submitCompletion();
    expect(await screen.findByRole('alert')).toHaveTextContent('availability recheck service');
    expect(service.decide).not.toHaveBeenCalled();
  });

  it('requires the original offer binding as well as the explicit completion capability', () => {
    const service = {
      ...adapter(direct),
      completeDirectPay: vi.fn<PaymentReviewService['decide']>(),
    };
    expect(canComplete(direct, service)).toBe(true);
    expect(canComplete({ ...direct, offerId: undefined }, service)).toBe(false);
    expect(canComplete(direct, adapter(direct))).toBe(false);
  });

  it('credits the entire received amount including the original purchase fee', () => {
    const valid = receipt(direct, input);
    expect(valid.creditAmountCents).toBe(10500);
    expect(confirmedPaymentDecision(valid, direct, input)).toBe(true);
    for (const patch of [
      { creditAmountCents: 10000 },
      { feeAmountCents: 500 },
      { ledgerPosted: false },
      { provisioningQueued: true },
      { amountCents: 10000 },
    ])
      expect(confirmedPaymentDecision({ ...valid, ...patch }, direct, input)).toBe(false);
    const resolution = valid.directPayResolution;
    if (!resolution) throw new Error('Resolution fixture is missing');
    expect(
      confirmedPaymentDecision(
        {
          ...valid,
          directPayResolution: {
            ...resolution,
            purchaseIntentId: 'ALSO-SPENDABLE',
          },
        },
        direct,
        input,
      ),
    ).toBe(false);
  });

  it('requires a paid-resume receipt bound to the exact case, account, order, offer and key', () => {
    const valid = paidResume();
    expect(confirmedPaymentDecision(valid, direct, input)).toBe(true);
    for (const patch of [
      { caseId: 'OTHER-CASE' },
      { accountId: 'other-user' },
      { idempotencyKey: 'other-key' },
      { revision: 1 },
      { amountCents: 10000 },
      { creditAmountCents: 10500 },
      { ledgerPosted: true },
      { provisioningQueued: true },
      { notificationQueued: false },
      { emailQueued: false },
    ])
      expect(confirmedPaymentDecision({ ...valid, ...patch }, direct, input)).toBe(false);
    const resolution = valid.directPayResolution;
    if (!resolution) throw new Error('Resolution fixture is missing');
    for (const patch of [
      { orderId: 'OTHER-ORDER' },
      { offerId: 'OTHER-OFFER' },
      { purchaseIntentId: '' },
      { purchaseIntentId: undefined },
      { availabilityCheckedAt: '2026-09-30T08:00:00Z' },
    ])
      expect(
        confirmedPaymentDecision(
          {
            ...valid,
            directPayResolution: {
              ...resolution,
              ...patch,
            },
          },
          direct,
          input,
        ),
      ).toBe(false);
  });

  it('uses the opt-in completion service, never the old provisioning decision', async () => {
    const legacy = adapter(direct);
    const completeDirectPay = vi
      .fn<PaymentReviewService['decide']>()
      .mockImplementation(async (decision) => ({
        ...paidResume(),
        idempotencyKey: decision.idempotencyKey,
      }));
    renderConsole(
      <PaymentReviewQueue kind="direct_pay" service={{ ...legacy, completeDirectPay }} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Completed' }));
    submitCompletion();
    await waitFor(() => expect(completeDirectPay).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(legacy.decide).not.toHaveBeenCalled();
    expect(
      screen.getByText(/next step to complete the original paid purchase/),
    ).toBeInTheDocument();
  });
});

describe('account metadata and Credit display', () => {
  it('does not infer Account # or Current Credit from IDs or the requested top-up', () => {
    const record = { ...topup, accountNumber: undefined, currentCreditCents: undefined };
    renderConsole(<PaymentRequestTable kind="topup" rows={[record]} onSelect={vi.fn()} />);
    const cells = within(requestRow(topup.id)).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('Not assigned');
    expect(cells[1]).toHaveTextContent('$100.00');
    expect(cells[2]).toHaveTextContent('Unavailable');
    expect(screen.queryByText(topup.accountId)).not.toBeInTheDocument();
  });

  it('updates Current Credit only from the refetched account snapshot, not by adding the request', async () => {
    const service = adapter(topup);
    let resolveRefresh: (
      value: Awaited<ReturnType<PaymentReviewService['list']>>,
    ) => void = () => {};
    service.list
      .mockReset()
      .mockResolvedValueOnce({
        confirmed: true,
        sessionScope: service.sessionScope,
        records: [topup],
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );
    renderConsole(<PaymentReviewQueue kind="topup" service={service} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Completed' }));
    submitCompletion();
    await waitFor(() => expect(service.list).toHaveBeenCalledTimes(2));
    expect(within(requestRow(topup.id)).getAllByRole('cell')[2]).toHaveTextContent('$20.00');
    expect(screen.queryByText('$120.00')).not.toBeInTheDocument();
    await act(async () =>
      resolveRefresh({
        confirmed: true,
        sessionScope: service.sessionScope,
        records: [{ ...topup, status: 'Confirmed', revision: 2, currentCreditCents: 7000 }],
      }),
    );
    await waitFor(() =>
      expect(within(requestRow(topup.id)).getAllByRole('cell')[2]).toHaveTextContent('$70.00'),
    );
    expect(screen.queryByText('$120.00')).not.toBeInTheDocument();
    expect(service.decide).toHaveBeenCalledWith(expect.objectContaining({ decision: 'Confirm' }));
  });
});
