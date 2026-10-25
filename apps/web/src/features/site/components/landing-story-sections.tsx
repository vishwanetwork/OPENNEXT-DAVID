'use client';

import type { ReactNode } from 'react';
import { WorkspaceCta } from './cta';
import { COPY } from './landing-sections';

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
