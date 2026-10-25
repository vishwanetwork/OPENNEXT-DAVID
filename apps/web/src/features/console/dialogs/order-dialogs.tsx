'use client';

import { type FormEvent } from 'react';
import { money, stamp, download } from '../helpers';
import { Btn, Callout, DetailGrid, Field, Status, formValues } from '../components/forms';
import type { DialogContext } from './context';

/** Order dialogs of the browser-local console (legacy OpenNEXT-admin.js). */
export function buildOrderDialogs(ctx: DialogContext) {
  const { overlay, toast, store, closeBtn } = ctx;

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

  return { orderDetail, orderAdvance };
}
