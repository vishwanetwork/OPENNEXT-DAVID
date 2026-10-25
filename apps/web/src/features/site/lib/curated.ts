import type { CuratedRfq } from '@opennext/contracts';

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

export interface RequirementRow {
  label: string;
  value: string;
}

/** Requirement rows for a curated RFQ, de-duplicated; falls back to the summary fields. */
export function requirementRows(item: CuratedRfq): RequirementRow[] {
  const fallback = [
    { label: 'Location', value: item.region },
    { label: 'Hardware', value: Array.isArray(item.modelOptions) ? item.modelOptions.join(' / ') : item.model },
    { label: 'Quantity', value: item.quantityLabel },
    { label: 'Rental term', value: item.termLabel },
    { label: 'Deployment', value: item.deliveryLabel },
    { label: 'Payment', value: item.paymentTerms },
  ];
  const rows = Array.isArray(item.specifications) && item.specifications.length ? item.specifications : fallback;
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (!row || !text(row.label) || !text(row.value)) return false;
      const key = `${text(row.label).toLowerCase()}\n${text(row.value).toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row) => ({ label: text(row.label), value: text(row.value) }));
}

export const validCurated = (item: unknown): item is CuratedRfq =>
  !!item &&
  typeof item === 'object' &&
  !!text((item as CuratedRfq).id) &&
  !!text((item as CuratedRfq).title) &&
  (item as CuratedRfq).sourceKind === 'customer_requirement';

/** Pre-filled contact message for offering capacity against a curated RFQ. */
export function offerMessage(item: CuratedRfq): string {
  return [
    `I would like to offer capacity for RFQ ${text(item.id)}.`,
    '',
    text(item.title),
    text(item.description),
    ...requirementRows(item).map((row) => `${row.label}: ${row.value}`),
    '',
    'My available capacity, delivery date and proposed commercial terms:',
    '',
  ]
    .filter((value, index, all) => value || index === 1 || index === all.length - 3 || index === all.length - 1)
    .join('\n');
}
