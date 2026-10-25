'use client';

import type { ReactNode } from 'react';
import { CapacityIllustration } from './artwork';
import { BrandLink } from './brand';
import { WorkspaceCta } from './cta';
import { ListingsCarousel } from './listings-carousel';
import { useSiteActions } from './site-actions';
import { Ticker } from './ticker';

/** Landing copy (legacy `copy.en`). Kept verbatim. */
export const COPY = {
  signin: 'Open Terminal',
  eyebrow: 'THE AI CAPACITY MARKET - FROM SUPPLY TO WORKLOAD',
  intro:
    'Find the capacity to build. Find buyers for what you can deliver. Price intelligence, model access and GPU compute — connected in one market.',
  explore: 'Find capacity',
  post: 'List capacity',
  marketTitle: 'The resources. The context. The next move.',
  models: 'Model capacity',
  modelPreview: 'Coming Soon',
  gpu: 'GPU compute',
  gpuPreview: 'Explore GPUs',
  listingsTitle: 'Inside OpenNEXT',
  rental: 'GPU rental',
  physical: 'Physical GPUs',
  procurementTitle: 'From intent to agreement.',
  buyer:
    'Move from a resource need to a clear purchasing decision. Compare offers or invite suppliers to quote.',
  buyerAction: 'Post a requirement',
  supplier:
    'Put deliverable capacity in front of buyers. Publish your supply or compete for the right RFQs.',
  supplierAction: 'List your supply',
  closing: 'Your next move starts here.',
  closingDescription: 'Bring your workload, your capacity or your next big question.',
  closingAction: 'Open Terminal',
  privacy: 'Privacy',
  contact: 'Contact Us',
  footer: 'OpenNEXT · AI Capacity Market',
} as const;

export function PublicHeader() {
  const { openContact } = useSiteActions();
  return (
    <header className="public-header">
      <div className="public-header-inner">
        <BrandLink />
        <nav className="public-header-actions" aria-label="Main navigation">
          <button
            type="button"
            className="on-button on-button-outline on-button-small"
            data-act="contact-us"
            onClick={() => openContact()}
          >
            Contact Us
          </button>
          <WorkspaceCta target="gpus" style="primary" className="on-button-small">
            {COPY.signin}
          </WorkspaceCta>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter({ compact = false }: { compact?: boolean }) {
  const { openContact, openInfo } = useSiteActions();
  return (
    <footer className={`public-footer${compact ? ' public-footer-compact' : ''}`}>
      <BrandLink />
      <div className="public-footer-links">
        <button type="button" data-act="contact-us" onClick={() => openContact()}>
          {COPY.contact}
        </button>
        <button
          type="button"
          data-public-action="info"
          data-info="privacy"
          onClick={() => openInfo('privacy')}
        >
          {COPY.privacy}
        </button>
        {compact ? null : <span>{COPY.footer}</span>}
      </div>
    </footer>
  );
}

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

const PROCESS: [string, ReactNode][] = [
  [
    'Specify',
    <>
      Capture the workload, region,
      <br /> quantity, budget and delivery window.
    </>,
  ],
  ['Compare', 'Review competing quotes, supplier details and market context.'],
  [
    'Agree',
    <>
      Accept the right quote. Keep price,
      <br /> scope and delivery terms in one order.
    </>,
  ],
  ['Track', 'Track order milestones, delivery evidence and billing records.'],
];

export function ProcessSection() {
  return (
    <section
      className="public-section public-procurement-section public-container"
      id="how-it-works"
      aria-labelledby="public-process-title"
    >
      <div className="public-section-heading public-heading-lines">
        <h2 id="public-process-title">{COPY.procurementTitle}</h2>
        <p className="public-section-description public-description-lines">
          Market intelligence and procurement in the same workspace.
          <br />
          Keep every specification, quote and decision connected.
        </p>
      </div>
      <ol className="public-process">
        {PROCESS.map(([title, description]) => (
          <li key={title}>
            <h3>{title}</h3>
            <p>{description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function VisionBand() {
  return (
    <section className="public-vision-band" aria-labelledby="public-vision-title">
      <div className="public-container public-vision-inner">
        <div>
          <h2 id="public-vision-title">
            A clearer view.
            <br />A smarter next step.
          </h2>
          <p className="public-section-description">
            We are building a connected intelligence and transaction network for the compute
            economy.
          </p>
        </div>
        <div className="public-vision-rows">
          <article>
            <div>
              <h3>Market context, built into the decision</h3>
              <span className="public-capability-status">Live</span>
            </div>
            <p>
              Explore recorded price history, current reference prices and supplier quotes. Compare
              like-for-like resources before you commit.
            </p>
          </article>
          <article>
            <div>
              <h3>From your goal to the right resources</h3>
              <span className="public-capability-status upcoming">Coming next</span>
            </div>
            <p>
              Describe your goal to an Agent. Planned task decomposition and usage-aware
              recommendations will help match models and GPUs to your workload, then connect that
              plan to procurement.
            </p>
          </article>
          <article>
            <div>
              <h3>Intelligence beyond the next quote</h3>
              <span className="public-capability-status upcoming">On the roadmap</span>
            </div>
            <p>
              Price outlooks and an Agent Wallet are planned to support timing, budgets and more
              payment options. Compute-linked financial products remain a longer-term research
              direction, subject to regulatory requirements.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

/** The original continuous factory composition is isolated from the app stylesheet. */
export function GciBand() {
  return (
    <section className="public-gci-band" id="public-gci" aria-labelledby="public-gci-title">
      <div className="public-container public-gci-section">
        <div className="public-gci-heading">
          <div>
            <h2 id="public-gci-title">OpenNEXT GCI Index Factory</h2>
            <p className="public-section-description">
              Our framework for turning comparable observations and transaction evidence into
              dependable compute benchmarks. Index publication depends on data quality and coverage.
            </p>
          </div>
        </div>
        <div className="gci-factory">
          <iframe
            className="gci-original-frame"
            src="/gci-index-factory.html?v=opennext-20260915-original-1"
            title="OpenNEXT GCI Index Factory — System Architecture and End-to-End Workflow"
            loading="lazy"
            sandbox="allow-scripts"
            allow="fullscreen"
            allowFullScreen
          />
        </div>
      </div>
    </section>
  );
}

export function ClosingSection() {
  return (
    <section className="public-closing public-container" aria-labelledby="public-closing-title">
      <div>
        <h2 id="public-closing-title">{COPY.closing}</h2>
        <p>{COPY.closingDescription}</p>
      </div>
      <WorkspaceCta target="gpus">{COPY.closingAction}</WorkspaceCta>
    </section>
  );
}

export function LandingBody() {
  return (
    <div className="public-page" lang="en">
      <PublicHeader />
      <Ticker />
      <main>
        <HeroSection />
        <SupplierBand />
        <ListingsBand />
        <MarketSection />
        <ProcessSection />
        <VisionBand />
        <GciBand />
        <ClosingSection />
      </main>
      <div className="public-container">
        <PublicFooter />
      </div>
    </div>
  );
}
