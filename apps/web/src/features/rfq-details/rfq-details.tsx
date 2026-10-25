import type { ReactNode } from 'react';
import type { RfqRecord } from '@opennext/contracts';
import { defaultDate, defaultMoney, maximumQuote, numeric, present, rfqKind } from './maximum';
import './rfq-details.css';

export interface RfqDetailsProps {
  record: RfqRecord;
  /** Money formatter; defaults to `$1,234.56` / `Not provided`. */
  money?: (value: unknown) => string;
  /** Date formatter; defaults to en-GB UTC. */
  date?: (value: unknown) => string;
}

interface FieldSpec {
  name: string;
  label: string;
  value: unknown;
  full?: boolean;
}

function Field({ name, label, value, full }: FieldSpec) {
  return (
    <div className={`rfq-detail-field${full ? ' rfq-detail-full' : ''}`} data-rfq-field={name}>
      <dt>{label}</dt>
      <dd>{present(value) ? String(value) : 'Not provided'}</dd>
    </div>
  );
}

/**
 * Shared, read-only presentation of a submitted RFQ / quote request. Field order, labels and
 * the "Not provided" placeholders match the submission form; no actions are rendered.
 */
export function RfqDetails({ record, money = defaultMoney, date = defaultDate }: RfqDetailsProps) {
  const kind = rfqKind(record);
  const isModel = kind === 'model_capacity';
  const isHardware = kind === 'physical_gpu';
  const fields: FieldSpec[] = [
    { name: 'model', label: isHardware ? 'GPU model / SKU' : 'GPU / model', value: record.model },
    { name: 'region', label: 'Region / data location', value: record.region },
  ];
  if (isModel) {
    fields.push(
      { name: 'inputMillion', label: 'Input volume (million tokens)', value: record.inputMillion },
      {
        name: 'outputMillion',
        label: 'Output volume (million tokens)',
        value: record.outputMillion,
      },
      { name: 'days', label: 'Service duration (days)', value: record.days },
      { name: 'tps', label: 'Required TPS', value: record.tps },
    );
  } else {
    if (!isHardware) fields.push({ name: 'vcpu', label: 'vCPU', value: record.vcpu });
    fields.push({ name: 'count', label: 'GPU quantity', value: record.count });
    if (isHardware) fields.push({ name: 'condition', label: 'Condition', value: record.condition });
    else
      fields.push(
        { name: 'memory', label: 'Memory (GB / GPU)', value: record.memory },
        { name: 'hours', label: 'Duration (hours)', value: record.hours },
      );
  }
  fields.push(
    { name: 'term', label: 'Market terms', value: record.term },
    {
      name: 'budget',
      label: isModel
        ? 'Maximum total budget (USD)'
        : isHardware
          ? 'Maximum unit price (USD / GPU)'
          : 'Maximum USD / GPU-hour',
      value: numeric(record.budget) ? money(record.budget) : null,
    },
    {
      name: 'start',
      label: isHardware ? 'Required arrival (UTC)' : 'Required start (UTC)',
      value: date(record.start),
    },
    { name: 'quoteDeadline', label: 'Quotes due (UTC)', value: date(record.quoteDeadline) },
  );
  if (isHardware)
    fields.push(
      {
        name: 'shippingAddress',
        label: 'Shipping destination / address',
        value: record.shippingAddress,
      },
      { name: 'incoterms', label: 'Incoterms / shipping responsibility', value: record.incoterms },
      { name: 'warranty', label: 'Warranty and return requirements', value: record.warranty },
    );
  else if (isModel)
    fields.push({
      name: 'accessPolicy',
      label: 'Access and data policy requirements',
      value: record.accessPolicy,
    });
  else
    fields.push(
      { name: 'network', label: 'Network / interconnect (Optional)', value: record.network },
      { name: 'storage', label: 'Storage capacity / type (Optional)', value: record.storage },
      { name: 'image', label: 'Runtime / OS / image (Optional)', value: record.image },
    );
  fields.push(
    {
      name: 'sla',
      label: isHardware
        ? 'Inspection / support requirements (optional)'
        : 'SLA / support needs (optional)',
      value: record.sla,
    },
    { name: 'deliveryMethod', label: 'Delivery / access method', value: record.deliveryMethod },
    { name: 'urgency', label: 'Urgency', value: record.urgency },
    { name: 'visibility', label: 'Visibility', value: record.visibility },
    {
      name: 'notes',
      label: isHardware
        ? 'Hardware specifications and acceptance requirements (optional)'
        : 'Workload and acceptance requirements (optional)',
      value: record.notes,
      full: true,
    },
    {
      name: 'shareClosingPrice',
      label: 'Share the awarded price with participating suppliers after the RFQ closes.',
      value:
        typeof record.shareClosingPrice === 'boolean'
          ? record.shareClosingPrice
            ? 'Yes'
            : 'No'
          : null,
      full: true,
    },
  );
  const offer = record.selectedOffer;
  let offerSummary: ReactNode = null;
  if (offer && typeof offer === 'object') {
    offerSummary = (
      <section className="rfq-detail-offer">
        <h3>Selected resource</h3>
        <p>
          {[
            offer.model,
            offer.country,
            offer.term,
            numeric(offer.gpuCount) ? offer.gpuCount + ' GPUs' : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <dl>
          <Field name="selectedOfferId" label="Resource reference" value={offer.id} />
          <Field
            name="selectedOfferHourly"
            label="Listed instance price / hour"
            value={numeric(offer.instanceHourly) ? money(offer.instanceHourly) : null}
          />
          <Field
            name="selectedOfferUnit"
            label="Listed USD / GPU-hour"
            value={numeric(offer.perGpuHourly) ? money(offer.perGpuHourly) : null}
          />
        </dl>
      </section>
    );
  }
  const total = maximumQuote(record);
  return (
    <section
      className="rfq-request-details"
      aria-label={`Submitted ${record.requestKind === 'quote_request' ? 'quote request' : 'RFQ'} details`}
    >
      {offerSummary}
      <dl className="rfq-detail-grid">
        {fields.map((field) => (
          <Field key={field.name} {...field} />
        ))}
      </dl>
      <div className="rfq-detail-total">
        <span>Maximum Quote Price:</span>
        <strong>{total === null ? 'Not provided' : money(total)}</strong>
      </div>
    </section>
  );
}
