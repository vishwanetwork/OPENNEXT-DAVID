'use client';

import { useEffect, useRef, useState } from 'react';
import type { MarketRow, SettlementRow } from '@opennext/contracts';
import { useRegions, regionCode } from '@/features/market';
import { useTerminal } from '@/features/terminal/context';
import { useWorkspaceStore } from '@/features/terminal/store';
import { bestFor, marketStatus, recentFor, regionMatches, useMarketplaceStore } from '../exchange';
import { isDemo } from '../workspace';
import {
  FREE_SETTLEMENT_DAYS,
  SETTLEMENT_PERIODS,
  useProcurementUi,
  type SettlementDays,
} from '../ui-store';
import { useOpportunity } from './opportunity';
import {
  PBtn,
  canInquire,
  date,
  externalCommitment,
  externalName,
  externalQuantity,
  rowPrice,
} from './shared';

/** Shown settlement / reference rows so the settlement dialog can resolve them by id. */
export const settlementRows = new Map<string, SettlementRow>();

/** Continuous vertical cycling of the match cards; pauses on hover/focus, modal or hidden tab. */
function useMatchScroll(active: boolean) {
  const viewport = useRef<HTMLDivElement>(null);
  const modal = useWorkspaceStore((s) => s.modal);
  useEffect(() => {
    const node = viewport.current;
    if (!node || !active) return;
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
  }, [active, modal]);
  return viewport;
}

type Row = MarketRow & Partial<SettlementRow>;

/** Current time, refreshed every minute, so settlement windows are computed outside render. */
function useNow(interval = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

function MatchCard({ r, kind }: { r: Row; kind: 'best' | 'recent' }) {
  const { openModal } = useTerminal();
  const role = useWorkspaceStore((s) => s.role);
  const { open: openOpportunity, inquire } = useOpportunity();
  const label = r.external
    ? canInquire(role, r)
      ? r.side === 'supply'
        ? 'Request quote'
        : 'Offer capacity'
      : 'Details'
    : r.referenceOnly
      ? 'Details'
      : kind === 'best'
        ? r.side === 'demand'
          ? 'Offer'
          : 'Request quote'
        : 'Details';
  const act = r.external
    ? canInquire(role, r)
      ? 'proc-external-inquiry'
      : 'proc-listing'
    : r.referenceOnly
      ? kind === 'best'
        ? 'proc-listing'
        : 'proc-settlement'
      : kind === 'best'
        ? 'proc-opportunity'
        : 'proc-settlement';
  const onClick = () => {
    if (act === 'proc-external-inquiry') inquire(r);
    else if (act === 'proc-opportunity')
      openOpportunity(r.id, r.side === 'demand' ? 'offer' : 'buy');
    else openModal(act, { id: r.id });
  };
  return (
    <article
      className="match-card proc-match"
      data-match-id={r.id}
      data-match-side={r.side || 'settled'}
    >
      <div className="match-top">
        <strong>{r.model}</strong>
        <strong>
          {rowPrice(r)}
          {r.price == null ? null : <small> /GPU-hr</small>}
        </strong>
      </div>
      <p>
        {r.external ? externalName(r) : r.provider} · {r.region}
        <br />
        {r.external
          ? externalQuantity(r) + ' · ' + externalCommitment(r)
          : r.count + ' GPU · ' + r.term + ' · ' + r.hours + 'h'}
      </p>
      <div className="match-bottom">
        <span className="fit">
          {r.external
            ? 'Sourced recommendation'
            : r.referenceOnly
              ? kind === 'best'
                ? 'Same-model reference'
                : 'Reference activity'
              : kind === 'best'
                ? r.bestMatch
                  ? 'Matches your submitted requirements'
                  : 'Same-model recommendation'
                : 'Settled ' + date(r.settledAt)}
        </span>
        <PBtn
          data-act={act}
          data-id={r.id}
          data-intent={kind === 'best' ? (r.side === 'demand' ? 'offer' : 'buy') : undefined}
          onClick={onClick}
        >
          {label}
        </PBtn>
      </div>
    </article>
  );
}

/** Best Matches / Recent Settled panels (legacy `matches(c, kind)`). */
export function MatchesPanel({ kind }: { kind: 'best' | 'recent' }) {
  const { openModal } = useTerminal();
  const { model, region, count, term, role } = useWorkspaceStore();
  const regions = useRegions();
  const code = (value: string) => regionCode(regions, value);
  const market = useMarketplaceStore();
  const { settlementDays, setSettlementDays } = useProcurementUi();
  const status = marketStatus(market);
  const demo = isDemo();
  const now = useNow();
  const filters = { model, region, count, term, role };
  let rows: Row[];
  if (kind === 'best') rows = bestFor(market, filters, demo, code);
  else {
    const cutoff = now - settlementDays * 86400000;
    rows = (recentFor(market, filters, settlementDays, demo, code) as Row[]).filter(
      (r) =>
        !r.external &&
        r.model === model &&
        (region === 'All regions' || regionMatches(region, r.region, code)) &&
        ((r.referenceOnly && r.timeBasis === 'illustrative') ||
          (Date.parse(String(r.referenceOnly ? r.activityAt : r.settledAt)) >= cutoff &&
            Date.parse(String(r.referenceOnly ? r.activityAt : r.settledAt)) <= now)),
    );
    rows.forEach((r) => settlementRows.set(r.id, r as SettlementRow));
  }
  const hasReference = rows.some((r) => r.referenceOnly);
  const empty = kind === 'best' ? status.matchReason || 'No matches.' : 'No matches.';
  const viewport = useMatchScroll(rows.length > 3);
  const onDays = (value: string) => {
    const days = Number(value);
    if (['180', '365', 'all'].includes(value)) openModal('proc-history-upgrade');
    else if (FREE_SETTLEMENT_DAYS.includes(days as SettlementDays))
      setSettlementDays(days as SettlementDays);
  };
  const cards = rows.map((r) => <MatchCard key={r.id} r={r} kind={kind} />);
  return (
    <section className="matches" data-match-kind={kind}>
      <div className="matches-head">
        <div>
          <h3>
            {kind === 'best' ? 'Best Matches' : hasReference ? 'Recent Matches' : 'Recent Settled'}
          </h3>
          <small>
            {model} · {region}
          </small>
        </div>
        {kind === 'best' ? (
          <button
            type="button"
            className="icon-btn"
            data-act="proc-refresh"
            aria-label="Refresh matches"
            onClick={() =>
              void import('../workspace').then((m) => m.refreshMarketplace().catch(() => {}))
            }
          >
            ↻
          </button>
        ) : (
          <select
            className="field proc-history-days"
            aria-label="Settlement history"
            data-proc-days
            value={String(settlementDays)}
            onChange={(e) => onDays(e.target.value)}
          >
            {SETTLEMENT_PERIODS.map(([days, label]) => (
              <option key={String(days)} value={String(days)}>
                {label}
              </option>
            ))}
          </select>
        )}
      </div>
      {kind === 'best' && status.matchPrompt ? (
        <p className="proc-match-prompt">{status.matchPrompt}</p>
      ) : null}
      <div
        ref={viewport}
        className="match-viewport proc-match-viewport"
        data-scroll={kind}
        tabIndex={0}
      >
        <div className="match-cycle">
          {cards.length ? (
            cards
          ) : (
            <div className="proc-match-empty">
              <strong>{empty}</strong>
              {kind === 'best' && !rows.length ? (
                <PBtn
                  data-act={role === 'Seller' ? 'new-supply' : 'new-rfq'}
                  onClick={() =>
                    openModal(
                      role === 'Seller'
                        ? useWorkspaceStore.getState().review.status === 'Approved'
                          ? 'supply-form'
                          : 'review'
                        : 'rfq-form',
                    )
                  }
                >
                  {role === 'Seller' ? 'List supply' : 'Post RFQ'}
                </PBtn>
              ) : null}
            </div>
          )}
        </div>
        {rows.length > 3 ? (
          <div className="match-copy" aria-hidden="true" {...{ inert: true }}>
            {cards}
          </div>
        ) : null}
      </div>
      <div className="match-foot">
        <span>
          {rows.length}{' '}
          {hasReference ? 'reference records' : kind === 'best' ? 'matches' : 'settlements'}
        </span>
        <span>Hover to pause</span>
      </div>
    </section>
  );
}
