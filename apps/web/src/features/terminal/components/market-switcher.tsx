'use client';

import { useEffect, useRef } from 'react';
import { useTerminal, useWorkspaceStore } from '@/terminal-kit';

/** Market switcher (GPU Market / Model Capacity) — Model Capacity is "Coming soon". */
export function MarketSwitcher() {
  const { route, go } = useTerminal();
  const menu = useWorkspaceStore((s) => s.menu);
  const setMenu = useWorkspaceStore((s) => s.setMenu);
  const selected = route === 'models' ? 'models' : 'market';
  const expanded = menu === 'market-switch';
  const button = useRef<HTMLButtonElement>(null);
  const checked = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (expanded) checked.current?.focus();
  }, [expanded]);
  return (
    <div className="filter-wrap market-switch-wrap">
      <button
        ref={button}
        type="button"
        className="market-switch-button"
        data-act="market-menu"
        aria-label="Switch Market"
        aria-haspopup="menu"
        aria-controls="market-switch-menu"
        aria-expanded={expanded}
        onClick={() => setMenu(expanded ? null : 'market-switch')}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" />
        </svg>
        <span>Switch Market</span>
        <span className="chevron">⌄</span>
      </button>
      {expanded ? (
        <div
          className="select-menu market-switch-menu"
          id="market-switch-menu"
          role="menu"
          aria-label="Choose a market"
        >
          {(
            [
              ['market', 'GPU Market', 'GPU rental and compute capacity', '◇'],
              ['models', 'Model Capacity', 'LLM access and token pricing', '◈'],
            ] as const
          ).map(([target, label, description, icon]) => (
            <button
              key={target}
              ref={selected === target ? checked : undefined}
              type="button"
              className="market-option"
              role="menuitemradio"
              aria-checked={selected === target}
              disabled={target === 'models'}
              aria-disabled={target === 'models' ? 'true' : undefined}
              data-act={target === 'models' ? undefined : 'switch-market'}
              data-value={target === 'models' ? undefined : target}
              onClick={() => {
                if (target === 'market') {
                  go('market');
                  button.current?.focus();
                }
              }}
            >
              <span className="market-option-icon">{icon}</span>
              <span>
                <strong>
                  {label}
                  {target === 'models' ? (
                    <>
                      {' '}
                      <em className="market-coming-soon">Coming soon</em>
                    </>
                  ) : null}
                </strong>
                <small>{description}</small>
              </span>
              <span className="market-option-check" aria-hidden="true">
                {selected === target ? '✓' : ''}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
