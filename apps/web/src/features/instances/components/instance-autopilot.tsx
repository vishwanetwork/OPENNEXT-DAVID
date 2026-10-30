'use client';

import { useState, type FormEvent } from 'react';
import type { InstanceAutopilotResponse, InstanceAutopilotStatus } from '@opennext/contracts';
import { useToast } from '@/components/ui/toast';
import { useAutopilotActions, useInstanceAutopilot } from '../hooks';
import { AsyncButton, AsyncFeedback } from '@/components/ui/async-feedback';
import { useTerminal, useWorkspaceStore } from '@/terminal-kit';

type Choice = 'end' | 'keep';

/** `NAME=value` lines; blank lines and `#` comments are skipped. */
export function parseVariables(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    const name = at > 0 ? line.slice(0, at).trim() : '';
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) || name.toUpperCase().startsWith('SPOTBOT_'))
      throw new Error(`"${line.slice(0, 40)}" is not NAME=value with a valid name.`);
    const value = line.slice(at + 1);
    if (!value) throw new Error(`${name} has no value.`);
    if (name in values) throw new Error(`${name} is defined twice.`);
    values[name] = value;
  }
  return values;
}

const action = (choice: Choice | null) =>
  choice === 'end' ? 'the server ends' : choice === 'keep' ? 'the server keeps running' : '';

/** One sentence on where the task stands. */
export function autopilotSummary(status: InstanceAutopilotStatus | null): string {
  if (!status || status.state === 'none') return 'No autopilot task is set.';
  const outcome = status.outcome;
  const exit = outcome?.exitCode != null ? ` with exit code ${outcome.exitCode}` : '';
  const after =
    outcome?.action === 'end'
      ? ' The server is ending, as you chose.'
      : outcome?.action === 'keep'
        ? ' The server keeps running until its paid time ends or you end it.'
        : '';
  switch (status.state) {
    case 'waiting':
      return `Waiting for the server. The task starts about 15 seconds after the server is running; when it succeeds ${action(status.onSuccess)}, and when it fails ${action(status.onFailure)}.`;
    case 'running':
      return status.stopRequested ? 'Stopping the task…' : 'The task is running.';
    case 'interrupted':
      return outcome
        ? 'AWS replaced the server while the task ran. As you chose, it was not run again.'
        : 'AWS replaced the server while the task ran. It runs again on the replacement.';
    case 'succeeded':
      return `The task finished${exit}.${after}`;
    case 'failed':
      return `The task failed${exit}.${after}`;
    case 'stopped':
      return 'The task was stopped. The server keeps running.';
  }
}

function Choices({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: string | null;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="autopilot-choice">
      <legend className="form-label">{label}</legend>
      {options.map(([option, text]) => (
        <label key={option}>
          <input
            type="radio"
            name={name}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
          />{' '}
          {text}
        </label>
      ))}
    </fieldset>
  );
}

function AutopilotForm({
  id,
  current,
}: {
  id: string;
  current: InstanceAutopilotResponse['task'];
}) {
  const actions = useAutopilotActions(id);
  const toast = useToast();
  const { closeModal } = useTerminal();
  const [script, setScript] = useState(current?.script ?? '');
  const [env, setEnv] = useState(
    Object.entries(current?.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
  );
  const [secrets, setSecrets] = useState('');
  const [kept, setKept] = useState<string[]>(current?.secretNames ?? []);
  const [onSuccess, setOnSuccess] = useState<Choice>(current?.onSuccess ?? 'end');
  const [onFailure, setOnFailure] = useState<Choice | null>(current?.onFailure ?? null);
  const [onReplacement, setOnReplacement] = useState(current?.onReplacement ?? 'rerun');
  const [minutes, setMinutes] = useState(current?.maxMinutes ? String(current.maxMinutes) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!script.trim()) return setError('Enter the script to run.');
    if (!onFailure) return setError('Choose what happens to the server when the task fails.');
    let body;
    try {
      const added = parseVariables(secrets);
      const variables = parseVariables(env);
      const both = Object.keys(variables).find((k) => k in added || kept.includes(k));
      if (both) throw new Error(`${both} is both a variable and a secret.`);
      body = {
        script,
        env: variables,
        secrets: { ...Object.fromEntries(kept.map((k) => [k, null])), ...added },
        onSuccess,
        onFailure,
        onReplacement,
        maxMinutes: minutes ? Number(minutes) : null,
      };
    } catch (failure) {
      return setError((failure as Error).message);
    }
    setBusy(true);
    try {
      await actions.save(body);
      setSecrets('');
      toast('Autopilot saved. The task starts once the server is running.');
      const modal = useWorkspaceStore.getState().modal;
      if (modal?.type === 'instance-autopilot' && modal.id === id) closeModal();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await actions.remove();
      toast('Autopilot removed.');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="autopilot-form" aria-busy={busy} onSubmit={(event) => void submit(event)}>
      {busy ? <AsyncFeedback>Saving your autopilot changes…</AsyncFeedback> : null}
      <fieldset disabled={busy} className="async-fieldset">
        <label className="form-label">
          Script · runs with bash as ubuntu in /home/ubuntu
          <textarea
            className="field mono"
            rows={8}
            maxLength={65536}
            spellCheck={false}
            autoCapitalize="none"
            placeholder={'git clone https://github.com/you/project && cd project\npython train.py'}
            value={script}
            onChange={(event) => setScript(event.target.value)}
          />
        </label>
        <label className="form-label">
          Environment variables · one NAME=value per line
          <textarea
            className="field mono"
            rows={3}
            spellCheck={false}
            autoCapitalize="none"
            placeholder="EPOCHS=3"
            value={env}
            onChange={(event) => setEnv(event.target.value)}
          />
        </label>
        {current?.secretNames.length ? (
          <fieldset className="autopilot-choice">
            <legend className="form-label">Stored secrets</legend>
            {current.secretNames.map((name) => (
              <label key={name}>
                <input
                  type="checkbox"
                  checked={kept.includes(name)}
                  onChange={(event) =>
                    setKept(event.target.checked ? [...kept, name] : kept.filter((k) => k !== name))
                  }
                />{' '}
                Keep {name}
              </label>
            ))}
          </fieldset>
        ) : null}
        <label className="form-label">
          Secrets · one NAME=value per line; stored encrypted and never shown again
          <textarea
            className="field mono"
            rows={2}
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
            placeholder="HF_TOKEN=hf_…"
            value={secrets}
            onChange={(event) => setSecrets(event.target.value)}
          />
        </label>
        <Choices
          name="onSuccess"
          label="When the task succeeds (exit code 0)"
          value={onSuccess}
          options={[
            ['end', 'End the server and stop billing'],
            ['keep', 'Keep the server running'],
          ]}
          onChange={(value) => setOnSuccess(value as Choice)}
        />
        <Choices
          name="onFailure"
          label="When the task fails"
          value={onFailure}
          options={[
            ['end', 'End the server and stop billing'],
            ['keep', 'Keep the server running so I can investigate'],
          ]}
          onChange={(value) => setOnFailure(value as Choice)}
        />
        <Choices
          name="onReplacement"
          label="If AWS replaces the server while the task runs"
          value={onReplacement}
          options={[
            ['rerun', 'Run the task again on the replacement (SPOTBOT_RESUMED=1)'],
            ['none', 'Do not run it again'],
          ]}
          onChange={(value) => setOnReplacement(value as 'rerun' | 'none')}
        />
        <label className="form-label">
          Time limit · minutes, optional; a task that runs longer is stopped and counts as failed
          <input
            className="field"
            type="number"
            min={1}
            max={43200}
            step={1}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
        <p className="form-note">
          Keeping the server is billed per minute until its paid time ends or you end it. On a Spot
          interruption the task receives SIGTERM about two minutes before the server goes.
        </p>
        {error ? (
          <p className="onx-spot-purchase-error" role="alert">
            {error}
          </p>
        ) : null}
      </fieldset>
      <div className="modal-footer">
        {current ? (
          <AsyncButton
            type="button"
            className="btn secondary"
            disabled={busy}
            busy={busy}
            busyLabel="Removing…"
            onClick={() => void remove()}
          >
            Remove autopilot
          </AsyncButton>
        ) : null}
        <AsyncButton type="submit" className="btn" busy={busy} busyLabel="Saving…">
          Save autopilot
        </AsyncButton>
      </div>
    </form>
  );
}

/**
 * The task the server runs once it is delivered, and what happens to the server when the task
 * exits. The task can change until its first run starts; after that it can only be stopped.
 */
export function InstanceAutopilot({ id, ended }: { id: string; ended: boolean }) {
  const query = useInstanceAutopilot(id, true);
  const actions = useAutopilotActions(id);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (query.isPending) return <AsyncFeedback>Loading the autopilot…</AsyncFeedback>;
  if (!query.data)
    return (
      <>
        <p className="form-note">The autopilot is not available for this instance.</p>
        <AsyncButton busy={query.isFetching} onClick={() => void query.refetch()}>
          Try again
        </AsyncButton>
      </>
    );
  const { task, status, logTail } = query.data;
  const state = status?.state ?? 'none';
  const editable = !ended && (state === 'none' || state === 'waiting');
  const stop = async () => {
    setBusy(true);
    setError('');
    try {
      await actions.stop();
      toast('Stopping the task. The server keeps running.');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="instance-autopilot" data-instance-autopilot>
      {query.isFetching ? <AsyncFeedback>Updating task status…</AsyncFeedback> : null}
      {query.isError ? (
        <p role="alert">
          Showing the last loaded configuration. Its current status could not be refreshed.
        </p>
      ) : null}
      {busy ? <AsyncFeedback>Sending stop request…</AsyncFeedback> : null}
      <p className="form-note" role="status">
        {ended && state === 'none' ? 'This instance has ended.' : autopilotSummary(status)}
      </p>
      {editable ? <AutopilotForm key={task?.version ?? 0} id={id} current={task} /> : null}
      {!editable && task ? (
        <details>
          <summary>Script</summary>
          <pre className="autopilot-log">{task.script}</pre>
        </details>
      ) : null}
      {logTail ? (
        <>
          <p className="form-label">Last lines of the task log</p>
          <pre className="autopilot-log" data-autopilot-log>
            {logTail}
          </pre>
        </>
      ) : null}
      {(state === 'running' || state === 'interrupted') && !ended && !status?.outcome ? (
        <div className="modal-footer">
          <AsyncButton
            type="button"
            className="btn secondary"
            disabled={busy || status?.stopRequested}
            busy={busy}
            busyLabel="Stopping…"
            onClick={() => void stop()}
          >
            Stop task
          </AsyncButton>
        </div>
      ) : null}
      {error ? (
        <p className="onx-spot-purchase-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
