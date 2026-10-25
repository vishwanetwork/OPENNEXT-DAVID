'use client';

import { useEffect } from 'react';
import { useConsoleStore } from '../store';
import { Icon } from '../icons';
import { matchesQuery } from '../helpers';
import { Badge, Btn, Empty, Head, Note, SearchBox, Status } from '../components/forms';
import { useConsoleDialogs } from '../dialogs/use-dialogs';
import { consumePendingDetail, registerDetailOpener } from '../components/shell';
import { usePageTools } from './use-page-tools';

export function UsersPage() {
  const db = useConsoleStore((s) => s.db);
  const tab = useConsoleStore((s) => s.userTab);
  const setUi = useConsoleStore((s) => s.setUi);
  const dialogs = useConsoleDialogs();
  const { search, setSearch, exportRows } = usePageTools('users');
  useEffect(() => {
    const open = (id: string) => dialogs.userDetail(id);
    const unregister = registerDetailOpener('user', open);
    const pending = consumePendingDetail('user');
    if (pending) open(pending);
    return unregister;
  }, [dialogs]);
  const list = db.users.filter(
    (x) =>
      (tab === 'All accounts' ||
        (tab === 'Supplier review' && ['Seller', 'Broker'].includes(x.role)) ||
        (tab === 'Team' && ['Administrator', 'Operations', 'Analyst'].includes(x.role))) &&
      matchesQuery(x, search),
  );
  return (
    <>
      <Head
        title="User & supplier access"
        copy="Manage roles, company verification and the right to supply capacity."
        actions={
          <>
            <Btn
              className="btn-icon"
              onClick={() => exportRows(db.users.map(({ review, ...x }) => ({ ...x, ...review })))}
            >
              <Icon name="export" />
              Export
            </Btn>
            <Btn className="primary btn-icon" onClick={dialogs.invite}>
              <Icon name="plus" />
              Invite account
            </Btn>
          </>
        }
      />
      <section className="panel">
        <div className="table-toolbar">
          <div className="tabs">
            {['All accounts', 'Supplier review', 'Team'].map((t) => (
              <Btn
                key={t}
                className={tab === t ? 'active' : ''}
                onClick={() => {
                  setUi({ userTab: t });
                  setSearch('');
                }}
              >
                {t}
              </Btn>
            ))}
          </div>
          <SearchBox
            placeholder="Search name, company or email…"
            value={search}
            onChange={setSearch}
          />
        </div>
        {list.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Company</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Verification</th>
                  <th>Joined</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <strong>{x.name}</strong>
                      <small>{x.email}</small>
                    </td>
                    <td>{x.company}</td>
                    <td>
                      <Badge
                        label={x.role}
                        tone={['Seller', 'Broker'].includes(x.role) ? 'purple' : 'blue'}
                      />
                    </td>
                    <td>
                      <Status label={x.status} />
                    </td>
                    <td>
                      {['Seller', 'Broker'].includes(x.role)
                        ? `${Object.values(x.review).filter((v) => v === 'Approved').length} / 4 complete`
                        : 'Account verified'}
                    </td>
                    <td>{x.joined}</td>
                    <td>
                      <Btn className="link small" onClick={() => dialogs.userDetail(x.id)}>
                        Manage
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No accounts found"
            copy="Try a different company name or invite an account."
            action={<Btn onClick={dialogs.invite}>Invite account</Btn>}
          />
        )}
      </section>
      <div className="callout">
        Supplier onboarding checks eligibility, KYB and delivery rights once. Every new capacity
        allocation requires a separate technical test and approval. Technical verification does not
        imply upstream resale authorization.
      </div>
      <Note />
    </>
  );
}
