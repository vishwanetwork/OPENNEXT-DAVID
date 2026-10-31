'use client';

import { money } from '@/lib/format';
import { useWorkspaceStore } from '@/terminal-kit';
import { AgentHint, useAgentHints } from './agent-drawer';
import { AgentAvatar } from './agent-avatar';

/** Floating launcher + contextual hint (legacy `companion()`). */
export function AgentCompanion({ onHintAction }: { onHintAction: (hint: AgentHint) => void }) {
  const { hint, dismiss } = useAgentHints();
  const { agentOpen, modal, role, setAgentOpen } = useWorkspaceStore();
  if (agentOpen || modal) return null;
  const seller = role === 'seller';
  const matching = hint?.kind === 'match';
  const prompt = matching
    ? seller
      ? 'Would you like to respond to this buyer now?'
      : 'Would you like to order this capacity now?'
    : seller
      ? 'Would you like to list capacity in this price range?'
      : 'Would you like to order within this price range?';
  return (
    <aside className="agent-companion" aria-label="OpenNEXT procurement assistant">
      <div className="agent-context-hint" id="agentContextHint" hidden={!hint}>
        {hint ? (
          <>
            <button
              type="button"
              className="agent-hint-dismiss"
              data-act="agent-hint-dismiss"
              aria-label="Dismiss suggestion"
              onClick={dismiss}
            >
              ×
            </button>
            <p>{prompt}</p>
            <span>
              {hint.model}
              {Number.isFinite(hint.price as number) ? ' ' + money(hint.price) + ' / GPU-hour' : ''}
            </span>
            <button
              type="button"
              className="agent-hint-action"
              data-act="agent-hint-action"
              onClick={() => onHintAction(hint)}
            >
              {matching
                ? seller
                  ? 'Review RFQ'
                  : 'Review capacity'
                : seller
                  ? 'Prepare supply'
                  : 'Prepare RFQ'}{' '}
              <span aria-hidden="true">→</span>
            </button>
          </>
        ) : null}
      </div>
      <button
        type="button"
        className="agent-companion-launch"
        data-act="agent-open"
        aria-label="Open AI Agent"
        onClick={() => setAgentOpen(true)}
      >
        <span className="agent-avatar-halo" aria-hidden="true" />
        <AgentAvatar />
      </button>
    </aside>
  );
}
