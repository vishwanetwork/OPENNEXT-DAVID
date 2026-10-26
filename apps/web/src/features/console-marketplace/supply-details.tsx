import type { MarketRecord } from '@opennext/contracts';
import { date, money, number, present } from './marketplace';

/** Field labels and order follow Terminal's submitted Supply form, without editing controls. */
export function SupplyDetails({ record }: { record: MarketRecord }) {
  const fields: { name: string; label: string; value: unknown; full?: boolean }[] = [
    { name: 'title', label: 'Listing title', value: record.title },
    { name: 'model', label: 'GPU model', value: record.model },
    { name: 'region', label: 'Country / territory', value: record.region },
    { name: 'count', label: 'Available GPU count', value: number(record.count) },
    { name: 'hours', label: 'Available duration (hours)', value: number(record.hours) },
    { name: 'term', label: 'Market terms', value: record.term },
    { name: 'netPrice', label: 'Your unit price (USD / GPU-hour)', value: money(record.netPrice) },
    { name: 'serviceStart', label: 'Available from (UTC)', value: date(record.serviceStart) },
    { name: 'serviceEnd', label: 'Available until (UTC)', value: date(record.serviceEnd) },
    { name: 'vcpu', label: 'vCPU', value: number(record.vcpu) },
    {
      name: 'memory',
      label: 'Memory (GB / GPU)',
      value: number(record.memory),
    },
    {
      name: 'notes',
      label: 'Specifications and commercial terms',
      value: record.notes,
      full: true,
    },
  ];
  return (
    <section className="market-console-supply-form" aria-label="Submitted supply details">
      <dl className="market-console-form-fields">
        {fields.map(({ name, label, value, full }) => (
          <div key={name} data-supply-field={name} className={full ? 'full' : undefined}>
            <dt>{label}</dt>
            <dd>{present(value) ? String(value) : 'Not provided'}</dd>
          </div>
        ))}
      </dl>
      <h3>Agent installation handoff</h3>
      <p className="form-note">
        SSH connection details are held securely by the backend and are not returned in the Console
        snapshot. Verification status: {record.agentStatus || 'Not provided'}.
      </p>
    </section>
  );
}
