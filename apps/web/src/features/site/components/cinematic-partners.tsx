import Image from 'next/image';
import type { CSSProperties } from 'react';

const programs = [
  {
    name: 'Anthropic',
    asset: 'anthropic.svg',
    width: 570,
    height: 64,
    detail: 'Cyber Verification Program',
    className: 'anthropic',
  },
  {
    name: 'Plug and Play',
    asset: 'plug-and-play.svg',
    width: 144,
    height: 40,
    detail: 'Fall 2026 Cohort',
    className: 'plug-and-play',
  },
  {
    name: 'Circle',
    asset: 'circle.svg',
    width: 196,
    height: 50,
    detail: 'Alliance Program',
    className: 'circle',
  },
];

export function CinematicPartners() {
  return (
    <div id="partners" className="hero-partners">
      <div className="container partner-network">
        <section
          aria-labelledby="partners-title"
          className="partner-group primary-partner"
          data-reveal
        >
          <h3 id="partners-title">Our partner</h3>
          <div className="partner-identity">
            <Image
              unoptimized
              src="/landing-design/partners/fidelity-labs.jpeg"
              alt="Fidelity Labs"
              width={200}
              height={200}
              loading="eager"
            />
            <span>Fidelity Labs</span>
          </div>
        </section>

        <section
          aria-labelledby="programs-title"
          className="partner-group program-group"
          data-reveal
        >
          <h3 id="programs-title">Programs &amp; alliances</h3>
          <ul className="program-logos" aria-label="Programs and alliances">
            {programs.map((program, index) => (
              <li
                key={program.name}
                style={{ '--partner-delay': `${index * 80}ms` } as CSSProperties}
              >
                <div className={`program-logo program-logo-${program.className}`}>
                  <Image
                    unoptimized
                    src={`/landing-design/partners/${program.asset}`}
                    alt={program.name}
                    width={program.width}
                    height={program.height}
                    loading="eager"
                  />
                </div>
                <p>{program.detail}</p>
              </li>
            ))}
          </ul>
        </section>
        <section
          className="partner-group powered-by"
          aria-labelledby="powered-by-title"
          data-reveal
        >
          <h3 id="powered-by-title">Powered by Vishwa Lab</h3>
          <a
            className="powered-by-link"
            href="https://vishwalab.com/"
            target="_blank"
            rel="noreferrer"
            aria-label="Vishwa Lab (opens in a new tab)"
          >
            <Image
              unoptimized
              src="/landing-design/partners/vishwa.png"
              alt="Vishwa"
              width={240}
              height={68}
              loading="eager"
            />
          </a>
        </section>
      </div>
    </div>
  );
}
