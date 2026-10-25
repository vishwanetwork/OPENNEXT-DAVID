'use client';

import { useTerminal, useTerminalSlots, useWorkspaceData, useWorkspaceStore } from '@/terminal-kit';
import { AgentCompanion, AgentDrawer, type AgentHint } from './AgentDrawer';
import { TerminalModal } from './modals';

/** Agent drawer, contextual companion and the active modal (legacy `renderOverlays()`). */
export function TerminalOverlays() {
  const { openModal, route } = useTerminal();
  const { openOpportunity } = useTerminalSlots();
  const state = useWorkspaceStore();
  const review = useWorkspaceData().review;
  const onHintAction = (hint: AgentHint) => {
    if (hint.model !== state.model || hint.role !== state.role) return;
    if (hint.kind === 'match') {
      openOpportunity(hint.id || '', hint.side === 'demand' ? 'offer' : 'buy');
      return;
    }
    if (state.role === 'seller') {
      if (review.status !== 'Approved') {
        state.patch({ afterReview: 'supply-form' });
        openModal('review');
      } else openModal('supply-form');
      return;
    }
    openModal('rfq-form', {
      prefill: {
        model: state.model,
        region: hint.region || state.region,
        count: state.count,
        term: state.term,
        budget: Number.isFinite(hint.price as number) ? (hint.price as number) : undefined,
        notes:
          'Reference price range: ' +
          (Number.isFinite(hint.min as number) ? '$' + Number(hint.min).toFixed(2) : 'To confirm') +
          ' – ' +
          (Number.isFinite(hint.max as number) ? '$' + Number(hint.max).toFixed(2) : 'To confirm') +
          ' per GPU-hour. Confirm the current executable quote before purchase.',
      },
    });
  };
  return (
    <div id="overlays">
      <AgentDrawer />
      {route ? <AgentCompanion onHintAction={onHintAction} /> : null}
      <TerminalModal />
    </div>
  );
}
