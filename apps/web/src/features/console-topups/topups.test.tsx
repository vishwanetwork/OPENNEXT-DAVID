import { describe, expect, it, vi } from 'vitest';
import type { CreditTopup } from '@opennext/contracts';
import type { PaymentReviewService } from '@/lib/payment-review';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderConsole, mockFetch, json } from '@/test/render';
import { assertScope, filterTopups, pendingRow, topupAmount, topupLabel } from './topups';
import { ConsoleTopupsPage } from './topups-page';

const rows: [CreditTopup, CreditTopup] = [
  {
    id: 'TOP-1',
    email: 'buyer@example.com',
    amountCents: 10050,
    method: 'bank_transfer',
    status: 'Pending',
    createdAt: '2026-10-18T08:00:00.000Z',
  },
  {
    id: 'TOP-2',
    email: 'done@example.com',
    amount: '25',
    method: 'paypal',
    status: 'Approved',
    createdAt: '2026-10-17T08:00:00.000Z',
    reviewedAt: '2026-10-17T09:00:00.000Z',
  },
];

describe('top-up helpers', () => {
  it('formats amounts, labels and filters', () => {
    expect(topupAmount(rows[0])).toBe('$100.50');
    expect(topupAmount(rows[1])).toBe('$25.00');
    expect(topupAmount({ id: 'x', status: 'Pending', amount: 'nope' })).toBe('Not provided');
    expect(topupLabel(rows[1])).toBe('Solved');
    expect(pendingRow(rows[0])).toBe(true);
    expect(pendingRow({ ...rows[0], solved: true })).toBe(false);
    expect(filterTopups(rows, 'paypal', 'All').map((r) => r.id)).toEqual(['TOP-2']);
    expect(filterTopups(rows, '', 'Pending').map((r) => r.id)).toEqual(['TOP-1']);
  });
  it('fails closed on wrong-scope lists', () => {
    expect(() => assertScope('production', { scope: 'demo', requests: [] })).toThrow(
      /different account scope/,
    );
    expect(() =>
      assertScope('production', { requests: [{ id: 'x', status: 'Pending', workspaceId: 'ws' }] }),
    ).toThrow();
    expect(() =>
      assertScope('demo', { scope: 'demo', requests: [{ id: 'x', status: 'Pending' }] }),
    ).toThrow();
    expect(() =>
      assertScope('demo', {
        scope: 'demo',
        requests: [{ id: 'x', status: 'Pending', workspaceId: 'ws' }],
      }),
    ).not.toThrow();
  });
});

describe('ConsoleTopupsPage', () => {
  it('lists live accounts and requires verified receipt before approving', async () => {
    const fetchSpy = mockFetch((path) =>
      path.startsWith('/api/admin/topups')
        ? json(200, { scope: 'production', requests: rows })
        : json(404, {}),
    );
    renderConsole(<ConsoleTopupsPage />);
    await waitFor(() => expect(screen.getByText('buyer@example.com')).toBeInTheDocument());
    expect(screen.getByText('2 of 2 requests · Live accounts')).toBeInTheDocument();
    expect(screen.getByText('Solved', { selector: '.on-topup-status' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Approve'));
    expect(screen.getByText('Approve top-up')).toBeInTheDocument();
    const form = document.querySelector('[data-topup-form="review"]') as HTMLFormElement;
    const checkbox = form.querySelector('input[name="fundsVerified"]') as HTMLInputElement;
    checkbox.required = false;
    fireEvent.submit(form);
    await waitFor(() =>
      expect(
        screen.getByText('Confirm that the payment has been received before approving.'),
      ).toBeInTheDocument(),
    );
    expect(fetchSpy.mock.calls.some(([input]) => String(input).includes('/review'))).toBe(false);
  });
  it('keeps rejection reachable on the established service without claiming email delivery', async () => {
    mockFetch((path) =>
      path.startsWith('/api/admin/topups')
        ? json(200, { scope: 'production', requests: rows })
        : json(404, {}),
    );
    renderConsole(<ConsoleTopupsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('heading', { name: 'Reject top-up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject request' })).toBeInTheDocument();
    expect(screen.queryByText(/notification and email have been queued/i)).not.toBeInTheDocument();
  });
  it('selects the versioned queue only when a payment review adapter is supplied', async () => {
    const fetchSpy = mockFetch(() => json(404, {}));
    const service: PaymentReviewService = {
      sessionScope: 'operator-production',
      list: vi.fn<PaymentReviewService['list']>().mockResolvedValue({
        confirmed: true,
        sessionScope: 'operator-production',
        records: [],
      }),
      decide: vi.fn<PaymentReviewService['decide']>(),
    };
    renderConsole(<ConsoleTopupsPage service={service} />);
    await waitFor(() =>
      expect(service.list).toHaveBeenCalledWith('topup', expect.any(AbortSignal)),
    );
    expect(
      screen.getByRole('heading', { name: 'Bank transfer top-up requests' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Account scope' })).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([input]) => String(input).includes('/api/admin/topups'))).toBe(
      false,
    );
  });
});
