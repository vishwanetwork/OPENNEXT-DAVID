import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { PricingProvider } from '@opennext/contracts';
import { renderConsole, mockFetch, json } from '@/test/render';
import {
  credentialReady,
  filterProviders,
  providerMetrics,
  providerState,
  providerTerms,
} from './api';
import { PricingAdminPage } from './pricing-admin-page';

const providers: [PricingProvider, PricingProvider, PricingProvider] = [
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
  it('reads the actual backend latestRun / credentialConfigured / supportedTerms fields', () => {
    const provider = {
      ...providers[1],
      credentialConfigured: true,
      supportedTerms: ['On-demand'],
      latestRun: { id: 'r-new', provider: 'lambda', status: 'completed', records: 8 },
    };
    expect(providerState(provider)).toBe('completed');
    expect(credentialReady(provider)).toBe(true);
    expect(providerMetrics([provider]).connected).toBe(1);
    expect(filterProviders([provider], '', 'connected')).toHaveLength(1);
    expect(providerTerms(provider)).toEqual([
      { term: 'Spot', supported: false },
      { term: 'On-demand', supported: true },
      { term: 'Reserved', supported: false },
    ]);
    expect(credentialReady({ ...provider, credentialConfigured: false, configured: true })).toBe(
      false,
    );
  });
  it('keeps connected filters consistent with credential-aware source metrics', () => {
    expect(providerState(providers[0])).toBe('completed_with_gaps');
    expect(providerState({ ...providers[1], lastRun: null })).toBe('needs_credentials');
    expect(providerMetrics(providers)).toEqual({
      providers: 3,
      connected: 1,
      records: 374,
      running: 0,
    });
    expect(filterProviders(providers, '', 'connected').map((p) => p.id)).toEqual(['aws']);
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
  it('embeds the source grid, reads backend latest-run fields, and opens the official API directory', async () => {
    const actualProvider = {
      ...providers[1],
      enabled: true,
      credentialConfigured: true,
      latestRun: {
        id: 'r-new',
        provider: 'lambda',
        status: 'completed',
        recordCount: 8,
        finishedAt: '2026-10-27T00:00:00Z',
      },
    };
    mockFetch((path) =>
      path.endsWith('/providers')
        ? json(200, { providers: [actualProvider], access: { mutable: true } })
        : json(200, { runs: [] }),
    );
    renderConsole(<PricingAdminPage embedded />);
    expect(screen.getByRole('heading', { level: 2, name: 'Price Source' })).toBeInTheDocument();
    const card = await screen.findByRole('article', { name: 'Lambda price source' });
    expect(within(card).getByText('8 records')).toBeInTheDocument();
    expect(within(card).getByText('Run now')).not.toBeDisabled();
    fireEvent.click(screen.getByText('API directory'));
    expect(screen.getByRole('heading', { name: 'Source API directory' })).toBeInTheDocument();
    expect(
      screen.getByText('GET https://cloud.lambda.ai/api/v1/instance-types'),
    ).toBeInTheDocument();
  });
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
    expect(screen.getByRole('heading', { level: 1, name: 'Price Source' })).toBeInTheDocument();
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
