'use client';

import type { FormEvent } from 'react';
import {
  Button,
  PageHeading,
  downloadWorkspace,
  useToast,
  useWorkspaceData,
  useWorkspaceStore,
  type Identity,
} from '@/terminal-kit';

const OPTIONS: [keyof NonNullable<Identity['preferences']>, string, string][] = [
  ['quotes', 'Quotes & RFQ responses', 'Updates on supplier quotes and your requests.'],
  ['delivery', 'Instance updates', 'Delivery and Spot interruption warnings.'],
  ['market', 'Saved capacity', 'Price changes for resources you follow.'],
];

export function SettingsPage() {
  const identity = useWorkspaceStore((s) => s.identity);
  const patch = useWorkspaceStore((s) => s.patch);
  const saved = useWorkspaceStore((s) => s.saved);
  const cart = useWorkspaceStore((s) => s.cart);
  const workspace = useWorkspaceData();
  const toast = useToast();
  const exportWorkspace = () =>
    downloadWorkspace('workspace', {
      rfqs: workspace.rfqs,
      listings: workspace.listings,
      saved,
      cart,
      orders: workspace.orders,
      notifications: workspace.notifications,
      responses: workspace.responses,
    });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    patch({
      identity: {
        ...identity,
        preferences: {
          quotes: !!data.get('quotes'),
          delivery: !!data.get('delivery'),
          market: !!data.get('market'),
          zone: String(data.get('zone') || 'UTC'),
        },
      },
    });
    toast('Settings saved');
  };
  return (
    <div className="page-content preview-settings">
      <PageHeading title="Settings" subtitle="Control your notification and display preferences." />
      <form data-form="settings" className="preview-settings-form" onSubmit={submit}>
        <div className="preview-settings-grid">
          <section className="panel preview-settings-card">
            <header>
              <h2>Notifications</h2>
              <p>Choose which workspace updates matter to you.</p>
            </header>
            <div className="preview-settings-options">
              {OPTIONS.map(([id, label, note]) => (
                <label key={id} className="preview-settings-option">
                  <span>
                    <strong>{label}</strong>
                    <small>{note}</small>
                  </span>
                  <input
                    type="checkbox"
                    name={id}
                    aria-label={label}
                    defaultChecked={identity.preferences?.[id] !== false}
                  />
                </label>
              ))}
            </div>
          </section>
          <section className="panel preview-settings-card">
            <header>
              <h2>Display</h2>
              <p>Set the time zone for your workspace preferences.</p>
            </header>
            <label className="form-label" htmlFor="workspace-time-zone">
              Time zone
            </label>
            <select
              id="workspace-time-zone"
              name="zone"
              className="field"
              defaultValue={identity.preferences?.zone || 'UTC'}
            >
              {['UTC', 'Asia/Shanghai', 'Asia/Singapore', 'America/Los_Angeles'].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
            <p className="preview-settings-hint">
              Market history and settlement timestamps retain their displayed time-zone labels.
            </p>
          </section>
        </div>
        <footer className="preview-settings-save">
          <button className="btn small" type="submit">
            Save settings
          </button>
        </footer>
      </form>
      <section className="panel preview-settings-export">
        <div>
          <h2>Workspace data</h2>
          <p>Download your requirements, saved resources and procurement records.</p>
        </div>
        <Button
          cls="secondary small"
          data-act="export"
          data-value="workspace"
          onClick={exportWorkspace}
        >
          Export workspace
        </Button>
      </section>
    </div>
  );
}
