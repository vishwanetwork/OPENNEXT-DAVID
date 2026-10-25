'use client';

import { money } from '@/lib/format';
import { type ExchangeListing } from '../lib/listings';
import { ListingIcon } from '@/components/icons';
import { ListingAction, Metric, UrgencyBadge, tokenMoney } from './listing-action';

export function ExchangeCard({
  item,
  index,
  total,
}: {
  item: ExchangeListing;
  index: number;
  total: number;
}) {
  const demand = item.side === 'demand';
  const isModel = item.kind === 'model';
  const isHardware = item.kind === 'hardware';
  const unit = isModel ? '1M tokens' : isHardware ? 'GPU' : 'GPU-hour';
  const label = demand ? 'Offer capacity' : 'Buy capacity';
  const priceLabel = item.priceLabel || (demand ? 'Buyer target price' : 'Supplier asking price');
  return (
    <article
      className="on-listing-card"
      data-listing-id={item.id}
      data-listing-index={index}
      data-listing-side={item.side}
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${total}: ${item.name}`}
    >
      <div className="on-listing-card-top">
        <span className="on-listing-kind">
          <i></i>
          {demand ? 'Buyer RFQ' : 'Supplier offer'}
        </span>
        {demand ? <UrgencyBadge urgency={item.urgency} /> : null}
      </div>
      <h3>{item.name}</h3>
      <div className="on-listing-location">
        <ListingIcon name="globe" />
        <span>{item.region}</span>
      </div>
      <p className="on-listing-description">{item.note}</p>
      <dl className="on-listing-specs">
        {isModel ? (
          <>
            <Metric label="Model" value={item.model} />
            <Metric label="Region" value={item.region} />
            <Metric label="Allocation" value={item.count || 'On inquiry'} />
            <Metric
              label="Term"
              value={item.term || (item.hours ? `${item.hours} hours` : 'Confirm in quote')}
            />
          </>
        ) : (
          <>
            <Metric label="GPU model" value={item.model} />
            <Metric
              label="Quantity"
              value={`${item.count || 'On inquiry'}${item.count ? ' GPUs' : ''}`}
            />
            <Metric
              label={isHardware ? 'Delivery' : 'Usage window'}
              value={item.hours ? `${item.hours} hours` : item.term || 'Confirm in quote'}
            />
            <Metric label="Region" value={item.region} />
          </>
        )}
      </dl>
      <div className="on-listing-pricing">
        {isModel && !demand && Number.isFinite(Number(item.output)) ? (
          <div className="on-listing-token-prices">
            <div>
              <span>Input / 1M tokens</span>
              <strong>{tokenMoney(item.input)}</strong>
            </div>
            <div>
              <span>Output / 1M tokens</span>
              <strong>{tokenMoney(item.output)}</strong>
            </div>
          </div>
        ) : (
          <div className="on-listing-single-price">
            <span>{priceLabel}</span>
            <div>
              <strong>
                {Number.isFinite(Number(item.price)) ? money(item.price) : 'On inquiry'}
              </strong>
              <small>{/total|budget/i.test(item.priceLabel || '') ? 'total' : '/ ' + unit}</small>
            </div>
          </div>
        )}
        <p>
          {demand
            ? 'Respond to this requirement with your offer.'
            : 'Confirm availability and delivery before purchase.'}
        </p>
      </div>
      <ListingAction
        item={item}
        label={label}
        target={demand ? 'supply' : isModel ? 'models' : 'rfq'}
        intent={demand ? 'offer' : 'buy'}
      />
    </article>
  );
}
