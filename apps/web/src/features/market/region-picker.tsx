import type { RefObject } from 'react';
import type { RegionalHistoryResponse } from '@opennext/contracts';
import type { Region } from './catalog';
import {
  presentation,
  regionName,
  type ChoiceState,
  type SelectionResult,
} from './regional-history';

export interface RegionOption {
  code: string;
  name?: string;
}

/** "Compare regions" toggle plus the searchable, multi-select picker beneath it. */
export function RegionPicker({
  state,
  result,
  regionsList,
  data,
  regions,
  update,
  toggleRef,
  searchRef,
}: {
  state: ChoiceState;
  result: SelectionResult;
  regionsList: RegionOption[];
  data: RegionalHistoryResponse;
  regions: readonly Region[];
  update: (patch: Partial<ChoiceState>) => void;
  toggleRef: RefObject<HTMLButtonElement | null>;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const query = state.query.trim().toLowerCase();
  let visibleGroups = 0;
  return (
    <div className="history-selection">
      <button
        ref={toggleRef}
        type="button"
        className="btn secondary small"
        data-region-toggle
        aria-expanded={state.open}
        onClick={() => update({ open: !state.open })}
      >
        Compare regions <span className="history-count">{state.selected.length} selected</span>⌄
      </button>
      <span>
        All {regionsList.length} regions available · Hover or focus a legend to isolate prices
      </span>
      {state.open ? (
        <section
          className="history-picker"
          aria-label="Choose regions for price comparison"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              update({ open: false });
              toggleRef.current?.focus();
            }
          }}
        >
          <div className="history-picker-head">
            <strong>Compare global prices</strong>
            <button
              type="button"
              data-region-toggle
              aria-label="Close region picker"
              onClick={() => {
                update({ open: false });
                toggleRef.current?.focus();
              }}
            >
              ×
            </button>
          </div>
          <input
            ref={searchRef}
            type="search"
            data-region-search
            aria-label="Search regions"
            placeholder="Search region or configuration…"
            value={state.query}
            onChange={(e) => update({ query: e.target.value })}
          />
          <div className="history-picker-actions">
            <button
              type="button"
              data-region-all
              onClick={() => update({ selected: result.known.map((s) => s.id), initialized: true })}
            >
              Select all
            </button>
            <button
              type="button"
              data-region-clear
              onClick={() => update({ selected: [], initialized: true })}
            >
              Clear
            </button>
            <span>{state.selected.length} selected · No limit</span>
          </div>
          <div className="history-options">
            {regionsList.map((region) => {
              const rows = result.known.filter((s) => s.region === region.code);
              const name = regionName(
                { name: (region as { city?: string }).city || region.name, region: region.code },
                data,
                regions,
              );
              const text = [
                name,
                ...rows.map((s) => presentation(s, result.known, data, regions).label),
              ]
                .join(' ')
                .toLowerCase();
              const hidden = !text.includes(query);
              if (!hidden) visibleGroups++;
              return (
                <div
                  key={region.code}
                  className="history-region-group"
                  data-history-search-text={text}
                  hidden={hidden}
                >
                  <div className="history-region-name">{name}</div>
                  {rows.length ? (
                    rows.map((s) => {
                      const display = presentation(s, result.known, data, regions);
                      return (
                        <label key={s.id} className="history-zone-row">
                          <input
                            type="checkbox"
                            aria-label={display.label}
                            data-region-id={s.id}
                            checked={state.selected.includes(s.id)}
                            onChange={(e) =>
                              update({
                                selected: e.target.checked
                                  ? [...new Set([...state.selected, s.id])]
                                  : state.selected.filter((v) => v !== s.id),
                                initialized: true,
                              })
                            }
                          />
                          <span>{display.description || display.name}</span>
                        </label>
                      );
                    })
                  ) : (
                    <div className="history-region-empty">
                      No recorded prices for this configuration
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="history-picker-empty" hidden={visibleGroups > 0}>
            No matching regions.
          </div>
          <div className="history-picker-notice">
            Different hardware configurations remain separate. Missing prices are never estimated.
          </div>
        </section>
      ) : null}
    </div>
  );
}
