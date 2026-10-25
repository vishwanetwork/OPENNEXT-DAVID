'use client';

import { usd, type SpotRow } from '../inventory';
import { totalsView, type CheckoutDraft } from '../checkout';

function Totals({ row, hours }: { row: SpotRow; hours: unknown }) {
  const { total, hourly } = totalsView(row, hours);
  return (
    <>
      <p>
        <span>/ hour</span>
        <strong>{hourly}</strong>
      </p>
      <p>
        <span>
          Compute / hour
          {total ? (
            <small>
              {total.durationHours} {total.durationHours === 1 ? 'hour' : 'hours'} ×{' '}
              {usd(total.hourlyCents / 100)} / hour
            </small>
          ) : null}
        </span>
        <strong data-spot-compute>{total ? usd(total.baseCents / 100) : '—'}</strong>
      </p>
      <p>
        <span>OpenNEXT Fee 5%</span>
        <strong data-spot-fee>{total ? usd(total.feeCents / 100) : '—'}</strong>
      </p>
      <p className="onx-spot-checkout-total">
        <span>Total</span>
        <strong data-spot-total>{total ? usd(total.totalCents / 100) : '—'}</strong>
      </p>
    </>
  );
}

export function Summary({
  row,
  draft,
  editable = false,
  onHours,
}: {
  row: SpotRow;
  draft: CheckoutDraft;
  editable?: boolean;
  onHours?: (value: string) => void;
}) {
  return (
    <>
      <div className="onx-spot-purchase-resource">
        <h3>
          {row.model} · {row.country}
        </h3>
        <p>
          {row.gpuCount} GPUs ·{' '}
          {row.memory === null ? 'Memory to confirm' : row.memory + ' GB / GPU'} ·{' '}
          {row.vcpu === null ? 'vCPU to confirm' : row.vcpu + ' vCPU'}
        </p>
      </div>
      {editable ? (
        <label className="form-label onx-spot-duration">
          Usage duration <span className="muted">(hours)</span>
          <input
            className="field"
            type="number"
            name="durationHours"
            data-spot-hours
            min={0.01}
            step={0.01}
            inputMode="decimal"
            required
            value={draft.hoursRaw}
            placeholder="Enter hours"
            onChange={(event) => onHours?.(event.target.value)}
          />
        </label>
      ) : null}
      <div className="onx-spot-checkout-summary" data-spot-checkout-totals aria-live="polite">
        <Totals row={row} hours={draft.hoursRaw} />
      </div>
    </>
  );
}

export const Notice = ({ draft }: { draft: CheckoutDraft }) =>
  draft.message ? (
    <p className="onx-spot-purchase-note" role="status">
      {draft.message}
    </p>
  ) : null;

export const ErrorLine = ({ draft }: { draft: CheckoutDraft }) => (
  <p className="onx-spot-purchase-error" data-spot-checkout-error role="alert">
    {draft.error}
  </p>
);

export function Unavailable() {
  return <p className="form-note">Choose an available Spot offer to start a purchase.</p>;
}
