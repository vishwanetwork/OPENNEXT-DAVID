'use client';

import {
  ACTIVITY_SHOW_OPTIONS,
  bandLabel,
  formatTime,
  GROUPING_STEPS,
  integer,
  latestMatching,
  priceBands,
  stepLabel,
  usdCents,
  type Settlement,
} from '../settlements';
import { useSellerStore } from '../store';

export function AnalyticsPanel({ rows }: { rows: Settlement[] }) {
  const ui = useSellerStore();
  const stats = priceBands(rows, ui.groupingStepCents);
  return (
    <section className="onx-sa-panel onx-sa-analytics" aria-labelledby="onx-sa-analytics-title">
      <header className="onx-sa-panel-head">
        <div>
          <h2 id="onx-sa-analytics-title">Analytics</h2>
          <span className="onx-sa-panel-model">{ui.tradeModel || 'No model available'}</span>
        </div>
        <span className="onx-sa-price-unit">USD / GPU-hour</span>
      </header>
      <div className="onx-sa-metrics">
        <div>
          <small>COMPLETED TRADES</small>
          <strong>{integer(stats.trades)}</strong>
        </div>
        <div>
          <small>TRADED GPUs</small>
          <strong>{integer(stats.totalGpus)}</strong>
        </div>
        <div>
          <small>GPU-WEIGHTED AVG.</small>
          <strong>
            {stats.weightedAverageCents === null ? '—' : usdCents(stats.weightedAverageCents)}
          </strong>
        </div>
      </div>
      <div className="onx-sa-band-toolbar">
        <span>Band size</span>
        <div role="group" aria-label="Executed price band size">
          {GROUPING_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              data-sa-step={step}
              className={ui.groupingStepCents === step ? 'active' : ''}
              aria-pressed={ui.groupingStepCents === step}
              onClick={() => ui.setStep(step)}
            >
              {stepLabel(step)}
            </button>
          ))}
        </div>
        <span className="onx-sa-concentration">
          Largest band: {(stats.topShare * 100).toFixed(1)}% of GPUs
        </span>
      </div>
      <div className="onx-sa-band-head" aria-hidden="true">
        <span>Executed band</span>
        <span>GPU concentration</span>
        <span>Trades</span>
        <span>GPUs</span>
      </div>
      <div className="onx-sa-band-list">
        {stats.bands.length ? (
          stats.bands.map((band) => {
            const label = bandLabel(band.lowerCents, ui.groupingStepCents);
            return (
              <div key={band.lowerCents} className="onx-sa-band-row">
                <div className="onx-sa-band-price">
                  <strong>{label.short}</strong>
                  <small>{label.range === label.short ? 'Exact cent' : label.range}</small>
                </div>
                <div className="onx-sa-depth">
                  <span style={{ width: Math.max(2, band.relative * 100).toFixed(2) + '%' }} />
                  <b>{(band.share * 100).toFixed(1)}%</b>
                </div>
                <strong className="onx-sa-band-number">{integer(band.trades)}</strong>
                <strong className="onx-sa-band-number">{integer(band.gpus)}</strong>
              </div>
            );
          })
        ) : (
          <div className="onx-sa-empty">
            <strong>No completed trades in the selected range</strong>
            <span>Adjust the filters, range or market term.</span>
          </div>
        )}
      </div>
    </section>
  );
}

export function ActivitiesPanel({ rows }: { rows: Settlement[] }) {
  const ui = useSellerStore();
  const latest = latestMatching(rows, ui.activityShow);
  return (
    <section className="onx-sa-panel onx-sa-activities" aria-labelledby="onx-sa-activities-title">
      <header className="onx-sa-panel-head">
        <div>
          <h2 id="onx-sa-activities-title">Activities</h2>
          <span className="onx-sa-panel-model">{ui.tradeModel || 'No model available'}</span>
        </div>
        <label className="onx-sa-show-control">
          <span>Show</span>
          <select
            data-sa-show
            aria-label="Show activities"
            value={String(ui.activityShow)}
            onChange={(event) => ui.setActivityShow(event.target.value)}
          >
            {ACTIVITY_SHOW_OPTIONS.map((limit) => (
              <option key={limit} value={limit}>
                {limit}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="onx-sa-activity-head" aria-hidden="true">
        <span>Price</span>
        <span>Model / Country</span>
        <span>Capacity / Term</span>
        <span>Time / Order ID</span>
      </div>
      <div className="onx-sa-activity-list">
        {latest.length ? (
          latest.map((row) => (
            <article key={row._key} className="onx-sa-activity-row">
              <div className="onx-sa-activity-price">
                <strong>{usdCents(row.priceCents)}</strong>
                <small>USD/GPU-hour</small>
              </div>
              <div>
                <strong>{row.model}</strong>
                <small>{row.country}</small>
              </div>
              <div>
                <strong>
                  {integer(row.gpuCount)} GPU{row.gpuCount === 1 ? '' : 's'}
                </strong>
                <small>
                  {row.term}
                  {row.vcpu === null ? '' : ' ' + integer(row.vcpu) + ' vCPU'}
                  {row.memory === null ? '' : ' ' + row.memory + ' GB/GPU'}
                </small>
              </div>
              <div>
                <time dateTime={row.settledAt}>{formatTime(row.settledAtTime)}</time>
                <code>{row.id}</code>
              </div>
            </article>
          ))
        ) : (
          <div className="onx-sa-empty">
            <strong>No completed activities match</strong>
            <span>Adjust the filters or choose another market term.</span>
          </div>
        )}
      </div>
      <footer className="onx-sa-panel-foot">
        <span>
          Showing {latest.length} of {rows.length} in the selected range
        </span>
        <button type="button" className="text-link" data-sa-history onClick={ui.openHistory}>
          Request older activity
        </button>
      </footer>
    </section>
  );
}
