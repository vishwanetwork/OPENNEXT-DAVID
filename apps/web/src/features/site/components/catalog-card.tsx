'use client';

import { money } from '@/lib/format';
import type { CatalogItem } from '@/data/catalog';
import { ListingIcon } from '@/components/icons';
import { ListingAction, Metric, UrgencyBadge, tokenMoney } from './listing-action';

export function CatalogCard({
  item,
  index,
  total,
}: {
  item: CatalogItem;
  index: number;
  total: number;
}) {
  const isModel = item.kind === 'model';
  const isRental = item.kind === 'rental';
  const tag = isModel
    ? item.sourceLabel
    : isRental
      ? 'Buyer demand'
      : item.unit === 'server'
        ? 'Complete system'
        : 'Physical GPU';
  const place = isModel ? item.brand : isRental ? item.region : 'NVIDIA';
  const tier = isModel
    ? item.priceKind === 'supplier_quote'
      ? item.context
          .replace('Not specified — confirm in quote', 'Confirm in quote')
          .replace('context — threshold requires quote confirmation', '· confirm threshold')
      : item.context
    : '';
  const cachedInput = isModel && 'cachedInput' in item ? item.cachedInput : undefined;
  return (
    <article
      className="on-listing-card"
      data-listing-id={item.id}
      data-listing-index={index}
      data-listing-side={isRental ? 'demand' : 'supply'}
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${total}: ${item.name}`}
    >
      <div className="on-listing-card-top">
        <span className="on-listing-kind">
          <i></i>
          {tag}
        </span>
        {isRental ? (
          <UrgencyBadge urgency={item.urgency} />
        ) : (
          <span className="on-listing-sample">Reference</span>
        )}
      </div>
      <h3>{item.name}</h3>
      <div className="on-listing-location">
        <ListingIcon name="globe" />
        <span>{place}</span>
      </div>
      <p className="on-listing-description">{item.note}</p>
      <dl className="on-listing-specs">
        {isModel ? (
          <>
            <Metric label="Context / tier" value={tier} />
            <Metric label="Billing" value="Per 1M tokens" />
          </>
        ) : isRental ? (
          <>
            <Metric label="Total GPUs" value={item.count} />
            <Metric label="GPUs / node" value={8} />
            <Metric label="Nodes" value={item.nodes} />
            <Metric label="Minimum term" value={item.months + ' months'} />
          </>
        ) : (
          <>
            <Metric label="Memory" value={item.memory} />
            <Metric label="Form factor" value={item.form} />
            <Metric label="Price unit" value={'Per ' + item.unit} />
            <Metric label="Min. order" value={item.minimum} />
          </>
        )}
      </dl>
      <div className="on-listing-pricing">
        {isModel ? (
          <>
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
            {Number.isFinite(cachedInput) ? (
              <div
                className="on-listing-cached-price"
                title="Cache billing semantics require quote confirmation"
              >
                <span>Cache / 1M tokens</span>
                <strong>{tokenMoney(cachedInput)}</strong>
              </div>
            ) : null}
          </>
        ) : (
          <div className="on-listing-single-price">
            <span>{isRental ? 'Buyer target price' : 'Reference purchase price'}</span>
            <div>
              <strong>{money(item.price)}</strong>
              <small>{isRental ? '/ GPU-hour' : '/ ' + item.unit}</small>
            </div>
          </div>
        )}
        <p>
          {isModel
            ? item.priceKind === 'supplier_quote'
              ? 'Supplier quote · final terms confirmed on inquiry'
              : 'Official reference · standard non-cached rate'
            : isRental
              ? 'Buyer budget · availability requires a separate quote'
              : item.status || 'Price and delivery subject to quote'}
        </p>
      </div>
      <ListingAction
        item={item}
        label={isRental ? 'Offer capacity' : 'Buy capacity'}
        target={isRental ? 'supply' : isModel ? 'models' : 'rfq'}
        intent={isRental ? 'offer' : 'buy'}
      />
    </article>
  );
}
