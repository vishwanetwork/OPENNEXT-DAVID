import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { at } from '@/test/at';
import { json, mockFetch, renderConsole } from '@/test/render';
import { normalizeSnapshot } from './marketplace';
import { MarketplaceInboxPage } from './inbox-page';
import {
  EMPTY_RESOURCE_FILTERS,
  homepageCandidate,
  matchesResourceFilters,
} from './resource-filters';

const navigation = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/supply',
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

afterEach(() => {
  cleanup();
  navigation.search = '';
  vi.unstubAllGlobals();
});

const supply = {
  id: 'SUP-1',
  kind: 'gpu_rental',
  model: 'H200',
  title: 'H200 Singapore cluster',
  region: 'Singapore',
  count: 16,
  netPrice: 2.25,
  term: 'Reserved',
  hours: 720,
  vcpu: 192,
  memory: 141,
  status: 'Published',
  agentStatus: 'Verified',
  serviceStart: '2026-10-27T00:00:00.000Z',
  serviceEnd: '2026-11-27T00:00:00.000Z',
  notes: 'Dedicated nodes with InfiniBand.',
  ownerEmail: 'supplier@example.test',
  sshHost: 'private-host.example.test',
};
const candidate = {
  id: 'HPR-1',
  sourceId: 'SUP-1',
  model: 'H200',
  side: 'supply',
  current: true,
  fingerprint: 'reviewed-material-1',
  status: 'Pending',
  snapshot: {
    title: supply.title,
    region: supply.region,
    count: 16,
    hours: 720,
    netPrice: 2.25,
    description: supply.notes,
  },
};
const snapshot = {
  scope: 'production',
  rfqs: [],
  kyb: [],
  featured: [candidate],
  supplies: [
    supply,
    { ...supply, id: 'SUP-2', model: 'H100', region: 'Germany', term: 'Spot', memory: null },
  ],
  generatedAt: '2026-10-27T00:00:00.000Z',
};

describe('Console resource filtering and homepage eligibility', () => {
  it('intersects model, country and terms without inferring missing data', () => {
    const rows = normalizeSnapshot(snapshot, 'production').supplies;
    expect(rows.filter((row) => matchesResourceFilters(row, EMPTY_RESOURCE_FILTERS))).toHaveLength(
      2,
    );
    expect(
      rows
        .filter((row) =>
          matchesResourceFilters(row, {
            modelFilter: 'H200',
            countryFilter: 'Singapore',
            termFilter: 'Reserved',
          }),
        )
        .map((row) => row.id),
    ).toEqual(['SUP-1']);
    expect(
      matchesResourceFilters(at(rows, 0), { ...EMPTY_RESOURCE_FILTERS, countryFilter: 'Germany' }),
    ).toBe(false);
  });

  it('requires a current server candidate and fingerprint; blocks private/demo/external records', () => {
    const data = normalizeSnapshot(snapshot, 'production');
    const row = at(data.supplies, 0);
    expect(homepageCandidate(row, 'supply', data.featured, false)?.id).toBe('HPR-1');
    expect(homepageCandidate(row, 'demand', data.featured, false)).toBeUndefined();
    expect(homepageCandidate(row, 'supply', data.featured, true)).toBeUndefined();
    expect(
      homepageCandidate({ ...row, visibility: 'Private RFQ' }, 'supply', data.featured, false),
    ).toBeUndefined();
    expect(
      homepageCandidate(
        { ...row, provenance: { kind: 'external' } },
        'supply',
        data.featured,
        false,
      ),
    ).toBeUndefined();
    expect(
      homepageCandidate(row, 'supply', [{ ...candidate, fingerprint: '' }], false),
    ).toBeUndefined();
    expect(
      homepageCandidate(row, 'supply', [{ ...candidate, current: false }], false),
    ).toBeUndefined();
  });
});

describe('Supplier capacity inbox', () => {
  it('filters the Terminal-aligned table and opens the submitted supply form in place', async () => {
    mockFetch(() => json(200, snapshot));
    renderConsole(<MarketplaceInboxPage tab="supplies" />);
    await screen.findByText('2 of 2 records');
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Model',
      'Capacity',
      'Min. Price',
      'Country',
      'vCPU',
      'Memory',
      'Duration',
      'Terms',
      'Details',
    ]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), {
      target: { value: 'Singapore' },
    });
    expect(screen.getByText('1 of 2 records')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    const form = await screen.findByRole('region', { name: 'Submitted supply details' });
    expect(within(form).getByText('Available duration (hours)')).toBeInTheDocument();
    expect(within(form).getByText('Dedicated nodes with InfiniBand.')).toBeInTheDocument();
    expect(screen.queryByText('private-host.example.test')).not.toBeInTheDocument();
    expect(within(form).queryByRole('button')).not.toBeInTheDocument();
  });

  it('reviews homepage placement with the server-issued fingerprint and never manufactures a candidate', async () => {
    const writes: { path: string; body: unknown }[] = [];
    mockFetch((path, init) => {
      if (init?.method === 'PATCH') {
        writes.push({ path, body: JSON.parse(String(init.body)) });
        return json(200, { ok: true });
      }
      return json(200, snapshot);
    });
    renderConsole(<MarketplaceInboxPage tab="supplies" />);
    await screen.findByText('2 of 2 records');
    expect(screen.getByRole('button', { name: 'Feature on homepage: H100' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Feature on homepage: H200' }));
    expect(await screen.findByText('Inside OpenNEXT → Buy Capacity')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Homepage card preview' })).toHaveTextContent(
      'H200 Singapore cluster',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve for homepage' }));
    await waitFor(() =>
      expect(writes).toEqual([
        {
          path: '/api/admin/marketplace/featured/HPR-1',
          body: { status: 'Approved', reason: '', fingerprint: 'reviewed-material-1' },
        },
      ]),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('article', { name: 'Homepage card preview' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('keeps a failed review open with the backend error', async () => {
    mockFetch((_, init) =>
      init?.method === 'PATCH'
        ? json(409, { error: 'This candidate has changed. Refresh before reviewing.' })
        : json(200, snapshot),
    );
    renderConsole(<MarketplaceInboxPage tab="supplies" />);
    await screen.findByText('2 of 2 records');
    fireEvent.click(screen.getByRole('button', { name: 'Feature on homepage: H200' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve for homepage' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This candidate has changed.');
    expect(screen.getByRole('button', { name: 'Approve for homepage' })).toBeInTheDocument();
  });

  it('opens a recent-activity record link and allows closing without reopening', async () => {
    navigation.search = 'record=SUP-1';
    mockFetch(() => json(200, snapshot));
    renderConsole(<MarketplaceInboxPage tab="supplies" />);
    expect(
      await screen.findByRole('region', { name: 'Submitted supply details' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(
      screen.queryByRole('region', { name: 'Submitted supply details' }),
    ).not.toBeInTheDocument();
  });
});
