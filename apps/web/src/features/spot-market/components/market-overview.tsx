'use client';

import Image from 'next/image';
import { ConsoleIcon } from '@/components/icons';
import { useWorkspaceStore } from '@/terminal-kit';
import { usd, type MarketTerm, type SpotRow } from '../inventory';
import { useSpotMarketStore } from '../store';
import { GpuThumbnail } from './gpu-thumbnail';

/** Model shortcuts use the same current-term inventory and filters as the offer table. */
export function modelHighlights(rows: SpotRow[], term: MarketTerm) {
  const grouped = new Map<string, { model: string; count: number; price: number }>();
  for (const row of rows) {
    if (row.term !== term || !Number.isFinite(row.perGpuHourly) || row.perGpuHourly <= 0) continue;
    const model = grouped.get(row.model);
    grouped.set(row.model, {
      model: row.model,
      count: (model?.count ?? 0) + 1,
      price: Math.min(model?.price ?? Infinity, row.perGpuHourly),
    });
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count).slice(0, 3);
}

export function MarketOverview({
  rows,
  term,
  onNewRfq,
}: {
  rows: SpotRow[];
  term: MarketTerm;
  onNewRfq: () => void;
}) {
  const setAgentOpen = useWorkspaceStore((s) => s.setAgentOpen);
  const ui = useSpotMarketStore();
  const models = modelHighlights(rows, term);
  const choose = (model: string) => {
    const active = ui.selected.model.length === 1 && ui.selected.model[0] === model;
    if (active) ui.clearGroup('model');
    else ui.selectGroup('model', [model]);
  };
  return (
    <>
      <div className="buyer-market-feature">
        <Image
          src="/terminal-design/agent-compute.webp"
          alt=""
          width={1448}
          height={1086}
          className="buyer-market-art"
          priority
        />
        <div className="buyer-market-feature-copy">
          <h1>GPU Market</h1>
          <p>Find the right compute. On your terms.</p>
          <div className="buyer-market-feature-actions">
            <button
              type="button"
              className="btn onx-spot-post-rfq"
              data-act="new-rfq"
              onClick={onNewRfq}
            >
              Post RFQ <ConsoleIcon name="arrow" className="buyer-nav-icon" />
            </button>
            <button
              type="button"
              className="buyer-feature-agent"
              onClick={() => setAgentOpen(true)}
            >
              Ask OpenNEXT Agent <ConsoleIcon name="external" className="buyer-nav-icon" />
            </button>
          </div>
        </div>
      </div>
      {models.length ? (
        <div className="buyer-model-highlights" aria-label={`${term} model shortcuts`}>
          {models.map((item) => (
            <button
              key={item.model}
              type="button"
              className="buyer-model-highlight"
              aria-label={`View ${item.model} ${term} offers`}
              aria-pressed={ui.selected.model.length === 1 && ui.selected.model[0] === item.model}
              onClick={() => choose(item.model)}
            >
              <GpuThumbnail model={item.model} />
              <span className="buyer-model-name">
                <strong>{item.model}</strong>
                <span>
                  {item.count} {term} offers
                </span>
              </span>
              <span className="buyer-model-rate">
                <span>From</span>
                <strong>{usd(item.price)}</strong>
                <span>/ GPU-hour</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
