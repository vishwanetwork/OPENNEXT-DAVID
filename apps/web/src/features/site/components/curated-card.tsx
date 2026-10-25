'use client';

import { type CuratedListing } from '../lib/listings';
import { ListingIcon } from '@/components/icons';
import { useSiteActions } from './site-actions';
import { Metric } from './listing-action';

export function CuratedCard({
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
