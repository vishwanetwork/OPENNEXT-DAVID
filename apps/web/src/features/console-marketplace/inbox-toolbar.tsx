import { MARKETS, TAB_LABELS, type InboxData, type InboxTab } from './marketplace';

export interface InboxFilterState {
  query: string;
  kindFilter: string;
  sourceFilter: string;
  statusFilter: string;
  reviewFilter: string;
}

const REVIEW_OPTIONS: [string, string][] = [
  ['Current', 'All current candidates'],
  ['Pending', 'Pending'],
  ['Approved', 'Approved'],
  ['Rejected', 'Rejected'],
  ['History', 'Superseded history'],
];

export function InboxToolbar({
  tab,
  demo,
  data,
  filters,
  sources,
  statusValues,
  onTab,
  onChange,
}: {
  tab: InboxTab;
  demo: boolean;
  data: InboxData;
  filters: InboxFilterState;
  sources: [string, string][];
  statusValues: string[];
  onTab: (tab: InboxTab) => void;
  onChange: (patch: Partial<InboxFilterState>) => void;
}) {
  const visibleTabs = (Object.entries(TAB_LABELS) as [InboxTab, string][]).filter(
    ([k]) => !demo || k !== 'featured',
  );
  const marketTab = tab === 'rfqs' || tab === 'supplies';
  return (
    <div className="market-console-toolbar">
      <div className="market-console-tabs">
        {visibleTabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`btn ${k === tab ? 'primary' : ''}`}
            onClick={() => onTab(k)}
          >
            {label} <span>{(data[k] || []).length}</span>
          </button>
        ))}
      </div>
      <div className="market-console-filters">
        <input
          className="field"
          type="search"
          aria-label="Search submissions"
          placeholder="Search ID, model, location, account or source…"
          value={filters.query}
          onChange={(e) => onChange({ query: e.target.value })}
        />
        <select
          className="field"
          aria-label="Market type"
          hidden={!marketTab}
          value={filters.kindFilter}
          onChange={(e) => onChange({ kindFilter: e.target.value })}
        >
          <option value="All">All markets</option>
          {Object.entries(MARKETS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="field"
          aria-label="Submission source"
          hidden={!marketTab}
          value={filters.sourceFilter}
          onChange={(e) => onChange({ sourceFilter: e.target.value })}
        >
          <option value="All">All sources</option>
          {sources.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="field"
          aria-label="Marketplace status"
          hidden={tab === 'featured'}
          value={filters.statusFilter}
          onChange={(e) => onChange({ statusFilter: e.target.value })}
        >
          <option value="All">All statuses</option>
          {statusValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          className="field"
          aria-label="Homepage review status"
          hidden={tab !== 'featured'}
          value={filters.reviewFilter}
          onChange={(e) => onChange({ reviewFilter: e.target.value })}
        >
          {REVIEW_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
