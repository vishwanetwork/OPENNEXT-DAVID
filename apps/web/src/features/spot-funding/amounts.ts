export function dollarCents(text: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw new Error('Enter a USD amount with up to two decimal places.');
  const cents = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 10_000_000)
    throw new Error('Enter an amount from $0.01 to $100,000.');
  return cents;
}
