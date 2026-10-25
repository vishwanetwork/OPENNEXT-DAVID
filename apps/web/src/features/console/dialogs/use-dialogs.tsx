'use client';

import { useMemo, type FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { Icon } from '../icons';
import { useOverlay } from '../components/overlay';
import { useConsoleStore } from '../store';
import { money, stamp, download } from '../helpers';
import { DEFAULT_PROMPT, MODEL_SPECS, REGIONS, VERIFY_COMMAND } from '../reference-data';
import {
  Badge,
  Btn,
  Callout,
  DetailGrid,
  Field,
  SelectField,
  Status,
  formValues,
} from '../components/forms';
import type { Offer, ScheduleDraft } from '../types';
import { useConsoleNav } from '../components/shell';

/**
 * Legacy drawers / modals of the browser-local console (offer, order, instance, schedule,
 * advisory, user, invite, import, billing limit). Each opener renders a snapshot of the record;
 * form submissions mutate the store, write an audit entry and re-open the updated record.
 */
export function useConsoleDialogs() {
  const overlay = useOverlay();
  const toast = useToast();
  const nav = useConsoleNav();
  const store = useConsoleStore;
  return useMemo(() => buildDialogs(overlay, toast, nav, store), [overlay, toast, nav, store]);
}

type Overlay = ReturnType<typeof useOverlay>;

function buildDialogs(
  overlay: Overlay,
  toast: (message: string) => void,
  nav: (page: string) => void,
  store: typeof useConsoleStore,
) {
  const closeBtn = (label = 'Close') => <Btn onClick={overlay.close}>{label}</Btn>;

  function runLog(id: string) {
    const x = store.getState().db.runs.find((v) => v.id === id);
    if (!x) return;
    overlay.modal({
      title: 'Execution log',
      subtitle: `${x.name} · ${x.id}`,
      wide: true,
      body: (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 17 }}>
            <Status label={x.status} />
            <Badge label={x.trigger} />
            <Badge label={x.duration} />
            <Badge label={`${x.records} records`} />
          </div>
          <div className="log-box">
            {x.log.map((v, i) => (
              <div key={i}>
                <span className="muted">{String(i + 1).padStart(2, '0')}</span>{' '}
                <span
                  className={
                    v.includes('DONE') || v.includes('completed')
                      ? 'log-ok'
                      : v.includes('POLICY') || v.includes('GATE')
                        ? 'log-blue'
                        : ''
                  }
                >
                  {v}
                </span>
              </div>
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 14 }}>
            Completed {x.time}. This record is retained in the local audit trail.
          </p>
        </>
      ),
      footer: (
        <>
          {closeBtn()}
          <Btn
            className="primary"
            onClick={() => {
              download(`${id}.txt`, `${x.name}\n${x.time}\n\n${x.log.join('\n')}`, 'text/plain');
              toast('Export downloaded.');
            }}
          >
            Export log
          </Btn>
        </>
      ),
    });
  }

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

  function scheduleStore(active: boolean, authorized: boolean) {
    const d = store.getState().scheduleDraft;
    if (!d) return;
    if (active && !authorized) {
      toast('Confirm the evaluation scope before activation.');
      return;
    }
    const { db, mutate, record, setUi } = store.getState();
    const id = `SCH-${105 + db.schedules.length}`;
    mutate((data) => {
      data.schedules.unshift({
        ...d,
        id,
        status: active ? 'Active' : 'Draft',
        provider: 'All providers',
        last: '—',
        next: active ? `In ${d.interval} min` : '—',
        runs: 0,
      });
    });
    record(
      active ? 'Schedule authorized' : 'Schedule draft saved',
      id,
      `Hourly cap ${money(d.budget)}; read-only evaluation; human approval required.`,
    );
    setUi({ scheduleDraft: null, scheduleTab: 'schedules' });
    overlay.close();
    nav('schedules');
    toast(active ? 'Schedule activated with approval gates.' : 'Schedule draft saved.');
  }

  function scheduleWizard() {
    const d = store.getState().scheduleDraft;
    if (!d) return;
    const steps = (
      <div className="steps">
        {['Describe', 'Review plan', 'Authorize'].map((s, i) => (
          <div key={s} className={`step ${i + 1 <= d.step ? 'active' : ''}`}>
            <b>{i + 1}</b>
            {s}
          </div>
        ))}
      </div>
    );
    const back = () => {
      store.getState().setUi({
        scheduleDraft: { ...store.getState().scheduleDraft!, step: (d.step - 1) as 1 | 2 | 3 },
      });
      scheduleWizard();
    };
    let body: React.ReactNode;
    let foot: React.ReactNode;
    if (d.step === 1) {
      const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const { get } = formValues(event.currentTarget);
        const text = get('instruction');
        if (text.length < 20) {
          toast('Describe the hardware, region and constraints in a little more detail.');
          return;
        }
        const next: ScheduleDraft = { ...d, instruction: text, strategy: get('strategy') };
        const model = MODEL_SPECS.find((x) => text.toLowerCase().includes(x[0].toLowerCase()));
        if (model) next.model = model[0];
        if (/h100/i.test(text)) next.model = 'H100 SXM';
        const count = text.match(/(\d+)\s*(?:h100|h200|b200|b300|gpus?)/i);
        if (count) next.count = +count[1];
        const cap = text.match(/\$(\d+(?:\.\d+)?)/);
        if (cap) next.budget = +cap[1];
        const region = REGIONS.find((r) => text.toLowerCase().includes(r.toLowerCase()));
        if (region) next.region = region;
        const interval = text.match(/every\s+(\d+)\s+min/i);
        if (interval) next.interval = +interval[1];
        next.name = `${next.model} capacity evaluation`;
        next.step = 2;
        store.getState().setUi({ scheduleDraft: next });
        scheduleWizard();
      };
      body = (
        <>
          {steps}
          <form id="schedule-describe-form" onSubmit={submit}>
            <SelectField
              label="GPU matching strategy"
              name="strategy"
              items={['Compatible or better', 'Exact model']}
              defaultValue={d.strategy}
            />
            <div className="field" style={{ marginTop: 17 }}>
              <label htmlFor="instruction">Instruction</label>
              <textarea
                name="instruction"
                id="instruction"
                style={{ height: 145 }}
                defaultValue={d.instruction}
              />
              <div className="hint">
                Specify hardware, region, budget, frequency and approval boundaries.
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <Btn
                className="link small"
                onClick={() => {
                  const el = document.getElementById('instruction') as HTMLTextAreaElement | null;
                  if (el) el.value = DEFAULT_PROMPT;
                  toast('Default instruction loaded.');
                }}
              >
                Load default instruction
              </Btn>
            </div>
          </form>
        </>
      );
      foot = (
        <>
          {closeBtn('Cancel')}
          <button form="schedule-describe-form" type="submit" className="primary">
            Analyze instruction <Icon name="arrow" />
          </button>
        </>
      );
    } else if (d.step === 2) {
      const read = (form: HTMLFormElement) => {
        const { get } = formValues(form);
        return {
          name: get('name'),
          model: get('model'),
          count: +get('count'),
          region: get('region'),
          budget: +get('budget'),
          interval: +get('interval'),
          strategy: get('strategy'),
        };
      };
      const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const values = read(event.currentTarget);
        if (!values.name || values.count < 1 || values.budget <= 0 || values.interval < 5) {
          toast(
            'Enter a name, a positive GPU count and budget, and an interval of at least 5 minutes.',
          );
          return;
        }
        store.getState().setUi({ scheduleDraft: { ...d, ...values, step: 3 } });
        scheduleWizard();
      };
      body = (
        <>
          {steps}
          <Callout>
            Review the structured plan before activation. Hard constraints apply to every
            evaluation; procurement actions require separate approval.
          </Callout>
          <form id="schedule-review-form" onSubmit={submit}>
            <div className="form-grid">
              <Field label="Schedule name" name="name" defaultValue={d.name} className="full" />
              <SelectField
                label="Target GPU"
                name="model"
                items={MODEL_SPECS.map((x) => x[0])}
                defaultValue={d.model}
              />
              <Field label="GPU count" name="count" defaultValue={d.count} type="number" />
              <SelectField label="Region" name="region" items={REGIONS} defaultValue={d.region} />
              <Field
                label="Hourly allocation cap (USD)"
                name="budget"
                defaultValue={d.budget}
                type="number"
              />
              <Field
                label="Evaluation interval (minutes)"
                name="interval"
                defaultValue={d.interval}
                type="number"
              />
              <SelectField
                label="Matching strategy"
                name="strategy"
                items={['Compatible or better', 'Exact model']}
                defaultValue={d.strategy}
              />
            </div>
            <label className="check-line">
              <input type="checkbox" name="approval" defaultChecked disabled />
              Require human approval for orders, payments and provisioning.
            </label>
          </form>
        </>
      );
      foot = (
        <>
          <Btn onClick={back}>Back</Btn>
          <Btn
            onClick={() => {
              const form = document.getElementById(
                'schedule-review-form',
              ) as HTMLFormElement | null;
              if (form) store.getState().setUi({ scheduleDraft: { ...d, ...read(form) } });
              scheduleStore(false, false);
            }}
          >
            Save draft
          </Btn>
          <button form="schedule-review-form" type="submit" className="primary">
            Review authorization
          </button>
        </>
      );
    } else {
      body = (
        <>
          {steps}
          <div className="plan-grid">
            {(
              [
                ['Schedule', d.name],
                ['Hardware', `${d.count} × ${d.model}`],
                ['Region', d.region],
                ['Hourly cap', money(d.budget)],
                ['Frequency', `Every ${d.interval} minutes`],
                ['Execution', 'Read-only evaluation'],
              ] as [string, string][]
            ).map(([l, v]) => (
              <div key={l}>
                <small>{l}</small>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <Callout>
            The active plan evaluates local market records and creates recommendations. A connected
            execution service is required for automatic collection or provisioning.
          </Callout>
          <label className="check-line">
            <input id="authorize-schedule" type="checkbox" />I approve this evaluation scope and the
            hard constraints shown above.
          </label>
          <label className="check-line">
            <input type="checkbox" defaultChecked disabled />
            Orders, payments and provisioning stay behind human approval.
          </label>
        </>
      );
      foot = (
        <>
          <Btn onClick={back}>Back</Btn>
          <Btn onClick={() => scheduleStore(false, false)}>Save draft</Btn>
          <Btn
            className="primary"
            onClick={() =>
              scheduleStore(
                true,
                (document.getElementById('authorize-schedule') as HTMLInputElement | null)
                  ?.checked ?? false,
              )
            }
          >
            Activate schedule
          </Btn>
        </>
      );
    }
    overlay.modal({
      title: 'Create ad-hoc schedule',
      subtitle: 'Describe the task, review the plan, then authorize the scope.',
      body,
      footer: foot,
      wide: true,
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

  function offerPlan(x: Offer) {
    return scheduleNew({
      name: `${x.model} ${x.region} evaluation`,
      model: x.model,
      count: x.count,
      region: x.region,
      budget: +(x.rate * x.count * 1.1).toFixed(2),
      instruction: `Every 30 minutes, evaluate ${x.count} ${x.model} GPUs in ${x.region}. Keep total hourly cost below ${money(x.rate * x.count * 1.1)}. Require approval before billable actions.`,
    });
  }

  function offerDetail(id: string) {
    const x = store.getState().db.offers.find((v) => v.id === id);
    if (!x) return;
    overlay.drawer({
      title: `${x.model} · ${x.count} GPUs`,
      subtitle: `${x.id} · ${x.provider}`,
      body: (
        <>
          <Badge label={x.terms} tone="purple" /> <Badge label={x.availability} tone="green" />
          <DetailGrid
            items={[
              ['GPU-hour rate', money(x.rate)],
              ['Allocation hourly total', money(x.rate * x.count)],
              ['GPU memory', `${x.memory} GB`],
              ['Region', x.region],
              ['Placement score', `${x.score} / 10`],
              ['Record type', x.record],
              ['Source', x.source],
              ['Last observed', x.updated],
            ]}
          />
          <h3>Record provenance</h3>
          <p className="small-text muted" style={{ marginTop: 9 }}>
            Imported source observations are used for market analysis. Availability must be
            confirmed with the supplier before procurement.
          </p>
          <div className="code-box" style={{ marginTop: 17 }}>
            Record: {x.id}
            <br />
            Currency: USD
            <br />
            Unit: GPU-hour
            <br />
            Normalization: GPU count × unit rate
          </div>
        </>
      ),
      footer: (
        <>
          {closeBtn()}
          <Btn className="primary" onClick={() => offerPlan(x)}>
            Create evaluation plan
          </Btn>
        </>
      ),
    });
  }

  function specDetail(index: number) {
    const [model, memory] = MODEL_SPECS[index];
    overlay.modal({
      title: `${model} specifications`,
      subtitle: 'Hardware reference used for allocation matching.',
      body: (
        <>
          <DetailGrid
            items={[
              ['GPU model', model],
              ['Memory per GPU', `${memory} GB`],
              ['Manufacturer', model.startsWith('MI') ? 'AMD' : 'NVIDIA'],
              ['Verification', 'Supplier hardware evidence required'],
            ]}
          />
          <Callout>
            Validate the exact SKU, interconnect and available memory with the supplier.
            Specifications are references, not delivery evidence.
          </Callout>
        </>
      ),
      footer: closeBtn(),
    });
  }

  function orderDetail(id: string) {
    const x = store.getState().db.orders.find((v) => v.id === id);
    if (!x) return;
    const next = [
      'Record quote acceptance',
      'Record funding confirmation',
      'Record delivery acceptance',
      'Order complete',
    ][x.stage];
    overlay.drawer({
      title: x.id,
      subtitle: `${x.buyer} · ${x.seller}`,
      body: (
        <>
          <Status label={x.status} />
          <DetailGrid
            items={[
              ['Allocation', `${x.count} × ${x.model}`],
              ['Region', x.region],
              ['Contract period', x.period],
              ['Accepted value', money(x.total)],
              ['Buyer', x.buyer],
              ['Supplier', x.seller],
            ]}
          />
          <h3>Progress</h3>
          <div style={{ margin: '15px 0 24px' }}>
            <div className="order-stage">
              {[0, 1, 2, 3].map((i) => (
                <i key={i} style={{ width: 70 }} className={i <= x.stage ? 'done' : ''} />
              ))}
            </div>
            <div className="tiny muted" style={{ marginTop: 8 }}>
              Quote → Funding confirmed → Reserved → Delivered
            </div>
          </div>
          <h3>Order timeline</h3>
          <div className="timeline">
            {x.events.map(([a, d], i) => (
              <div className="timeline-item" key={i}>
                <strong>{a}</strong>
                <p>{d}</p>
              </div>
            ))}
          </div>
          <Callout>
            Record confirmations received from your settlement partner and supplier. This action
            does not transfer money or provision capacity.
          </Callout>
        </>
      ),
      footer: (
        <>
          {closeBtn()}
          {x.stage < 3 ? (
            <Btn className="primary" onClick={() => orderAdvance(id)}>
              {next}
            </Btn>
          ) : (
            <Btn
              onClick={() => {
                download(`${id}.json`, JSON.stringify(x, null, 2), 'application/json');
                toast('Export downloaded.');
              }}
            >
              Export record
            </Btn>
          )}
        </>
      ),
    });
  }

  function orderAdvance(id: string) {
    const x = store.getState().db.orders.find((v) => v.id === id);
    if (!x) return;
    const labels = ['Quote acceptance', 'Funding confirmation', 'Delivery acceptance'];
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const { get } = formValues(event.currentTarget);
      if (!get('reference') || !get('evidence')) {
        toast('Add a confirmation reference and operator notes.');
        return;
      }
      const titles = ['Quote accepted', 'Funding confirmation recorded', 'Delivery accepted'];
      let stageTitle = '';
      store.getState().mutate((d) => {
        const o = d.orders.find((v) => v.id === id)!;
        stageTitle = titles[o.stage];
        o.events.unshift([
          titles[o.stage],
          `${stamp()} · ${get('reference')} · ${get('evidence')}`,
        ]);
        o.stage = Math.min(3, o.stage + 1);
        o.status = ['Quoted', 'Awaiting funds', 'Reserved', 'Delivered'][o.stage];
        o.updated = stamp();
      });
      store.getState().record(stageTitle, id, `${get('reference')}: ${get('evidence')}`);
      orderDetail(id);
      toast('Order confirmation recorded.');
    };
    overlay.modal({
      title: labels[x.stage],
      subtitle: `Record the evidence for ${x.id}.`,
      body: (
        <form id="order-stage-form" onSubmit={submit}>
          <div className="form-grid">
            <Field
              label={x.stage === 1 ? 'Settlement reference' : 'Confirmation reference'}
              name="reference"
              hint="Required. Use the supplier, buyer or partner’s confirmation reference."
              className="full"
            />
            <div className="field full">
              <label htmlFor="evidence">Operator notes</label>
              <textarea
                id="evidence"
                name="evidence"
                placeholder="What was confirmed, by whom, and when?"
              />
            </div>
          </div>
        </form>
      ),
      footer: (
        <>
          {closeBtn('Cancel')}
          <button className="primary" form="order-stage-form" type="submit">
            Save confirmation
          </button>
        </>
      ),
    });
  }

  function instanceDetail(id: string) {
    const x = store.getState().db.instances.find((v) => v.id === id);
    if (!x) return;
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const { get, has } = formValues(event.currentTarget);
      const config = store.getState().db.config;
      if (!get('host') || +get('port') < 1 || +get('port') > 65535 || !get('fingerprint')) {
        toast('Enter the SSH host, valid port and verified fingerprint.');
        return;
      }
      if (config.requireGPU && !get('proof')) {
        toast('Hardware evidence is required by the platform policy.');
        return;
      }
      if (!has('confirmed')) {
        toast('Confirm that you reviewed the host and hardware evidence.');
        return;
      }
      store.getState().mutate((d) => {
        Object.assign(d.instances.find((v) => v.id === id)!, {
          host: get('host'),
          port: +get('port'),
          fingerprint: get('fingerprint'),
          proof: get('proof'),
          status: 'Verified',
          verified: stamp(),
        });
      });
      store
        .getState()
        .record(
          'Instance evidence verified',
          id,
          'Operator reviewed host identity and hardware proof. No SSH session initiated.',
        );
      instanceDetail(id);
      toast('Instance verification saved.');
    };
    overlay.drawer({
      title: x.name,
      subtitle: `${x.id} · ${x.source}`,
      body: (
        <>
          <Status label={x.status} />
          <DetailGrid
            items={[
              ['Owner', x.owner],
              ['Allocation', `${x.count} × ${x.model}`],
              ['Region', x.region],
              ['Last verified', x.verified],
            ]}
          />
          <form id="instance-verify-form" onSubmit={submit}>
            <Field label="SSH host" name="host" defaultValue={x.host} />
            <Field label="SSH port" name="port" defaultValue={x.port} type="number" />
            <Field
              label="Verified host fingerprint"
              name="fingerprint"
              defaultValue={x.fingerprint}
              hint="Compare the fingerprint through a trusted supplier contact."
            />
            <div className="field">
              <label htmlFor="proof">Hardware verification evidence</label>
              <textarea
                id="proof"
                name="proof"
                className="mono"
                placeholder="Paste the nvidia-smi output received from the supplier."
                defaultValue={x.proof}
              />
              <div className="hint">Confirm GPU model, count, memory and driver version.</div>
            </div>
            <label className="check-line">
              <input type="checkbox" name="confirmed" defaultChecked={x.status === 'Verified'} />I
              reviewed the host identity and hardware evidence against the order.
            </label>
            <Callout>
              This stores an operator review. No SSH connection is initiated from this browser.
            </Callout>
          </form>
        </>
      ),
      footer: (
        <>
          {closeBtn()}
          <button className="primary" form="instance-verify-form" type="submit">
            Save verification
          </button>
        </>
      ),
    });
  }

  function instanceNew() {
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const { get } = formValues(event.currentTarget);
      if (!get('name') || !get('owner') || !get('host') || +get('count') < 1 || +get('port') < 1) {
        toast('Complete the instance, owner, hardware count and SSH details.');
        return;
      }
      const id = `INS-${3022 + store.getState().db.instances.length}`;
      store.getState().mutate((d) => {
        d.instances.unshift({
          id,
          name: get('name'),
          source: get('source'),
          owner: get('owner'),
          model: get('model'),
          count: +get('count'),
          region: get('region'),
          host: get('host'),
          port: +get('port'),
          fingerprint: '',
          status: 'Pending',
          proof: '',
          verified: '—',
        });
      });
      store.getState().record('Instance registered', id, get('name'));
      store.getState().setUi({ instanceTab: 'All instances' });
      overlay.close();
      nav('instances');
      instanceDetail(id);
      toast('Instance registered. Add verification evidence next.');
    };
    overlay.modal({
      title: 'Register instance',
      subtitle: 'Capture delivery details for a platform or supplier allocation.',
      body: (
        <form id="instance-new-form" onSubmit={submit}>
          <div className="form-grid">
            <Field label="Instance name" name="name" className="full" />
            <SelectField
              label="Source"
              name="source"
              items={['Seller supplied', 'Platform supplied']}
              defaultValue="Seller supplied"
            />
            <Field label="Supplier / owner" name="owner" />
            <SelectField
              label="GPU model"
              name="model"
              items={MODEL_SPECS.map((x) => x[0])}
              defaultValue="H100 SXM"
            />
            <Field label="GPU count" name="count" defaultValue={8} type="number" />
            <SelectField label="Region" name="region" items={REGIONS} defaultValue="US East" />
            <Field label="SSH host" name="host" />
            <Field label="SSH port" name="port" defaultValue={22} type="number" />
          </div>
        </form>
      ),
      footer: (
        <>
          {closeBtn('Cancel')}
          <button type="submit" form="instance-new-form" className="primary">
            Register instance
          </button>
        </>
      ),
    });
  }

  function adviceDetail(id: string) {
    const x = store.getState().db.advisory.find((v) => v.id === id);
    if (!x) return;
    const decide = (decision: 'Dismissed' | 'Accepted') => {
      store.getState().mutate((d) => {
        d.advisory.find((v) => v.id === id)!.status = decision;
      });
      store.getState().record(`Recommendation ${decision.toLowerCase()}`, id, x.title);
      overlay.close();
      toast(`Recommendation ${decision.toLowerCase()}.`);
    };
    overlay.drawer({
      title: x.title,
      subtitle: `${id} · ${x.type}`,
      body: (
        <>
          <Status label={x.status} />
          <p className="small-text muted" style={{ marginTop: 18, lineHeight: 1.8 }}>
            {x.desc}
          </p>
          <DetailGrid
            items={[
              ['Relevant hardware', x.model],
              ['Evidence records', x.records],
              ['Confidence', `${x.confidence}%`],
              ['Recommendation', 'Operator review required'],
            ]}
          />
          <h3>Recommended next step</h3>
          <p className="small-text muted" style={{ marginTop: 9 }}>
            {x.type === 'Supplier review'
              ? 'Review rights evidence and schedule a separate capacity test.'
              : x.type === 'Delivery readiness'
                ? 'Verify the host fingerprint, hardware evidence and delivery contact.'
                : 'Compare current supplier quotes and confirm the buyer’s constraints.'}
          </p>
          <Callout style={{ marginTop: 20 }}>
            Accepting this recommendation adds an audit record. External execution still requires
            the relevant workflow and approval.
          </Callout>
        </>
      ),
      footer: (
        <>
          <Btn onClick={() => decide('Dismissed')}>Dismiss</Btn>
          <Btn className="primary" onClick={() => decide('Accepted')}>
            Accept recommendation
          </Btn>
        </>
      ),
    });
  }

  function userDetail(id: string) {
    const x = store.getState().db.users.find((v) => v.id === id);
    if (!x) return;
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const { get } = formValues(event.currentTarget);
      if (!get('note')) {
        toast('Add a review note or evidence reference.');
        return;
      }
      const review = {
        eligibility: get('eligibility'),
        kyb: get('kyb'),
        rights: get('rights'),
        test: get('test'),
      };
      if (
        ['Seller', 'Broker'].includes(get('role')) &&
        get('status') === 'Active' &&
        !Object.values(review).every((v) => v === 'Approved')
      ) {
        toast('All four supplier checks must be approved before activating a Seller or Broker.');
        return;
      }
      store.getState().mutate((d) => {
        Object.assign(d.users.find((v) => v.id === id)!, {
          role: get('role'),
          status: get('status'),
          review,
        });
      });
      store.getState().record('Account and supplier review updated', id, get('note'));
      userDetail(id);
      toast('Review and access role saved.');
    };
    const checks: [keyof typeof x.review, string, string][] = [
      ['eligibility', 'Eligibility', 'Identity, geography and permitted supply scope'],
      ['kyb', 'KYB', 'Company record and beneficial ownership'],
      [
        'rights',
        'Rights & authorization',
        'Evidence of ownership, allocation or resale permission',
      ],
      ['test', 'Capacity test', 'Hardware / delivery evidence reviewed'],
    ];
    overlay.drawer({
      title: x.name,
      subtitle: `${x.company} · ${x.id}`,
      body: (
        <>
          <div className="user-identity">
            <span className="avatar">
              {x.name
                .split(' ')
                .map((s) => s[0])
                .slice(0, 2)
                .join('')}
            </span>
            <div>
              <h3>{x.name}</h3>
              <p>{x.email}</p>
            </div>
            <Status label={x.status} />
          </div>
          <form id="user-review-form" onSubmit={submit}>
            <div className="form-grid">
              <SelectField
                label="Workspace role"
                name="role"
                items={['Buyer', 'Seller', 'Broker', 'Analyst', 'Operations', 'Administrator']}
                defaultValue={x.role}
              />
              <SelectField
                label="Account status"
                name="status"
                items={['Active', 'In review', 'Paused']}
                defaultValue={x.status}
              />
            </div>
            <h3 style={{ marginTop: 24 }}>Supplier review</h3>
            <p className="tiny muted" style={{ marginTop: 7 }}>
              Eligibility, KYB and rights establish supplier onboarding. Capacity tests apply to
              each new allocation.
            </p>
            {checks.map(([key, label, copy], i) => (
              <div className="review-check" key={key}>
                <span className={x.review[key] === 'Approved' ? 'complete' : ''}>
                  {x.review[key] === 'Approved' ? '✓' : i + 1}
                </span>
                <div>
                  <strong>{label}</strong>
                  <small>{copy}</small>
                </div>
                <select name={key} aria-label={label} defaultValue={x.review[key]}>
                  {['Pending', 'In review', 'Approved', 'Rejected'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </div>
            ))}
            <div className="field" style={{ marginTop: 20 }}>
              <label htmlFor="review-note">Review note / evidence reference</label>
              <textarea
                name="note"
                id="review-note"
                style={{ height: 85 }}
                placeholder="Document what was checked and the evidence reference."
              />
            </div>
            <Callout>
              Only mark rights approved when the supplied evidence supports the permitted delivery
              scope. A successful capacity test does not establish upstream authorization.
            </Callout>
          </form>
        </>
      ),
      footer: (
        <>
          {closeBtn()}
          <button className="primary" type="submit" form="user-review-form">
            Save review
          </button>
        </>
      ),
    });
  }

  function invite() {
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const { get } = formValues(event.currentTarget);
      if (!get('name') || !get('company') || !/^\S+@\S+\.\S+$/.test(get('email'))) {
        toast('Enter a name, company and valid email address.');
        return;
      }
      const { db } = store.getState();
      if (db.users.some((x) => x.email.toLowerCase() === get('email').toLowerCase())) {
        toast('An account with this email already exists.');
        return;
      }
      const id = `USR-${1001 + db.users.length}`;
      store.getState().mutate((d) => {
        d.users.push({
          id,
          name: get('name'),
          email: get('email'),
          company: get('company'),
          role: get('role'),
          status: ['Seller', 'Broker'].includes(get('role')) ? 'In review' : 'Active',
          joined: new Date().toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }),
          review: { eligibility: 'Pending', kyb: 'Pending', rights: 'Pending', test: 'Pending' },
        });
      });
      store
        .getState()
        .record(
          'Account record created',
          id,
          `${get('email')} · ${get('role')}; no invitation email sent.`,
        );
      store.getState().setUi({ userTab: 'All accounts' });
      overlay.close();
      nav('users');
      toast('Account record created.');
    };
    overlay.modal({
      title: 'Invite account',
      subtitle: 'Add a procurement contact, supplier, broker or team operator.',
      body: (
        <form id="invite-form" onSubmit={submit}>
          <div className="form-grid">
            <Field label="Full name" name="name" className="full" />
            <Field label="Work email" name="email" type="email" className="full" />
            <Field label="Company" name="company" />
            <SelectField
              label="Role"
              name="role"
              items={['Buyer', 'Seller', 'Broker', 'Analyst', 'Operations', 'Administrator']}
              defaultValue="Buyer"
            />
          </div>
          <Callout style={{ marginTop: 20 }}>
            This creates an account record in the local workspace. No invitation email is sent.
          </Callout>
        </form>
      ),
      footer: (
        <>
          {closeBtn('Cancel')}
          <button type="submit" className="primary" form="invite-form">
            Create account record
          </button>
        </>
      ),
    });
  }

  function billingLimit() {
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const { get } = formValues(event.currentTarget);
      if (+get('limit') < 1.26) {
        toast('The limit must cover the $1.26 already allocated.');
        return;
      }
      store.getState().mutate((d) => {
        d.spendLimit = +get('limit');
      });
      store
        .getState()
        .record(
          'Evaluation spending cap updated',
          'Agent billing',
          `${money(+get('limit'))} per month`,
        );
      overlay.close();
      toast('Monthly spending limit saved.');
    };
    overlay.modal({
      title: 'Monthly spending limit',
      subtitle: 'Set the maximum allocated evaluation cost.',
      body: (
        <form id="billing-limit-form" onSubmit={submit}>
          <Field
            label="Monthly limit (USD)"
            name="limit"
            defaultValue={store.getState().db.spendLimit || 100}
            type="number"
          />
          <Callout style={{ marginTop: 18 }}>
            This local cap is recorded for evaluation planning. A connected billing service is
            required to enforce external spending.
          </Callout>
        </form>
      ),
      footer: (
        <>
          {closeBtn('Cancel')}
          <button className="primary" type="submit" form="billing-limit-form">
            Save limit
          </button>
        </>
      ),
    });
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(VERIFY_COMMAND);
      toast('Verification command copied.');
    } catch {
      overlay.modal({
        title: 'Verification command',
        subtitle: 'Copy and share this with the supplier.',
        body: <div className="code-box">{VERIFY_COMMAND}</div>,
        footer: closeBtn(),
      });
    }
  }

  return {
    close: overlay.close,
    runLog,
    scheduleRun,
    scheduleToggle,
    scheduleDetail,
    scheduleNew,
    offerDetail,
    offerPlan,
    specDetail,
    orderDetail,
    orderAdvance,
    instanceDetail,
    instanceNew,
    adviceDetail,
    userDetail,
    invite,
    billingLimit,
    copyCommand,
  };
}
