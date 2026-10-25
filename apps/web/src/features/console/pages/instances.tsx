'use client';

import { useEffect } from 'react';
import { useConsoleStore } from '../store';
import { Icon } from '../icons';
import { matchesQuery } from '../helpers';
import { Btn, Empty, Head, Note, SearchBox, Status } from '../components/forms';
import { useConsoleDialogs } from '../dialogs/use-dialogs';
import { consumePendingDetail, registerDetailOpener, useConsoleNav } from '../components/shell';
import { usePageTools } from './use-page-tools';

export function InstancesPage() {
  const db = useConsoleStore((s) => s.db);
  const tab = useConsoleStore((s) => s.instanceTab);
  const setUi = useConsoleStore((s) => s.setUi);
  const dialogs = useConsoleDialogs();
  const nav = useConsoleNav();
  const { search, setSearch, refresh } = usePageTools('instances');
  useEffect(() => {
    const open = (id: string) => dialogs.instanceDetail(id);
    const unregister = registerDetailOpener('instance', open);
    const pending = consumePendingDetail('instance');
    if (pending) open(pending);
    return unregister;
  }, [dialogs]);
  const list = db.instances.filter(
    (x) => (tab === 'All instances' || x.source === tab) && matchesQuery(x, search),
  );
  return (
    <>
      <Head
        title="Instances"
        copy="Verify seller access, host identity and hardware evidence before delivery."
        actions={
          <>
            <Btn className="btn-icon" onClick={refresh}>
              <Icon name="refresh" />
              Refresh
            </Btn>
            <Btn className="primary btn-icon" onClick={dialogs.instanceNew}>
              <Icon name="plus" />
              Register instance
            </Btn>
          </>
        }
      />
      <section className="panel">
        <div className="table-toolbar">
          <div className="tabs">
            {['All instances', 'Platform supplied', 'Seller supplied'].map((t) => (
              <Btn
                key={t}
                className={tab === t ? 'active' : ''}
                onClick={() => {
                  setUi({ instanceTab: t });
                  setSearch('');
                }}
              >
                {t}
              </Btn>
            ))}
          </div>
          <SearchBox placeholder="Search instance or owner…" value={search} onChange={setSearch} />
        </div>
        {list.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Instance</th>
                  <th>Hardware</th>
                  <th>Owner / source</th>
                  <th>Region</th>
                  <th>Verification</th>
                  <th>Last verified</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <strong>{x.name}</strong>
                      <small>{x.id}</small>
                    </td>
                    <td>
                      {x.count} × {x.model}
                    </td>
                    <td>
                      <strong>{x.owner}</strong>
                      <small>{x.source}</small>
                    </td>
                    <td>{x.region}</td>
                    <td>
                      <Status label={x.status} />
                    </td>
                    <td>{x.verified}</td>
                    <td>
                      <Btn className="link small" onClick={() => dialogs.instanceDetail(x.id)}>
                        {x.status === 'Verified' ? 'Inspect' : 'Verify access'}
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No instances in this view"
            copy="Register a supplier allocation when delivery details are available."
            action={<Btn onClick={dialogs.instanceNew}>Register instance</Btn>}
          />
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Delivery verification policy</h2>
          <Btn className="link small" onClick={() => nav('agent')}>
            Manage policy
          </Btn>
        </div>
        <div className="panel-body">
          <div className="metric-list">
            <div className="metric-tile">
              <small>Host identity</small>
              <strong style={{ fontSize: 12 }}>
                {db.config.pinHost ? 'Fingerprint required' : 'Operator review'}
              </strong>
            </div>
            <div className="metric-tile">
              <small>Hardware proof</small>
              <strong style={{ fontSize: 12 }}>
                {db.config.requireGPU ? 'nvidia-smi required' : 'Optional evidence'}
              </strong>
            </div>
            <div className="metric-tile">
              <small>Execution mode</small>
              <strong style={{ fontSize: 12 }}>Read-only evaluation</strong>
            </div>
          </div>
        </div>
      </section>
      <Note />
    </>
  );
}
