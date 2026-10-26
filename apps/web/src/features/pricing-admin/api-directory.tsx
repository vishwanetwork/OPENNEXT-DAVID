'use client';

import { useState } from 'react';
import type { PricingProvider } from '@opennext/contracts';
import { NativeDialog } from '@/features/console';
import { PROVIDER_REFERENCES } from './provider-references';
import { ProviderLogo } from './provider-card-ui';

export function ProviderReference({ id }: { id: string }) {
  const reference = PROVIDER_REFERENCES[id];
  if (!reference) return null;
  return (
    <section className="pc-api-list pc-reference">
      <h3>Official API reference</h3>
      <p>Reviewed 27 Oct 2026. Documentation is not an active OpenNEXT connector.</p>
      {reference.endpoints.length ? (
        reference.endpoints.map((endpoint) => <code key={endpoint}>{endpoint}</code>)
      ) : (
        <p>No verified public pricing endpoint. Provider confirmation is required.</p>
      )}
      <dl className="pc-details">
        <div>
          <dt>Authentication</dt>
          <dd>{reference.auth}</dd>
        </div>
        <div>
          <dt>Documented coverage</dt>
          <dd>{reference.coverage}</dd>
        </div>
      </dl>
      <p className="pc-callout">{reference.limitation}</p>
      <a href={reference.docs} target="_blank" rel="noopener noreferrer">
        Official documentation ↗
      </a>
    </section>
  );
}

export function ApiDirectory({
  providers,
  onClose,
}: {
  providers: PricingProvider[];
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const visible = providers.filter((p) =>
    `${p.name} ${p.id}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <NativeDialog className="pc-dialog pc-directory" onClose={onClose}>
      <header>
        <div>
          <span className="pc-eyebrow">SERVER-SIDE INTEGRATION REFERENCE</span>
          <h2>Source API directory</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close API directory">
          ×
        </button>
      </header>
      <div className="pc-dialog-content">
        <p className="pc-callout">
          {providers.length} registered sources. Only server-confirmed adapters collect prices. Keys
          stay on the backend; reference endpoints are never called by this browser.
        </p>
        <label>
          Find a source
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <div className="pc-directory-list">
          {visible.map((p) => (
            <details key={p.id}>
              <summary>
                <span className="pc-provider">
                  <ProviderLogo id={p.id} />
                  <strong>{p.name}</strong>
                </span>
                <span>
                  {p.adapterStatus === 'implemented'
                    ? 'Adapter implemented'
                    : 'Integration pending'}
                </span>
              </summary>
              <ProviderReference id={p.id} />
            </details>
          ))}
          {!visible.length && <p>No sources match this search.</p>}
        </div>
      </div>
    </NativeDialog>
  );
}
