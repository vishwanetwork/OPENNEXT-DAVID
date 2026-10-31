import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import { ArrowUpRightIcon, MapPinIcon } from './cinematic-icons';
import { capacityOffers } from '../lib/capacity-offers';
import { CapacityPrice } from './capacity-price';
import { priceAtStep } from '../lib/capacity-price-motion';
import type { CapacityOffer } from '../lib/capacity-offers';
import { useReducedMotion, usePageActive } from './use-cinematic-motion';

type Price = { base: number; previous: number; current: number; step: number };
function CapacityCard({
  offer,
  price,
  terminalUrl,
  copy,
}: {
  offer: CapacityOffer;
  price: Price;
  terminalUrl: string;
  copy: boolean;
}) {
  const highlight = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse') return;
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--shine-x', `${event.clientX - rect.left}px`);
    card.style.setProperty('--shine-y', `${event.clientY - rect.top}px`);
  };

  return (
    <div className="capacity-item" role="listitem">
      <article className="capacity-card" onPointerMove={highlight}>
        <h3 className="capacity-card-title">{offer.title}</h3>
        <dl className="capacity-card-specs">
          <div>
            <dt className="capacity-sr-only">Quantity</dt>
            <dd>{offer.gpus} GPUs</dd>
          </div>
          <div>
            <dt className="capacity-sr-only">Rental duration</dt>
            <dd>{offer.hours.toLocaleString('en-US')} hours</dd>
          </div>
        </dl>
        <p className="capacity-card-region">
          <MapPinIcon size={18} aria-hidden="true" />
          {offer.region}
        </p>
        <p className="capacity-card-price">
          <CapacityPrice {...price} />
          <span>/ GPU-hour</span>
        </p>
        <a
          className="capacity-card-cta"
          href={terminalUrl}
          tabIndex={copy ? -1 : undefined}
          aria-label={`Buy capacity: ${offer.title} in ${offer.region}`}
        >
          <span>Buy capacity</span>
          <ArrowUpRightIcon size={20} aria-hidden="true" />
        </a>
      </article>
    </div>
  );
}

export function CapacityRail({ terminalUrl }: { terminalUrl: string }) {
  const root = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const focusFrame = useRef(0);
  const nextPrice = useRef(0);
  const [prices, setPrices] = useState(() =>
    capacityOffers.map((offer) => {
      const base = Math.round(Number(offer.price) * 100);
      return { base, previous: base, current: base, step: 0 };
    }),
  );
  const [copies, setCopies] = useState(2);
  const [visible, setVisible] = useState(false);
  const pageVisible = usePageActive();
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [keyboard, setKeyboard] = useState(false);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const intersection = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting)),
      { threshold: 0.05 },
    );
    intersection.observe(element);
    const measure = () => {
      const width = group.current?.getBoundingClientRect().width;
      if (!width) return;
      element.style.setProperty('--capacity-cycle', `${width}px`);
      element.style.setProperty('--capacity-duration', `${width / 26}s`);
      setCopies(Math.max(2, Math.ceil((viewport.current?.clientWidth ?? 0) / width) + 1));
    };
    const resize = new ResizeObserver(measure);
    if (viewport.current) resize.observe(viewport.current);
    if (group.current) resize.observe(group.current);
    measure();
    return () => {
      intersection.disconnect();
      resize.disconnect();
      cancelAnimationFrame(focusFrame.current);
    };
  }, []);

  const focus = (event: FocusEvent<HTMLElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches(':focus-visible')) return;
    setKeyboard(true);
    const target = event.target;
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() =>
      target
        .closest('.capacity-card')
        ?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }),
    );
  };
  const blur = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setKeyboard(false);
    if (viewport.current) viewport.current.scrollLeft = 0;
  };
  const running = visible && pageVisible && !reduced && !hovered && !pressed && !keyboard;

  useEffect(() => {
    if (!running) return;
    // Decorative display-price motion only; all repeated groups share one value.
    const timer = setInterval(() => {
      const index = nextPrice.current++ % capacityOffers.length;
      setPrices((values) =>
        values.map((price, offerIndex) =>
          offerIndex !== index
            ? price
            : {
                ...price,
                previous: price.current,
                current: priceAtStep(price.base, price.step + 1, offerIndex),
                step: price.step + 1,
              },
        ),
      );
    }, 1200);
    return () => clearInterval(timer);
  }, [running]);

  return (
    <section
      id="capacity"
      ref={root}
      className="capacity-rail"
      data-reveal
      aria-label="Explore GPU capacity"
      data-running={running}
      data-keyboard={keyboard}
      data-reduced={reduced}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setHovered(true);
      }}
      onPointerLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onFocusCapture={focus}
      onBlurCapture={blur}
    >
      <div ref={viewport} className="capacity-viewport">
        <div className="capacity-track">
          {Array.from({ length: copies }, (_, index) => (
            <div
              key={index}
              ref={index === 0 ? group : undefined}
              className="capacity-group"
              role="list"
              data-copy={index !== 0}
              aria-hidden={index === 0 ? undefined : true}
            >
              {capacityOffers.map((offer, offerIndex) => (
                <CapacityCard
                  key={offer.title}
                  offer={offer}
                  price={
                    prices[offerIndex] ?? {
                      base: Math.round(Number(offer.price) * 100),
                      current: Math.round(Number(offer.price) * 100),
                      previous: Math.round(Number(offer.price) * 100),
                      step: 0,
                    }
                  }
                  terminalUrl={terminalUrl}
                  copy={index !== 0}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
