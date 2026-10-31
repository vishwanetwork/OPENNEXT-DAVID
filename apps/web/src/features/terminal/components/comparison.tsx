'use client';

import { money } from '@/lib/format';
import { regionText, useRegions, type Offer } from '@/features/market';

export interface ComparisonProps {
  offers: Offer[];
  model: string;
  full?: boolean;
  onSave: (offer: Offer) => void;
  onCart: (offer: Offer) => void;
  onDetail: (offer: Offer) => void;
}

const KEYS = ['price', 'delivery', 'available', 'rating', 'response'] as const;

/** Same-model supplier comparison table (legacy `comparison()`). */
export function Comparison({
  offers,
  model,
  full = false,
  onSave,
  onCart,
  onDetail,
}: ComparisonProps) {
  const regions = useRegions();
  const best: Partial<Record<(typeof KEYS)[number], number | null>> = {};
  for (const key of KEYS) {
    const values = offers
      .map((o) => o[key])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    best[key] = values.length
      ? key === 'price' || key === 'delivery' || key === 'response'
        ? Math.min(...values)
        : Math.max(...values)
      : null;
  }
  const value = (o: Offer, key: (typeof KEYS)[number]) =>
    o[key] === null || o[key] === undefined
      ? 'Not reported'
      : key === 'price'
        ? money(o.price)
        : key === 'delivery' || key === 'response'
          ? o[key] + ' min'
          : key === 'available'
            ? o[key] + ' GPU'
            : Number(o[key]).toFixed(2);
  return (
    <div className="compare">
      <div className="compare-title">
        <span>Same-model comparison {offers[0]?.model || model}</span>
        <small className="muted" style={{ fontSize: 9, fontWeight: 400 }}>
          {offers.some((o) => o.side === 'supply')
            ? 'Selected marketplace listings; confirm terms in quote'
            : 'Provider API observations; not firm quotes'}
        </small>
      </div>
      <table>
        <thead>
          <tr>
            <th>Provider / instance</th>
            <th>$/GPU-hr</th>
            <th>Delivery</th>
            <th>Availability</th>
            <th>Rating</th>
            {full ? <th>Response</th> : null}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {offers.length ? (
            offers.map((o) => (
              <tr key={o.id}>
                <td>
                  <span className="supplier-name">{o.provider}</span>
                  <span className="supplier-sub">
                    {regionText(regions, o.regionCode || o.region)}
                  </span>
                </td>
                {(['price', 'delivery', 'available', 'rating'] as const).map((k) => (
                  <td
                    key={k}
                    className={
                      best[k] !== null && best[k] !== undefined && o[k] === best[k] ? 'best' : ''
                    }
                  >
                    {value(o, k)}
                  </td>
                ))}
                {full ? <td>{value(o, 'response')}</td> : null}
                <td>
                  <div className="table-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      data-act="save"
                      data-id={o.id}
                      aria-label={`Save ${o.provider}`}
                      onClick={() => onSave(o)}
                    >
                      ☆
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      data-act="cart"
                      data-id={o.id}
                      aria-label={`Add ${o.provider} to quote cart`}
                      onClick={() => onCart(o)}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="detail-link"
                      data-act="detail"
                      data-id={o.id}
                      onClick={() => onDetail(o)}
                    >
                      Details
                    </button>
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={7} className="api-empty-row">
                No collected provider prices match this model, region, term and GPU count.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
