'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { money } from '@/lib/format';
import { regionText, useRegions } from '@/features/market';
import { useTerminal, useWorkspaceStore } from '@/terminal-kit';
import { useCurrentOffers } from './market-page';
import { AgentAvatar } from './agent-avatar';

export interface AgentHint {
  kind: 'match' | 'chart';
  id?: string;
  side?: string;
  price?: number | null;
  min?: number | null;
  max?: number | null;
  region?: string;
  model?: string;
  role?: string;
}

interface AgentHintApi {
  hint: AgentHint | null;
  suggest: (hint: AgentHint) => void;
  dismiss: () => void;
}

const HintContext = createContext<AgentHintApi>({
  hint: null,
  suggest: () => {},
  dismiss: () => {},
});

export const useAgentHints = () => useContext(HintContext);

/** Contextual "OpenNEXT Agent" suggestions shown on the market page (legacy `suggestAgent`). */
export function AgentHintProvider({ children }: { children: ReactNode }) {
  const [hint, setHint] = useState<AgentHint | null>(null);
  const { route } = useTerminal();
  const { model, role, agentOpen, modal } = useWorkspaceStore();
  const suggest = useCallback(
    (next: AgentHint) => {
      const workspace = useWorkspaceStore.getState();
      if (route !== 'market' || workspace.agentOpen || workspace.modal) return;
      setHint({ ...next, model: workspace.model, role: workspace.role });
    },
    [route],
  );
  const current =
    hint && hint.model === model && hint.role === role && route === 'market' ? hint : null;
  const value = {
    hint: agentOpen || modal ? null : current,
    suggest,
    dismiss: () => setHint(null),
  };
  return <HintContext.Provider value={value}>{children}</HintContext.Provider>;
}

/** Agent drawer: scripted replies grounded in the lowest collected match (never a generated price). */
export function AgentDrawer() {
  const { agentOpen, agentMessages, setAgentOpen, pushAgentMessages } = useWorkspaceStore();
  const offers = useCurrentOffers();
  const regions = useRegions();
  const input = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (agentOpen) input.current?.focus();
  }, [agentOpen]);
  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [agentMessages]);
  const reply = (text: string) => {
    const o = offers[0];
    const answer = o
      ? `The lowest collected match is ${o.provider} at ${money(o.price)}/GPU-hour in ${regionText(regions, o.regionCode || o.region)}. The whole ${o.count}-GPU instance is ${money(o.instanceHourly)}/hour.\n\nThis is an API reference observation, not a firm supplier quote. Availability, delivery time and SLA must be confirmed. No money or infrastructure is changed by this assistant.`
      : 'There are no collected API prices for this selection. Try On-demand, another GPU count or region, or connect the provider in the Operations Console. I will not generate a price to fill missing data.';
    pushAgentMessages([
      { role: 'user', text },
      { role: 'assistant', text: answer },
    ]);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = String(new FormData(event.currentTarget).get('message') || '').trim();
    if (!message) return;
    reply(message);
    event.currentTarget.reset();
  };
  return (
    <aside className={`agent-drawer ${agentOpen ? 'open' : ''}`} id="agentDrawer">
      <div className="drawer-head">
        <div className="agent-drawer-identity">
          <AgentAvatar id="drawer" />
          <div>
            <strong>OpenNEXT Agent</strong>
            <small>Capacity procurement assistant</small>
          </div>
        </div>
        <button
          type="button"
          className="icon-btn"
          data-act="agent-close"
          aria-label="Close agent"
          onClick={() => setAgentOpen(false)}
        >
          ×
        </button>
      </div>
      <div ref={body} className="drawer-body" id="agentMessages">
        <div className="bubble">
          Tell me the model, region, start time and budget. I can compare suppliers, explain
          trade-offs and prepare a quote request for your review.
        </div>
        {agentMessages.map((m, i) => (
          <div
            key={i}
            className={`bubble ${m.role === 'user' ? 'user' : ''}`}
            style={{ whiteSpace: 'pre-line' }}
          >
            {m.text}
          </div>
        ))}
        <div className="quick">
          {['Find the lowest Spot price', 'Compare best matches', 'Draft an 8-GPU RFQ'].map((q) => (
            <button
              key={q}
              type="button"
              data-act="agent-prompt"
              data-value={q}
              onClick={() => reply(q)}
            >
              {q}
            </button>
          ))}
        </div>
      </div>
      <form className="composer" data-form="agent" onSubmit={submit}>
        <input
          ref={input}
          name="message"
          id="agentInput"
          placeholder="Ask about capacity…"
          required
        />
        <button type="submit" aria-label="Send message">
          ↑
        </button>
      </form>
    </aside>
  );
}
export { AgentCompanion } from './agent-companion';
