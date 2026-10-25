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
import { useCurrentOffers } from './MarketPage';

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
      const S = useWorkspaceStore.getState();
      if (route !== 'market' || S.agentOpen || S.modal) return;
      setHint({ ...next, model: S.model, role: S.role });
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

export function AgentAvatar({ id = 'companion' }: { id?: string }) {
  return (
    <svg className="agent-avatar-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient
          id={`agent-shell-${id}`}
          x1="17"
          y1="10"
          x2="48"
          y2="55"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff" />
          <stop offset=".42" stopColor="#e6ece8" />
          <stop offset="1" stopColor="#a8b9b0" />
        </linearGradient>
        <linearGradient
          id={`agent-glass-${id}`}
          x1="23"
          y1="20"
          x2="39"
          y2="42"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#304d42" />
          <stop offset=".52" stopColor="#122c23" />
          <stop offset="1" stopColor="#071a14" />
        </linearGradient>
        <linearGradient
          id={`agent-rim-${id}`}
          x1="15"
          y1="14"
          x2="49"
          y2="49"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff" stopOpacity=".95" />
          <stop offset="1" stopColor="#718c7e" stopOpacity=".5" />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="54" rx="16" ry="2" fill="#071c14" opacity=".16" />
      <path
        d="M13 25c-2 0-3 2-3 6s1 6 3 6m38-12c2 0 3 2 3 6s-1 6-3 6"
        stroke="#92a99c"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <rect
        x="13"
        y="11"
        width="38"
        height="40"
        rx="15"
        fill={`url(#agent-shell-${id})`}
        stroke={`url(#agent-rim-${id})`}
      />
      <path
        d="M20 17c3-3 7-4 12-4s9 1 12 4"
        stroke="#fff"
        strokeOpacity=".8"
        strokeLinecap="round"
      />
      <rect
        x="18"
        y="20"
        width="28"
        height="21"
        rx="9"
        fill={`url(#agent-glass-${id})`}
        stroke="#647e70"
        strokeWidth=".7"
      />
      <path d="M23 23h18" stroke="#d4ebdf" strokeOpacity=".16" strokeLinecap="round" />
      <g className="agent-avatar-eyes" fill="#b8e8cc">
        <rect x="25" y="27" width="3" height="6" rx="1.5" />
        <rect x="36" y="27" width="3" height="6" rx="1.5" />
      </g>
      <path d="M29 45h6" stroke="#6e8879" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="45" cy="45" r="1" fill="#5b9270" />
    </svg>
  );
}

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
            <small>OPENNEXT AGENT</small>
            <p>{prompt}</p>
            <span>
              {hint.model}
              {Number.isFinite(hint.price as number)
                ? ' · ' + money(hint.price) + ' / GPU-hour'
                : ''}
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
        <span className="agent-companion-caption" aria-hidden="true">
          AGENT
        </span>
      </button>
    </aside>
  );
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
