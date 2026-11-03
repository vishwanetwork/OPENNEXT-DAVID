import { describe, expect, it, vi } from 'vitest';
import { cashoutApi } from './api';
import {
  amountInCents,
  cashoutBindingError,
  confirmedCashoutSnapshot,
  createCashoutSubmission,
  validIban,
  validateCashoutBank,
} from './validation';
import { bankFixture, kybFixture, receiptFixture, snapshotFixture } from './test-fixtures';

describe('Cashout validation', () => {
  it('accepts exact USD cents and rejects negative, scientific, fractional or unsafe values', () => {
    expect(amountInCents('105.25')).toBe(10525);
    expect(amountInCents('0.01')).toBe(1);
    for (const value of ['-1', '0', '1e2', '1.001', '9007199254740991'])
      expect(amountInCents(value)).toBeNull();
  });
  it('binds ownership and checks a distinct authoritative withdrawable balance', () => {
    expect(confirmedCashoutSnapshot(snapshotFixture, 'someone-else')).toBeNull();
    expect(confirmedCashoutSnapshot({ ...snapshotFixture, demo: true }, 'u1')).toBeNull();
    expect(
      confirmedCashoutSnapshot(
        { ...snapshotFixture, withdrawableCents: undefined, availableCredit: 500 },
        'u1',
      ),
    ).toBeNull();
    expect(() =>
      createCashoutSubmission('100.01', bankFixture, snapshotFixture, kybFixture),
    ).toThrow('withdrawable');
    expect(createCashoutSubmission('100', bankFixture, snapshotFixture, kybFixture)).toMatchObject({
      amountCents: 10000,
      idempotencyKey: 'server-issued-key',
      expectedBalanceRevision: 4,
      expectedKybRevision: 2,
    });
  });
  it('requires the same approved KYB subject and current revision', () => {
    expect(cashoutBindingError(snapshotFixture, { ...kybFixture, revision: 3 })).toBeTruthy();
    expect(
      cashoutBindingError(snapshotFixture, { ...kybFixture, status: 'Rejected' }),
    ).toBeTruthy();
    expect(
      cashoutBindingError(snapshotFixture, { ...kybFixture, accountId: 'other' }),
    ).toBeTruthy();
    expect(
      validateCashoutBank(
        { ...bankFixture, beneficiaryName: 'Another Person' },
        kybFixture.company.companyName,
      ),
    ).toContain('KYB');
    expect(() =>
      createCashoutSubmission(
        '100',
        { ...bankFixture, beneficiaryAddress: 'Other address' },
        snapshotFixture,
        kybFixture,
      ),
    ).toThrow('approved KYB');
  });
  it('validates SWIFT, account alternatives and IBAN checksum', () => {
    expect(validIban('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(validIban('GB81 WEST 1234 5698 7654 32')).toBe(false);
    expect(validateCashoutBank({ ...bankFixture, accountNumber: '' }, 'Example Limited')).toContain(
      'account number',
    );
    expect(validateCashoutBank({ ...bankFixture, swiftBic: 'NO' }, 'Example Limited')).toContain(
      'SWIFT',
    );
    expect(validateCashoutBank({ ...bankFixture, bankCountry: 'XX' }, 'Example Limited')).toContain(
      'country',
    );
    expect(validateCashoutBank(bankFixture, 'Example Limited')).toBe('');
  });
  it('requires an owner, amount, KYB, key and reservation-bound server receipt', async () => {
    const input = createCashoutSubmission('100', bankFixture, snapshotFixture, kybFixture);
    const service = {
      load: vi.fn().mockResolvedValue(snapshotFixture),
      submit: vi.fn().mockResolvedValue(receiptFixture),
    };
    await expect(cashoutApi.submit(service, input)).resolves.toEqual(receiptFixture);
    for (const receipt of [
      { ...receiptFixture, accountId: 'other' },
      { ...receiptFixture, reservedAmountCents: 9999 },
      { ...receiptFixture, balanceRevision: 4 },
      { ...receiptFixture, idempotencyKey: 'another' },
      { ...receiptFixture, request: { ...receiptFixture.request, kybRevision: 1 } },
    ]) {
      service.submit.mockResolvedValue(receipt);
      await expect(cashoutApi.submit(service, input)).rejects.toThrow('not confirmed');
    }
  });
});
