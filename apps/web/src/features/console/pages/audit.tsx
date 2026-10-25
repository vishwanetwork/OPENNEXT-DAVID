'use client';

import { useConsoleStore } from '../store';
import { ConsoleIcon as Icon } from '@/components/icons';
import { matchesQuery } from '../helpers';
import { Btn, Empty, Head, Note, SearchBox } from '../components/forms';
import { usePageTools } from './use-page-tools';

export function AuditPage() {
  const db = useConsoleStore((s) => s.db);
  const { search, setSearch, refresh, exportRows } = usePageTools('audit');
  const list = db.audit.filter((x) => matchesQuery(x, search));
  return (
    <>
      <Head
        title="Audit log"
        copy="A record of operator decisions, configuration changes and local evaluations."
        actions={
          <>
            <Btn className="btn-icon" onClick={() => exportRows(db.audit)}>
              <Icon name="export" />
              Export
            </Btn>
            <Btn className="btn-icon" onClick={refresh}>
              <Icon name="refresh" />
              Refresh
            </Btn>
          </>
        }
      />
      <section className="panel">
        <div className="table-toolbar">
          <div>
            <h2>Workspace activity</h2>
            <small className="muted">{db.audit.length} retained events</small>
          </div>
          <SearchBox
            placeholder="Search actor, action or reference…"
            value={search}
            onChange={setSearch}
          />
        </div>
        {list.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Reference</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {list.map((x, i) => (
                  <tr key={i}>
                    <td>{x.time}</td>
                    <td>{x.actor}</td>
                    <td>
                      <strong>{x.action}</strong>
                    </td>
                    <td className="mono">{x.target}</td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 350, color: '#7c899d' }}>
                      {x.detail || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No matching events" copy="Try another reference or actor." />
        )}
      </section>
      <Note />
    </>
  );
}
