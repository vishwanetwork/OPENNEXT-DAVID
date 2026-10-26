'use client';

import type { PricingProvider } from '@opennext/contracts';
import { credentialReady, fmt, providerRun, providerState, providerTerms } from './api';
import { ProviderLogo, StatusBadge } from './provider-card-ui';

export function ProviderCard({
  provider,
  mutable,
  busy,
  onOpen,
  onRun,
}: {
  provider: PricingProvider;
  mutable: boolean;
  busy: boolean;
  onOpen: () => void;
  onRun: () => void;
}) {
  const p = provider;
  const run = providerRun(p);
  const state = providerState(p);
  const implemented = p.adapterStatus === 'implemented';
  return (
    <article className="pc-card" aria-label={`${p.name} price source`}>
      <button type="button" className="pc-card-top" onClick={onOpen}>
        <span className="pc-provider">
          <ProviderLogo id={p.id} />
          <strong>{p.name}</strong>
        </span>
        <span className={`pc-enabled ${p.enabled ? 'is-enabled' : ''}`}>
          {p.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </button>
      <p className="pc-cadence">Incremental · every {p.intervalMinutes} minutes</p>
      <div className="pc-terms" aria-label={`${p.name} adapter price types`}>
        {providerTerms(p).map(({ term, supported }) => (
          <span
            key={term}
            className={supported ? 'is-supported' : ''}
            title={supported ? `${term} adapter supported` : `${term} integration pending`}
          >
            {term}
          </span>
        ))}
      </div>
      <div className="pc-card-run">
        <span>LATEST RUN</span>
        <StatusBadge status={state} />
      </div>
      <div className="pc-card-bottom">
        <small>{fmt(run?.finishedAt || run?.startedAt)}</small>
        <strong>
          {run ? `${Number(run.recordCount ?? run.records ?? 0).toLocaleString()} records` : '—'}
        </strong>
      </div>
      <div className="pc-card-actions">
        <button type="button" onClick={onOpen}>
          Configure &amp; API
        </button>
        <button
          type="button"
          disabled={!mutable || !implemented || !credentialReady(p) || state === 'running' || busy}
          onClick={onRun}
        >
          {state === 'running' ? 'Running…' : 'Run now'}
        </button>
      </div>
    </article>
  );
}
