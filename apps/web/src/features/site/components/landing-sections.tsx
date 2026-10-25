'use client';

import { Ticker } from './ticker';
import { PublicFooter, PublicHeader } from './public-chrome';
import { HeroSection, ListingsBand, MarketSection, SupplierBand } from './landing-market-sections';
import { ClosingSection, GciBand, ProcessSection, VisionBand } from './landing-story-sections';

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
