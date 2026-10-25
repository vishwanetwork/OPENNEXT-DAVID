import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderConsole, mockFetch, json } from '@/features/console/test-utils';
import { duration, filterFeatured, filterRecords, normalizeSnapshot, quantity, range } from './marketplace';
import { MarketplaceInboxPage } from './inbox-page';

const rfq = {
  id: 'RFQ-1', kind: 'rental', title: 'H200 · On-demand RFQ', model: 'H200', region: 'US East', vcpu: 128, memory: 141, count: 8, hours: 48, term: 'On-demand', budget: 3.225,
  status: 'Open', reviewStatus: 'Approved', reviewRevision: 2, visibility: 'Public RFQ', ownerEmail: 'buyer@example.com', ownerName: 'Ada', ownerCompany: 'Acme',
  submission: { receiptId: 'RCPT-1', status: 'Received', receivedAt: '2026-10-18T08:00:00.000Z', revision: 1 }, createdAt: '2026-10-18T08:00:00.000Z',
};
const privateRfq = { ...rfq, id: 'RFQ-2', visibility: 'Private RFQ', reviewStatus: 'Reviewing', status: 'Open' };
const external = { ...rfq, id: 'EXT-1', external: true, provenance: { kind: 'external', sourceName: 'Packet Demand', sourceId: 'packet', sourceUrl: 'https://example.com/x' }, quantity: { minNodes: 2, maxNodes: 4, gpusPerNode: 8 }, rentalMonths: { min: 3 } };
const snapshot = { scope: 'production', generatedAt: '2026-10-25T00:00:00.000Z', rfqs: [rfq, privateRfq, external], supplies: [], kyb: [], featured: [{ id: 'F-1', sourceId: 'RFQ-1', model: 'H200', side: 'demand', status: 'Pending', current: true, fingerprint: 'fp', submittedAt: '2026-10-19T00:00:00.000Z', snapshot: { title: 'H200', ownerEmail: 'buyer@example.com', region: 'US East', count: 8, hours: 48, price: 3.225 } }] };

describe('marketplace snapshot helpers', () => {
  it('derives Live / Approved · Private statuses and rejects wrong scopes', () => {
    const data = normalizeSnapshot(snapshot, 'production');
    expect(data.rfqs.map((r) => r.status)).toEqual(['Live RFQ', 'Open', 'Live RFQ']);
    expect(data.rfqs[0].workflowStatus).toBe('Open');
    expect(normalizeSnapshot({ ...snapshot, rfqs: [{ ...privateRfq, reviewStatus: 'Approved' }] }, 'production').rfqs[0].status).toBe('Approved · Private RFQ');
    expect(() => normalizeSnapshot({ ...snapshot, scope: 'demo' }, 'production')).toThrow(/different workspace scope/);
    expect(() => normalizeSnapshot({ rfqs: [] }, 'production')).toThrow(/incomplete snapshot/);
    expect(() => normalizeSnapshot({ scope: 'demo', rfqs: [rfq], supplies: [], kyb: [] }, 'demo')).toThrow(/different workspace scope/);
    expect(normalizeSnapshot({ scope: 'demo', rfqs: [{ ...rfq, workspaceId: 'ws' }], supplies: [], kyb: [] }, 'demo').featured).toEqual([]);
  });
  it('renders external quantities, ranges and durations from source values only', () => {
    const data = normalizeSnapshot(snapshot, 'production');
    expect(quantity(data.rfqs[2], false)).toBe('2–4 nodes · 8 GPUs / node');
    expect(duration(data.rfqs[2], false)).toBe('3 months');
    expect(range({ min: 3, max: null }, ' months')).toBe('3+ months');
    expect(quantity(data.rfqs[0], false)).toBe('8 GPUs');
    expect(duration(data.rfqs[0], false)).toBe('48 hours');
    expect(range({ options: [1, 2] }, ' GPUs')).toBe('1 / 2 GPUs');
    expect(range(null)).toBe('');
  });
  it('filters by market, state, account and source together', () => {
    const data = normalizeSnapshot(snapshot, 'production');
    const base = { query: '', statusFilter: 'All', kindFilter: 'All', sourceFilter: 'All' };
    expect(filterRecords(data.rfqs, 'rfqs', false, base)).toHaveLength(3);
    expect(filterRecords(data.rfqs, 'rfqs', false, { ...base, sourceFilter: 'external:packet' }).map((r) => r.id)).toEqual(['EXT-1']);
    expect(filterRecords(data.rfqs, 'rfqs', false, { ...base, statusFilter: 'Open' }).map((r) => r.id)).toEqual(['RFQ-2']);
    expect(filterRecords(data.rfqs, 'rfqs', false, { ...base, query: 'acme', kindFilter: 'gpu_rental' })).toHaveLength(3);
    expect(filterFeatured(data.featured, '', 'Current')).toHaveLength(1);
    expect(filterFeatured(data.featured, '', 'History')).toHaveLength(0);
  });
});

describe('MarketplaceInboxPage', () => {
  it('lists RFQs by email, model and hardware and shows full details with the review form', async () => {
    mockFetch((path) => (path === '/api/admin/marketplace' ? json(200, snapshot) : json(404, { error: 'Not found.' })));
    renderConsole(<MarketplaceInboxPage tab="rfqs" />);
    await waitFor(() => expect(screen.getAllByText('buyer@example.com').length).toBeGreaterThan(0));
    expect(screen.getByText('3 of 3 records')).toBeInTheDocument();
    expect(screen.getAllByText('141 GB / GPU').length).toBe(3);
    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[1]);
    await waitFor(() => expect(screen.getByText('Capacity RFQ')).toBeInTheDocument());
    expect(screen.getByText('Maximum Quote Price:')).toBeInTheDocument();
    expect(screen.getByText('$1,238.40')).toBeInTheDocument();
    expect(screen.getByText('Approve RFQ')).toBeInTheDocument();
  });
  it('isolates demo submissions with test-only disclosure and no homepage tab', async () => {
    mockFetch((path) =>
      path === '/api/admin/demo/marketplace'
        ? json(200, { scope: 'demo', rfqs: [{ ...privateRfq, workspaceId: 'ws-1', workspaceExpiresAt: '2026-10-26T00:00:00.000Z' }], supplies: [], kyb: [] })
        : json(404, { error: 'Not found.' }),
    );
    renderConsole(<MarketplaceInboxPage tab="rfqs" scope="demo" />);
    await waitFor(() => expect(screen.getByText('DEMO · TEST ONLY')).toBeInTheDocument());
    expect(screen.getByText('Demo submissions · Buyer RFQs')).toBeInTheDocument();
    expect(screen.queryByText('Homepage review')).toBeNull();
    await waitFor(() => expect(screen.getByText('ws-1')).toBeInTheDocument());
  });
  it('keeps the stale snapshot warning on failure and clears rows on auth loss', async () => {
    mockFetch(() => json(401, { error: 'Administrator sign-in is required.' }));
    renderConsole(<MarketplaceInboxPage tab="supplies" />);
    await waitFor(() => expect(screen.getByText('Administrator access required')).toBeInTheDocument());
    expect(screen.getByText(/No successful server sync yet/)).toBeInTheDocument();
  });
});
