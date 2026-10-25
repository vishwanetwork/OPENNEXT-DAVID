import { z } from 'zod';

const num = z.number().nullable().optional();
const str = z.string().nullable().optional();

/** Delivered allocation (`/api/marketplace/instances`, also inside `/api/marketplace/me`). */
export const Instance = z
  .object({
    id: z.string(),
    name: str,
    model: str,
    region: str,
    term: str,
    count: num,
    rate: num,
    status: str,
    connectionStatus: str,
    paymentStatus: str,
    orderId: str,
    purchaseOrderId: str,
    serviceStart: str,
    serviceEnd: str,
    end: z.union([z.string(), z.number()]).nullish(),
    endedAt: str,
    releasedAt: str,
    createdAt: str,
    sshHost: str,
    sshUser: str,
    sshPort: num,
    resaleAllowed: z.boolean().optional(),
    availableResellCount: num,
    telemetry: z.object({ utilizationPercent: num, observedAt: str, idleGpuCount: num }).passthrough().nullish(),
    sample: z.boolean().optional(),
    demo: z.boolean().optional(),
    preview: z.boolean().optional(),
  })
  .passthrough();
export type Instance = z.infer<typeof Instance>;

export const InstancesResponse = z.object({ instances: z.array(Instance).default([]) }).passthrough();
export type InstancesResponse = z.infer<typeof InstancesResponse>;

/** POST /api/marketplace/instances/:id/resell */
export const ResellRequest = z.object({ count: z.number().int().positive(), rate: z.number().positive(), hours: z.number().int().positive() });
export type ResellRequest = z.infer<typeof ResellRequest>;
export const ResellResponse = z.object({ supply: z.record(z.unknown()) }).passthrough();
