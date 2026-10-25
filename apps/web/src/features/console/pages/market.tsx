'use client';

import type { FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { useConsoleStore, defaultMarketFilters } from '../store';
import { ConsoleIcon as Icon } from '@/components/icons';
import { money } from '../helpers';
import {
  DATASET_BY_LABEL,
  DATASET_LABELS,
  PROVIDERS,
  MODEL_SPECS,
  REGIONS,
} from '../reference-data';
import {
  Badge,
  Btn,
  Empty,
  Head,
  Note,
  SearchBox,
  SelectField,
  formValues,
} from '../components/forms';
import { useConsoleDialogs } from '../dialogs/use-dialogs';
import { usePageTools } from './use-page-tools';
import { filteredOffers } from './market-data';
import { useImportDialog } from './market-import';
import { ResourceView } from './market-resource-view';

export function MarketPage() {
  const db = useConsoleStore((s) => s.db);
  const f = useConsoleStore((s) => s.market);
  const pageNumber = useConsoleStore((s) => s.pageNumber);
  const lastRefresh = useConsoleStore((s) => s.lastRefresh);
  const setUi = useConsoleStore((s) => s.setUi);
  const toast = useToast();
  const dialogs = useConsoleDialogs();
  const { search, setSearch: setSearchRaw, exportRows } = usePageTools('market');
  const setSearch = (value: string) => {
    setSearchRaw(value);
    setUi({ pageNumber: 1 });
  };
  const openImport = useImportDialog((key) => {
    setUi({ market: { ...f, dataset: key } });
    setSearch('');
  });
  const base = filteredOffers(db, f, search);
  const actions = (
    <>
      <Btn className="btn-icon" onClick={() => exportRows(base)}>
        <Icon name="export" />
        Export
      </Btn>
      <Btn className="primary btn-icon" onClick={openImport}>
        <Icon name="upload" />
        Import records
      </Btn>
    </>
  );
  const head = (
    <Head
      title="Market intelligence"
      copy="Inspect normalized offers, historical prices and supplier capacity records."
      actions={actions}
    />
  );

  if (['providers', 'specs', 'inventory'].includes(f.dataset)) {
    return (
      <>
        {head}
        <ResourceView search={search} setSearch={setSearch} />
        <Note />
      </>
    );
  }
  const list =
    f.dataset === 'history'
      ? base.slice(0, 24).flatMap((x) =>
          Array.from({ length: 8 }, (_, i) => ({
            ...x,
            rate: +(x.rate * (0.94 + i * 0.009 + Math.sin(i + x.count) * 0.025)).toFixed(3),
            updated: `Oct ${String(5 + i).padStart(2, '0')}, 16:00`,
          })),
        )
      : base;
  const per = 10;
  const pagesN = Math.max(1, Math.ceil(list.length / per));
  const current = Math.min(pageNumber, pagesN);
  const sliced = list.slice((current - 1) * per, current * per);
  const clear = () => {
    setUi({ market: { ...defaultMarketFilters(), dataset: f.dataset }, pageNumber: 1 });
    setSearchRaw('');
  };
  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { get } = formValues(event.currentTarget);
    const min = get('min');
    const max = get('max');
    if (min && max && +min > +max) {
      toast('Minimum rate cannot exceed maximum rate.');
      return;
    }
    setUi({
      market: {
        dataset: DATASET_BY_LABEL[get('dataset')] ?? 'current',
        provider: get('provider'),
        model: get('model'),
        count: get('count'),
        region: get('region'),
        terms: get('terms'),
        availability: get('availability'),
        min,
        max,
        score: get('score'),
      },
      pageNumber: 1,
    });
    toast('Market filters applied.');
  };
  return (
    <>
      {head}
      <section className="panel">
        <div className="panel-head">
          <h2>Market filters</h2>
          <small className="muted">Structured source records</small>
        </div>
        <form
          id="market-filter-form"
          className="panel-body"
          onSubmit={apply}
          key={JSON.stringify(f)}
        >
          <div className="filters">
            <SelectField
              label="Dataset"
              name="dataset"
              items={Object.values(DATASET_LABELS)}
              defaultValue={DATASET_LABELS[f.dataset]}
            />
            <SelectField
              label="Provider"
              name="provider"
              items={['All providers', ...PROVIDERS]}
              defaultValue={f.provider}
            />
            <SelectField
              label="GPU model"
              name="model"
              items={['All models', ...MODEL_SPECS.map((x) => x[0])]}
              defaultValue={f.model}
            />
            <SelectField
              label="GPU count"
              name="count"
              items={['All counts', '1', '4', '8', '16', '32', '64']}
              defaultValue={f.count}
            />
            <SelectField
              label="Region"
              name="region"
              items={['All regions', ...REGIONS]}
              defaultValue={f.region}
            />
            <SelectField
              label="Market terms"
              name="terms"
              items={['All terms', 'Spot', 'On-demand', 'Reserved']}
              defaultValue={f.terms}
            />
            <SelectField
              label="Availability"
              name="availability"
              items={['All availability', 'Available', 'Scheduled']}
              defaultValue={f.availability}
            />
            <div className="field">
              <label>GPU-hour rate (USD)</label>
              <div className="range">
                <input
                  name="min"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Min"
                  defaultValue={f.min}
                />
                <span>–</span>
                <input
                  name="max"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Max"
                  defaultValue={f.max}
                />
              </div>
            </div>
            <SelectField
              label="Minimum placement score"
              name="score"
              items={['All scores', '5', '6', '7', '8', '9', '10']}
              defaultValue={f.score}
            />
          </div>
          <div className="filter-foot">
            <button className="primary" type="submit">
              Apply filters
            </button>
            <Btn onClick={clear}>Clear</Btn>
            <small>Last refreshed {lastRefresh}</small>
          </div>
        </form>
      </section>
      <section className="panel">
        <div className="table-toolbar">
          <div>
            <h2>{DATASET_LABELS[f.dataset]}</h2>
            <small className="muted">{list.length} matching records · USD / GPU-hour</small>
          </div>
          <SearchBox
            placeholder="Search GPU, provider or region…"
            value={search}
            onChange={setSearch}
          />
        </div>
        {sliced.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>GPU / provider</th>
                  <th>Region</th>
                  <th>GPUs</th>
                  <th>{f.dataset === 'history' ? 'Observed rate' : 'Rate / GPU-hr'}</th>
                  <th>Terms</th>
                  <th>Availability</th>
                  <th>Score</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sliced.map((x, i) => (
                  <tr key={`${x.id}-${i}`}>
                    <td>
                      <strong>{x.model}</strong>
                      <small>
                        {x.provider} · {x.memory} GB
                      </small>
                    </td>
                    <td>{x.region}</td>
                    <td>{x.count}</td>
                    <td>
                      <strong>{money(x.rate)}</strong>
                      <small>{f.dataset === 'history' ? 'Oct 11, 16:00' : x.updated}</small>
                    </td>
                    <td>
                      <Badge label={x.terms} tone={x.terms === 'Spot' ? 'purple' : 'blue'} />
                    </td>
                    <td>
                      <Badge
                        label={x.availability}
                        tone={x.availability === 'Available' ? 'green' : 'orange'}
                      />
                    </td>
                    <td>
                      {x.score}
                      <span className="muted"> / 10</span>
                    </td>
                    <td>
                      <Btn className="link small" onClick={() => dialogs.offerDetail(x.id)}>
                        Details
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No matching records"
            copy="Try another provider, GPU model or region."
            action={<Btn onClick={clear}>Clear filters</Btn>}
          />
        )}
        <div className="table-foot">
          <span>
            {list.length
              ? `${(current - 1) * per + 1}–${Math.min(current * per, list.length)} of ${list.length}`
              : '0 records'}
          </span>
          <div className="pagination">
            <Btn disabled={current <= 1} onClick={() => setUi({ pageNumber: current - 1 })}>
              Previous
            </Btn>
            <span style={{ padding: '4px 8px' }}>
              {current} / {pagesN}
            </span>
            <Btn disabled={current >= pagesN} onClick={() => setUi({ pageNumber: current + 1 })}>
              Next
            </Btn>
          </div>
        </div>
      </section>
      <Note />
    </>
  );
}
export { importOffers } from './market-data';
