import { z } from 'zod';
import type { BuyerKybService, BuyerKybSnapshot } from '@/lib/buyer-kyb';
import { modeForCountry } from './requirements';

/** Validates frontend service-port results, not a newly agreed backend wire contract. */
const companySchema = z.object({
  country: z.string(),
  companyName: z.string(),
  registrationNumber: z.string(),
  email: z.string(),
  website: z.string(),
  taxId: z.string(),
  monthlyVolumeUsd: z.string(),
  monthlyTransactions: z.string(),
  businessDescription: z.string(),
  incorporationDate: z.string(),
  legalForm: z.string(),
  legalAddress: z.string(),
  phone: z.string(),
});
const snapshotSchema = z.object({
  confirmed: z.literal(true),
  accountId: z.string().min(1),
  demo: z.boolean(),
  verification: z
    .object({
      id: z.string().min(1),
      accountId: z.string().min(1),
      email: z.string().email(),
      mode: z.enum(['Auto', 'Full']),
      status: z.enum(['Reviewing', 'Approved', 'Rejected']),
      revision: z.number().int().nonnegative(),
      company: companySchema,
      documents: z.array(
        z.object({
          id: z.string().min(1),
          kind: z.enum([
            'legal-presence',
            'ownership-structure',
            'proof-of-address',
            'company-details',
            'representative-authorization',
          ]),
          fileName: z.string().min(1),
          contentType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
          sizeBytes: z.number().int().positive(),
        }),
      ),
      submittedAt: z.string().datetime({ offset: true }),
      reviewedAt: z.string().datetime({ offset: true }).optional(),
    })
    .nullable(),
});

export function confirmedKybSnapshot(
  value: unknown,
  accountId: string,
  demo: boolean,
): BuyerKybSnapshot | null {
  const result = snapshotSchema.safeParse(value);
  if (!result.success || result.data.accountId !== accountId || result.data.demo !== demo)
    return null;
  const record = result.data.verification;
  if (
    record &&
    (record.accountId !== accountId || modeForCountry(record.company.country) !== record.mode)
  )
    return null;
  return result.data;
}

export const buyerKybApi = {
  async load(service: BuyerKybService, accountId: string, demo: boolean, signal?: AbortSignal) {
    const result = confirmedKybSnapshot(await service.load(signal), accountId, demo);
    if (!result)
      throw new Error('KYB status could not be verified for this account. Please try again.');
    return result;
  },
  async submit(
    service: BuyerKybService,
    input: Parameters<BuyerKybService['submit']>[0],
    accountId: string,
    demo: boolean,
  ) {
    if (demo) throw new Error('Real business documents cannot be submitted in Demo.');
    const result = confirmedKybSnapshot(await service.submit(input), accountId, demo);
    if (
      !result ||
      result.verification?.status !== 'Reviewing' ||
      result.verification.mode !== input.mode ||
      result.verification.company.country !== input.company.country ||
      result.verification.company.registrationNumber.trim() !==
        input.company.registrationNumber.trim()
    )
      throw new Error('Submission was not confirmed. Check your KYB status before trying again.');
    return result;
  },
};
