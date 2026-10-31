import { expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderConsole, mockFetch, jsonResponse } from '@/test/render';
import { PaymentsPage } from './payments';

it('shows automatic Credit settlements without bank confirmation actions', async () => {
  const request = mockFetch((url) => {
    if (String(url).includes('/operations/session'))
      return jsonResponse({ confirmed: true, sessionScope: 'operator' });
    if (String(url).includes('/payments/credit'))
      return jsonResponse({
        payments: [
          {
            id: 'charge',
            orderId: 'yesterday-credit-order',
            rentalId: 'ended-instance',
            email: 'buyer@example.test',
            currency: 'USD',
            state: 'billed',
            authorizedCents: 105,
            settledCents: 27,
            releasedCents: 78,
            submittedAt: '2026-10-31T03:05:50Z',
            paymentMethod: 'Credit',
          },
        ],
        total: 1,
        nextCursor: null,
        asOf: '2026-11-01T00:00:00Z',
      });
    return jsonResponse({});
  });
  renderConsole(<PaymentsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Credit purchases' }));
  expect(await screen.findByText('yesterday-credit-order')).toBeInTheDocument();
  expect(screen.getByText('1.05 USD')).toBeInTheDocument();
  expect(screen.getByText('0.27 USD')).toBeInTheDocument();
  expect(screen.getByText('0.78 USD')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Fail' })).not.toBeInTheDocument();
  expect(
    request.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET'),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Bank transfers' }));
  expect(screen.getByText('Payment Requests', { selector: 'h1' })).toBeInTheDocument();
});
