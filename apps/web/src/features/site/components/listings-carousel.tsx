'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useCuratedRfqs, usePublicMarket, useShowcase } from '../hooks';
import { allGroups, disclosureFor, hasApprovedRentalLanes, positionLabel, type Listing, type MarketSide } from '../lib/listings';
import { ListingIcon } from './icons';
import { ListingCard } from './listing-card';
import { useSiteActions } from './site-actions';

export interface ListingsCopy {
  rental: string;
  models: string;
  physical: string;
}

const STEP_MS = 580;
const AUTO_MS = 4600;

const REDUCED = '(prefers-reduced-motion: reduce)';
const subscribeReducedMotion = (callback: () => void) => {
  const query = matchMedia(REDUCED);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
};
const useReducedMotion = () =>
  useSyncExternalStore(subscribeReducedMotion, () => matchMedia(REDUCED).matches, () => false);

const rotate = <T,>(items: T[], offset: number): T[] => {
  if (!items.length) return items;
  const start = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
};

function EmptyCards({ side }: { side: MarketSide }) {
  const { openWorkspace } = useSiteActions();
  const supply = side === 'supply';
  return (
    <div className="on-listing-empty">
      <h3>{supply ? 'No published offers in this market yet.' : 'No open requirements in this market yet.'}</h3>
      <p>{supply ? 'Tell suppliers what you need and invite a quote.' : 'Publish your capacity so buyers can find you.'}</p>
      <button type="button" className="on-button on-button-outline" data-public-action="open-workspace" data-target={supply ? 'rfq' : 'supply'} onClick={() => openWorkspace({ target: supply ? 'rfq' : 'supply' })}>
        {supply ? 'Post an RFQ' : 'List capacity'}
      </button>
    </div>
  );
}

/**
 * Three market tabs (GPU rental, Model capacity, Physical GPUs), one card at a time, five
 * visible on desktop. Auto-advances every 4.6 s while in view, pauses on hover/focus, honours
 * reduced motion, supports keyboard arrows and touch swipes (legacy OpenNEXT-home-listings.js).
 */
export function ListingsCarousel({ copy }: { copy: ListingsCopy }) {
  const curated = useCuratedRfqs();
  const market = usePublicMarket();
  const showcase = useShowcase(!hasApprovedRentalLanes(market.data));
  const groups = useMemo(
    () => (side: MarketSide) => allGroups(side, { market: market.data, showcase: showcase.data, curated: curated.data || [] }),
    [market.data, showcase.data, curated.data],
  );

  const [side, setSide] = useState<MarketSide>('supply');
  const [tab, setTab] = useState(0);
  const reducedMotion = useReducedMotion();
  // A manual toggle applies until the reduced-motion preference changes, which pauses again.
  const [manual, setManual] = useState<{ value: boolean; under: boolean } | null>(null);
  const paused = manual && manual.under === reducedMotion ? manual.value : reducedMotion;
  const setPaused = (update: (value: boolean) => boolean) => setManual({ value: update(paused), under: reducedMotion });
  const [visible, setVisible] = useState(5);
  const [offsets, setOffsets] = useState([0, 0, 0]);
  const [announcement, setAnnouncement] = useState('');

  const component = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const tracks = useRef<(HTMLDivElement | null)[]>([]);
  const busy = useRef<(null | (() => void))[]>([null, null, null]);
  const inView = useRef(false);

  const rendered = useMemo(() => groups(side), [groups, side]);
  const names = [copy.rental, copy.models, copy.physical];
  const activeItems: Listing[] = rendered[tab] || [];
  const activeCards = rotate(activeItems, offsets[tab]);

  const readVisible = useCallback(() => {
    if (!component.current) return 5;
    return Math.max(1, Number(getComputedStyle(component.current).getPropertyValue('--on-visible-cards')) || 5);
  }, []);

  const finishAll = useCallback(() => {
    busy.current.forEach((finish) => finish?.());
  }, []);

  const step = useCallback(
    (direction: 1 | -1, manual = false) => {
      const panel = tab;
      const track = tracks.current[panel];
      const items = rendered[panel] || [];
      const count = readVisible();
      if (!track || busy.current[panel] || items.length <= count) return;
      const first = track.firstElementChild as HTMLElement | null;
      if (!first) return;
      const distance = first.getBoundingClientRect().width + parseFloat(getComputedStyle(track).gap || '0');
      if (!distance) return;
      const motion = matchMedia(REDUCED).matches;
      let fallback: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (fallback) clearTimeout(fallback);
        track.removeEventListener('transitionend', ended);
        track.style.transition = 'none';
        track.style.transform = 'translate3d(0,0,0)';
        track.classList.remove('is-moving');
        busy.current[panel] = null;
        if (direction > 0) setOffsets((current) => current.map((value, i) => (i === panel ? value + 1 : value)));
        if (manual) {
          const next = rotate(items, offsets[panel] + direction);
          const title = next[0] && 'name' in next[0] ? next[0].name : '';
          setAnnouncement(items.length ? `Showing ${Math.min(count, items.length)} listings, starting with ${title}.` : 'No listings for this selection.');
        }
      };
      const ended = (event: TransitionEvent) => {
        if (event.target === track && event.propertyName === 'transform') busy.current[panel]?.();
      };
      busy.current[panel] = finish;
      track.addEventListener('transitionend', ended);
      track.classList.add('is-moving');
      if (direction < 0) {
        // Prepend the last card, then slide it into place from the left.
        setOffsets((current) => current.map((value, i) => (i === panel ? value - 1 : value)));
        track.style.transition = 'none';
        track.style.transform = `translate3d(-${distance}px,0,0)`;
        void track.offsetWidth;
      }
      requestAnimationFrame(() => {
        track.style.transition = motion ? 'none' : `transform ${STEP_MS}ms cubic-bezier(.22,.68,.2,1)`;
        track.style.transform = direction > 0 ? `translate3d(-${distance}px,0,0)` : 'translate3d(0,0,0)';
        fallback = setTimeout(() => busy.current[panel]?.(), motion ? 0 : STEP_MS + 80);
      });
    },
    [tab, rendered, readVisible, offsets],
  );

  useEffect(() => {
    const node = viewport.current;
    const observer = node
      ? new IntersectionObserver((entries) => {
          inView.current = entries[0].isIntersecting;
        }, { threshold: 0.15 })
      : null;
    if (node) observer?.observe(node);
    const resize = node
      ? new ResizeObserver(() => {
          finishAll();
          setVisible(readVisible());
        })
      : null;
    if (node) resize?.observe(node);
    return () => {
      observer?.disconnect();
      resize?.disconnect();
    };
  }, [readVisible, finishAll]);

  useEffect(() => {
    const timer = setInterval(() => {
      const node = component.current;
      if (!node || paused || !inView.current || document.hidden || node.matches(':hover') || node.querySelector('.on-listing-card:focus-within')) return;
      step(1);
    }, AUTO_MS);
    return () => clearInterval(timer);
  }, [paused, step]);

  // Touch swipes on the panels; a swipe suppresses the click that follows it.
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    let startX: number | null = null;
    let swipedUntil = 0;
    const down = (event: PointerEvent) => {
      if (event.pointerType === 'touch') startX = event.clientX;
    };
    const up = (event: PointerEvent) => {
      if (startX === null) return;
      const delta = event.clientX - startX;
      startX = null;
      if (Math.abs(delta) > 45) {
        swipedUntil = performance.now() + 350;
        step(delta < 0 ? 1 : -1, true);
      }
    };
    const cancel = () => {
      startX = null;
    };
    const click = (event: MouseEvent) => {
      if (performance.now() < swipedUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', cancel);
    node.addEventListener('click', click, true);
    return () => {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('click', click, true);
    };
  }, [step]);

  const disabled = activeItems.length <= visible;
  const start = activeItems.length ? ((offsets[tab] % activeItems.length) + activeItems.length) % activeItems.length : 0;

  return (
    <div
      ref={component}
      className="public-listing-preview on-listing-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Capacity market listings"
      data-paused={String(paused)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || (event.target as HTMLElement).matches('.public-listing-radio')) return;
        event.preventDefault();
        step(event.key === 'ArrowLeft' ? -1 : 1, true);
      }}
    >
      <div className="on-listing-sides">
        <div role="group" aria-label="Choose your side of the market">
          <button type="button" data-listing-side-filter="supply" aria-pressed={side === 'supply'} onClick={() => { finishAll(); setSide('supply'); }}>
            Buy capacity<span>Browse supplier offers</span>
          </button>
          <button type="button" data-listing-side-filter="demand" aria-pressed={side === 'demand'} onClick={() => { finishAll(); setSide('demand'); }}>
            Offer capacity<span>Respond to buyer RFQs</span>
          </button>
        </div>
      </div>
      {names.map((name, i) => (
        <span key={i} style={{ display: 'contents' }}>
          <input
            className="public-listing-radio"
            type="radio"
            name="public-listings"
            id={`public-listings-${i}`}
            checked={tab === i}
            onChange={() => {
              finishAll();
              setTab(i);
              const items = rendered[i] || [];
              const first = rotate(items, offsets[i])[0];
              setAnnouncement(items.length ? `Showing ${Math.min(visible, items.length)} listings, starting with ${first && 'name' in first ? first.name : ''}.` : 'No listings for this selection.');
            }}
          />
          <label className={`public-listing-tab public-listing-tab-${i}`} htmlFor={`public-listings-${i}`}>{name}</label>
        </span>
      ))}
      <div className="on-listing-controls">
        <span className="on-listing-position" aria-hidden="true">{positionLabel(activeItems.length, start, visible)}</span>
        <button type="button" data-listing-move="-1" aria-label="Previous listing" disabled={disabled} onClick={() => step(-1, true)}><ListingIcon name="left" /></button>
        <button type="button" data-listing-toggle aria-label={`${paused ? 'Play' : 'Pause'} listing carousel`} aria-pressed={paused} disabled={disabled} onClick={() => setPaused((value) => !value)}>
          <ListingIcon name={paused ? 'play' : 'pause'} />
        </button>
        <button type="button" data-listing-move="1" aria-label="Next listing" disabled={disabled} onClick={() => step(1, true)}><ListingIcon name="right" /></button>
      </div>
      <div className="public-listing-panels" ref={viewport}>
        {rendered.map((items, i) => {
          const cards = rotate(items, offsets[i]);
          const columns = Math.min(visible, Math.max(1, cards.length));
          return (
            <div className={`public-listing-panel public-listing-panel-${i}`} role="region" aria-label={names[i]} data-listing-panel={i} key={i}>
              <div className="on-listing-viewport">
                <div
                  className="on-listing-track"
                  ref={(node) => {
                    tracks.current[i] = node;
                  }}
                  style={{ ['--on-card-columns' as string]: columns } as React.CSSProperties}
                >
                  {cards.map((item, position) => (
                    <div key={item.id} style={{ display: 'contents' }} inert={position >= visible ? true : undefined} aria-hidden={position >= visible}>
                      <ListingCard item={item} index={items.indexOf(item)} total={items.length} />
                    </div>
                  ))}
                </div>
                {items.length ? null : <EmptyCards side={side} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="on-listing-under">
        <span>{disclosureFor(activeCards)}</span>
        <span className="on-listing-motion-hint">Hover to pause</span>
      </div>
      <span className="on-listing-announcement" role="status" aria-live="polite">{announcement}</span>
    </div>
  );
}
