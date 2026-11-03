import { z } from 'zod';
import type { BuyerKybCase } from '@/lib/buyer-kyb';
import type { CashoutBankDetails, CashoutSnapshot, CashoutSubmission } from '@/lib/cashout';
import { validCountry } from '@/lib/countries';

const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().trim().min(1);
export const cashoutRecordSchema = z.object({
  id: identifier,
  accountId: identifier,
  accountNumber: identifier,
  email: z.string().email(),
  amountCents: cents.positive(),
  currency: z.literal('USD'),
  status: z.enum(['pending', 'completed', 'failed']),
  revision: cents,
  kybId: identifier,
  kybRevision: cents,
  companyName: identifier,
  registrationNumber: identifier,
  companyCountry: identifier.refine(validCountry),
  bankName: identifier,
  bankCountry: identifier.refine(validCountry),
  maskedAccount: identifier.refine((value) => /\*|[xX]{3}|•/.test(value)),
  submittedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).optional(),
  transferReference: identifier.optional(),
  idempotencyKey: identifier,
});

export const cashoutSnapshotSchema = z.object({
  confirmed: z.literal(true),
  accountId: identifier,
  demo: z.literal(false),
  currency: z.literal('USD'),
  balanceRevision: cents,
  withdrawableCents: cents,
  kybId: identifier,
  kybRevision: cents,
  submissionKey: identifier,
  requests: z.array(cashoutRecordSchema),
});

export function confirmedCashoutSnapshot(
  value: unknown,
  accountId: string,
): CashoutSnapshot | null {
  const parsed = cashoutSnapshotSchema.safeParse(value);
  if (!parsed.success || parsed.data.accountId !== accountId) return null;
  if (parsed.data.requests.some((request) => request.accountId !== accountId)) return null;
  if (
    new Set(parsed.data.requests.map((request) => request.id)).size !== parsed.data.requests.length
  )
    return null;
  return parsed.data;
}

export function amountInCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole = '', fraction = ''] = value.trim().split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

/** IBAN modulo-97 check catches transcription errors; the backend validates country-specific rules. */
export function validIban(value: string): boolean {
  const normalized = value.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(normalized)) return false;
  const shifted = normalized.slice(4) + normalized.slice(0, 4);
  let remainder = 0;
  for (const character of shifted) {
    const digits = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

const validBic = (value: string) => /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(value);

export function validateCashoutBank(bank: CashoutBankDetails, companyName: string): string {
  if (bank.beneficiaryName !== companyName)
    return 'The beneficiary must match the legal company name on your approved KYB.';
  if (!bank.beneficiaryAddress.trim() || !bank.bankName.trim() || !bank.bankAddress.trim())
    return 'Enter the beneficiary address, bank name and bank address.';
  if (!validCountry(bank.bankCountry)) return 'Select a valid bank country.';
  if (!bank.accountNumber.trim() && !bank.iban.trim()) return 'Enter an account number or IBAN.';
  if (bank.accountNumber && !/^[A-Za-z0-9 -]{4,40}$/.test(bank.accountNumber))
    return 'Check the bank account number.';
  if (bank.iban && !validIban(bank.iban)) return 'Enter a valid IBAN.';
  if (!validBic(bank.swiftBic)) return 'Enter a valid 8- or 11-character SWIFT / BIC.';
  if (bank.intermediarySwiftBic && !validBic(bank.intermediarySwiftBic))
    return 'Check the intermediary bank SWIFT / BIC.';
  if (Boolean(bank.intermediaryBank) !== Boolean(bank.intermediarySwiftBic))
    return 'Provide both the intermediary bank name and SWIFT / BIC, or leave both blank.';
  if (Object.values(bank).some((value) => value.length > 500)) return 'A bank field is too long.';
  return '';
}

export function cashoutBindingError(snapshot: CashoutSnapshot, kyb: BuyerKybCase): string {
  return kyb.status !== 'Approved' ||
    snapshot.accountId !== kyb.accountId ||
    snapshot.kybId !== kyb.id ||
    snapshot.kybRevision !== kyb.revision ||
    !kyb.company.companyName.trim() ||
    !kyb.company.registrationNumber.trim() ||
    !validCountry(kyb.company.country)
    ? 'Your approved KYB or balance has changed. Refresh before submitting.'
    : '';
}

export function createCashoutSubmission(
  amount: string,
  bank: CashoutBankDetails,
  snapshot: CashoutSnapshot,
  kyb: BuyerKybCase,
): CashoutSubmission {
  const amountCents = amountInCents(amount);
  const error =
    cashoutBindingError(snapshot, kyb) || validateCashoutBank(bank, kyb.company.companyName);
  if (error) throw new Error(error);
  if (kyb.company.legalAddress && bank.beneficiaryAddress !== kyb.company.legalAddress)
    throw new Error('The beneficiary address must match your approved KYB.');
  if (amountCents === null || amountCents > snapshot.withdrawableCents)
    throw new Error('Enter an amount within your verified withdrawable Credit.');
  return {
    accountId: snapshot.accountId,
    amountCents,
    currency: 'USD',
    expectedBalanceRevision: snapshot.balanceRevision,
    kybId: kyb.id,
    expectedKybRevision: kyb.revision,
    companyName: kyb.company.companyName,
    registrationNumber: kyb.company.registrationNumber,
    companyCountry: kyb.company.country,
    bank,
    idempotencyKey: snapshot.submissionKey,
  };
}
