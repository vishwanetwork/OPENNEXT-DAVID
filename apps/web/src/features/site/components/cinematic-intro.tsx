import Image from 'next/image';
import { ArrowUpRightIcon } from './cinematic-icons';
import { LinkButton, WordReveal } from './cinematic-elements';
import { CapacityRail } from './capacity-rail';
export function CinematicIntro({
  heroCollapsed,
  buyerHref,
  supplierHref,
}: {
  heroCollapsed: boolean;
  buyerHref: string;
  supplierHref: string;
}) {
  return (
    <>
      <section id="top" className="hero-scroll" aria-labelledby="hero-title">
        <div className="hero-stage">
          <div className="hero-frame">
            <Image
              unoptimized
              className="hero-image"
              src="/landing-design/hero-data-center.webp"
              alt="A glass-fronted data center illuminated at blue hour"
              width="1672"
              height="941"
              fetchPriority="high"
            />
          </div>
          <div className="hero-inner-frame frame-one" aria-hidden="true">
            <Image
              unoptimized
              src="/landing-design/hero-data-center.webp"
              alt=""
              width={1672}
              height={941}
            />
          </div>
          <div className="hero-inner-frame frame-two" aria-hidden="true">
            <Image
              unoptimized
              src="/landing-design/hero-data-center.webp"
              alt=""
              width={1672}
              height={941}
            />
          </div>
          <div className="container hero-copy" inert={heroCollapsed}>
            <p className="eyebrow hero-enter">Agent-native GPU marketplace</p>
            <h1 id="hero-title">
              <span className="line-mask">
                <span>An always-on</span>
              </span>
              <span className="line-mask">
                <span>compute market.</span>
              </span>
            </h1>
            <p className="hero-description hero-enter">
              Find GPU capacity. Reach the right buyers.
              <br />
              Set the terms. Keep control.
            </p>
            <div className="hero-actions hero-enter">
              <LinkButton href={buyerHref} kind="white">
                Find capacity
              </LinkButton>
              <LinkButton href={supplierHref} kind="outline-light">
                Offer capacity
              </LinkButton>
            </div>
          </div>
          <div className="hero-morph-copy" aria-hidden="true">
            <span>
              Demand
              <br />
              meets
            </span>
            <span>
              the right
              <br />
              capacity.
            </span>
            <p>One market. Both sides connected.</p>
          </div>
        </div>
      </section>

      <section id="market" className="market-section section">
        <div className="container">
          <div className="section-heading" data-reveal>
            <div>
              <p className="eyebrow">For both sides of the market</p>
              <h2>
                <WordReveal>Find your fit.</WordReveal>
                <br />
                <WordReveal>Set your terms.</WordReveal>
              </h2>
            </div>
            <p>
              Less chasing quotes. More useful connections. <br />
              Bring your requirements or your available capacity into one shared market.
            </p>
          </div>
          <div className="audience-grid" data-reveal>
            <article className="audience-card buyer-card">
              <div className="audience-top">
                <h3>
                  Capacity for
                  <br />
                  your next move.
                </h3>
                <ArrowUpRightIcon size={27} aria-hidden="true" />
              </div>
              <p>
                Define what you need. Compare available offers and start a conversation around the
                right terms.
              </p>
              <div className="requirements">
                <span>GPU configuration</span>
                <span>Location</span>
                <span>Rental terms</span>
              </div>
              <a className="text-link" href={buyerHref} target="_blank" rel="noreferrer">
                Explore capacity
                <ArrowUpRightIcon size={19} />
              </a>
            </article>
            <article className="audience-card supplier-card">
              <div className="audience-top">
                <h3>
                  A market for
                  <br />
                  what you can deliver.
                </h3>
                <ArrowUpRightIcon size={27} aria-hidden="true" />
              </div>
              <p>
                Bring your capacity to the table. Set your availability and commercial terms, and
                connect with buyer demand.
              </p>
              <div className="requirements">
                <span>Available capacity</span>
                <span>Availability</span>
                <span>Commercial terms</span>
              </div>
              <a className="text-link" href={supplierHref} target="_blank" rel="noreferrer">
                Offer your capacity
                <ArrowUpRightIcon size={19} />
              </a>
            </article>
          </div>
        </div>
        <CapacityRail terminalUrl={buyerHref} />
      </section>
    </>
  );
}
