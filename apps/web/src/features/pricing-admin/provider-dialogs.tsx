'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import type { PricingProvider } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { AdminLoginForm, NativeDialog } from '@/features/console';
import { credentialReady, pricingAdminApi, providerState, providerTerms } from './api';
import { Dialog } from './pricing-admin-page';
import { StatusBadge } from './provider-card-ui';
import { JobDialog, PricesDialog } from './job-dialogs';
import { ProviderReference } from './api-directory';

export function PcDialog({
  dialog,
  providers,
  access,
  busy,
  onClose,
  onOpen,
  onNotice,
  onRun,
  refresh,
}: {
  dialog: Dialog;
  providers: PricingProvider[];
  access: { mutable: boolean };
  busy: string | null;
  onClose: () => void;
  onOpen: (dialog: Dialog) => void;
  onNotice: (text: string, error?: boolean) => void;
  onRun: (id: string, test: boolean) => Promise<void>;
  refresh: () => Promise<unknown>;
}) {
  const api = useApi();
  const nameOf = (id: string) => providers.find((p) => p.id === id)?.name || id;
  let title = '';
  let content: ReactNode = null;
  if (dialog.kind === 'login') {
    title = 'Connect administrator session';
    content = (
      <AdminLoginForm
        intro={
          <p>
            This token belongs to the OpenNEXT server, not a cloud provider. It is exchanged for a
            short-lived, HTTP-only session cookie.
          </p>
        }
        buttonClassName="pc-primary"
        errorClassName="pc-notice pc-error"
        onConnected={async () => {
          onClose();
          onNotice('Administrator session connected.');
          await refresh();
        }}
      />
    );
  } else if (dialog.kind === 'detail') {
    const p = providers.find((x) => x.id === dialog.id);
    if (!p) return null;
    title = p.name;
    content = (
      <ProviderDetail
        p={p}
        access={access}
        busy={busy}
        onClose={onClose}
        onOpen={onOpen}
        onNotice={onNotice}
        onRun={onRun}
        refresh={refresh}
      />
    );
  } else if (dialog.kind === 'job') {
    return <JobDialog id={dialog.id} nameOf={nameOf} onClose={onClose} onOpen={onOpen} />;
  } else if (dialog.kind === 'prices') {
    return <PricesDialog id={dialog.id} name={nameOf(dialog.id)} api={api} onClose={onClose} />;
  }
  return (
    <NativeDialog className="pc-dialog" onClose={onClose}>
      <header>
        <div>
          <span className="pc-eyebrow">PRICE SOURCE OPERATIONS</span>
          <h2>{title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close price-source dialog">
          ×
        </button>
      </header>
      <div className="pc-dialog-content">{content}</div>
    </NativeDialog>
  );
}

function ProviderDetail({
  p,
  access,
  busy,
  onClose,
  onOpen,
  onNotice,
  onRun,
  refresh,
}: {
  p: PricingProvider;
  access: { mutable: boolean };
  busy: string | null;
  onClose: () => void;
  onOpen: (dialog: Dialog) => void;
  onNotice: (text: string, error?: boolean) => void;
  onRun: (id: string, test: boolean) => Promise<void>;
  refresh: () => Promise<unknown>;
}) {
  const api = useApi();
  const [credential, setCredential] = useState('');
  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await pricingAdminApi.settings(api, p.id, {
        enabled: data.has('enabled'),
        intervalMinutes: Number(data.get('intervalMinutes')),
      });
      onClose();
      onNotice('Collection settings saved on the server.');
      await refresh();
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : 'The pricing operation could not be completed.',
        true,
      );
    }
  };
  const saveCredential = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = credential;
    setCredential('');
    try {
      await pricingAdminApi.credential(api, p.id, value);
      onClose();
      onNotice('Credential saved in server memory. It will be cleared when the server restarts.');
      await refresh();
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : 'The pricing operation could not be completed.',
        true,
      );
    }
  };
  return (
    <>
      <div className="pc-detail-status">
        <StatusBadge status={providerState(p)} />
        <span>{p.recordCount || 0} cached records</span>
      </div>
      <p className="pc-scope">{p.scope}</p>
      <dl className="pc-details">
        <div>
          <dt>Adapter</dt>
          <dd>
            {p.adapterStatus === 'implemented'
              ? 'Implemented'
              : 'API / schema verification pending'}
          </dd>
        </div>
        <div>
          <dt>Server credential</dt>
          <dd>
            {!p.credentialRequired
              ? 'Not needed for public catalog'
              : credentialReady(p)
                ? 'Configured — never returned to browser'
                : 'Not configured'}
          </dd>
        </div>
        <div>
          <dt>Supported price types</dt>
          <dd>
            {providerTerms(p)
              .filter((item) => item.supported)
              .map((item) => item.term)
              .join(' · ') || 'Pending integration'}
          </dd>
        </div>
        <div>
          <dt>Pending price types</dt>
          <dd>
            {providerTerms(p)
              .filter((item) => !item.supported)
              .map((item) => item.term)
              .join(' · ') || 'None'}
          </dd>
        </div>
        <div>
          <dt>Credential environment</dt>
          <dd>{p.credentialEnv || 'Provider-specific server integration'}</dd>
        </div>
      </dl>
      {p.message ? <div className="pc-callout">{p.message}</div> : null}
      <form onSubmit={saveSettings}>
        <h3>Collection settings</h3>
        <label className="pc-checkbox">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={p.enabled}
            disabled={p.adapterStatus !== 'implemented'}
          />
          Enable scheduled collection
        </label>
        <label>
          Interval (minutes)
          <input
            type="number"
            name="intervalMinutes"
            min={10}
            max={1440}
            defaultValue={p.intervalMinutes}
            required
          />
        </label>
        <div className="pc-dialog-actions">
          <button type="submit" className="pc-primary" disabled={!access.mutable}>
            Save settings
          </button>
          <button
            type="button"
            disabled={!access.mutable || p.adapterStatus !== 'implemented' || busy === p.id}
            onClick={() => void onRun(p.id, true)}
          >
            Test &amp; collect
          </button>
          <button type="button" onClick={() => onOpen({ kind: 'prices', id: p.id })}>
            View prices
          </button>
        </div>
      </form>
      {p.credentialEnv && p.adapterStatus === 'implemented' ? (
        <form onSubmit={saveCredential} autoComplete="off">
          <h3>Provider credential</h3>
          <p>
            For this session only. Saved to server memory, never browser storage. Use server
            environment or a secrets manager for persistent deployment.
          </p>
          <label>
            API key
            <input
              type="password"
              name="credential"
              autoComplete="new-password"
              placeholder="Enter a rotated read-only API key"
              required
              minLength={5}
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
            />
          </label>
          <button type="submit" className="pc-primary" disabled={!access.mutable}>
            Save to server memory
          </button>
        </form>
      ) : null}
      <div className="pc-api-list">
        <h3>Registered upstream endpoints</h3>
        {(p.endpoints || []).length ? (
          (p.endpoints || []).map((e, i) => (
            <code key={i}>
              {e.method} {e.url}
            </code>
          ))
        ) : (
          <p>
            No verified connector endpoint yet. Credentials alone do not establish a price feed.
          </p>
        )}
        {p.docsUrl ? (
          <a href={p.docsUrl} target="_blank" rel="noopener noreferrer">
            Registered documentation ↗
          </a>
        ) : null}
      </div>
      <ProviderReference id={p.id} />
    </>
  );
}
