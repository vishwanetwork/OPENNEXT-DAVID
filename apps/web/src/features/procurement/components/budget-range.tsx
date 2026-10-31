'use client';

import { useMemo } from 'react';
import { money } from '@/lib/format';
import { ALL_REGIONS, offersFor, usePrices, useRegions } from '@/features/market';
import { useWorkspaceStore } from '@/terminal-kit';
import { isHardware, isModel } from '../exchange';

/* ---------- RFQ form ---------- */
export function BudgetRange({
  r,
  model,
  onPick,
}: {
  r: Record<string, unknown>;
  model: string;
  onPick: (value: number) => void;
}) {
  const prices = usePrices();
  const regions = useRegions();
  const storedTerm = useWorkspaceStore((s) => s.term);
  const term = String(r.term || storedTerm);
  const rates = useMemo(
    () =>
      offersFor(prices.data?.records || [], { model, term, region: ALL_REGIONS }, regions)
        .filter((o) => !o.stale && Number(o.price) > 0)
        .map((o) => Number(o.price)),
    [prices.data, model, term, regions],
  );
  if (isModel(r) || isHardware(r)) return null;
  const min = rates.length ? Math.min(...rates) : null;
  const max = rates.length ? Math.max(...rates) : null;
  const average = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max) || min <= 0)
    return (
      <div className="proc-range full">
        <p className="form-note">
          No current reference range is available for this GPU. Enter your maximum price manually.
        </p>
      </div>
    );
  const selectedValue = Number(r.budget) || min;
  return (
    <div className="proc-range full">
      <label className="form-label" htmlFor="proc-budget-slider">
        {model} reference price range
      </label>
      <input
        id="proc-budget-slider"
        type="range"
        data-proc-budget-range
        min={min}
        max={max}
        step="0.000001"
        defaultValue={Math.min(max, Math.max(min, selectedValue))}
        disabled={min === max}
        onChange={(e) => onPick(Number(Number(e.target.value).toFixed(6)))}
      />
      <div className="row spread">
        <span>Low {money(min)}</span>
        {average !== null && Number.isFinite(average) ? (
          <span>Average {money(average)}</span>
        ) : null}
        <span>High {money(max)}</span>
      </div>
      <p className="form-note">
        USD / GPU-hour. Observed market prices, not a guaranteed quote. You may enter a higher
        maximum for urgent requirements.
      </p>
    </div>
  );
}
