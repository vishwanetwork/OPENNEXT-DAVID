'use client';

import type { ReactNode } from 'react';
import { useApp } from '@/components/providers/app-context';
import { money } from '@/lib/format';
import type { CatalogItem } from '../data/catalog';
import {
  isCurated,
  isExchange,
  isHighUrgency,
  type CuratedListing,
  type ExchangeListing,
  type Listing,
} from '../lib/listings';
import { demoOpportunityPath, type ListingIntent, type PublicTarget } from '../lib/workspace-links';
import { ListingIcon } from './icons';
import { useSiteActions } from './site-actions';

const tokenMoney = (value: unknown) =>
  Number(value).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });

const Metric = ({ label, value }: { label: ReactNode; value: ReactNode }) => (
  <div>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

const UrgencyBadge = ({ urgency }: { urgency: unknown }) =>
  isHighUrgency(urgency) ? <span className="on-listing-urgency">High Urgency</span> : null;

/** Card call-to-action (legacy `action()`): demo rows deep-link into the demo workspace. */
function ListingAction({
  item,
  label,
  target,
  intent,
}: {
  item: Listing;
  label: string;
  target: PublicTarget;
  intent: ListingIntent;
}) {
  const { crossHref } = useApp();
  const { openWorkspace } = useSiteActions();
  const className = `on-listing-cta${intent === 'buy' ? ' on-listing-cta-buy' : ''}`;
  const name = item.name;
  if (isExchange(item) && item.demo) {
    return (
      <a
        className={className}
        href={crossHref('terminal', demoOpportunityPath(item.id, intent))}
        data-showcase-opportunity={item.id}
        aria-label={`${label}: ${name}`}
      >
        <span>{label}</span>
        <ListingIcon name="right" />
      </a>
    );
  }
  const exchange = isExchange(item);
  const kind = item.kind;
  const onClick = () => {
    if (exchange) {
      // Legacy `OpenNEXTProcurement.opportunity`: unauthenticated visitors carry the opportunity into the terminal.
      openWorkspace({
        route: intent === 'offer' ? 'supply' : 'rfqs',
        opportunity: { id: item.id, intent },
      });
      return;
    }
    // Legacy `queueListingIntent`: catalog references are only purchasable; rentals can be offered.
    const valid =
      ['rental', 'model', 'hardware'].includes(kind) && (kind === 'rental' || intent === 'buy');
    if (valid) {
      openWorkspace({
        route: intent === 'offer' ? 'supply' : kind === 'model' ? 'models' : 'rfqs',
        preferredRole: intent === 'offer' ? 'seller' : 'buyer',
        listing: { id: item.id, intent },
      });
      return;
    }
    openWorkspace({ target });
  };
  return (
    <button
      type="button"
      className={className}
      data-public-action="open-workspace"
      data-target={target}
      data-listing-selection={item.id}
      data-listing-intent={intent}
      data-exchange-id={exchange ? item.id : undefined}
      data-exchange-intent={exchange ? intent : undefined}
      data-mode={kind === 'rental' ? 'rental' : kind === 'hardware' ? 'hardware' : undefined}
      aria-label={`${label}: ${name}`}
      onClick={onClick}
    >
      <span>{label}</span>
      <ListingIcon name="right" />
    </button>
  );
}

function CuratedCard({
  item,
  index,
  total,
}: {
  item: CuratedListing;
  index: number;
  total: number;
}) {
  const { showCuratedDetails, offerCurated } = useSiteActions();
  return (
    <article
      className="on-listing-card on-listing-curated"
      data-listing-id={item.id}
      data-listing-index={index}
      data-listing-side="demand"
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${total}: ${item.title}`}
    >
      <div className="on-listing-card-top">
        <span className="on-listing-kind">
          <i></i>Buyer RFQ
        </span>
      </div>
      <h3>{item.title}</h3>
      <div className="on-listing-location">
        <ListingIcon name="globe" />
        <span>{item.region}</span>
      </div>
      <p className="on-listing-description">{item.description}</p>
      <dl className="on-listing-specs">
        <Metric label="Quantity" value={item.quantityLabel} />
        <Metric label="Rental term" value={item.termLabel} />
        <Metric label="Deployment" value={item.deliveryLabel} />
        <Metric label="Payment" value="Flexible with supplier" />
      </dl>
      <div className="on-listing-pricing">
        <div className="on-listing-single-price">
          <span>Supplier quotes invited</span>
          <strong>Price on request</strong>
        </div>
        <p>Submit a proposal against the complete requirements.</p>
      </div>
      <div className="on-listing-actions">
        <button
          type="button"
          className="on-listing-details"
          data-curated-rfq-details={item.id}
          aria-label={`View requirements: ${item.title}`}
          onClick={() => showCuratedDetails(item)}
        >
          View requirements
        </button>
        <button
          type="button"
          className="on-listing-cta"
          data-curated-rfq-offer={item.id}
          aria-label={`Offer capacity: ${item.title}`}
          onClick={() => offerCurated(item)}
        >
          <span>Offer capacity</span>
          <ListingIcon name="right" />
        </button>
      </div>
    </article>
  );
}

function ExchangeCard({
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

function CatalogCard({ item, index, total }: { item: CatalogItem; index: number; total: number }) {
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

export function ListingCard({
  item,
  index,
  total,
}: {
  item: Listing;
  index: number;
  total: number;
}) {
  if (isCurated(item)) return <CuratedCard item={item} index={index} total={total} />;
  if (isExchange(item)) return <ExchangeCard item={item} index={index} total={total} />;
  return <CatalogCard item={item} index={index} total={total} />;
}
