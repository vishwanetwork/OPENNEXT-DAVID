import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { PricingProvider } from '@opennext/contracts';
import { renderConsole, mockFetch, json } from '@/features/console/test-utils';
import { filterProviders, providerMetrics, providerState } from './api';
import { PricingAdminPage } from './pricing-admin-page';

const providers: PricingProvider[] = [
  {
    id: 'aws',
    name: 'AWS',
    enabled: true,
    intervalMinutes: 15,
    adapterStatus: 'implemented',
    credentialRequired: false,
    recordCount: 374,
    status: 'completed_with_gaps',
    lastRun: {
      id: 'r1',
      provider: 'aws',
      status: 'completed_with_gaps',
      records: 374,
      recordCount: 374,
    },
  },
  {
    id: 'lambda',
    name: 'Lambda',
    enabled: false,
    intervalMinutes: 60,
    adapterStatus: 'implemented',
    credentialRequired: true,
    configured: false,
    recordCount: 0,
    status: 'needs_credentials',
  },
  {
    id: 'gcp',
    name: 'Google Cloud',
    enabled: false,
    intervalMinutes: 60,
    adapterStatus: 'pending',
    credentialRequired: true,
    recordCount: 0,
    status: 'not_implemented',
  },
];

describe('price sources helpers', () => {
  it('derives state, metrics and filters like the legacy console', () => {
    expect(providerState(providers[0])).toBe('completed_with_gaps');
    expect(providerState({ ...providers[1], lastRun: null })).toBe('needs_credentials');
    expect(providerMetrics(providers)).toEqual({
      providers: 3,
      connected: 1,
      records: 374,
      running: 0,
    });
    expect(filterProviders(providers, '', 'connected').map((p) => p.id)).toEqual(['aws', 'lambda']);
    expect(filterProviders(providers, '', 'enabled').map((p) => p.id)).toEqual(['aws']);
    expect(filterProviders(providers, '', 'attention').map((p) => p.id)).toEqual([
      'aws',
      'lambda',
      'gcp',
    ]);
    expect(filterProviders(providers, 'goog', 'all').map((p) => p.id)).toEqual(['gcp']);
  });
});

describe('PricingAdminPage', () => {
  it('renders provider cards and history from the admin API', async () => {
    mockFetch((path) =>
      path.endsWith('/providers')
        ? json(200, { providers, access: { mutable: true, local: true } })
        : json(200, {
            runs: [
              {
                id: 'r1',
                provider: 'aws',
                status: 'completed',
                startedAt: '2026-10-25T14:40:52.316Z',
                records: 374,
              },
            ],
          }),
    );
    renderConsole(<PricingAdminPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Price sources' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('AWS', { selector: '.pc-provider strong' })).toBeInTheDocument(),
    );
    expect(screen.getByText('Needs credential')).toBeInTheDocument();
    expect(screen.getByText('374 records')).toBeInTheDocument();
    expect(screen.getByText('View log ↗')).toBeInTheDocument();
    expect(screen.getByText('Run enabled sources')).not.toBeDisabled();
  });
  it('asks for the administrator session when the API refuses access', async () => {
    mockFetch(() =>
      json(401, { error: 'Administrator sign-in required', access: { mutable: false } }),
    );
    renderConsole(<PricingAdminPage />);
    await waitFor(() =>
      expect(screen.getByText('Connect administrator session')).toBeInTheDocument(),
    );
    expect(document.querySelector('.pc-notice')).toHaveTextContent(
      'Administrator access is required',
    );
    expect(screen.getByText('Run enabled sources')).toBeDisabled();
  });
});
