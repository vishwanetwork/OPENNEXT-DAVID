'use client';

import { type FormEvent } from 'react';
import { ConsoleIcon as Icon } from '@/components/icons';
import { money } from '../helpers';
import { DEFAULT_PROMPT, MODEL_SPECS, REGIONS } from '../reference-data';
import { Btn, Callout, Field, SelectField, formValues } from '../components/forms';
import type { ScheduleDraft } from '../types';
import type { DialogContext } from './context';

/** Schedule wizard of the browser-local console (legacy OpenNEXT-admin.js). */
export function buildScheduleWizard(ctx: DialogContext) {
  const { overlay, toast, nav, store, closeBtn } = ctx;

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

  return { scheduleStore, scheduleWizard };
}
