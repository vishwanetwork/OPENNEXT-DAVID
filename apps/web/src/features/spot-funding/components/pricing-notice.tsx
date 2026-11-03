/** Enabled only when the backend has activated the floating-rate policy and consent flow. */
export function SpotPricingNotice({ available = false }: { available?: boolean }) {
  if (!available) return null;
  return (
    <p className="spot-funding-note">
      Your initial payment uses the price at purchase. Spot rates may change each hour; actual rates
      and charges are recorded in Instances and Billing. We warn you when order or account funding
      reaches 20% remaining. Running continues while the next hour is funded. If it cannot be
      funded, runtime and compute billing pause until funding and capacity are confirmed.
    </p>
  );
}
