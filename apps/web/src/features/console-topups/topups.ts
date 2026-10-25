import { TopupReviewResponse, TopupsResponse, type CreditTopup } from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

export type TopupScope = 'production' | 'demo';
export const POLL_MS = 15000;
export const METHODS: Record<string, string> = {
  credit_card: 'Credit card',
  paypal: 'PayPal',
  bank_transfer: 'Bank transfer',
};

export const topupStamp = (value: unknown): string =>
  value && Number.isFinite(Date.parse(String(value)))
    ? new Date(String(value)).toLocaleString('en-GB', { timeZone: 'UTC' })
    : 'Not provided';

export const topupAmount = (row: CreditTopup): string => {
  const value = Number.isSafeInteger(row.amountCents)
    ? Number(row.amountCents) / 100
    : Number(row.amount);
  return Number.isFinite(value) && value > 0
    ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    : 'Not provided';
};

export const topupLabel = (row: CreditTopup): string =>
  row.status === 'Approved'
    ? 'Solved'
    : row.status === 'Rejected'
      ? 'Rejected'
      : row.status === 'Pending'
        ? 'Pending'
        : 'Unknown';

export const topupToken = (row: CreditTopup): string => row.id + '|' + (row.workspaceId || '');
export const pendingRow = (row: CreditTopup | undefined): boolean =>
  row?.status === 'Pending' && !row.solved;

export const topupEndpoint = (suffix = '', scope: TopupScope = 'production') =>
  '/api/admin/topups' + suffix + (scope === 'demo' ? '?scope=demo' : '');

export function filterTopups(rows: CreditTopup[], query: string, filter: string): CreditTopup[] {
  const q = query.toLowerCase();
  return rows.filter(
    (row) =>
      (filter === 'All' || row.status === filter) &&
      [
        row.id,
        row.email,
        row.accountId,
        row.purchaseReference,
        METHODS[String(row.method)] || row.method,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
  );
}

/** Fails closed when the server answers for a different account scope. */
export function assertScope(
  scope: TopupScope,
  result: { scope?: string; requests: CreditTopup[] },
): void {
  const wrong =
    scope === 'demo'
      ? result.scope === 'production' ||
        !result.requests.every((row) => typeof row.workspaceId === 'string' && row.workspaceId)
      : result.scope === 'demo' ||
        result.requests.some((row) => row.workspaceId || row.demo === true);
  if (wrong) throw new Error('The server returned records for a different account scope.');
}
