import Image from 'next/image';
import { ArrowUpRightIcon } from './cinematic-icons';
import { Brand, LinkButton, WordReveal, RollingNumber } from './cinematic-elements';
export function CinematicClosing({
  reduced,
  buyerHref,
  supplierHref,
}: {
  reduced: boolean;
  buyerHref: string;
  supplierHref: string;
}) {
  return (
    <>
      <section id="experience" className="experience-section section">
        <div className="container">
          <div className="section-heading experience-heading" data-reveal>
            <div>
              <p className="eyebrow">The team behind OpenNEXT</p>
              <h2>
                <WordReveal>Experience that</WordReveal>
                <br />
                <WordReveal>moves things forward.</WordReveal>
              </h2>
            </div>
            <p>
              Built by people with experience across AI, infrastructure and commercial execution.
            </p>
          </div>
          <div className="metrics-grid">
            <article className="metric">
              <span className="metric-eyebrow">Perspective, built over time</span>
              <RollingNumber
                value={10}
                suffix="+"
                label="Over ten years of industry experience across our team"
                paused={reduced}
              />
              <h3>Years of industry experience</h3>
              <p>Across the team behind OpenNEXT.</p>
            </article>
            <article className="metric">
              <span className="metric-eyebrow">Transactions facilitated / US dollars</span>
              <RollingNumber
                value={500}
                prefix="$"
                suffix="M+"
                label="Over five hundred million US dollars in transactions facilitated by our team"
                paused={reduced}
              />
              <h3>In deals facilitated</h3>
              <p>Across our team members’ careers.</p>
            </article>
          </div>
        </div>
      </section>

      <section id="contact" className="closing">
        <div className="closing-picture" aria-hidden="true">
          <Image
            unoptimized
            src="/landing-design/hero-data-center.webp"
            alt=""
            width="1672"
            height="941"
            loading="lazy"
          />
        </div>
        <div className="closing-content container" data-reveal>
          <p className="eyebrow">Make your next connection</p>
          <h2>
            Bring your demand.
            <br />
            Bring your capacity.
          </h2>
          <div className="closing-actions">
            <LinkButton href={buyerHref} kind="white">
              Find capacity
            </LinkButton>
            <LinkButton href={supplierHref} kind="outline-light">
              Offer capacity
            </LinkButton>
          </div>
          <a className="closing-contact" href={'mailto:nova@vishwalab.com'}>
            Talk to the team
            <ArrowUpRightIcon size={16} />
          </a>
        </div>
      </section>
    </>
  );
}

export function CinematicFooter() {
  return (
    <footer className="footer">
      <div className="footer-top container">
        <Brand />
      </div>
      <div className="footer-wordmark" data-reveal aria-hidden="true">
        <Image
          unoptimized
          src="/landing-design/opennext-wordmark-muted.svg"
          width="295"
          height="63"
          alt=""
          loading="lazy"
        />
      </div>
      <div className="footer-bottom container">
        <span>© {new Date().getFullYear()} OpenNEXT</span>
      </div>
    </footer>
  );
}
