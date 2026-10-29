export interface TopupPricing {
  pricingVersion: 'credit-face-value-v1';
  creditAmountCents: number;
  feeAmountCents: number;
  amountCents: number;
}

/** Display estimate only. The payment service must independently price and verify receipts. */
export function topupPricing(creditAmountCents: number): TopupPricing | null {
  if (
    !Number.isSafeInteger(creditAmountCents) ||
    creditAmountCents < 100 ||
    creditAmountCents > 10_000_000
  )
    return null;
  const feeAmountCents = 0;
  return {
    pricingVersion: 'credit-face-value-v1',
    creditAmountCents,
    feeAmountCents,
    amountCents: creditAmountCents + feeAmountCents,
  };
}

export function validTopupPricing(value: {
  pricingVersion?: string;
  creditAmountCents?: number;
  feeAmountCents?: number;
  amountCents: number;
}): boolean {
  const expected = topupPricing(value.creditAmountCents ?? 0);
  return Boolean(
    expected &&
      value.pricingVersion === expected.pricingVersion &&
      value.amountCents === expected.amountCents &&
      value.feeAmountCents === expected.feeAmountCents,
  );
}
