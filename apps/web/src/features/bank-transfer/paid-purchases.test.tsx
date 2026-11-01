import { beforeEach, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { json, mockFetch, renderTerminal, signIn } from '@/test/render';
import { PaidPurchases } from './paid-purchases';

const purchase = {
  id: 'PI-1',
  accountId: 'u1',
  transferId: 'BT-1',
  offerId: 'spotbot-us-east-1-g4dn.xlarge',
  orderId: 'order-1',
  model: 'T4',
  gpuCount: 1,
  region: 'us-east-1',
  durationHours: 1,
  amountCents: 100,
  currency: 'USD',
  state: 'awaiting_customer_order',
  expiresAt: '2026-11-05T00:00:00Z',
  rentalId: null,
  capacityGuaranteed: false,
};
beforeEach(() => signIn());

it('redeems through the paid endpoint, prevents repeated clicks and never charges Credit', async () => {
  let finish: ((value: Response) => void) | undefined;
  const fetch = mockFetch((path) =>
    path.endsWith('/redeem')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : json(200, { confirmed: true, demo: false, accountId: 'u1', purchases: [purchase] }),
  );
  renderTerminal(<PaidPurchases />);
  const button = await screen.findByRole('button', { name: /Continue purchase/ });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(fetch.mock.calls.filter(([path]) => String(path).endsWith('/redeem'))).toHaveLength(1);
  if (!finish) throw new Error('Expected a pending redemption request.');
  finish(
    json(200, {
      confirmed: true,
      demo: false,
      accountId: 'u1',
      purchase: { ...purchase, state: 'redeeming' },
    }),
  );
  await waitFor(() => expect(button).not.toBeDisabled());
  expect(fetch.mock.calls.some(([path]) => String(path).includes('/spot-purchases'))).toBe(false);
});

it('refuses another account response instead of displaying its receipt', async () => {
  mockFetch(() =>
    json(200, {
      confirmed: true,
      demo: false,
      accountId: 'other',
      purchases: [{ ...purchase, accountId: 'other' }],
    }),
  );
  renderTerminal(<PaidPurchases />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Paid purchases could not be loaded');
  expect(screen.queryByText(/T4/)).not.toBeInTheDocument();
});

it('does not call the live paid API from the demo workspace', () => {
  const fetch = mockFetch(() => json(500, {}));
  renderTerminal(<PaidPurchases />, { demo: true });
  expect(fetch).not.toHaveBeenCalled();
});
