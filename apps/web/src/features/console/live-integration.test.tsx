import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { jsonResponse, mockFetch, renderConsole } from '@/test/render';
import { LiveOrdersPage, LiveUsersPage } from './pages/live-records';
import { LiveAgentPage, LiveBillingPage } from './pages/live-agent';

const asOf = '2026-10-31T00:00:00Z';
const session = { confirmed: true, sessionScope: 'operator-one' };
const growth = { '7D': 3, '1M': 4, '3M': 5, '6M': 6, '1Y': 7 };
const person = (id: string) => ({
  id,
  name: id,
  email: `${id}@example.test`,
  company: null,
  role: 'buyer',
  status: 'Active',
  joinedAt: asOf,
});

describe('Live Console integration', () => {
  it('authenticates before reading private records and preserves platform totals across pages', async () => {
    const request = mockFetch((raw) => {
      const url = new URL(raw, 'http://localhost');
      if (url.pathname.endsWith('/operations/session')) return jsonResponse(session);
      return jsonResponse({
        users: [person(url.searchParams.get('cursor') ? 'Second' : 'First')],
        totalUsers: 101,
        filteredTotal: 101,
        growth,
        nextCursor: url.searchParams.get('cursor') ? null : '50',
        asOf,
      });
    });
    renderConsole(<LiveUsersPage />);
    expect(screen.getByText('Loading users…')).toBeInTheDocument();
    expect(await screen.findByText('First@example.test')).toBeInTheDocument();
    expect(screen.getByText('101')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Second@example.test')).toBeInTheDocument();
    expect(screen.getByText('101')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search name, company or email…'), {
      target: { value: 'missing' },
    });
    await waitFor(() =>
      expect(
        request.mock.calls.some(
          ([path]) =>
            String(path).includes('search=missing') && !String(path).includes('cursor=50'),
        ),
      ).toBe(true),
    );
    expect(request.mock.calls[0]?.[0]).toBe('/api/admin/operations/session');
  });

  it('offers administrator sign-in and never shows customer records after access is denied', async () => {
    const request = mockFetch(() => jsonResponse({ error: 'Administrator sign-in required' }, 401));
    renderConsole(<LiveUsersPage />);
    expect(await screen.findByLabelText('Administrator token')).toBeInTheDocument();
    expect(request.mock.calls).toHaveLength(1);
    expect(screen.queryByText(/@example.test/)).toBeNull();
  });

  it('reads actual orders and sends search criteria to the server', async () => {
    const request = mockFetch((path) =>
      jsonResponse(
        path.endsWith('/operations/session')
          ? session
          : {
              orders: [
                {
                  id: 'paid-order',
                  kind: 'Instance',
                  email: 'buyer@example.test',
                  model: 'L4',
                  gpuCount: 1,
                  country: 'us-west-2',
                  term: 'Spot',
                  total: 1.05,
                  currency: 'USD',
                  status: 'WAITING_CAPACITY',
                  state: 'processing',
                  submittedAt: asOf,
                },
              ],
              total: 1,
              nextCursor: null,
              asOf,
            },
      ),
    );
    renderConsole(<LiveOrdersPage />);
    expect(await screen.findByText('paid-order')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search order, email, model or country…'), {
      target: { value: 'buyer' },
    });
    await waitFor(() =>
      expect(request.mock.calls.some(([path]) => String(path).includes('search=buyer'))).toBe(true),
    );
    expect(screen.queryByText(/awaiting backend/i)).toBeNull();
  });

  it('queues a bounded server maintenance job instead of modifying local agent configuration', async () => {
    const job = {
      id: 'job-1',
      action: 'reconcile',
      state: 'queued',
      createdAt: asOf,
      finishedAt: null,
      error: null,
    };
    const request = mockFetch((path, init) => {
      if (path.endsWith('/operations/session')) return jsonResponse(session);
      if (path.endsWith('/agent/actions')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          action: 'reconcile',
          idempotencyKey: expect.any(String),
        });
        return jsonResponse(job);
      }
      return jsonResponse({
        health: {
          status: 'ok',
          background_enabled: true,
          worker_running: true,
          live_orders_enabled: true,
          dry_run_enabled: false,
          rentals_enabled: true,
          rental_worker_running: true,
          rental_event_consumer_error: null,
        },
        rentalStates: { ACTIVE: 2 },
        jobs: [],
        maintenanceError: null,
        policy: { arbitraryCode: false, runningOrdersChanged: false },
        asOf,
      });
    });
    renderConsole(<LiveAgentPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reconcile pending operations' }));
    expect(
      await screen.findByText('Reconciliation queued. This page may be closed.'),
    ).toBeInTheDocument();
    expect(
      request.mock.calls.filter(([path]) => String(path).endsWith('/agent/actions')),
    ).toHaveLength(1);
    expect(screen.queryByLabelText('Agent source repository')).toBeNull();
  });

  it('shows authoritative usage amounts without fabricated provider costs', async () => {
    mockFetch((path) =>
      jsonResponse(
        path.endsWith('/operations/session')
          ? session
          : {
              currency: 'USD',
              billedCents: 230,
              heldCents: 500,
              releasedCents: 120,
              providerInvoiceCents: null,
              entries: [],
              asOf,
            },
      ),
    );
    renderConsole(<LiveBillingPage />);
    expect(await screen.findByText('$2.30')).toBeInTheDocument();
    expect(screen.getByText('$5.00')).toBeInTheDocument();
    expect(screen.queryByText('$1.26')).toBeNull();
    expect(screen.getByRole('button', { name: 'Export displayed records' })).toBeDisabled();
  });
});
