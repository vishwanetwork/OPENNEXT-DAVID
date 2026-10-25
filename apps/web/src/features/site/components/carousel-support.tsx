'use client';

import { useSyncExternalStore } from 'react';
import { type MarketSide } from '../lib/listings';
import { useSiteActions } from './site-actions';

export const REDUCED = '(prefers-reduced-motion: reduce)';

const subscribeReducedMotion = (callback: () => void) => {
  const query = matchMedia(REDUCED);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
};

export const useReducedMotion = () =>
  useSyncExternalStore(
    subscribeReducedMotion,
    () => matchMedia(REDUCED).matches,
    () => false,
  );

export const rotate = <T,>(items: T[], offset: number): T[] => {
  if (!items.length) return items;
  const start = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
};

export function EmptyCards({ side }: { side: MarketSide }) {
  const { openWorkspace } = useSiteActions();
  const supply = side === 'supply';
  return (
    <div className="on-listing-empty">
      <h3>
        {supply
          ? 'No published offers in this market yet.'
          : 'No open requirements in this market yet.'}
      </h3>
      <p>
        {supply
          ? 'Tell suppliers what you need and invite a quote.'
          : 'Publish your capacity so buyers can find you.'}
      </p>
      <button
        type="button"
        className="on-button on-button-outline"
        data-public-action="open-workspace"
        data-target={supply ? 'rfq' : 'supply'}
        onClick={() => openWorkspace({ target: supply ? 'rfq' : 'supply' })}
      >
        {supply ? 'Post an RFQ' : 'List capacity'}
      </button>
    </div>
  );
}
