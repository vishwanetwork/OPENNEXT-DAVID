'use client';

import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/components/providers/api-context';
import { AsyncFeedback } from '@/components/ui/async-feedback';
import { spotMarketApi } from '../api';
import { useSpotCheckout } from '../hooks';

export function ModelOptions() {
  const checkout = useSpotCheckout();
  const draft = checkout.pending();
  const api = useApi();
  const offerId = draft?.row.id ?? '';
  const models = useQuery({
    queryKey: ['marketplace', 'inference-presets', offerId],
    queryFn: ({ signal }) => spotMarketApi.inferencePresets(api, offerId, signal),
    enabled: Boolean(offerId) && draft?.row.sourceKind === 'agent',
    retry: false,
    staleTime: 30000,
  });
  if (!draft || draft.row.sourceKind !== 'agent') return null;
  const selected = draft.inferenceQuote?.inferencePresetId ?? '';
  const preset = models.data?.presets.find((p) => p.id === selected);
  return (
    <fieldset disabled={draft.busy} aria-busy={models.isFetching || draft.busy}>
      <legend>Optional model preinstallation</legend>
      {models.isPending ? <AsyncFeedback>Loading compatible models…</AsyncFeedback> : null}
      {models.isError ? (
        <p className="form-note">
          Model options are unavailable. GPU-only purchases remain available.
        </p>
      ) : null}
      <label className="form-label">
        Model
        <select
          className="field"
          value={selected}
          onChange={(e) => void checkout.selectInference(e.target.value)}
        >
          <option value="">None — GPU and SSH access only</option>
          {models.data?.presets.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.enabled}>
              {p.label}
              {p.enabled ? '' : ' — unavailable for this offer'}
            </option>
          ))}
        </select>
      </label>
      {preset ? (
        <p className="form-note">
          {preset.diskGiB} GiB protected model disk. Estimated preparation:{' '}
          {preset.estimatedMinutes} minutes; network and engine startup may take longer. This
          estimate is not a readiness guarantee.
        </p>
      ) : null}
      {selected ? (
        <label className="form-label">
          <span>
            <input
              type="checkbox"
              checked={draft.inferenceBillingAcknowledged === true}
              onChange={(e) => checkout.acknowledgeInference(e.target.checked)}
            />{' '}
            I understand billing starts at GPU delivery, including model download and loading. The
            inference endpoint becomes usable only after the model is ready.
          </span>
        </label>
      ) : null}
    </fieldset>
  );
}
