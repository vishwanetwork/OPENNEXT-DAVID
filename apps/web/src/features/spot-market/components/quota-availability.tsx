import type { SpotRow } from '../inventory';

export function QuotaAvailability({ row }: { row: SpotRow }) {
  if (row.sourceKind !== 'agent' || row.term !== 'Spot') return null;
  const quota = row.quota;
  const title = quota?.usageKnown
    ? `Shared regional quota: ${quota.remainingVcpus ?? '—'} vCPU remaining, ${quota.vcpusPerInstance ?? '—'} vCPU per instance. Other offers may share this allowance. Actual Spot capacity is confirmed at launch.${quota.checkedAt ? ' Checked ' + new Date(quota.checkedAt).toLocaleTimeString() : ''}`
    : 'The remaining quota could not be confirmed. It will be checked before the order is accepted. Actual Spot capacity is confirmed at launch.';
  return (
    <small className="form-note" title={title}>
      {quota?.usageKnown && quota.maxInstances !== null
        ? `Quota estimate: up to ${quota.maxInstances} instances (${quota.maxGpus} GPUs)`
        : 'Quota estimate unavailable'}
      <br />
      Spot capacity checked at launch
    </small>
  );
}
