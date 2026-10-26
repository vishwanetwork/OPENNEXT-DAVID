/** Read-only view models for future administrator services, not backend wire contracts. */
export const GROWTH_PERIODS = ['7D', '1M', '3M', '6M', '1Y'] as const;
export type GrowthPeriod = (typeof GROWTH_PERIODS)[number];

export interface OperationsUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly company: string | null;
  readonly role: string;
  readonly status: string;
  readonly joinedAt: string;
}

export interface UsersSnapshot {
  readonly users: readonly OperationsUser[];
  /** Aggregates must come from the service, never from a potentially paginated table. */
  readonly totalUsers: number;
  readonly growth: Readonly<Partial<Record<GrowthPeriod, number>>>;
}

export interface OperationsOrder {
  readonly id: string;
  readonly kind: 'Instance' | 'RFQ';
  readonly email: string;
  readonly model: string;
  readonly gpuCount: number;
  readonly country: string;
  readonly term: string;
  readonly total: number;
  readonly currency: string;
  readonly status: string;
  readonly state: 'processing' | 'completed' | 'cancelled';
  readonly submittedAt: string;
}

export interface OperationsPayment {
  readonly id: string;
  readonly email: string;
  readonly orderId: string;
  readonly amount: number;
  readonly currency: string;
  readonly reference: string;
  readonly submittedAt: string;
  readonly status: 'Awaiting confirmation' | 'Confirmed' | 'Rejected';
  readonly detail: string;
}

const contains = (values: readonly (string | number | null)[], search: string) => {
  const query = search.trim().toLowerCase();
  return values.some((value) =>
    String(value ?? '')
      .toLowerCase()
      .includes(query),
  );
};

export const filterUsers = (rows: readonly OperationsUser[], search: string, role: string) =>
  rows.filter(
    (row) =>
      (role === 'All' || row.role === role) &&
      contains([row.name, row.email, row.company, row.role, row.status], search),
  );

export const filterOrders = (rows: readonly OperationsOrder[], search: string, kind: string) =>
  rows.filter(
    (row) =>
      row.state === 'processing' &&
      (kind === 'All' || row.kind === kind) &&
      contains([row.id, row.email, row.model, row.country, row.term, row.status], search),
  );

export const filterPayments = (
  rows: readonly OperationsPayment[],
  search: string,
  status: string,
) =>
  rows.filter(
    (row) =>
      (status === 'All' || row.status === status) &&
      contains([row.email, row.orderId, row.reference, row.status], search),
  );

export function growthValue(snapshot: UsersSnapshot | undefined, period: GrowthPeriod) {
  return snapshot?.growth[period];
}

export function paymentAmount(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return '—';
  return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
