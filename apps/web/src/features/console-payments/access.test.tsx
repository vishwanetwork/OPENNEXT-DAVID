import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '@/lib/api/client';
import type { PaymentReviewRecord, PaymentReviewService } from '@/lib/payment-review';
import { renderConsole } from '@/test/render';
import { PaymentReviewQueue } from './page';

const record: PaymentReviewRecord = {
  id: 'PAY-1',
  accountId: 'buyer-1',
  email: 'private@example.com',
  revision: 1,
  kind: 'topup',
  status: 'Pending',
  currency: 'USD',
  amountCents: 10000,
  creditAmountCents: 10000,
  feeAmountCents: 0,
  pricingVersion: 'credit-face-value-v1',
  reference: 'REF-1',
  submittedAt: '2026-10-29T01:00:00Z',
};
function adapter() {
  return {
    sessionScope: 'operator-a',
    list: vi
      .fn<PaymentReviewService['list']>()
      .mockResolvedValue({ confirmed: true, sessionScope: 'operator-a', records: [record] }),
    decide: vi.fn<PaymentReviewService['decide']>(),
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('clears private records and blocks more decisions after authorization expires', async () => {
  const service = adapter();
  service.decide.mockRejectedValue(new ApiError('Session expired.', 401));
  const { queryClient } = renderConsole(<PaymentReviewQueue kind="topup" service={service} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add Credit' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add Credit' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Administrator access expired');
  expect(screen.queryByText('private@example.com')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  await waitFor(() =>
    expect(
      queryClient
        .getQueriesData({ queryKey: ['admin', 'payment-review'] })
        .every(([, value]) => value === undefined),
    ).toBe(true),
  );
  expect(service.list).toHaveBeenCalledTimes(1);
});

it('never loads private records for an unscoped operator adapter', () => {
  const service = { ...adapter(), sessionScope: '' };
  renderConsole(<PaymentReviewQueue kind="topup" service={service} />);
  expect(service.list).not.toHaveBeenCalled();
  expect(screen.getByText('Payment service awaiting backend')).toBeInTheDocument();
});
