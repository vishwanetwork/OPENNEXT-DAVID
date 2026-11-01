import Image from 'next/image';
import type { CSSProperties } from 'react';

const partners = [
  { name: 'Pharos', asset: 'pharos.png', width: 190, height: 48, className: 'pharos' },
  {
    name: 'Fidelity Labs',
    asset: 'fidelity-labs.png',
    width: 300,
    height: 200,
    className: 'fidelity',
  },
  { name: 'Ondo', asset: 'ondo.svg', width: 96, height: 28, className: 'ondo' },
  { name: 'Solana', asset: 'solana.svg', width: 196, height: 48, className: 'solana' },
];

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
    <div id="partners" className="partner-network">
      <section aria-labelledby="partners-title" className="partner-group" data-reveal>
        <h3 id="partners-title">Our partners</h3>
        <ul className="partner-logos" aria-label="OpenNEXT partners">
          {partners.map((partner, index) => (
            <li
              key={partner.name}
              style={{ '--partner-delay': `${index * 80}ms` } as CSSProperties}
            >
              <div className={`partner-logo partner-logo-${partner.className}`}>
                <Image
                  unoptimized
                  src={`/landing-design/partners/${partner.asset}`}
                  alt={partner.name}
                  width={partner.width}
                  height={partner.height}
                  loading="lazy"
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="programs-title" className="partner-group program-group" data-reveal>
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
                  loading="lazy"
                />
              </div>
              <p>{program.detail}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
