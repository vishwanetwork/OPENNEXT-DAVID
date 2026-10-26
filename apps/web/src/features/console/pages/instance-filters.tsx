import type { CatalogFilters, CatalogRow } from './instance-catalog';
import { emptyCatalogFilters } from './instance-catalog';

export function InstanceFilters({
  rows,
  filters,
  onChange,
}: {
  rows: CatalogRow[];
  filters: CatalogFilters;
  onChange: (filters: CatalogFilters) => void;
}) {
  return (
    <div className="ops-filters">
      <label>
        Search
        <input
          type="search"
          value={filters.query}
          placeholder="Model, source or region"
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
        />
      </label>
      {(['model', 'country', 'source', 'capacity', 'vcpu', 'memory'] as const).map((key) => (
        <label key={key}>
          {key === 'vcpu' ? 'vCPU' : key[0]?.toUpperCase() + key.slice(1)}
          {key === 'model' || key === 'source' ? (
            <>
              <input
                list={'catalog-' + key}
                value={filters[key]}
                placeholder="All"
                onChange={(e) => onChange({ ...filters, [key]: e.target.value })}
              />
              <datalist id={'catalog-' + key}>
                {[...new Set(rows.map((row) => row[key]))].sort().map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </>
          ) : (
            <select
              value={filters[key]}
              onChange={(e) => onChange({ ...filters, [key]: e.target.value })}
            >
              <option value="">All</option>
              {[
                ...new Set(
                  rows
                    .map((row) => row[key])
                    .filter((v) => v !== null)
                    .map(String),
                ),
              ]
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                .map((value) => (
                  <option key={value} value={value}>
                    {value}
                    {key === 'memory' ? ' GB' : ''}
                  </option>
                ))}
            </select>
          )}
        </label>
      ))}
      <button type="button" onClick={() => onChange(emptyCatalogFilters())}>
        Reset
      </button>
    </div>
  );
}
