'use client';

import { useConsoleStore } from '../store';
import { Icon } from '../icons';
import { matchesQuery } from '../helpers';
import { Btn, Empty, Head, Note, SearchBox, Status } from '../components/forms';
import { useConsoleDialogs } from '../dialogs/use-dialogs';
import { usePageTools } from './use-page-tools';

export function SchedulesPage() {
  const db = useConsoleStore((s) => s.db);
  const tab = useConsoleStore((s) => s.scheduleTab);
  const setUi = useConsoleStore((s) => s.setUi);
  const dialogs = useConsoleDialogs();
  const { search, setSearch, refresh } = usePageTools('schedules');
  const active = db.schedules.filter((x) => x.status === 'Active').length;
  const schedules = db.schedules.filter((x) => matchesQuery(x, search));
  const runs = db.runs.filter((x) => matchesQuery(x, search));
  const list = tab === 'schedules' ? schedules : runs;
  const sep = <span style={{ marginInline: 7, color: '#dae1eb' }}>|</span>;
  return (
    <>
      <Head
        title="Schedules"
        copy="Translate an instruction into a reviewable plan, enforce constraints and keep an execution record."
        actions={
          <>
            <Btn className="btn-icon" onClick={refresh}>
              <Icon name="refresh" />
              Refresh
            </Btn>
            <Btn className="primary btn-icon" onClick={() => dialogs.scheduleNew()}>
              <Icon name="plus" />
              Create schedule
            </Btn>
          </>
        }
      />
      <div className="schedule-summary">
        <div className="panel">
          <span className="muted small-text">Active schedules</span>
          <strong>{active}</strong>
        </div>
        <div className="panel">
          <span className="muted small-text">Successful evaluations</span>
          <strong>{db.runs.filter((x) => x.status === 'Completed').length}</strong>
        </div>
        <div className="panel">
          <span className="muted small-text">Execution scope</span>
          <strong style={{ fontSize: 16, marginTop: 10 }}>Read-only</strong>
        </div>
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <div className="tabs">
            <Btn
              className={tab === 'schedules' ? 'active' : ''}
              onClick={() => {
                setUi({ scheduleTab: 'schedules' });
                setSearch('');
              }}
            >
              Schedules
            </Btn>
            <Btn
              className={tab === 'runs' ? 'active' : ''}
              onClick={() => {
                setUi({ scheduleTab: 'runs' });
                setSearch('');
              }}
            >
              Run history
            </Btn>
          </div>
          <SearchBox
            placeholder={tab === 'runs' ? 'Search execution runs…' : 'Search schedules…'}
            value={search}
            onChange={setSearch}
          />
        </div>
        {list.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {tab === 'schedules' ? (
                    <>
                      <th>Schedule</th>
                      <th>Status</th>
                      <th>Frequency</th>
                      <th>Last evaluation</th>
                      <th>Runs</th>
                      <th></th>
                    </>
                  ) : (
                    <>
                      <th>Execution</th>
                      <th>Status</th>
                      <th>Trigger</th>
                      <th>Started</th>
                      <th>Duration</th>
                      <th>Records</th>
                      <th></th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {tab === 'schedules'
                  ? schedules.map((x) => (
                      <tr key={x.id}>
                        <td>
                          <strong>{x.name}</strong>
                          <small>
                            {x.id} · {x.provider}
                          </small>
                        </td>
                        <td>
                          <Status label={x.status} />
                        </td>
                        <td>Every {x.interval} minutes</td>
                        <td>{x.last}</td>
                        <td>{x.runs}</td>
                        <td style={{ textAlign: 'right' }}>
                          <Btn className="link small" onClick={() => dialogs.scheduleDetail(x.id)}>
                            View plan
                          </Btn>
                          {sep}
                          <Btn className="link small" onClick={() => dialogs.scheduleToggle(x.id)}>
                            {x.status === 'Active'
                              ? 'Pause'
                              : x.status === 'Paused'
                                ? 'Resume'
                                : 'Activate'}
                          </Btn>
                          {sep}
                          <Btn
                            className="link small"
                            disabled={x.status === 'Draft'}
                            onClick={() => dialogs.scheduleRun(x.id)}
                          >
                            Run now
                          </Btn>
                        </td>
                      </tr>
                    ))
                  : runs.map((x) => (
                      <tr key={x.id}>
                        <td>
                          <strong>{x.name}</strong>
                          <small>{x.id}</small>
                        </td>
                        <td>
                          <Status label={x.status} />
                        </td>
                        <td>{x.trigger}</td>
                        <td>{x.time}</td>
                        <td>{x.duration}</td>
                        <td>{x.records}</td>
                        <td>
                          <Btn className="link small" onClick={() => dialogs.runLog(x.id)}>
                            View log
                          </Btn>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No matching schedules"
            copy="Create a plan or try another search."
            action={<Btn onClick={() => dialogs.scheduleNew()}>Create schedule</Btn>}
          />
        )}
      </section>
      <Note />
    </>
  );
}
