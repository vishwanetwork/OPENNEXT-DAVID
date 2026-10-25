import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderConsole, mockFetch, json } from '@/test/render';
import { assertScope, filterTopups, pendingRow, topupAmount, topupLabel } from './topups';
import { ConsoleTopupsPage } from './topups-page';

const rows = [
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
});
