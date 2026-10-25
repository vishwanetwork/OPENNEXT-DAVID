'use client';

import { ConsoleIcon as Icon } from '@/components/icons';
import { money, stamp } from '../helpers';
import { DEFAULT_PROMPT } from '../reference-data';
import { Btn, Callout, DetailGrid, Status } from '../components/forms';
import type { ScheduleDraft } from '../types';
import type { DialogContext } from './context';

/** Schedule dialogs of the browser-local console (legacy OpenNEXT-admin.js). */
export function buildScheduleDialogs(
  ctx: DialogContext,
  deps: { runLog: (id: string) => void; scheduleWizard: () => void },
) {
  const { overlay, toast, store, closeBtn } = ctx;
  const { runLog, scheduleWizard } = deps;

  function scheduleRun(id: string) {
    const { db, mutate, record } = store.getState();
    const x = db.schedules.find((v) => v.id === id);
    if (!x || x.status === 'Draft') return;
    const offers = db.offers.filter(
      (o) =>
        (x.model === 'All models' ||
          o.model === x.model ||
          (x.strategy === 'Compatible or better' && ['H100 SXM', 'H200'].includes(o.model))) &&
        (x.region === 'All regions' || o.region === x.region) &&
        (!x.budget || o.rate * x.count <= x.budget),
    );
    const run = {
      id: `RUN-${2049 + db.runs.length}`,
      schedule: id,
      name: x.name,
      status: 'Completed',
      trigger: 'Manual',
      time: stamp(),
      duration: '1.4s',
      records: offers.length,
      log: [
        `[PLAN] ${id} · ${x.name}`,
        `[MODE] Read-only local evaluation`,
        `[SCOPE] ${x.count} × ${x.model} · ${x.region}`,
        `[POLICY] Hourly allocation cap ${x.budget ? money(x.budget) : 'not applicable'}; human approval required`,
        `[DATA] ${db.offers.length} normalized offer records inspected`,
        `[MATCH] ${offers.length} eligible records matched all hard constraints`,
        offers.length
          ? `[RESULT] Lowest eligible rate ${money(Math.min(...offers.map((v) => v.rate)))} / GPU-hour`
          : '[RESULT] No eligible capacity in the current dataset',
        '[GATE] No orders, payments, SSH sessions or provisioning actions submitted',
        '[DONE] Evaluation complete; execution evidence recorded',
      ],
    };
    mutate((d) => {
      d.runs.unshift(run);
      const s = d.schedules.find((v) => v.id === id)!;
      s.runs++;
      s.last = stamp();
    });
    record(
      'Schedule evaluation completed',
      id,
      `${offers.length} eligible records; read-only local evaluation.`,
    );
    runLog(run.id);
    toast('Evaluation complete. View the evidence below.');
  }

  function scheduleToggle(id: string) {
    const { db, mutate, record } = store.getState();
    const x = db.schedules.find((v) => v.id === id);
    if (!x) return;
    if (x.status === 'Draft') {
      overlay.modal({
        title: 'Activate schedule',
        subtitle: `Review the scope for ${id}.`,
        body: (
          <>
            <Callout>{x.instruction}</Callout>
            <p className="small-text muted">
              This activates read-only evaluation with a human approval gate for all billable
              actions.
            </p>
          </>
        ),
        footer: (
          <>
            {closeBtn('Cancel')}
            <Btn
              className="primary"
              onClick={() => {
                store.getState().mutate((d) => {
                  const s = d.schedules.find((v) => v.id === id)!;
                  s.status = 'Active';
                  s.next = `In ${s.interval} min`;
                });
                store
                  .getState()
                  .record('Schedule activated', id, 'Read-only evaluation authorized.');
                overlay.close();
                toast('Schedule activated.');
              }}
            >
              Confirm activation
            </Btn>
          </>
        ),
      });
      return;
    }
    const next = x.status === 'Active' ? 'Paused' : 'Active';
    mutate((d) => {
      const s = d.schedules.find((v) => v.id === id)!;
      s.status = next;
      s.next = next === 'Active' ? `In ${s.interval} min` : '—';
    });
    record(`Schedule ${next.toLowerCase()}`, id);
    overlay.close();
    toast(`Schedule ${next.toLowerCase()}.`);
  }

  function scheduleDetail(id: string) {
    const db = store.getState().db;
    const x = db.schedules.find((v) => v.id === id);
    if (!x) return;
    const runs = db.runs.filter((r) => r.schedule === id).slice(0, 5);
    overlay.drawer({
      title: x.name,
      subtitle: `${id} · ${x.status}`,
      body: (
        <>
          <Status label={x.status} />
          <p className="small-text muted" style={{ marginTop: 18, lineHeight: 1.8 }}>
            {x.instruction}
          </p>
          <DetailGrid
            items={[
              ['GPU target', `${x.count} × ${x.model}`],
              ['Region', x.region],
              ['Hourly cap', x.budget ? money(x.budget) : 'Read-only sync'],
              ['Frequency', `Every ${x.interval} minutes`],
              ['Matching strategy', x.strategy],
              ['Approval gate', 'Always required'],
            ]}
          />
          <h3>Hard constraints</h3>
          {[
            'Budget checked before every proposal',
            'Only eligible market records considered',
            'No autonomous order or payment',
            'Traceable execution records',
          ].map((t) => (
            <div className="permission-row" key={t}>
              <span>{t}</span>
              <Icon name="check" />
            </div>
          ))}
          <h3 style={{ marginTop: 22 }}>Recent evaluations</h3>
          {runs.length ? (
            runs.map((r) => (
              <div className="queue-row" key={r.id}>
                <div>
                  <strong>{r.id}</strong>
                  <p>
                    {r.time} · {r.records} records
                  </p>
                </div>
                <Btn className="link small" onClick={() => runLog(r.id)}>
                  View log
                </Btn>
              </div>
            ))
          ) : (
            <p className="small-text muted" style={{ marginTop: 12 }}>
              No evaluations yet.
            </p>
          )}
        </>
      ),
      footer: (
        <>
          {closeBtn()}
          <Btn onClick={() => scheduleToggle(id)}>
            {x.status === 'Active' ? 'Pause' : x.status === 'Paused' ? 'Resume' : 'Activate'}
          </Btn>
          <Btn className="primary" disabled={x.status === 'Draft'} onClick={() => scheduleRun(id)}>
            Run now
          </Btn>
        </>
      ),
    });
  }

  function scheduleNew(prefill?: Partial<ScheduleDraft>) {
    store.getState().setUi({
      scheduleDraft: {
        step: 1,
        instruction: prefill?.instruction || DEFAULT_PROMPT,
        strategy: prefill?.strategy || 'Compatible or better',
        name: prefill?.name || 'Spot capacity evaluation',
        model: prefill?.model || 'H100 SXM',
        count: prefill?.count || 8,
        region: prefill?.region || 'US East',
        budget: prefill?.budget || 32,
        interval: 30,
        approval: true,
      },
    });
    scheduleWizard();
  }

  return { scheduleRun, scheduleToggle, scheduleDetail, scheduleNew };
}
