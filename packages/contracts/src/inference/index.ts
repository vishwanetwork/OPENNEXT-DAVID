import { z } from 'zod';

export const InferencePreset = z.object({
  id: z.string(),
  label: z.string(),
  model: z.string(),
  precision: z.string(),
  diskGiB: z.number().int().positive(),
  estimatedMinutes: z.number().positive(),
  billingStart: z.literal('gpu_delivery'),
  enabled: z.boolean(),
  reason: z.string().nullable(),
  modelGpuCount: z.number().int().positive().nullable().optional(),
  requirements: z
    .object({
      minimumTotalVramGB: z.number().positive(),
      minimumHostMemoryGiB: z.number().positive(),
      minimumVcpus: z.number().int().positive(),
      modelDiskGiB: z.number().positive(),
      rootDiskGiB: z.number().positive(),
      tensorParallelSizes: z.array(z.number().int().positive()),
      minimumComputeCapability: z.string(),
      architecture: z.string(),
      maxModelLen: z.number().int().positive(),
      maxNumSeqs: z.number().int().positive(),
    })
    .optional(),
});
export type InferencePreset = z.infer<typeof InferencePreset>;
export const InferencePresets = z.object({ presets: z.array(InferencePreset) });
export const InferenceQuote = z.object({
  modelGpuCount: z.number().int().positive().nullable().optional(),
  pricing: z.object({
    currency: z.literal('USD'),
    durationHours: z.number(),
    hourlyCents: z.number().int().positive(),
    baseCents: z.number().int(),
    feeCents: z.number().int(),
    totalCents: z.number().int(),
  }),
  modelStorageHourlyCents: z.number().int().nonnegative(),
  inferencePresetId: z.string().nullable(),
  billingStart: z.literal('gpu_delivery'),
});
export type InferenceQuote = z.infer<typeof InferenceQuote>;
export const InferenceQuoteRequest = z.object({
  offerId: z.string().min(1).max(200),
  inferencePresetId: z.string().max(100),
  durationHours: z.number().min(1).max(720),
});
export const InferenceAction = z.object({
  action: z.enum(['retry', 'stop', 'rotate_key']),
  expectedVersion: z.number().int().nonnegative(),
});
export const InferenceStatus = z
  .object({
    version: z.number().int().optional(),
    preset_id: z.string(),
    state: z.enum([
      'queued',
      'preparing_runtime',
      'downloading',
      'loading',
      'ready',
      'failed',
      'stopped',
    ]),
    downloaded_bytes: z.number().nonnegative().optional(),
    total_bytes: z.number().nonnegative().optional(),
    error: z.string().nullable().optional(),
    estimated_minutes: z.number().positive().optional(),
    model_gpu_count: z.number().int().positive().optional(),
    billing_start: z.literal('gpu_delivery'),
  })
  .passthrough();
export const InstanceInference = z.object({
  status: InferenceStatus.nullable(),
  connection: z
    .object({
      baseUrl: z.string().url(),
      model: z.string(),
      apiKey: z.string(),
      keyVersion: z.number().int(),
    })
    .nullable(),
});
export type InstanceInference = z.infer<typeof InstanceInference>;
export const CapacityQuota = z.object({
  maxInstances: z.number().int().nonnegative().nullable(),
  maxGpus: z.number().int().nonnegative().nullable(),
  usageKnown: z.boolean(),
  capacityGuaranteed: z.literal(false),
  capacityStatus: z.literal('unknown'),
  basis: z.literal('quota_estimate'),
  checkedAt: z.string().optional(),
  sharedPoolId: z.string().optional(),
  quotaLimitVcpus: z.number().optional(),
  usedVcpus: z.number().optional(),
  reservedVcpus: z.number().optional(),
  remainingVcpus: z.number().nullable().optional(),
  vcpusPerInstance: z.number().optional(),
});
export type CapacityQuota = z.infer<typeof CapacityQuota>;
