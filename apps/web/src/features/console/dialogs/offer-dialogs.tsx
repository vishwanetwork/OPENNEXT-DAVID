'use client';

import { money } from '../helpers';
import { MODEL_SPECS } from '../reference-data';
import { Badge, Btn, Callout, DetailGrid } from '../components/forms';
import type { Offer, ScheduleDraft } from '../types';
import type { DialogContext } from './context';

/** Offer dialogs of the browser-local console (legacy OpenNEXT-admin.js). */
export function buildOfferDialogs(
  ctx: DialogContext,
  deps: { scheduleNew: (prefill?: Partial<ScheduleDraft>) => void },
) {
  const { overlay, store, closeBtn } = ctx;
  const { scheduleNew } = deps;

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

  return { offerPlan, offerDetail, specDetail };
}
