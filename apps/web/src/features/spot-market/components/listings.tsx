'use client';

import { LucideIcon } from '@/components/icons';
import { formatSpec, usd, type SpotRow } from '../inventory';

export interface RowActions {
  onBuy: (row: SpotRow) => void;
  onQuote: (row: SpotRow) => void;
}

export function PriceCell({ row }: { row: SpotRow }) {
  return (
    <div className="onx-spot-price">
      <strong>
        {usd(row.instanceHourly)} <span>/hour</span>
      </strong>
      <small>{usd(row.perGpuHourly)} USD/GPU-hour</small>
    </div>
  );
}

export function ActionButton({ row, actions }: { row: SpotRow; actions: RowActions }) {
  const buy = row.term === 'Spot';
  const label = buy ? 'Buy Now' : 'Ask for quote';
  const data = buy ? { 'data-spot-buy': row._key } : { 'data-spot-quote': row._key };
  return (
    <button
      type="button"
      className={`onx-spot-action ${buy ? 'is-buy' : 'is-quote'}`}
      {...data}
      aria-label={`${label}: ${row.model}, ${row.country}`}
      onClick={() => (buy ? actions.onBuy(row) : actions.onQuote(row))}
    >
      {label}
    </button>
  );
}

const Empty = () => (
  <div className="onx-spot-empty">
    <strong>No offers match these filters</strong>
    <span>Adjust the filters or choose another market term.</span>
  </div>
);

export function TableView({ rows, actions }: { rows: SpotRow[]; actions: RowActions }) {
  return (
    <div className="onx-spot-table-scroll">
      <table className="onx-spot-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Capacity</th>
            <th>Price</th>
            <th>Country</th>
            <th aria-label="vCPU per node">vCPU</th>
            <th>Memory</th>
            <th className="onx-spot-action-column">
              <span className="onx-spot-sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={row._key}>
                <td>
                  <strong className="onx-spot-model">{row.model}</strong>
                </td>
                <td className="onx-spot-number">{row.gpuCount} GPUs</td>
                <td>
                  <PriceCell row={row} />
                </td>
                <td>{row.country}</td>
                <td className="onx-spot-number">{formatSpec(row.vcpu)}</td>
                <td className="onx-spot-number" aria-label="Memory per GPU">
                  {row.memory === null ? 'To confirm' : row.memory + ' GB'}
                </td>
                <td>
                  <ActionButton row={row} actions={actions} />
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={7}>
                <Empty />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function CardView({ rows, actions }: { rows: SpotRow[]; actions: RowActions }) {
  return (
    <div className="onx-spot-cards">
      {rows.length ? (
        rows.map((row) => (
          <article key={row._key} className="onx-spot-card">
            <div className="onx-spot-card-main">
              <div className="onx-spot-card-identity">
                <div className="onx-spot-card-model">
                  <h2 title={row.model}>{row.model}</h2>
                  <span>{row.gpuCount} GPUs</span>
                </div>
                <p>
                  <LucideIcon name="map-pin" />
                  {row.country}
                </p>
              </div>
              <div className="onx-spot-card-specs">
                <span>
                  <small>vCPU</small>
                  <strong>{formatSpec(row.vcpu)}</strong>
                </span>
                <span>
                  <small>Memory</small>
                  <strong>{row.memory === null ? 'To confirm' : row.memory + ' GB'}</strong>
                </span>
              </div>
            </div>
            <div className="onx-spot-card-bottom">
              <PriceCell row={row} />
              <ActionButton row={row} actions={actions} />
            </div>
          </article>
        ))
      ) : (
        <Empty />
      )}
    </div>
  );
}
