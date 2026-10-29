/** Instance lifecycle, telemetry and resale eligibility (legacy OpenNEXT-instances.js, pure part). */
import type { Instance } from '@opennext/contracts';

export const timestamp = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim()
      ? Date.parse(v)
      : NaN;

export const stampUtcFull = (v: unknown): string => {
  const d = new Date(v as string);
  return v && Number.isFinite(d.getTime())
    ? d.toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC'
    : 'Not provided';
};

export const moneyOrNa = (v: unknown): string =>
  Number.isFinite(Number(v))
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v))
    : 'Not available';

export interface Lifecycle {
  label: 'End' | 'Reconnecting' | 'Running' | 'Awaiting status';
  ended: boolean;
  connecting: boolean;
  running: boolean;
}

const ENDED = [
  'end',
  'ended',
  'released',
  'expired',
  'terminated',
  'completed',
  'cancelled',
  'canceled',
];

export const isSpot = (
  i: Partial<Instance> & { marketTerms?: unknown; marketType?: unknown; pricingType?: unknown },
) => /spot/i.test(String(i.term || i.marketTerms || i.marketType || i.pricingType || ''));

export function lifecycle(
  i: Partial<Instance> & { connection?: { status?: string } },
  now = Date.now(),
): Lifecycle {
  const status = String(i.status || '').toLowerCase();
  const end = timestamp(i.serviceEnd ?? i.end);
  const connection = String(i.connectionStatus || i.connection?.status || '').toLowerCase();
  if (i.releasedAt || i.endedAt || ENDED.includes(status) || (Number.isFinite(end) && end <= now))
    return { label: 'End', ended: true, connecting: false, running: false };
  if (
    isSpot(i) &&
    [status, connection].some((value) =>
      /^(connecting|interrupted|reconnecting|preempted|recovering|resuming|disconnected|offline)$/.test(
        value,
      ),
    )
  )
    return { label: 'Reconnecting', ended: false, connecting: true, running: false };
  if (['running', 'active'].includes(status))
    return { label: 'Running', ended: false, connecting: false, running: true };
  // Unknown lifecycle data does not prove that a resource is running or interrupted.
  return { label: 'Awaiting status', ended: false, connecting: false, running: false };
}

export interface Telemetry {
  fresh: boolean;
  value: number | null;
  at: string | null | undefined;
}

export function telemetry(i: Partial<Instance>, now = Date.now()): Telemetry {
  const t = i.telemetry || {};
  const value = Number(t.utilizationPercent);
  const at = timestamp(t.observedAt);
  const fresh =
    t.utilizationPercent !== null &&
    t.utilizationPercent !== undefined &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100 &&
    Number.isFinite(at) &&
    now - at <= 120000 &&
    now >= at - 5000;
  return { fresh, value: fresh ? value : null, at: t.observedAt };
}

export function eligibility(
  i: Partial<Instance>,
  role: string,
  now = Date.now(),
): { allowed: boolean; reason: string } {
  const t = telemetry(i, now);
  const end = timestamp(i.serviceEnd ?? i.end);
  const life = lifecycle(i, now);
  if (role !== 'Buyer')
    return { allowed: false, reason: 'Resale is available for purchased buyer capacity.' };
  if (i.resaleAllowed !== true)
    return { allowed: false, reason: 'Supplier resale permission is required.' };
  if (i.paymentStatus !== 'Paid' || !life.running || !Number.isFinite(end) || end <= now)
    return { allowed: false, reason: 'Only an active, paid allocation can be resold.' };
  if (!t.fresh) return { allowed: false, reason: 'Waiting for current utilization telemetry.' };
  if ((t.value as number) >= 95)
    return { allowed: false, reason: 'Resale is paused at 95% utilization or above.' };
  if (!Number.isInteger(i.availableResellCount) || (i.availableResellCount as number) < 1)
    return { allowed: false, reason: 'No independently allocatable idle GPUs are available.' };
  return { allowed: true, reason: 'Idle capacity is available for an authorized resale request.' };
}

/** Safe `ssh` command for verified connection details; '' when the record is incomplete. */
export function sshCommand(i: Partial<Instance>): string {
  const host = String(i.sshHost || '');
  const user = String(i.sshUser || '');
  const port = Number(i.sshPort || 22);
  const safe =
    /^[a-zA-Z0-9.-]+$/.test(host) &&
    /^[a-zA-Z0-9_.-]+$/.test(user) &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535;
  return safe ? 'ssh -p ' + port + ' ' + user + '@' + host : '';
}
