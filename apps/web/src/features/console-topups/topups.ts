import { TopupReviewResponse, TopupsResponse, type TopupRequest } from '@opennext/contracts';
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

export const topupAmount = (row: TopupRequest): string => {
  const value = Number.isSafeInteger(row.amountCents)
    ? Number(row.amountCents) / 100
    : Number(row.amount);
  return Number.isFinite(value) && value > 0
    ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    : 'Not provided';
};

export const topupLabel = (row: TopupRequest): string =>
  row.status === 'Approved'
    ? 'Solved'
    : row.status === 'Rejected'
      ? 'Rejected'
      : row.status === 'Pending'
        ? 'Pending'
        : 'Unknown';

export const topupToken = (row: TopupRequest): string => row.id + '|' + (row.workspaceId || '');
export const pendingRow = (row: TopupRequest | undefined): boolean =>
  row?.status === 'Pending' && !row.solved;

export const topupEndpoint = (suffix = '', scope: TopupScope = 'production') =>
  '/api/admin/topups' + suffix + (scope === 'demo' ? '?scope=demo' : '');

export function filterTopups(rows: TopupRequest[], query: string, filter: string): TopupRequest[] {
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
  result: { scope?: string; requests: TopupRequest[] },
): void {
  const wrong =
    scope === 'demo'
      ? result.scope === 'production' ||
        !result.requests.every((row) => typeof row.workspaceId === 'string' && row.workspaceId)
      : result.scope === 'demo' ||
        result.requests.some((row) => row.workspaceId || row.demo === true);
  if (wrong) throw new Error('The server returned records for a different account scope.');
}

export const topupsApi = {
  list: async (api: ApiClient, scope: TopupScope, signal?: AbortSignal) => {
    const parsed = TopupsResponse.safeParse(await api.get(topupEndpoint('', scope), { signal }));
    if (!parsed.success) throw new Error('The server returned an invalid top-up request list.');
    assertScope(scope, parsed.data);
    return parsed.data.requests;
  },
  review: async (
    api: ApiClient,
    scope: TopupScope,
    id: string,
    body: {
      decision: 'Approve' | 'Reject';
      reason: string;
      fundsVerified?: true;
      workspaceId?: string;
    },
  ) =>
    TopupReviewResponse.parse(
      await api.post(topupEndpoint('/' + encodeURIComponent(id) + '/review', scope), body),
    ),
};
