import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { json, mockFetch, renderConsole } from '@/test/render';
import { AllocationsView, stateLabel } from './instance-allocations';

const allocation = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  tenantId: 'integration-partner',
  orderId: 'order-' + id,
  rfqId: 'order-' + id,
  model: 'L4',
  gpuCount: 1,
  term: 'Spot',
  region: 'us-west-2',
  zone: 'us-west-2c',
  instanceType: 'g6.2xlarge',
  instanceId: 'i-0123456789abcdef0',
  generation: 2,
  state: 'ACTIVE',
  lifecycle: 'Running',
  error: null,
  degraded: null,
  priceCeilingHourlyUsd: '0.95',
  estimatedCostUsd: '0.420000',
  budgetUsd: '3.00',
  createdAt: '2026-10-27T03:00:00+00:00',
  expiresAt: '2026-10-28T00:00:00+00:00',
  closedAt: null,
  ...overrides,
});

describe('console allocations', () => {
  it('lists allocations with lifecycle, raw state, cost and pages by cursor', async () => {
    const paths: string[] = [];
    mockFetch((path) => {
      paths.push(path);
      if (path.includes('cursor=50'))
        return json(200, {
          instances: [allocation('b', { state: 'CLOSED', lifecycle: 'End' })],
          nextCursor: null,
          asOf: '2026-10-27T03:01:00+00:00',
        });
      return json(200, {
        instances: [
          allocation('a'),
          allocation('c', {
            state: 'ACTION_REQUIRED',
            lifecycle: 'Attention',
            error: 'gateway_ack_timeout',
          }),
        ],
        nextCursor: '50',
        asOf: '2026-10-27T03:01:00+00:00',
      });
    });
    renderConsole(<AllocationsView />);
    expect(await screen.findByText('order-a')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Running')).toBeInTheDocument();
    expect(screen.getByText(/Action required · gateway_ack_timeout/)).toBeInTheDocument();
    expect(screen.getAllByText('$0.42')).toHaveLength(2);
    expect(paths[0]).toContain('/api/admin/instances?limit=50');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('order-b')).toBeInTheDocument();
    expect(paths.at(-1)).toContain('cursor=50');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('filters by lifecycle on the server', async () => {
    const paths: string[] = [];
    mockFetch((path) => {
      paths.push(path);
      return json(200, { instances: [], nextCursor: null, asOf: '2026-10-27T03:01:00+00:00' });
    });
    renderConsole(<AllocationsView />);
    expect(await screen.findByText('No allocations match this status.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Attention' }));
    await waitFor(() => expect(paths.at(-1)).toContain('status=Attention'));
  });

  it('asks for the administrator token when the session is missing', async () => {
    mockFetch(() =>
      json(401, {
        error: 'Administrator sign-in required',
        access: { mutable: false, reason: 'Administrator sign-in required' },
      }),
    );
    renderConsole(<AllocationsView />);
    await waitFor(() => expect(document.querySelector('[data-admin-login]')).not.toBeNull());
  });

  it('labels backend states for people', () => {
    expect(stateLabel('WAITING_CAPACITY')).toBe('Waiting capacity');
    expect(stateLabel('ACTIVE')).toBe('Active');
  });
});
