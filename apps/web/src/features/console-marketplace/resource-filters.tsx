import type { FeaturedCandidate, MarketRecord } from '@opennext/contracts';
import { isExternal } from './marketplace';

export interface ResourceFilters {
  modelFilter: string;
  countryFilter: string;
  termFilter: string;
}

export const EMPTY_RESOURCE_FILTERS: ResourceFilters = {
  modelFilter: 'All',
  countryFilter: 'All',
  termFilter: 'All',
};

export const recordCountry = (record: MarketRecord): string =>
  record.country || record.region || record.regionLabel || '';

export function matchesResourceFilters(record: MarketRecord, filters: ResourceFilters): boolean {
  return (
    (filters.modelFilter === 'All' || record.model === filters.modelFilter) &&
    (filters.countryFilter === 'All' || recordCountry(record) === filters.countryFilter) &&
    (filters.termFilter === 'All' || record.term === filters.termFilter)
  );
}

/** Only the server can nominate a homepage candidate and issue its material fingerprint. */
export function homepageCandidate(
  record: MarketRecord,
  side: 'demand' | 'supply',
  candidates: FeaturedCandidate[],
  demo: boolean,
): FeaturedCandidate | undefined {
  if (demo || isExternal(record, demo) || record.visibility === 'Private RFQ') return undefined;
  return candidates.find(
    (candidate) =>
      candidate.sourceId === record.id &&
      candidate.side === side &&
      candidate.current &&
      Boolean(candidate.fingerprint?.trim()),
  );
}

export function ResourceFilterFields({
  rows,
  filters,
  onChange,
}: {
  rows: MarketRecord[];
  filters: ResourceFilters;
  onChange: (patch: Partial<ResourceFilters>) => void;
}) {
  const fields: {
    key: keyof ResourceFilters;
    label: string;
    value: (record: MarketRecord) => string;
  }[] = [
    { key: 'modelFilter', label: 'Model', value: (row) => row.model || '' },
    { key: 'countryFilter', label: 'Country', value: recordCountry },
    { key: 'termFilter', label: 'Terms', value: (row) => row.term || '' },
  ];
  return fields.map(({ key, label, value }) => (
    <label className="market-console-filter-field" key={key}>
      <span>{label}</span>
      <select
        className="field"
        aria-label={label}
        value={filters[key]}
        onChange={(event) => onChange({ [key]: event.target.value })}
      >
        <option value="All">All</option>
        {[
          ...new Set(
            [...rows.map(value), filters[key] === 'All' ? '' : filters[key]].filter(Boolean),
          ),
        ]
          .sort()
          .map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
      </select>
    </label>
  ));
}
