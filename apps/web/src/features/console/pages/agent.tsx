'use client';

import type { FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { useConsoleStore } from '../store';
import { ConsoleIcon as Icon } from '@/components/icons';
import { VERIFY_COMMAND } from '../reference-data';
import { Badge, Btn, Field, Head, Note, formValues } from '../components/forms';
import { useConsoleDialogs } from '../dialogs/use-dialogs';
import { usePageTools } from './use-page-tools';

export function AgentPage() {
  const c = useConsoleStore((s) => s.db.config);
  const toast = useToast();
  const dialogs = useConsoleDialogs();
  const { refresh } = usePageTools('agent');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { get, has } = formValues(event.currentTarget);
    if (!/^https:\/\//.test(get('repo')) || !/^ssh-(?:ed25519|rsa)\s+\S+/.test(get('publicKey'))) {
      toast('Enter an HTTPS repository and a valid OpenSSH public key.');
      return;
    }
    let revision = 0;
    useConsoleStore.getState().mutate((d) => {
      revision = d.config.revision + 1;
      d.config = {
        ...d.config,
        repo: get('repo'),
        publicKey: get('publicKey'),
        requireGPU: has('requireGPU'),
        pinHost: has('pinHost'),
        revision,
      };
    });
    useConsoleStore
      .getState()
      .record(
        'Agent policy updated',
        `Revision ${revision}`,
        'Repository, public key and verification requirements saved.',
      );
    toast('Agent configuration saved.');
  };
  return (
    <>
      <Head
        title="Platform agent"
        copy="Manage the verification source, public SSH policy and execution boundaries."
        actions={
          <Btn className="btn-icon" onClick={refresh}>
            <Icon name="refresh" />
            Refresh
          </Btn>
        }
      />
      <div className="config-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Agent configuration</h2>
              <p>Revision {c.revision} · Last saved policy is recorded in the audit log.</p>
            </div>
            <Badge label="Configured" tone="green" />
          </div>
          <form id="agent-config-form" onSubmit={submit} key={c.revision}>
            <div className="panel-body">
              <Field
                label="Agent source repository"
                name="repo"
                defaultValue={c.repo}
                type="url"
                hint="Repository used by a connected verification service. No agent is downloaded from this local workspace."
              />
              <div className="field">
                <label htmlFor="publicKey">OpenSSH public key</label>
                <textarea
                  id="publicKey"
                  name="publicKey"
                  className="mono"
                  style={{ height: 95 }}
                  defaultValue={c.publicKey}
                />
                <div className="hint">
                  Share the public key with suppliers. Private keys never belong in this console.
                </div>
              </div>
              <div className="toggle-line">
                <div>
                  <strong>Require nvidia-smi hardware evidence</strong>
                  <p>Match the GPU model and count against the contracted allocation.</p>
                </div>
                <label className="toggle">
                  <input name="requireGPU" type="checkbox" defaultChecked={c.requireGPU} />
                  <span />
                </label>
              </div>
              <div className="toggle-line">
                <div>
                  <strong>Pin the SSH host fingerprint</strong>
                  <p>Require an operator to verify the host identity before acceptance.</p>
                </div>
                <label className="toggle">
                  <input name="pinHost" type="checkbox" defaultChecked={c.pinHost} />
                  <span />
                </label>
              </div>
              <div className="toggle-line">
                <div>
                  <strong>Human approval for billable actions</strong>
                  <p>Payments, provisioning and order submission require explicit approval.</p>
                </div>
                <Badge label="Always required" tone="blue" />
              </div>
            </div>
            <div className="modal-footer">
              <span className="left">Applies to new verification records.</span>
              <button className="primary" type="submit">
                Save configuration
              </button>
            </div>
          </form>
        </section>
        <div>
          <section className="panel">
            <div className="panel-head">
              <h2>Execution boundaries</h2>
              <Icon name="shield" />
            </div>
            <div className="panel-body">
              {[
                'Read market records',
                'Evaluate matching constraints',
                'Create reviewable drafts',
              ].map((t) => (
                <div className="permission-row" key={t}>
                  <span>{t}</span>
                  <Icon name="check" />
                </div>
              ))}
              <div className="permission-row">
                <span>Submit orders autonomously</span>
                <Badge label="Blocked" />
              </div>
              <div className="permission-row">
                <span>Transfer funds</span>
                <Badge label="Blocked" />
              </div>
              <div className="permission-row">
                <span>Provision provider instances</span>
                <Badge label="Not connected" />
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Supplier verification guide</h2>
            </div>
            <div className="panel-body">
              <p className="small-text muted" style={{ marginBottom: 14 }}>
                Suppliers provide the host, port, fingerprint and hardware output. An operator
                reviews the evidence before marking delivery ready.
              </p>
              <div className="code-box">{VERIFY_COMMAND}</div>
              <Btn className="btn-icon small" onClick={() => void dialogs.copyCommand()}>
                <Icon name="copy" />
                Copy command
              </Btn>
              <p className="tiny muted" style={{ marginTop: 14 }}>
                Verification proves technical delivery, not ownership or resale authorization.
                Rights are reviewed separately.
              </p>
            </div>
          </section>
        </div>
      </div>
      <Note />
    </>
  );
}
