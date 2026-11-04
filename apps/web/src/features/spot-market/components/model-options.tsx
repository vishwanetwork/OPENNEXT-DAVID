'use client';

import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/components/providers/api-context';
import { AsyncButton, AsyncFeedback } from '@/components/ui/async-feedback';
import { spotMarketApi } from '../api';
import { useSpotCheckout } from '../hooks';

const reasons: Record<string, string> = {
  inference_insufficient_vram: 'Insufficient GPU memory for this precision and serving profile.',
  inference_insufficient_host_memory: 'This server has insufficient system RAM.',
  inference_insufficient_vcpus: 'This server has too few vCPUs.',
  inference_architecture_not_supported:
    'This server architecture is not supported by the prepared runtime.',
  inference_whole_gpu_required: 'A whole GPU server is required.',
  inference_gpu_vendor_not_supported: 'This prepared runtime requires NVIDIA GPUs.',
  inference_unsupported_gpu_layout: 'This GPU count is unsupported by this model serving profile.',
  inference_gpu_not_validated:
    'This GPU and runtime combination has not been enabled after validation.',
  inference_preset_not_enabled: 'This model preset is not enabled yet.',
  inference_configuration_unavailable: "This model's runtime configuration is unavailable.",
};

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
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
  });
  if (!draft || draft.row.sourceKind !== 'agent') return null;
  const selected = draft.inferenceQuote?.inferencePresetId ?? '';
  const preset = models.data?.presets.find((p) => p.id === selected);
  const modelGpuCount = draft.inferenceQuote?.modelGpuCount ?? preset?.modelGpuCount;
  return (
    <fieldset disabled={draft.busy} aria-busy={models.isFetching || draft.busy}>
      <legend>Optional model preinstallation</legend>
      <AsyncButton
        className="btn secondary small"
        busy={models.isFetching}
        busyLabel="Refreshing models…"
        disabled={draft.busy}
        onClick={() => void models.refetch()}
      >
        Refresh model options
      </AsyncButton>
      <p className="form-note">
        Model options are loaded once per offer. Refresh to check for changes.
      </p>
      {models.isPending ? <AsyncFeedback>Loading compatible models…</AsyncFeedback> : null}
      {models.isError ? (
        <p className="form-note">
          Model options could not be loaded. Refresh to retry. GPU-only purchases remain available.
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
      {models.data?.presets.length ? (
        <details className="form-note">
          <summary>Model requirements and availability</summary>
          <ul>
            {models.data.presets.map((p) => (
              <li key={p.id}>
                <strong>{p.label}</strong> · {p.precision}
                {p.requirements ? (
                  <span>
                    {' '}
                    · At least {p.requirements.minimumTotalVramGB} GB total GPU memory,{' '}
                    {p.requirements.minimumHostMemoryGiB} GiB system RAM and{' '}
                    {p.requirements.minimumVcpus} vCPUs. {p.requirements.modelDiskGiB} GiB model
                    disk. Context: {p.requirements.maxModelLen} tokens; concurrent requests:{' '}
                    {p.requirements.maxNumSeqs}.
                  </span>
                ) : null}{' '}
                {p.enabled
                  ? 'Available for this server.'
                  : (reasons[p.reason ?? ''] ?? 'Unavailable for this server.')}
              </li>
            ))}
          </ul>
          <p>
            These are conservative requirements for the listed precision. Quantized variants have
            separate requirements. Startup checks must pass before the endpoint becomes ready.
          </p>
        </details>
      ) : null}
      {preset ? (
        <p className="form-note">
          {modelGpuCount
            ? `The model uses ${modelGpuCount} GPU(s). The rental covers the entire server. `
            : ''}
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
