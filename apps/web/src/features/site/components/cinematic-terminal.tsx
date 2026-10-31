import Image from 'next/image';
import type { MouseEvent } from 'react';
import { ArrowRightIcon, ArrowUpRightIcon, ArrowsOutSimpleIcon } from './cinematic-icons';
import { WordReveal } from './cinematic-elements';
import { productSteps } from '../lib/cinematic-data';
export function CinematicTerminal({
  activeProduct,
  chooseStep,
  openPreview,
  buyerHref,
}: {
  activeProduct: number;
  chooseStep: (index: number) => void;
  openPreview: (event: MouseEvent<HTMLButtonElement>) => void;
  buyerHref: string;
}) {
  return (
    <section id="platform" className="platform-section section">
      <div className="container">
        <div className="platform-heading" data-reveal>
          <p className="eyebrow">The Capacity Terminal</p>
          <h2 id="platform-title">
            <WordReveal>From requirements</WordReveal>
            <br />
            <WordReveal>to a real conversation.</WordReveal>
          </h2>
          <p>RFQs, offers and quotes. One place to move things forward.</p>
        </div>
        <div className="product-story" aria-labelledby="platform-title">
          <div className="product-steps">
            {productSteps.map(([title, copy], index) => (
              <article
                id={`product-step-${index}`}
                data-product-step
                key={index}
                className={`product-step ${activeProduct === index ? 'step-active' : ''}`}
              >
                <button
                  type="button"
                  className="product-step-heading"
                  onClick={() => chooseStep(index)}
                  aria-current={activeProduct === index ? 'step' : undefined}
                >
                  <span className="step-number">0{index + 1}</span>
                  <h3>{title}</h3>
                  <ArrowRightIcon size={19} />
                </button>
                <p>{copy}</p>
                {index === 2 && (
                  <a className="text-link" href={buyerHref} target="_blank" rel="noreferrer">
                    Enter the Terminal
                    <ArrowUpRightIcon size={18} />
                  </a>
                )}
              </article>
            ))}
          </div>
          <div className="product-sticky">
            <div className="product-window">
              <button
                type="button"
                className="product-image-button"
                onClick={openPreview}
                aria-label="Expand GPU Market"
              >
                <Image
                  unoptimized
                  src={'/landing-design/terminal-market-v6.png'}
                  alt="OpenNEXT GPU Market with available GPU capacity, transparent hardware images, filters and pricing"
                  width="1280"
                  height="720"
                  loading="lazy"
                />
                <span className="expand-preview" aria-hidden="true">
                  <ArrowsOutSimpleIcon size={19} />
                </span>
              </button>
              <div className="product-caption">
                <span className="product-caption-index">0{activeProduct + 1}</span>
                <span key={activeProduct}>{productSteps[activeProduct]?.[0]}</span>
                <div className="product-dots" aria-label="Product walkthrough steps">
                  {productSteps.map((step, index) => (
                    <button
                      type="button"
                      key={index}
                      aria-label={`Show step ${index + 1}: ${step[0]}`}
                      aria-pressed={activeProduct === index}
                      onClick={() => chooseStep(index)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
