'use client';

import { useConsoleStore } from '../store';
import { ConsoleIcon as Icon } from '@/components/icons';
import { matchesQuery } from '../helpers';
import { Badge, Btn, Empty, Head, Note, SearchBox, Status } from '../components/forms';
import { useConsoleDialogs } from '../dialogs/use-dialogs';
import { usePageTools } from './use-page-tools';

export function AdvisoryPage() {
  const db = useConsoleStore((s) => s.db);
  const dialogs = useConsoleDialogs();
  const { search, setSearch, refresh } = usePageTools('advisory');
  const list = db.advisory.filter((x) => matchesQuery(x, search));
  return (
    <>
      <Head
        title="Advisory"
        copy="Human-reviewed recommendations from market, supplier and delivery signals."
        actions={
          <Btn className="btn-icon" onClick={refresh}>
            <Icon name="refresh" />
            Refresh
          </Btn>
        }
      />
      <section className="panel">
        <div className="table-toolbar">
          <div>
            <h2>Recommendations</h2>
            <small className="muted">Evidence first. Approval before execution.</small>
          </div>
          <SearchBox placeholder="Search recommendations…" value={search} onChange={setSearch} />
        </div>
      </section>
      <div className="card-grid">
        {list.length ? (
          list.map((x) => (
            <article className="advisory-card" key={x.id}>
              <Badge label={x.type} tone={x.type === 'Supplier review' ? 'orange' : 'blue'} />
              <h2>{x.title}</h2>
              <p>{x.desc}</p>
              <div className="advisory-metrics">
                <div>
                  <small>{x.savings ? 'Potential saving' : 'Confidence'}</small>
                  <strong>{x.savings || x.confidence}%</strong>
                </div>
                <div>
                  <small>Evidence records</small>
                  <strong>{x.records}</strong>
                </div>
                <div>
                  <small>Status</small>
                  <strong style={{ fontSize: 12, marginTop: 5 }}>
                    <Status label={x.status} />
                  </strong>
                </div>
              </div>
              <Btn onClick={() => dialogs.adviceDetail(x.id)}>Review recommendation</Btn>
            </article>
          ))
        ) : (
          <Empty title="No recommendations found" copy="Try another search." />
        )}
      </div>
      <Note />
    </>
  );
}
