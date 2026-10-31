import { z } from 'zod';
import {
  OperationsActivity,
  OperationsAgent,
  OperationsBilling,
  OperationsJob,
  OperationsOrders,
  OperationsOverview,
  OperationsUsers,
} from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

export const liveSchemas = {
  users: OperationsUsers,
  orders: OperationsOrders,
  overview: OperationsOverview,
  activity: OperationsActivity,
  agent: OperationsAgent,
  billing: OperationsBilling,
};
export type LiveResource = keyof typeof liveSchemas;
export type LiveData<K extends LiveResource> = z.infer<(typeof liveSchemas)[K]>;
const paths: Record<LiveResource, string> = {
  users: '/api/admin/users',
  orders: '/api/admin/orders',
  overview: '/api/admin/overview',
  activity: '/api/admin/operations/activity',
  agent: '/api/admin/agent',
  billing: '/api/admin/agent/billing',
};
const Session = z.object({ confirmed: z.literal(true), sessionScope: z.string().min(1) });
export const liveApi = {
  session: async (api: ApiClient, signal?: AbortSignal) =>
    Session.parse(await api.get('/api/admin/operations/session', { signal })),
  read: async <K extends LiveResource>(
    api: ApiClient,
    resource: K,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<LiveData<K>> =>
    liveSchemas[resource].parse(
      await api.get(paths[resource] + '?' + new URLSearchParams(params), { signal }),
    ) as LiveData<K>,
  reconcile: async (api: ApiClient, idempotencyKey: string) =>
    OperationsJob.parse(
      await api.post('/api/admin/agent/actions', { action: 'reconcile', idempotencyKey }),
    ),
};
