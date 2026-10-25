'use client';

import { useEffect, useRef } from 'react';
import { money, stampUtc } from '@/lib/format';
import { regionText, useRegions, type Offer } from '@/features/market';
import { Button, useWorkspaceStore } from '@/terminal-kit';

function MatchCard({
  o,
  kind,
  onQuote,
}: {
  o: Offer;
  kind: 'best' | 'recent';
  onQuote: (o: Offer) => void;
}) {
  const regions = useRegions();
  return (
    <article className="match-card" data-resource={o.id}>
      <div className="match-top">
        <span>{o.model}</span>
        <strong>
          {money(o.price)}
          <small style={{ fontWeight: 400, color: '#84928a', fontSize: 9 }}> /GPU-hr</small>
        </strong>
      </div>
      <p>
        {o.provider} · {regionText(regions, o.regionCode || o.region)}
        <br />
        {o.count} GPU · {o.term}
      </p>
      <div className="match-bottom">
        <span className="fit">
          {kind === 'best'
            ? 'Matches selected specifications'
            : 'Observed ' + (o.observedAt ? stampUtc(o.observedAt) : '—')}
          <br />
          {o.availability === true
            ? 'Capacity reported by provider'
            : o.availability === false
              ? 'Not currently available'
              : 'Availability requires confirmation'}
        </span>
        <Button cls="secondary small" data-act="quote" data-id={o.id} onClick={() => onQuote(o)}>
          Request quote
        </Button>
      </div>
    </article>
  );
}

/** Best Matches / Recent Observations side panels with auto-scroll (pauses on hover/focus). */
export function Matches({
  kind,
  offers,
  onQuote,
  onRefresh,
}: {
  kind: 'best' | 'recent';
  offers: Offer[];
  onQuote: (o: Offer) => void;
  onRefresh: () => void;
}) {
  const model = useWorkspaceStore((s) => s.model);
  const region = useWorkspaceStore((s) => s.region);
  const count = useWorkspaceStore((s) => s.count);
  const matchOffset = useWorkspaceStore((s) => s.matchOffset);
  const modal = useWorkspaceStore((s) => s.modal);
  const viewport = useRef<HTMLDivElement>(null);
  const list =
    kind === 'best'
      ? offers.slice().sort((a, b) => a.price - b.price)
      : offers
          .slice()
          .sort((a, b) => Date.parse(b.observedAt || '') - Date.parse(a.observedAt || ''));
  const offset = list.length ? matchOffset % list.length : 0;
  const rotated = [...list.slice(offset), ...list.slice(0, offset)].slice(0, 12);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    let frame = 0;
    let last = 0;
    let auto: number | null = null;
    const step = (now: number) => {
      const delta = Math.min(50, now - last || 16);
      last = now;
      if (
        !modal &&
        !document.hidden &&
        !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ) {
        if (node.matches(':hover') || node.contains(document.activeElement)) auto = node.scrollTop;
        else {
          auto = (auto ?? node.scrollTop) + delta * 0.025;
          node.scrollTop = auto;
          const first = node.querySelector<HTMLElement>('.match-cycle');
          if (first && node.scrollTop >= first.offsetHeight) {
            node.scrollTop -= first.offsetHeight;
            auto = node.scrollTop;
          }
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [modal]);
  return (
    <section className="matches">
      <div className="matches-head">
        <div>
          <h3>{kind === 'best' ? 'Best Matches' : 'Recent Observations'}</h3>
          <small>
            {model} · {region} · {count} GPU
          </small>
        </div>
        <button
          type="button"
          className="icon-btn"
          data-act="refresh-matches"
          aria-label={`Refresh ${kind} matches`}
          onClick={onRefresh}
        >
          ↻
        </button>
      </div>
      <div ref={viewport} className="match-viewport" tabIndex={0} data-scroll={kind}>
        <div className="match-cycle">
          {rotated.length ? (
            rotated.map((o) => <MatchCard key={o.id} o={o} kind={kind} onQuote={onQuote} />)
          ) : (
            <div className="api-matches-empty">
              No collected API prices match these filters. Choose another configuration or connect a
              provider in Console.
            </div>
          )}
        </div>
        {rotated.length > 2 ? (
          <div aria-hidden="true">
            {rotated.map((o) => (
              <MatchCard key={o.id + '-dup'} o={o} kind={kind} onQuote={onQuote} />
            ))}
          </div>
        ) : null}
      </div>
      <div className="match-foot">
        <span>{offers.length} actual price records</span>
        <span>Hover to pause</span>
      </div>
    </section>
  );
}
