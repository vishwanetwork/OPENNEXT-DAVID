import { z } from 'zod';
import {
  OPENNEXT_COMPANY,
  SPOT_AGREEMENT_VERSION,
  type SignedSpotAgreement,
  type SpotAgreementContext,
  type SpotAgreementDocument,
} from '@/lib/spot-agreement';

const text = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .refine((value) => !value.includes('{{'), 'Unresolved agreement fields cannot be signed.');
const identifier = z.string().min(1).max(200);
const cents = z.number().int().nonnegative().safe();
const date = z.string().datetime({ offset: true });
export const agreementContextSchema = z.object({
  accountId: identifier,
  purchaseReference: identifier,
  offerId: identifier,
  offerFingerprint: text,
  model: text,
  gpuCount: z.number().int().positive(),
  vcpu: z.number().positive().nullable(),
  memoryGbPerGpu: z.number().positive().nullable(),
  country: text,
  paymentMethod: z.enum(['credit', 'bank_transfer']),
  pricing: z.object({
    currency: z.literal('USD'),
    durationHours: z.number().min(1),
    hourlyCents: cents.positive(),
    baseCents: cents.positive(),
    feeCents: z.literal(0),
    totalCents: cents.positive(),
  }),
});
const documentSchema = z.object({
  confirmed: z.literal(true),
  demo: z.literal(false),
  id: identifier,
  version: z.literal(SPOT_AGREEMENT_VERSION),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  context: agreementContextSchema,
  accountNumber: identifier,
  kyb: z.object({
    caseId: identifier,
    revision: z.number().int().nonnegative(),
    companyName: text,
    registrationNumber: text,
    country: text,
    noticeEmail: z.string().email(),
  }),
  provider: z.object({
    legalName: z.literal(OPENNEXT_COMPANY.legalName),
    registrationNumber: z.literal(OPENNEXT_COMPANY.registrationNumber),
    representative: text,
    address: text,
    noticeEmail: z.string().email(),
    governingLaw: text,
    disputeForum: text,
  }),
  policies: z.object({
    approved: z.literal(true),
    serviceWindow: z.literal('cumulative-running-time'),
    dataPreservationVerified: z.literal(true),
    cashoutEnabled: z.literal(true),
    minimumChargeRule: text,
    taxTreatment: text,
    retentionAfterEnd: text,
    settlementTiming: text,
    paymentCollectionAuthority: text,
    cashoutTerms: text,
  }),
  expiresAt: date,
});
const receiptSchema = z.object({
  confirmed: z.literal(true),
  demo: z.literal(false),
  agreementId: identifier,
  version: z.literal(SPOT_AGREEMENT_VERSION),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  signatureId: identifier,
  context: agreementContextSchema,
  kybCaseId: identifier,
  kybRevision: z.number().int().nonnegative(),
  signatoryName: text,
  signatoryTitle: text,
  signedAt: date,
  providerExecutedAt: date,
  expiresAt: date,
  executionComplete: z.literal(true),
});

export function contextKey(context: SpotAgreementContext): string {
  const parsed = agreementContextSchema.parse(context);
  const price = parsed.pricing;
  const units = Math.round(price.durationHours * 100);
  const product = units * price.hourlyCents;
  if (
    Math.abs(units / 100 - price.durationHours) > 1e-8 ||
    !Number.isSafeInteger(product) ||
    Math.round(product / 100) !== price.baseCents ||
    price.baseCents !== price.totalCents
  )
    throw new Error('The agreement price and duration do not match the order total.');
  return JSON.stringify(parsed);
}
export function validateAgreementDocument(
  value: unknown,
  context: SpotAgreementContext,
  now = Date.now(),
): SpotAgreementDocument {
  const doc = documentSchema.parse(value);
  if (contextKey(doc.context) !== contextKey(context) || Date.parse(doc.expiresAt) <= now)
    throw new Error('The agreement does not match your current purchase or has expired.');
  return doc;
}
export function validateAgreementReceipt(
  value: unknown,
  context: SpotAgreementContext,
  now = Date.now(),
): SignedSpotAgreement {
  const receipt = receiptSchema.parse(value);
  if (
    contextKey(receipt.context) !== contextKey(context) ||
    Date.parse(receipt.expiresAt) <= now ||
    Date.parse(receipt.signedAt) > now + 60_000 ||
    Date.parse(receipt.providerExecutedAt) > now + 60_000
  )
    throw new Error('Review and sign the agreement for this purchase before paying.');
  return receipt;
}
