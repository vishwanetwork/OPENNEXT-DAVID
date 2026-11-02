'use client';

import { useState } from 'react';
import { useApi } from '@/components/providers/api-context';
import { AsyncButton, AsyncFeedback } from '@/components/ui/async-feedback';
import { instancesApi } from '../api';
import { useInference } from '../inference-hooks';

const labels: Record<string, string> = {
  queued: 'Waiting for GPU delivery',
  preparing_runtime: 'Preparing inference engine',
  downloading: 'Downloading model files',
  loading: 'Loading model into GPU memory',
  ready: 'Ready for inference',
  failed: 'Preparation failed',
  stopped: 'Model service stopped',
};

export function InstanceInference({ id, ended }: { id: string; ended: boolean }) {
  const query = useInference(id, ended);
  const api = useApi();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showKey, setShowKey] = useState(false);
  const status = query.data?.status;
  const connection = query.data?.connection;
  const action = async (kind: 'retry' | 'stop' | 'rotate_key') => {
    if (busy || !status) return;
    setBusy(kind);
    setError('');
    try {
      await instancesApi.inferenceAction(
        api,
        id,
        kind,
        kind === 'rotate_key' ? (connection?.keyVersion ?? 0) : (status.version ?? 1),
      );
      await query.refetch({ throwOnError: true });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The service could not be updated.');
    } finally {
      setBusy('');
    }
  };
  if (query.isPending) return <AsyncFeedback>Loading model service…</AsyncFeedback>;
  if (query.isError)
    return (
      <>
        <p role="alert">Model status could not be loaded.</p>
        <AsyncButton busy={query.isFetching} onClick={() => void query.refetch()}>
          Retry
        </AsyncButton>
      </>
    );
  if (!status) return <p>No model preinstallation was selected for this instance.</p>;
  const total = status.total_bytes ?? 0;
  const downloaded = Math.min(status.downloaded_bytes ?? 0, total);
  return (
    <div className="onx-instance-inference" aria-busy={Boolean(busy)}>
      <h3>{status.preset_id}</h3>
      <p role="status">
        {ended
          ? 'Instance ended'
          : status.state === 'ready' && !connection
            ? 'Model loaded; gateway connection pending'
            : labels[status.state]}
      </p>
      {status.estimated_minutes ? (
        <p className="form-note">
          Estimated cold preparation: {status.estimated_minutes} minutes. Download and startup times
          vary.
        </p>
      ) : null}
      {status.state === 'downloading' ? (
        <div>
          <progress aria-label="Model download" value={downloaded} max={total || 1} />
          <p>
            {total
              ? `${(downloaded / 2 ** 30).toFixed(1)} / ${(total / 2 ** 30).toFixed(1)} GiB`
              : 'Checking model files…'}
          </p>
        </div>
      ) : null}
      <p className="form-note">
        Billing starts at GPU delivery. Model preparation uses paid GPU time. Stopping the model
        keeps the rented GPU running; end the instance to stop renting it.
      </p>
      {status.error ? (
        <p role="alert">
          {status.error.replaceAll('_', ' ')}. You can retry preparation or continue using SSH.
        </p>
      ) : null}
      {status.state === 'ready' && !connection && !ended ? (
        <p className="form-note" role="status">
          The model is loaded. Waiting for the gateway to verify its secure inference connection.
          SSH remains available.
        </p>
      ) : null}
      {connection && !ended ? (
        <>
          <label className="form-label">
            Inference Base URL
            <input className="field" value={connection.baseUrl} readOnly />
          </label>
          <label className="form-label">
            Model
            <input className="field" value={connection.model} readOnly />
          </label>
          <label className="form-label">
            API key
            <input
              className="field"
              type={showKey ? 'text' : 'password'}
              value={connection.apiKey}
              readOnly
              autoComplete="off"
            />
          </label>
          <button type="button" className="btn secondary" onClick={() => setShowKey(!showKey)}>
            {showKey ? 'Hide API key' : 'Reveal API key'}
          </button>
          <p className="form-note">
            Use this Base URL and API key with an OpenAI-compatible SDK. The endpoint supports chat
            completions and streaming. A replacement reconnects this URL after reloading the model;
            in-flight requests must be retried.
          </p>
          <pre>{`curl "${connection.baseUrl}/chat/completions" \\\n  -H "Authorization: Bearer $INFERENCE_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${connection.model}","messages":[{"role":"user","content":"Hello"}],"max_tokens":64,"stream":true}'`}</pre>
          <AsyncButton
            className="btn secondary"
            busy={busy === 'rotate_key'}
            disabled={Boolean(busy)}
            onClick={() => void action('rotate_key')}
          >
            Rotate API key
          </AsyncButton>
        </>
      ) : null}
      {!ended ? (
        <div className="modal-footer">
          <AsyncButton
            className="btn secondary"
            busy={query.isFetching}
            disabled={Boolean(busy)}
            onClick={() => void query.refetch()}
          >
            Refresh model status
          </AsyncButton>
          {['failed', 'stopped'].includes(status.state) ? (
            <AsyncButton
              className="btn"
              busy={busy === 'retry'}
              disabled={Boolean(busy)}
              onClick={() => void action('retry')}
            >
              Retry preparation
            </AsyncButton>
          ) : (
            <AsyncButton
              className="btn secondary"
              busy={busy === 'stop'}
              disabled={Boolean(busy)}
              onClick={() => void action('stop')}
            >
              Stop model service
            </AsyncButton>
          )}
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
