import { z } from 'zod';

const count = z.number().int().nonnegative();
const page = { nextCursor: z.string().nullable(), asOf: z.string() };
export const OperationsUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  company: z.string().nullable(),
  role: z.string(),
  status: z.string(),
  joinedAt: z.string(),
});
export const OperationsUsers = z.object({
  users: z.array(OperationsUser),
  totalUsers: count,
  filteredTotal: count,
  growth: z.object({ '7D': count, '1M': count, '3M': count, '6M': count, '1Y': count }),
  ...page,
});
export const OperationsOrder = z.object({
  id: z.string(),
  kind: z.enum(['Instance', 'RFQ']),
  email: z.string(),
  model: z.string(),
  gpuCount: count,
  country: z.string(),
  term: z.string(),
  total: z.number().nonnegative(),
  currency: z.string(),
  status: z.string(),
  state: z.enum(['processing', 'completed', 'cancelled']),
  submittedAt: z.string(),
});
export const OperationsOrders = z.object({
  orders: z.array(OperationsOrder),
  total: count,
  ...page,
});
export const OperationsEvent = z.object({
  id: z.string(),
  at: z.string(),
  actor: z.string(),
  action: z.string(),
  target: z.string(),
  detail: z.string(),
});
export const OperationsActivity = z.object({
  events: z.array(OperationsEvent),
  total: count,
  ...page,
});
export const OperationsOverview = z.object({
  metrics: z.object({
    pendingTopups: count,
    pendingPayments: count,
    pendingKyb: count,
    liveInstances: count,
  }),
  events: z.array(OperationsEvent),
  asOf: z.string(),
});
export const OperationsJob = z.object({
  id: z.string(),
  action: z.literal('reconcile'),
  state: z.enum(['queued', 'running', 'completed', 'failed']),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export const OperationsAgent = z.object({
  health: z.object({
    status: z.string().nullable(),
    background_enabled: z.boolean().nullable(),
    worker_running: z.boolean().nullable(),
    live_orders_enabled: z.boolean().nullable(),
    dry_run_enabled: z.boolean().nullable(),
    rentals_enabled: z.boolean().nullable(),
    rental_worker_running: z.boolean().nullable(),
    rental_event_consumer_error: z.string().nullable(),
  }),
  rentalStates: z.record(count),
  jobs: z.array(OperationsJob),
  maintenanceError: z.string().nullable(),
  policy: z.object({ arbitraryCode: z.literal(false), runningOrdersChanged: z.literal(false) }),
  asOf: z.string(),
});
export const OperationsBilling = z.object({
  currency: z.literal('USD'),
  billedCents: count,
  heldCents: count,
  releasedCents: count,
  providerInvoiceCents: z.number().nullable(),
  entries: z.array(
    z.object({
      id: z.string(),
      rentalId: z.string().nullable(),
      state: z.string(),
      heldCents: count,
      billedCents: count.nullable(),
      releasedCents: count.nullable(),
      at: z.string(),
    }),
  ),
  asOf: z.string(),
});
