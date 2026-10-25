'use client';

import type { FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { useConsoleStore, defaultMarketFilters } from '../store';
import { Icon } from '../icons';
import { money, matchesQuery, stamp, parseCsv } from '../helpers';
import {
  DATASET_BY_LABEL,
  DATASET_LABELS,
  MODEL_SPECS,
  PROVIDERS,
  REGIONS,
} from '../reference-data';
import {
  Badge,
  Btn,
  Callout,
  Empty,
  Head,
  Note,
  SearchBox,
  SelectField,
  formValues,
} from '../components/forms';
import { useConsoleDialogs } from '../dialogs/use-dialogs';
import { useOverlay } from '../components/overlay';
import { usePageTools } from './use-page-tools';
import type { ConsoleDb, DatasetId, MarketFilters, Offer } from '../types';

export function filteredOffers(db: ConsoleDb, f: MarketFilters, search: string): Offer[] {
  const q = search.toLowerCase();
  return db.offers.filter(
    (x) =>
      (f.provider === 'All providers' || x.provider === f.provider) &&
      (f.model === 'All models' || x.model === f.model) &&
      (f.count === 'All counts' || String(x.count) === f.count) &&
      (f.region === 'All regions' || x.region === f.region) &&
      (f.terms === 'All terms' || x.terms === f.terms) &&
      (f.availability === 'All availability' || x.availability === f.availability) &&
      (f.min === '' || x.rate >= Number(f.min)) &&
      (f.max === '' || x.rate <= Number(f.max)) &&
      (f.score === 'All scores' || x.score >= Number(f.score)) &&
      matchesQuery(x, q),
  );
}

/** CSV import exactly as the legacy console validated it. Returns the accepted/skipped counts. */
export function importOffers(
  db: ConsoleDb,
  key: DatasetId,
  text: string,
): { added: number; skipped: number } | { error: string } {
  const parsed = parseCsv(text);
  if (!parsed) return { error: 'Upload or paste CSV records first.' };
  const { headers, lines } = parsed;
  if (lines.length === 0) return { error: 'The CSV needs at least one data row.' };
  let added = 0;
  let skipped = 0;
  if (key === 'current') {
    if (
      !['provider', 'model', 'count', 'region', 'terms', 'rate'].every((k) => headers.includes(k))
    )
      return { error: 'CSV headers must include provider, model, count, region, terms and rate.' };
    for (const line of lines) {
      const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
      const x = Object.fromEntries(headers.map((h, i) => [h, vals[i]]));
      if (!x.provider || !x.model || !x.region || !(+x.rate > 0) || !(+x.count > 0)) {
        skipped++;
        continue;
      }
      db.offers.unshift({
        id: `OFR-${Date.now().toString().slice(-6)}-${added}`,
        provider: x.provider,
        model: x.model,
        memory: MODEL_SPECS.find((s) => s[0] === x.model)?.[1] || 80,
        count: +x.count,
        region: x.region,
        terms: x.terms,
        rate: +x.rate,
        score: 8,
        availability: 'Available',
        source: 'Operator CSV import',
        updated: stamp(),
        record: 'Current offer',
      });
      added++;
    }
  } else {
    added = lines.filter((l) => l.split(',').length === headers.length).length;
    skipped = lines.length - added;
  }
  db.datasets.find((x) => x.id === key)!.count += added;
  return { added, skipped };
}

function ImportDialogBody() {
  return (
    <form id="import-form">
      <div className="form-grid">
        <SelectField
          label="Dataset"
          name="dataset"
          items={Object.values(DATASET_LABELS)}
          defaultValue="Current offers"
          className="full"
        />
        <div className="field full">
          <label htmlFor="csv-file">Upload CSV</label>
          <input
            type="file"
            id="csv-file"
            name="file"
            accept=".csv,text/csv"
            style={{ padding: 7, height: 'auto' }}
          />
          <div className="hint">Or paste records below. Uploading stays in this browser.</div>
        </div>
        <div className="field full">
          <label htmlFor="csv">CSV records</label>
          <textarea
            name="csv"
            id="csv"
            className="mono"
            style={{ height: 150 }}
            placeholder={
              'provider,model,count,region,terms,rate\nNebius,H100 SXM,8,US East,Spot,2.63'
            }
          />
        </div>
      </div>
      <Callout style={{ marginTop: 18 }}>
        Current offers require provider, model, count, region, terms and rate. Invalid rows are
        skipped; all imports are recorded in the audit log.
      </Callout>
    </form>
  );
}

function useImportDialog(onImported: (key: DatasetId) => void) {
  const overlay = useOverlay();
  const toast = useToast();
  return () => {
    const submit = async () => {
      const form = document.getElementById('import-form') as HTMLFormElement | null;
      if (!form) return;
      const f = new FormData(form);
      let text = String(f.get('csv') || '').trim();
      const file = f.get('file');
      if (!text && file instanceof File && file.size) text = await file.text();
      if (!text) {
        toast('Upload or paste CSV records first.');
        return;
      }
      const dataset = String(f.get('dataset'));
      const key = DATASET_BY_LABEL[dataset];
      let result: ReturnType<typeof importOffers> = { error: '' };
      useConsoleStore.getState().mutate((db) => {
        result = importOffers(db, key, text);
      });
      if ('error' in result) {
        toast(result.error);
        return;
      }
      const { added, skipped } = result;
      useConsoleStore
        .getState()
        .record(
          'Market records imported',
          dataset,
          `${added} accepted; ${skipped} invalid rows skipped.`,
        );
      overlay.close();
      onImported(key);
      toast(`${added} records imported${skipped ? `; ${skipped} skipped` : ''}.`);
    };
    overlay.modal({
      title: 'Import market records',
      subtitle: 'Normalize a CSV dataset for market analysis.',
      wide: true,
      body: <ImportDialogBody />,
      footer: (
        <>
          <Btn onClick={overlay.close}>Cancel</Btn>
          <Btn
            onClick={() => {
              const el = document.getElementById('csv') as HTMLTextAreaElement | null;
              if (el)
                el.value =
                  'provider,model,count,region,terms,rate\nNebius,H100 SXM,8,US East,Spot,2.63\nVultr,B200,8,Singapore,On-demand,4.96\nLambda,H200,16,US West,Reserved,3.48';
            }}
          >
            Load example
          </Btn>
          <Btn className="primary" onClick={() => void submit()}>
            Validate &amp; import
          </Btn>
        </>
      ),
    });
  };
}

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
        dataset: DATASET_BY_LABEL[get('dataset')],
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

function ResourceView({ search, setSearch }: { search: string; setSearch: (v: string) => void }) {
  const db = useConsoleStore((s) => s.db);
  const f = useConsoleStore((s) => s.market);
  const lastRefresh = useConsoleStore((s) => s.lastRefresh);
  const setUi = useConsoleStore((s) => s.setUi);
  const dialogs = useConsoleDialogs();
  const kind = f.dataset;
  const q = search.toLowerCase();
  const isSpec = kind === 'specs';
  const isInventory = kind === 'inventory';
  const specs = MODEL_SPECS.map(([model, memory, rate], i) => ({
    id: String(i),
    model,
    memory,
    rate,
    vendor: model.startsWith('MI') ? 'AMD' : 'NVIDIA',
    form: model.startsWith('RTX')
      ? 'PCIe workstation'
      : model.startsWith('GB')
        ? 'Rack scale'
        : 'Data center',
    use:
      memory >= 140
        ? 'Large-model training / inference'
        : memory >= 48
          ? 'Training / inference'
          : 'Rendering / smaller models',
  }));
  const specList = specs.filter((x) => matchesQuery(x, q));
  const offerList = db.offers.slice(0, isInventory ? 32 : 12).filter((x) => matchesQuery(x, q));
  const count = isSpec ? specList.length : offerList.length;
  const imported = db.imported?.[kind] || [];
  const keys = imported.length ? Object.keys(imported[0]) : [];
  return (
    <>
      <section className="panel">
        <div className="table-toolbar">
          <div className="tabs">
            {db.datasets.map((x) => (
              <Btn
                key={x.id}
                className={x.id === kind ? 'active' : ''}
                onClick={() => {
                  setUi({ market: { ...f, dataset: x.id as DatasetId } });
                  setSearch('');
                }}
              >
                {x.name}
              </Btn>
            ))}
          </div>
        </div>
        <div className="table-toolbar">
          <div>
            <h2>{DATASET_LABELS[kind]}</h2>
            <small className="muted">{count} matching reference records</small>
          </div>
          <SearchBox
            placeholder="Search GPU, provider or specification…"
            value={search}
            onChange={setSearch}
          />
        </div>
        {count ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {isSpec ? (
                    <>
                      <th>GPU model</th>
                      <th>Manufacturer</th>
                      <th>Memory</th>
                      <th>Form factor</th>
                      <th>Typical workload</th>
                      <th></th>
                    </>
                  ) : isInventory ? (
                    <>
                      <th>GPU / owner</th>
                      <th>Region</th>
                      <th>GPU count</th>
                      <th>Availability</th>
                      <th>Observed</th>
                      <th></th>
                    </>
                  ) : (
                    <>
                      <th>Provider / product</th>
                      <th>GPU model</th>
                      <th>Memory / GPU</th>
                      <th>Allocation size</th>
                      <th>Region</th>
                      <th></th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {isSpec
                  ? specList.map((x) => (
                      <tr key={x.id}>
                        <td>
                          <strong>{x.model}</strong>
                          <small>Specification reference</small>
                        </td>
                        <td>{x.vendor}</td>
                        <td>{x.memory} GB</td>
                        <td>{x.form}</td>
                        <td>{x.use}</td>
                        <td>
                          <Btn
                            className="link small"
                            onClick={() => dialogs.specDetail(Number(x.id))}
                          >
                            Inspect
                          </Btn>
                        </td>
                      </tr>
                    ))
                  : isInventory
                    ? offerList.map((x) => (
                        <tr key={x.id}>
                          <td>
                            <strong>{x.model}</strong>
                            <small>
                              {x.provider} · {x.id}
                            </small>
                          </td>
                          <td>{x.region}</td>
                          <td>{x.count}</td>
                          <td>
                            <Badge
                              label={x.availability}
                              tone={x.availability === 'Available' ? 'green' : 'orange'}
                            />
                          </td>
                          <td>{x.updated}</td>
                          <td>
                            <Btn className="link small" onClick={() => dialogs.offerDetail(x.id)}>
                              Inspect
                            </Btn>
                          </td>
                        </tr>
                      ))
                    : offerList.map((x) => (
                        <tr key={x.id}>
                          <td>
                            <strong>{x.provider}</strong>
                            <small>
                              {x.provider.toLowerCase()}-
                              {x.model.toLowerCase().replaceAll(' ', '-')}-{x.count}
                            </small>
                          </td>
                          <td>{x.model}</td>
                          <td>{x.memory} GB</td>
                          <td>{x.count} GPUs</td>
                          <td>{x.region}</td>
                          <td>
                            <Btn className="link small" onClick={() => dialogs.offerDetail(x.id)}>
                              Inspect
                            </Btn>
                          </td>
                        </tr>
                      ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No matching reference records" copy="Try another GPU model or provider." />
        )}
        <div className="table-foot">
          <span>Showing {count} records</span>
          <span>Last refreshed {lastRefresh}</span>
        </div>
      </section>
      {imported.length ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Additional imported records</h2>
            <Badge label={`${imported.length} rows`} tone="blue" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {keys.map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {imported.map((r, i) => (
                  <tr key={i}>
                    {keys.map((k) => (
                      <td key={k}>{r[k]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
