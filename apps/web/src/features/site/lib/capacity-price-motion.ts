// Presentation-only movement around the supplied example price, in integer cents.
// Each cycle is centered on zero; it cannot drift into a different price range.
const cycles = [
  [0, 1, 2, 3, 2, 1, 0, -1, -2, -3, -2, -1],
  [0, 2, 3, 1, 0, -2, -3, -1],
  [0, 1, 3, 2, 0, -1, -3, -2],
];

export function priceAtStep(baseCents: number, step: number, offerIndex: number) {
  const cycle = cycles[offerIndex % cycles.length] ?? [0];
  const direction = offerIndex % 2 === 0 ? 1 : -1;
  return baseCents + (cycle[step % cycle.length] ?? 0) * direction;
}

// Indexes address a 0–9 strip repeated three times. Starting in the middle
// leaves room for forward carries (9 → 0) and backward borrows (0 → 9).
export function digitRoll(previousDigit: number, nextDigit: number, direction: number) {
  const from = 10 + previousDigit;
  const distance =
    direction >= 0
      ? (nextDigit - previousDigit + 10) % 10
      : -((previousDigit - nextDigit + 10) % 10);
  return { from, to: from + distance };
}
