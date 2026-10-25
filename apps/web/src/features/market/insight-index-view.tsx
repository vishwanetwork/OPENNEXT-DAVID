'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useApi } from '@/components/providers/api-context';
import { useSessionStore } from '@/lib/session-store';
import { marketApi } from './api';
import { PRICE_METRICS, type PriceMetric } from './catalog';
import { marketKeys, useHistoryCatalog, useRegions } from './hooks';
import { insightSessionFor, useInsightSessions } from './insight-sessions';
import {
  availableModels,
  buildCatalog,
  emptyInsightCatalog,
  emptyReason,
  filterData,
  INSIGHT_METRICS,
  INSIGHT_PERIODS,
  INSIGHT_TERMS,
  optionsCopy,
  requestQuery,
  scopeText,
  type InsightOptions,
} from './insight-index';
import { RegionalHistoryChart } from './regional-history-chart';

export interface InsightIndexProps {
  /** Shared Market Insight options: range (24H/3D/7D/1M), term (Spot/On-demand/Reserved/All) and selected filters. */
  options?: Parameters<typeof optionsCopy>[0];
  role?: string;
}

/** Historical GPU price index panel (`.onx-sa-index`) used on the seller Market Insight page. */
export function InsightIndex({ options: input = {}, role = 'Seller' }: InsightIndexProps) {
  const api = useApi();
  const user = useSessionStore((s) => s.user);
  // One options object per serialized input so query keys and memoised filters do not churn.
  const serialized = JSON.stringify(input);
  const options = useMemo<InsightOptions>(
    () => optionsCopy(JSON.parse(serialized) as Parameters<typeof optionsCopy>[0]),
    [serialized],
  );
  const key = String(user?.id || user?.email || 'local') + ':' + role;
  const stored = useInsightSessions((s) => s.map[key]);
  const updateSession = useInsightSessions((s) => s.update);
  const update = (patch: Parameters<typeof updateSession>[1]) => updateSession(key, patch);
  const remembered = insightSessionFor(useInsightSessions.getState().map, key);
  void stored;

  const regions = useRegions();
  const catalogQuery = useHistoryCatalog();
  const rawQuery = useQuery({
    queryKey: marketKeys.imported('period=1D&unit=gpu'),
    queryFn: () => marketApi.importedHistory(api, 'period=1D&unit=gpu'),
    staleTime: 300_000,
    retry: false,
  });
  const catalog = useMemo(() => {
    const built = buildCatalog(catalogQuery.data, rawQuery.data);
    return {
      ...emptyInsightCatalog(),
      ...built,
      loaded: Boolean(catalogQuery.data || rawQuery.data),
    };
  }, [catalogQuery.data, rawQuery.data]);
  const models = availableModels(options, catalog.models);
  const session = models.includes(remembered.model)
    ? remembered
    : { ...remembered, model: models.includes('H100') ? 'H100' : models[0] || 'H100' };
  const term = options.term === 'All' ? session.term : options.term;
  const query = requestQuery(options, session.model, term, catalog.models);
  const history = useQuery({
    queryKey: marketKeys.regional(query),
    queryFn: () => marketApi.regionalHistory(api, query),
    enabled: Boolean(options.range),
    staleTime: 300_000,
    retry: false,
  });
  const filtered = history.data
    ? filterData(history.data, options, session.model, term, catalog)
    : null;

  const chart = () => {
    if (!options.range)
      return empty(
        'Use the shared time-range control',
        'This index does not unlock older history separately.',
      );
    if (history.isError)
      return empty(
        'Regional history is temporarily unavailable',
        'Please try again shortly. No replacement prices have been generated.',
      );
    if (!filtered)
      return empty(
        'Loading recorded prices…',
        'Price observations retain their original dates. Missing data is never estimated.',
      );
    if (!filtered.data.series.length)
      return empty(
        'No matching historical prices',
        emptyReason(filtered.unknown) + ' Adjust the filters to compare available records.',
      );
    const privateState = {
      model: session.model,
      count: 'market-insight',
      region: 'insight:' + JSON.stringify(options.selected),
      term,
      period: INSIGHT_PERIODS[options.range],
      priceMetrics: session.metrics.slice(),
      priceMetric: session.metrics.includes('avg') ? ('avg' as const) : session.metrics[0],
    };
    return <RegionalHistoryChart selection={privateState} data={filtered.data} regions={regions} />;
  };

  return (
    <section
      className="onx-sa-panel onx-sa-index"
      data-sa-index
      aria-label="Historical GPU price index"
    >
      <header className="onx-sa-panel-head">
        <div>
          <h2>
            Index <span data-insight-focus>{session.model}</span>
          </h2>
          <p>
            Recorded regional prices · USD / GPU-hour · <span data-insight-term-label>{term}</span>
          </p>
        </div>
      </header>
      <div data-insight-controls>
        <div className="onx-sa-index-controls">
          <label>
            Index model
            <select
              data-insight-model
              aria-label="Index GPU model"
              value={session.model}
              onChange={(e) => {
                if (models.includes(e.target.value)) update({ model: e.target.value });
              }}
            >
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          {options.term === 'All' ? (
            <label>
              Index term
              <select
                data-insight-term
                aria-label="Index market term"
                value={term}
                onChange={(e) => {
                  if ((INSIGHT_TERMS as readonly string[]).includes(e.target.value))
                    update({ term: e.target.value });
                }}
              >
                {INSIGHT_TERMS.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          ) : (
            <span className="onx-sa-index-term">{term}</span>
          )}
          <div className="onx-sa-index-metrics" role="group" aria-label="Price metrics">
            {(Object.keys(INSIGHT_METRICS) as PriceMetric[]).map((metric) => (
              <button
                key={metric}
                type="button"
                data-insight-metric={metric}
                aria-pressed={session.metrics.includes(metric)}
                onClick={() => {
                  if (session.metrics.includes(metric)) {
                    if (session.metrics.length === 1) return;
                    update({ metrics: session.metrics.filter((value) => value !== metric) });
                  } else
                    update({
                      metrics: PRICE_METRICS.filter(
                        (value) => value === metric || session.metrics.includes(value),
                      ),
                    });
                }}
              >
                {INSIGHT_METRICS[metric]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="onx-sa-index-chart imported-history" data-insight-chart>
        {chart()}
      </div>
      <p className="onx-sa-index-scope" data-insight-scope>
        {scopeText(options)}
      </p>
    </section>
  );
}

function empty(title: string, message: string) {
  return (
    <div className="aws-history-empty">
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}
