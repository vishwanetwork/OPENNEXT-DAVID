'use client';

import { CapacityIllustration } from './artwork';
import { WorkspaceCta } from './cta';
import { ListingsCarousel } from './listings-carousel';
import { COPY } from './landing-sections';

export function HeroSection() {
  return (
    <section className="public-hero public-container">
      <div className="public-hero-copy">
        <p className="on-eyebrow">{COPY.eyebrow}</p>
        <h1>
          The market behind
          <br />
          your next move.
        </h1>
        <p className="public-hero-description">{COPY.intro}</p>
        <div className="public-hero-actions">
          <WorkspaceCta target="gpus" style="primary" role="buyer">
            {COPY.explore}
          </WorkspaceCta>
          <WorkspaceCta target="supply" style="outline" role="seller">
            {COPY.post}
          </WorkspaceCta>
        </div>
      </div>
      <CapacityIllustration kind="network" />
    </section>
  );
}

export function SupplierBand() {
  return (
    <section
      className="public-supplier-band"
      id="suppliers"
      aria-labelledby="public-supplier-title"
    >
      <div className="public-container public-supplier-inner">
        <div className="public-supplier-heading">
          <h2 id="public-supplier-title">
            Built for buyers.
            <br />
            Open to suppliers.
          </h2>
          <p className="public-role-note">
            An enterprise can be both.
            <br />
            Source what you need. Offer what you can deliver.
          </p>
        </div>
        <div className="public-supplier-column">
          <h3>Buy capacity</h3>
          <p>{COPY.buyer}</p>
          <WorkspaceCta target="rfq" style="text" role="buyer">
            {COPY.buyerAction}
          </WorkspaceCta>
        </div>
        <div className="public-supplier-column">
          <h3>Offer capacity</h3>
          <p>{COPY.supplier}</p>
          <WorkspaceCta target="supply" style="text" role="seller">
            {COPY.supplierAction}
          </WorkspaceCta>
        </div>
      </div>
    </section>
  );
}

export function ListingsBand() {
  return (
    <section className="public-listings-band" aria-labelledby="public-listings-title">
      <div className="public-section public-listings-section public-container">
        <div className="public-section-heading public-heading-lines">
          <h2 id="public-listings-title">{COPY.listingsTitle}</h2>
          <p className="public-section-description public-description-lines">
            Two sides of the same market.
            <br />
            Explore supply to buy, or respond to buyers looking for capacity you can deliver.
          </p>
        </div>
        <ListingsCarousel
          copy={{ rental: COPY.rental, models: COPY.models, physical: COPY.physical }}
        />
      </div>
    </section>
  );
}

export function MarketSection() {
  return (
    <section
      className="public-section public-market-section public-container"
      id="market"
      aria-labelledby="public-market-title"
    >
      <div className="public-section-heading">
        <h2 id="public-market-title">{COPY.marketTitle}</h2>
      </div>
      <div className="public-market-row">
        <h3>{COPY.gpu}</h3>
        <p>
          Compare historical prices and current supply.
          <br /> Source GPU-hours, dedicated clusters or hardware, on your terms.
        </p>
        <WorkspaceCta target="gpus" style="text">
          {COPY.gpuPreview}
        </WorkspaceCta>
      </div>
      <div className="public-market-row">
        <h3>{COPY.models}</h3>
        <p>
          Compare model access and token pricing,
          <br /> with supplier provenance and authorization status in view.
          <br /> Match limits and delivery terms to your workload.
        </p>
        <button
          type="button"
          className="on-button on-button-text on-button-coming-soon"
          disabled
          aria-disabled="true"
        >
          {COPY.modelPreview}
        </button>
      </div>
    </section>
  );
}
