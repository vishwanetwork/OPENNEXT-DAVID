import { describe, expect, it } from 'vitest';
import { cashoutRecordSchema } from '@/features/cashout/validation';
import { bank, completion, record } from './fixtures.test-data';
import {
  cashoutCompletionKey,
  verifiedCashoutCompletion,
  verifiedCashoutDetails,
  verifiedCashouts,
} from './validation';

describe('cashout operations validation', () => {
  it('requires confirmed operator scope, valid cents, masked bank data and unique requests', () => {
    const response = { confirmed: true, sessionScope: 'operator-a', requests: [record] };
    expect(verifiedCashouts(response, 'operator-a')).toHaveLength(1);
    expect(() => verifiedCashouts(response, 'operator-b')).toThrow();
    expect(() => verifiedCashouts(response, '')).toThrow();
    for (const change of [
      { amountCents: 0 },
      { amountCents: 1.5 },
      { revision: -1 },
      { revision: 0.5 },
      { revision: Number.MAX_SAFE_INTEGER + 1 },
      { kybRevision: -1 },
      { kybRevision: Number.MAX_SAFE_INTEGER + 1 },
      { maskedAccount: '123456789' },
      { currency: 'EUR' },
    ])
      expect(() =>
        verifiedCashouts({ ...response, requests: [{ ...record, ...change }] }, 'operator-a'),
      ).toThrow();
    expect(() =>
      verifiedCashouts({ ...response, requests: [record, record] }, 'operator-a'),
    ).toThrow();
  });
  it.each(['****1234', '••••1234', 'xxx1234', 'XXX1234'])(
    'accepts Buyer-validated zero revisions and mask %s through Console review and completion',
    (maskedAccount) => {
      const buyerRecord = cashoutRecordSchema.parse({
        ...record,
        revision: 0,
        kybRevision: 0,
        maskedAccount,
      });
      expect(
        verifiedCashouts(
          { confirmed: true, sessionScope: 'operator-a', requests: [buyerRecord] },
          'operator-a',
        ),
      ).toEqual([buyerRecord]);
      expect(
        verifiedCashoutDetails(
          {
            confirmed: true,
            sessionScope: 'operator-a',
            requestId: buyerRecord.id,
            accountId: buyerRecord.accountId,
            revision: 0,
            bank,
          },
          buyerRecord,
          'operator-a',
        ),
      ).toEqual(bank);
      const input = {
        requestId: buyerRecord.id,
        accountId: buyerRecord.accountId,
        expectedRevision: 0,
        transferReference: 'WIRE-INITIAL',
        idempotencyKey: cashoutCompletionKey(buyerRecord),
      };
      expect(
        verifiedCashoutCompletion({ ...completion(input), revision: 1 }, buyerRecord, input),
      ).toBe(true);
      expect(
        verifiedCashoutCompletion({ ...completion(input), revision: 0 }, buyerRecord, input),
      ).toBe(false);
    },
  );
  it('binds full banking details to the authorized operator, request revision and KYB company', () => {
    const response = {
      confirmed: true,
      sessionScope: 'operator-a',
      requestId: record.id,
      accountId: record.accountId,
      revision: record.revision,
      bank,
    };
    expect(verifiedCashoutDetails(response, record, 'operator-a')).toEqual(bank);
    for (const change of [
      { accountId: 'other' },
      { requestId: 'other' },
      { revision: 3 },
      { sessionScope: 'operator-b' },
      { bank: { ...bank, beneficiaryName: 'Other Company' } },
    ])
      expect(() =>
        verifiedCashoutDetails({ ...response, ...change }, record, 'operator-a'),
      ).toThrow();
  });
  it('requires matching payout, settled reservation, next revision and both communication outboxes', () => {
    const input = {
      requestId: record.id,
      accountId: record.accountId,
      expectedRevision: record.revision,
      transferReference: 'WIRE-1',
      idempotencyKey: cashoutCompletionKey(record),
    };
    const receipt = completion(input);
    expect(verifiedCashoutCompletion(receipt, record, input)).toBe(true);
    for (const change of [
      { accountId: 'other' },
      { requestId: 'other' },
      { revision: 1 },
      { amountCents: 9999 },
      { idempotencyKey: 'other' },
      { transferReference: 'other' },
      { reservationSettled: false },
      { notificationQueued: false },
      { emailQueued: false },
    ])
      expect(verifiedCashoutCompletion({ ...receipt, ...change }, record, input)).toBe(false);
    expect(verifiedCashoutCompletion(receipt, { ...record, status: 'completed' }, input)).toBe(
      false,
    );
    expect(cashoutCompletionKey(record)).toBe(cashoutCompletionKey({ ...record }));
  });
});
