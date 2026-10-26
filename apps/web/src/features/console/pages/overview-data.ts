import type {
  ContactLead,
  CreditTopup,
  MarketplaceSnapshot,
  PriceRecord,
  PricingProvider,
} from '@opennext/contracts';

export function availableSourceCount(
  providers: PricingProvider[],
  prices: PriceRecord[],
  now = Date.now(),
) {
  return providers.filter((provider) => {
    if (!provider.enabled || provider.adapterStatus !== 'implemented') return false;
    if (
      provider.credentialRequired &&
      (provider.credentialConfigured ?? provider.configured) !== true
    )
      return false;
    const maxAge = Math.max(provider.intervalMinutes * 2, 60) * 60_000;
    return prices.some((price) => {
      const age = now - Date.parse(price.observedAt || '');
      return (
        price.provider === provider.id &&
        !price.stale &&
        price.perGpuHourly > 0 &&
        Number.isFinite(age) &&
        age >= -60_000 &&
        age <= maxAge
      );
    });
  }).length;
}

export interface OperationsEvent {
  key: string;
  event: string;
  actor: string;
  at: string;
  path: string;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

export function recentOperations(
  marketplace: MarketplaceSnapshot | undefined,
  topups: CreditTopup[] = [],
  contacts: ContactLead[] = [],
): OperationsEvent[] {
  const events: OperationsEvent[] = [];
  for (const row of marketplace?.audit || []) {
    const event = row.event || row.action || '';
    const id = text(row.id);
    if (
      !/^(?:Homepage candidate|Supplier review|RFQ operations review) (?:Approved|Rejected)$/i.test(
        event,
      )
    )
      continue;
    const target = /homepage candidate/i.test(event)
      ? 'featured'
      : /supplier review/i.test(event)
        ? 'kyb'
        : /rfq operations review/i.test(event)
          ? 'rfqs'
          : '';
    if (!target || !id || !row.at) continue;
    events.push({
      key: target + ':' + id + ':' + row.at,
      event,
      actor: row.actor || row.by || 'Not recorded',
      at: row.at,
      path: '/' + target + '?record=' + encodeURIComponent(id),
    });
  }
  for (const row of topups) {
    if (!['Approved', 'Rejected'].includes(row.status) || !row.reviewedAt) continue;
    events.push({
      key: 'topup:' + row.id,
      event: 'Top-up ' + row.status.toLowerCase(),
      actor: text(row.reviewedBy) || 'Not recorded',
      at: row.reviewedAt,
      path: '/topups?record=' + encodeURIComponent(row.id),
    });
  }
  for (const row of contacts) {
    for (const event of row.history || []) {
      if (!event.at || !event.status || event.status === 'New') continue;
      events.push({
        key: 'contact:' + row.id + ':' + event.at,
        event: 'Contact request · ' + event.status,
        actor: text(event.actor) || text(event.by) || 'Not recorded',
        at: event.at,
        path: '/leads?record=' + encodeURIComponent(row.id),
      });
    }
  }
  return events
    .filter((event) => Number.isFinite(Date.parse(event.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 10);
}
