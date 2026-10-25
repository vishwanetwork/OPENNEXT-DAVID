'use client';

import { useConsoleStore } from '../store';
import { matchesQuery } from '../helpers';
import { DATASET_LABELS, MODEL_SPECS } from '../reference-data';
import { Badge, Btn, Empty, SearchBox } from '../components/forms';
import { useConsoleDialogs } from '../dialogs/use-dialogs';
import type { DatasetId } from '../types';

export function ResourceView({
  search,
  setSearch,
}: {
  search: string;
  setSearch: (v: string) => void;
}) {
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
  const keys = imported.length ? Object.keys(imported[0] ?? {}) : [];
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
