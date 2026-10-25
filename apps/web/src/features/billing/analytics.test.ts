import { describe, expect, it } from 'vitest';
import type { LedgerEntry, Order } from '@opennext/contracts';
import { FEE_POLICY } from '@/features/procurement/fees';
import { activityRows, analytics, csv, flow, ledgerAmount, metrics, orderAmount, type BillingData } from './analytics';

const ui = { from: '2026-10-01', to: '2026-10-31', chart: 'bars' as const, sample: false, hidden: [] };
const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({ id: 'L', amount: -10, type: 'Capacity purchase', createdAt: '2026-10-05T10:00:00Z', status: 'Completed', ...over });
const order = (over: Partial<Order>): Order => ({ id: 'O', status: 'Completed', audit: [], ...over });
const data = (over: Partial<BillingData>): BillingData => ({ role: 'Buyer', ledger: [], orders: [], payouts: [], listings: [], billingUI: ui, ...over });

describe('billing analytics', () => {
  it('classifies flows and signs commissions per role', () => {
    expect(flow(entry({ type: 'Credit top-up', amount: 100 }))).toBe('transfer');
    expect(flow(entry({ type: 'Broker commission', amount: 5 }))).toBe('commission');
    expect(flow(entry({ type: 'Sale settlement', amount: 50 }))).toBe('revenue');
    expect(flow(entry({ amount: -5 }))).toBe('purchase');
    expect(ledgerAmount('Seller', entry({ type: 'Commission', amount: 5 }))).toBe(-5);
    expect(ledgerAmount('Broker', entry({ type: 'Commission', amount: -5 }))).toBe(5);
  });
  it('excludes credit, payout and pending transactions and splits purchases by market term', () => {
    const S = data({
      ledger: [entry({ id: 'a', orderId: 'O1', amount: -40 }), entry({ id: 'b', type: 'Credit top-up', amount: 500 }), entry({ id: 'c', amount: -9, status: 'Pending' }), entry({ id: 'd', orderId: 'O2', amount: -10 }), entry({ id: 'e', amount: -1, createdAt: '2026-09-30T00:00:00Z' })],
      orders: [order({ id: 'O1', term: 'Spot' }), order({ id: 'O2', term: 'On-demand' })],
    });
    const a = analytics(S);
    expect(a.sums.purchase).toBe(50);
    expect(a.sums.spot).toBe(40);
    expect(a.sums.demand).toBe(10);
    expect(a.rows).toHaveLength(31);
  });
  it('seller pending settlement excludes unpaid, completed and buy-side orders and uses net proceeds', () => {
    const S = data({
      role: 'Seller',
      orders: [
        order({ id: 'p1', side: 'sell', paymentStatus: 'Paid', status: 'Active', subtotal: 100, sellerNet: 95, feePolicyVersion: FEE_POLICY, buyerFee: 5, sellerFee: 5, buyerTotal: 105 }),
        order({ id: 'p2', side: 'sell', paymentStatus: 'Unpaid', status: 'Awaiting payment', total: 50 }),
        order({ id: 'p3', side: 'sell', paymentStatus: 'Paid', status: 'Completed', total: 70, settledAt: '2026-10-10T00:00:00Z', subtotal: 70, sellerNet: 66.5, feePolicyVersion: FEE_POLICY, buyerFee: 3.5, sellerFee: 3.5, buyerTotal: 73.5 }),
        order({ id: 'p4', side: 'buy', paymentStatus: 'Paid', status: 'Active', total: 20 }),
      ],
    });
    const cards = metrics(S, analytics(S));
    expect(cards.find((c) => c.label === 'Pending settlement')?.value).toBe(95);
    expect(cards.find((c) => c.label === 'OpenNEXT Fee 5%')?.value).toBe(-3.5);
    expect(orderAmount(S.orders[0])).toBe(95);
    expect(orderAmount(S.orders[3])).toBe(20);
  });
  it('activity rows include unpaid orders without ledger entries and sort newest first', () => {
    const S = data({ ledger: [entry({ id: 'a', orderId: 'O1', createdAt: '2026-10-05T10:00:00Z' })], orders: [order({ id: 'O2', paymentStatus: 'Unpaid', status: 'Awaiting payment', total: 30, createdAt: '2026-10-06T00:00:00Z', title: 'Cluster' })] });
    expect(activityRows(S).map((r) => [r.id, r.isOrder, r.displayAmount])).toEqual([['O2', true, -30], ['a', false, -10]]);
  });
  it('CSV export escapes quotes and spreadsheet formula injection', () => {
    const out = csv([{ id: '=SUM(A1)', note: 'say "hi"', nested: { a: 1 } }]);
    expect(out).toContain('"\'=SUM(A1)"');
    expect(out).toContain('"say ""hi"""');
    expect(out).toContain('"{""a"":1}"');
    expect(out.startsWith('﻿')).toBe(true);
  });
});
