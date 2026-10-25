/** Role-aware billing analytics (legacy OpenNEXT-billing.js, pure part). */
import type { LedgerEntry, Order, Payout } from '@opennext/contracts';
import { FEE_POLICY } from '@/features/procurement';
import type { Role } from '@/terminal-kit';

export const FEE_LABEL = 'OpenNEXT Fee 5%';
export const COLORS: Record<string, string> = {
  purchase: '#7298b5',
  revenue: '#3a7355',
  commission: '#bea165',
  spot: '#3a7355',
  demand: '#7298b5',
  other: '#bea165',
};

export const round = (value: unknown): number => Math.round((Number(value) || 0) * 100) / 100;
export const num = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);
export const usd = (value: unknown): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num(value));
export const tokenUsd = (value: unknown): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(num(value));
export const iso = (value: unknown): string => {
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};
export const dateKey = (value: unknown): string => iso(value).slice(0, 10);
export const stamp = (value: unknown): string => {
  const d = new Date(value as string);
  return !value || Number.isNaN(d.getTime())
    ? 'Not recorded'
    : d.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
      }) + ' UTC';
};

export type BillingRole = Role;
export const orderSide = (o: Order): 'buy' | 'sell' =>
  o.side || (o.role === 'Seller' ? 'sell' : 'buy');

export const currentFees = (o: Partial<Order>): boolean =>
  o.feePolicyVersion === FEE_POLICY &&
  (['subtotal', 'buyerFee', 'sellerFee', 'buyerTotal', 'sellerNet'] as const).every(
    (key) => o[key] != null && Number.isFinite(Number(o[key])),
  );

export const orderAmount = (o: Order): number =>
  num(
    orderSide(o) === 'sell'
      ? (o.sellerNet ?? o.subtotal ?? o.total ?? o.amount)
      : (o.buyerTotal ?? o.total ?? o.amount),
  );

export interface BillingUi {
  from: string;
  to: string;
  chart: 'bars' | 'lines';
  sample: boolean;
  hidden: string[];
}

export interface BillingData {
  role: BillingRole;
  ledger: LedgerEntry[];
  orders: Order[];
  payouts: Payout[];
  listings: { status?: string | null }[];
  billingUI: BillingUi;
}

export const defaultBillingUi = (): BillingUi => {
  const today = new Date();
  return {
    from: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10),
    to: today.toISOString().slice(0, 10),
    chart: 'bars',
    sample: false,
    hidden: [],
  };
};

export type Flow = 'transfer' | 'commission' | 'revenue' | 'purchase';
export function flow(l: LedgerEntry): Flow {
  const type = String(l.type || '').toLowerCase();
  if (
    /cashout|payout|top.?up|credit|refund/.test(type) ||
    (l.wallet === 'credit' && num(l.amount) > 0)
  )
    return 'transfer';
  if (/commission/.test(type)) return 'commission';
  if (/earning|sale|revenue|settlement/.test(type) && num(l.amount) > 0) return 'revenue';
  return num(l.amount) < 0 ? 'purchase' : 'transfer';
}
export const signedCommission = (role: BillingRole, value: unknown) =>
  (role === 'seller' ? -1 : 1) * Math.abs(num(value));
export const ledgerAmount = (role: BillingRole, item: LedgerEntry) =>
  flow(item) === 'commission' ? signedCommission(role, item.amount) : num(item.amount);
export const ledgerLabel = (role: BillingRole, item: LedgerEntry) =>
  flow(item) === 'commission'
    ? role === 'seller'
      ? 'Commission paid'
      : 'Commission earned'
    : String(item.type || '');

export const inPeriod = (ui: BillingUi, value: unknown) => {
  const day = dateKey(value);
  return Boolean(day) && day >= ui.from && day <= ui.to;
};

export function periodRows(S: BillingData): LedgerEntry[] {
  return S.ledger.filter((l) => {
    const day = dateKey(l.createdAt || l.date);
    return (
      day &&
      day >= S.billingUI.from &&
      day <= S.billingUI.to &&
      !['Failed', 'Cancelled', 'Pending'].includes(String(l.status))
    );
  });
}

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const start = Date.parse(from + 'T00:00:00Z');
  const end = Date.parse(to + 'T00:00:00Z');
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return days;
  for (let t = start; t <= end && days.length < 366; t += 86400000)
    days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

export type SeriesKey = 'purchase' | 'revenue' | 'commission' | 'spot' | 'demand' | 'other';
export interface DailyRow extends Record<SeriesKey, number> {
  day: string;
}
export interface Analytics {
  rows: DailyRow[];
  sums: Record<SeriesKey, number>;
  sample: boolean;
}

export function analytics(S: BillingData): Analytics {
  const days = daysBetween(S.billingUI.from, S.billingUI.to);
  const rows: DailyRow[] = days.map((day) => ({
    day,
    purchase: 0,
    revenue: 0,
    commission: 0,
    spot: 0,
    demand: 0,
    other: 0,
  }));
  const map = Object.fromEntries(rows.map((r) => [r.day, r]));
  for (const l of periodRows(S)) {
    const key = flow(l);
    const r = map[dateKey(l.createdAt || l.date)];
    if (!r || key === 'transfer') continue;
    const amount =
      key === 'commission' ? signedCommission(S.role, l.amount) : Math.abs(num(l.amount));
    r[key] += amount;
    if (key === 'purchase') {
      const o = S.orders.find((x) => x.id === l.orderId);
      r[
        o && /spot/i.test(String(o.term))
          ? 'spot'
          : o && /on.?demand/i.test(String(o.term))
            ? 'demand'
            : 'other'
      ] += amount;
    }
  }
  if (S.billingUI.sample)
    rows.forEach((r, i) => {
      r.spot = round(38 + (i % 6) * 8);
      r.demand = round(118 + (i % 9) * 13);
      r.other = round(12 + (i % 4) * 3);
      r.purchase = r.spot + r.demand + r.other;
      r.revenue = round(r.purchase * 1.22);
      r.commission = signedCommission(S.role, round(r.revenue * 0.035));
    });
  const sums = rows.reduce(
    (a, r) => {
      for (const k of [
        'purchase',
        'revenue',
        'commission',
        'spot',
        'demand',
        'other',
      ] as SeriesKey[])
        a[k] += r[k];
      return a;
    },
    { purchase: 0, revenue: 0, commission: 0, spot: 0, demand: 0, other: 0 } as Record<
      SeriesKey,
      number
    >,
  );
  return { rows, sums, sample: S.billingUI.sample };
}

export function settledPlatformFees(S: BillingData): number {
  return S.orders
    .filter(
      (o) =>
        orderSide(o) === 'sell' &&
        currentFees(o) &&
        o.paymentStatus === 'Paid' &&
        /completed|settled/i.test(o.status) &&
        inPeriod(S.billingUI, o.settledAt || o.completedAt),
    )
    .reduce((sum, o) => sum + num(o.sellerFee), 0);
}

export interface MetricCard {
  label: string;
  value: number;
  note: string;
  count?: boolean;
}

export function metrics(S: BillingData, a: Analytics): MetricCard[] {
  const r = S.role;
  const n = Math.max(1, a.rows.length);
  const sample = a.sample ? 'Example analysis' : 'Selected period';
  const settled = S.orders.filter(
    (o) =>
      orderSide(o) === 'buy' &&
      /completed|settled/i.test(o.status) &&
      o.paymentStatus === 'Paid' &&
      inPeriod(
        S.billingUI,
        o.completedAt ||
          o.settledAt ||
          (o.audit || []).filter((e) => /completed|settled/i.test(e.event)).at(-1)?.at,
      ),
  );
  const pending = S.orders
    .filter(
      (o) =>
        orderSide(o) === 'sell' &&
        o.paymentStatus === 'Paid' &&
        !/completed|cancelled|settled/i.test(o.status),
    )
    .reduce(
      (sum, o) =>
        sum +
        num(
          o.sellerNet == null
            ? o.subtotal == null
              ? o.total || o.amount
              : o.subtotal
            : o.sellerNet,
        ),
      0,
    );
  if (r === 'buyer')
    return [
      { label: 'Purchases & usage charges', value: a.sums.purchase, note: sample },
      {
        label: 'Average daily spend',
        value: a.sums.purchase / n,
        note: 'Posted charges / calendar days',
      },
      {
        label: 'Pending orders',
        value: S.orders
          .filter(
            (o) =>
              orderSide(o) === 'buy' && o.paymentStatus !== 'Paid' && !/cancelled/i.test(o.status),
          )
          .reduce((sum, o) => sum + num(o.total || o.amount), 0),
        note: 'Current unpaid orders · not date-filtered',
      },
      {
        label: 'Completed purchases',
        value: settled.length,
        note: 'Completed within selected period',
        count: true,
      },
    ];
  if (r === 'seller')
    return [
      { label: 'Settled earnings', value: a.sums.revenue, note: sample },
      {
        label: 'Pending settlement',
        value: pending,
        note: 'Current paid orders · not date-filtered',
      },
      {
        label: FEE_LABEL,
        value: -settledPlatformFees(S),
        note: 'Recorded settlement fees · already deducted from net proceeds',
      },
      {
        label: 'Paid out',
        value: S.payouts
          .filter(
            (p) =>
              p.status === 'Paid' &&
              dateKey(p.paidAt) >= S.billingUI.from &&
              dateKey(p.paidAt) <= S.billingUI.to,
          )
          .reduce((sum, p) => sum + num(p.amount), 0),
        note: 'Completed withdrawals',
      },
    ];
  return [
    { label: 'Purchase cost', value: a.sums.purchase, note: sample },
    { label: 'Sales revenue', value: a.sums.revenue, note: sample },
    {
      label: 'Trading margin',
      value: a.sums.revenue - a.sums.purchase,
      note: 'Revenue less purchase charges; before overhead',
    },
    {
      label: 'Commission earned',
      value: a.sums.commission,
      note: 'Reported separately from trading margin',
    },
  ];
}

export const seriesFor = (role: BillingRole): [SeriesKey, string][] =>
  role === 'buyer'
    ? [
        ['demand', 'On-demand'],
        ['spot', 'Spot'],
        ['other', 'Other capacity'],
      ]
    : role === 'seller'
      ? [
          ['revenue', 'Earnings'],
          ['commission', 'Commission paid'],
        ]
      : [
          ['purchase', 'Purchase cost'],
          ['revenue', 'Sales revenue'],
          ['commission', 'Commission earned'],
        ];

export interface ActivityRow {
  id: string;
  orderId?: string | null;
  type: string;
  createdAt?: string | null;
  date?: string | null;
  displayAmount: number;
  status?: string | null;
  isOrder: boolean;
  test?: boolean;
}

export function activityRows(S: BillingData): ActivityRow[] {
  const list = S.ledger.filter((l) => {
    const d = dateKey(l.createdAt || l.date);
    return d && d >= S.billingUI.from && d <= S.billingUI.to;
  });
  const unpaid = S.orders.filter(
    (o) =>
      o.paymentStatus !== 'Paid' &&
      dateKey(o.createdAt || o.created) >= S.billingUI.from &&
      dateKey(o.createdAt || o.created) <= S.billingUI.to &&
      !list.some((l) => l.orderId === o.id),
  );
  return [
    ...list.map((l) => ({
      ...l,
      orderId: l.orderId,
      type: ledgerLabel(S.role, l),
      displayAmount: ledgerAmount(S.role, l),
      isOrder: false,
    })),
    ...unpaid.map(
      (o): ActivityRow => ({
        id: o.id,
        orderId: o.id,
        type: o.title || 'Capacity order',
        createdAt: o.createdAt || o.created,
        date: null,
        displayAmount: (orderSide(o) === 'sell' ? 1 : -1) * orderAmount(o),
        status: o.status,
        isOrder: true,
      }),
    ),
  ].sort(
    (a, b) => +new Date(String(b.createdAt || b.date)) - +new Date(String(a.createdAt || a.date)),
  );
}

export function orderCommission(S: BillingData, item: Order): number | null {
  const recorded = item.commissionAmount ?? item.brokerCommission ?? item.commission;
  if (recorded != null) return signedCommission(S.role, recorded);
  const entries = S.ledger.filter(
    (entry) => entry.orderId === item.id && flow(entry) === 'commission',
  );
  return entries.length
    ? entries.reduce((sum, entry) => sum + ledgerAmount(S.role, entry), 0)
    : null;
}

/** CSV with quote escaping and spreadsheet formula-injection protection. */
export function csv(rows: Record<string, unknown>[]): string {
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const cell = (value: unknown) => {
    let text =
      value != null && typeof value === 'object'
        ? JSON.stringify(value)
        : String(value == null ? '' : value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return (
    '﻿' +
    keys.map(cell).join(',') +
    '\r\n' +
    rows.map((r) => keys.map((k) => cell(r[k])).join(',')).join('\r\n')
  );
}

export function exportRows(S: BillingData, type: string, id?: string): Record<string, unknown>[] {
  if (type === 'daily') return analytics(S).rows as unknown as Record<string, unknown>[];
  if (type === 'order')
    return S.orders
      .filter((item) => item.id === id)
      .map((item) => {
        const row: Record<string, unknown> = { ...item };
        for (const key of ['commission', 'commissionAmount', 'brokerCommission'])
          if (row[key] != null) row[key] = signedCommission(S.role, row[key]);
        const commission = orderCommission(S, item);
        if (commission != null) row.commissionAmount = commission;
        return row;
      });
  return (
    type === 'record'
      ? S.ledger.filter((item) => item.id === id)
      : S.ledger.filter((item) => {
          const day = dateKey(item.createdAt || item.date);
          return day && day >= S.billingUI.from && day <= S.billingUI.to;
        })
  ).map((item) => ({
    ...item,
    type: ledgerLabel(S.role, item),
    amount: ledgerAmount(S.role, item),
  }));
}

/** Chart width rule (legacy `chartWidth`). */
export const chartWidth = (viewport: number) =>
  viewport < 700 ? Math.max(280, viewport - 120) : 1060;
