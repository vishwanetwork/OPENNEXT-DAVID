'use client';

import { useConsoleStore } from '../store';
import { ConsoleIcon as Icon } from '@/components/icons';
import { number } from '../helpers';
import { Badge, Btn, Empty, Note } from '../components/forms';
import { useConsoleDialogs } from '../dialogs/use-dialogs';
import { useConsoleNav } from '../components/shell';
import { usePageTools } from './use-page-tools';
import type { DatasetId } from '../types';

export function OverviewPage() {
  const db = useConsoleStore((s) => s.db);
  const setUi = useConsoleStore((s) => s.setUi);
  const market = useConsoleStore((s) => s.market);
  const dialogs = useConsoleDialogs();
  const nav = useConsoleNav();
  const { refresh } = usePageTools('overview');
  const pending = db.users.filter((x) => x.status === 'In review').length;
  const tasks: [string, string, string, string, () => void][] = [
    ...db.users
      .filter((x) => x.status === 'In review')
      .map((x): [string, string, string, string, () => void] => [
        'shield',
        'Complete supplier review',
        `${x.company} · ${Object.values(x.review).filter((v) => v === 'Approved').length} of 4 checks complete`,
        'Review',
        () => dialogs.userDetail(x.id),
      ]),
    ...db.instances
      .filter((x) => x.status === 'Pending')
      .map((x): [string, string, string, string, () => void] => [
        'instances',
        'Verify delivery access',
        `${x.name} · ${x.count} ${x.model} · ${x.region}`,
        'Verify',
        () => dialogs.instanceDetail(x.id),
      ]),
    ...db.orders
      .filter((x) => x.stage === 1)
      .map((x): [string, string, string, string, () => void] => [
        'orders',
        'Confirm funding reference',
        `${x.buyer} · ${x.id} · ${x.period}`,
        'Open order',
        () => dialogs.orderDetail(x.id),
      ]),
  ];
  const stats: [string, number, string, string, string][] = [
    ['Accounts', db.users.length, '+2', 'joined this month', 'users'],
    ['Access inquiries', pending, String(pending), 'awaiting review', 'shield'],
    [
      'Imported records',
      db.datasets.reduce((a, x) => a + x.count, 0),
      '5',
      'normalized datasets',
      'database',
    ],
    [
      'Active schedules',
      db.schedules.filter((x) => x.status === 'Active').length,
      '100%',
      'approval gates enabled',
      'schedules',
    ],
  ];
  return (
    <>
      <div className="welcome">
        <div>
          <div className="eyebrow">YOUR OPERATIONS, AT A GLANCE</div>
          <h1>Welcome back, {db.profile.name.split(' ')[0]}.</h1>
          <p>
            Monitor market intelligence, delivery readiness and the work that needs a human
            decision.
          </p>
        </div>
        <Btn className="btn-icon" onClick={refresh}>
          <Icon name="refresh" />
          Refresh overview
        </Btn>
      </div>
      <div className="stats">
        {stats.map(([l, v, u, f, i]) => (
          <div className="stat" key={l}>
            <div className="stat-label">
              {l}
              <Icon name={i} />
            </div>
            <div className="stat-value">{number(v)}</div>
            <div className="stat-foot">
              <span className="up">{u}</span>
              {f}
            </div>
          </div>
        ))}
      </div>
      <div className="dataset-grid">
        {db.datasets.map((x, i) => (
          <button
            key={x.id}
            type="button"
            className={`dataset ${i === 0 ? 'active' : ''}`}
            onClick={() => {
              setUi({ market: { ...market, dataset: x.id as DatasetId } });
              nav('market');
            }}
          >
            <span className="eyebrow">{x.name}</span>
            <strong>{number(x.count)}</strong>
            <small>{x.file}</small>
          </button>
        ))}
      </div>
      <div className="grid-two">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Needs your attention</h2>
              <p>Prioritized work across procurement and supply.</p>
            </div>
            <Badge label={`${tasks.length} items`} tone="blue" />
          </div>
          <div className="panel-body">
            {tasks.length ? (
              tasks.slice(0, 5).map(([ic, title, copy, label, open], i) => (
                <div className="queue-row" key={i}>
                  <span className="activity-icon">
                    <Icon name={ic} />
                  </span>
                  <div>
                    <strong>{title}</strong>
                    <p>{copy}</p>
                  </div>
                  <Btn className="small" onClick={open}>
                    {label}
                  </Btn>
                </div>
              ))
            ) : (
              <Empty
                title="All caught up"
                copy="Supplier, delivery and funding reviews are complete."
              />
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Agent execution health</h2>
              <p>Validation and evaluation runs.</p>
            </div>
            <Badge label="Within policy" tone="green" />
          </div>
          <div className="panel-body">
            <div className="metric-list">
              <div className="metric-tile">
                <small>Completed runs</small>
                <strong>{db.runs.length}</strong>
              </div>
              <div className="metric-tile">
                <small>Policy breaches</small>
                <strong>0</strong>
              </div>
              <div className="metric-tile">
                <small>Pending approvals</small>
                <strong>{db.advisory.filter((x) => x.status === 'Open').length}</strong>
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <div className="spend-line">
                <span>Approved execution scope</span>
                <strong>Read-only</strong>
              </div>
              <div className="progress-track">
                <span style={{ width: '100%' }} />
              </div>
              <p className="small-text muted" style={{ marginTop: 12 }}>
                Orders, payments and provisioning stay behind a human approval gate.
              </p>
            </div>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Recent activity</h2>
            <p>Traceable actions from your team and scheduled evaluations.</p>
          </div>
          <Btn className="link small" onClick={() => nav('audit')}>
            View audit log
          </Btn>
        </div>
        <div className="panel-body">
          {db.audit.slice(0, 5).map((a, i) => (
            <div className="activity-row" key={i}>
              <span className="activity-icon">
                <Icon
                  name={
                    a.actor === 'Scheduler'
                      ? 'schedules'
                      : a.action.includes('market')
                        ? 'market'
                        : 'audit'
                  }
                />
              </span>
              <div>
                <strong>{a.action}</strong>
                <p>
                  {a.actor} · {a.target}
                </p>
              </div>
              <time>{a.time}</time>
            </div>
          ))}
        </div>
      </section>
      <Note />
    </>
  );
}
