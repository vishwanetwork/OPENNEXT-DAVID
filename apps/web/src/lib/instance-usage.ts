/** Read-only frontend port. A backend adapter and wire contract must be agreed before activation. */
export interface InstanceUsageInterval {
  startedAt: string;
  endedAt: string;
  state: 'connected' | 'interrupted';
  utilizationPercent: number | null;
}

export interface InstanceUsageEvent {
  id: string;
  at: string;
  type: 'started' | 'interrupted' | 'reconnected' | 'ended';
  initiatedBy: 'platform' | 'provider' | 'user';
  description: string;
}

export interface InstanceBillingEntry {
  id: string;
  startedAt: string;
  endedAt: string;
  billableSeconds: number;
  computeCents: number;
  feeCents: number;
  totalCents: number;
}

export interface InstanceUsageSnapshot {
  confirmed: boolean;
  accountId: string;
  instanceId: string;
  demo: boolean;
  observedAt: string;
  windowStart: string;
  windowEnd: string;
  purchasedHours: number;
  retainedDataConfirmed: boolean;
  intervals: InstanceUsageInterval[];
  events: InstanceUsageEvent[];
  billing: {
    currency: 'USD';
    startedAt: string | null;
    stoppedAt: string | null;
    totalCents: number;
    complete: boolean;
    entries: InstanceBillingEntry[];
  } | null;
}

export interface InstanceUsageService {
  /** Every response must enforce account ownership; timestamps and charges come from the server. */
  load: (input: { instanceId: string; signal?: AbortSignal }) => Promise<InstanceUsageSnapshot>;
}
