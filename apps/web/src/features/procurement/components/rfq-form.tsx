'use client';

import { useState, type FormEvent } from 'react';
import type { OwnedRfq } from '@opennext/contracts';
import { money } from '@/lib/format';
import { useTerminal, useWorkspaceStore } from '@/terminal-kit';
import { maximumQuotePrice } from '../fees';
import { deliveryMethod, isHardware, isModel, kindOf } from '../exchange';
import { useFindMarketRow } from '../market-view';
import { PBtn, isoInput } from './shared';
import { CountrySelect, Input, Optional, formData } from './fields';
import { useSubmitRecord } from './use-submit-record';
import { BudgetRange } from './budget-range';

export function RfqForm({
  r = {},
  editing = false,
}: {
  r?: Partial<OwnedRfq> & Record<string, unknown>;
  editing?: boolean;
}) {
  const workspace = useWorkspaceStore();
  const { closeModal } = useTerminal();
  const { submit, submitting } = useSubmitRecord();
  const findMarketRow = useFindMarketRow();
  const model = isModel(r);
  const hardware = isHardware(r);
  const chosen = findMarketRow(r.originSupply as string | undefined);
  const quoteRequest = r.requestKind === 'quote_request';
  const [live, setLive] = useState({
    budget: r.budget ?? '',
    count: r.count || workspace.count || 8,
    hours: r.hours || 72,
  });
  const [budgetValue, setBudgetValue] = useState<string>(
    r.budget === null || r.budget === undefined ? '' : String(r.budget),
  );
  const [defaults] = useState(() => ({
    start: isoInput(r.start),
    deadline: isoInput(r.quoteDeadline || Date.now() + 12 * 3600000),
  }));
  const maximum = maximumQuotePrice({
    kind: kindOf(r),
    budget: live.budget,
    count: live.count,
    hours: live.hours,
  });
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit({
      recordKind: 'rfq',
      id: editing ? String(r.id) : undefined,
      data: formData(event),
    });
  };
  const terms = model
    ? ['Authorized API access', 'Native allocation', 'Hosted inference']
    : quoteRequest
      ? ['On-demand', 'Reserved']
      : ['Spot', 'On-demand', 'Reserved'];
  const track = (name: string) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setLive((prev) => ({ ...prev, [name]: event.target.value }));
  return (
    <form data-form="proc-rfq" data-id={editing ? String(r.id) : ''} onSubmit={onSubmit}>
      <input type="hidden" name="kind" value={kindOf(r)} />
      <input type="hidden" name="requestKind" value={quoteRequest ? 'quote_request' : 'rfq'} />
      <input type="hidden" name="originSupply" value={String(r.originSupply || '')} />
      <input type="hidden" name="sku" value={String(r.sku || '')} />
      {r.selectedOffer ? (
        <input type="hidden" name="selectedOffer" value={JSON.stringify(r.selectedOffer)} />
      ) : null}
      {r.originSupply ? (
        <div className="callout">
          Selected supply · {chosen?.provider || String(r.originSupply)}. This request goes to this
          supplier, not to the public RFQ board.
        </div>
      ) : null}
      {model && chosen ? (
        <p className="form-note">
          Listed rates: input ${Number(chosen.price)} / 1M tokens · output $
          {Number(chosen.outputPrice)} / 1M tokens. Total depends on your input and output volumes;
          final terms require a quote.
        </p>
      ) : null}
      <div className="form-grid">
        {model || hardware ? (
          <Input
            label="Requirement name"
            name="title"
            defaultValue={r.title || ''}
            required
            maxLength={140}
          />
        ) : null}
        <Input
          label="GPU / model"
          name="model"
          defaultValue={r.model || workspace.model}
          required
          readOnly={Boolean(r.originSupply)}
        />
        <CountrySelect name="region" defaultValue={String(r.region || workspace.region)} />
        {!model && !hardware ? (
          <Input
            label="vCPU"
            name="vcpu"
            defaultValue={r.vcpu ?? ''}
            type="number"
            min={1}
            max={65536}
            step={1}
            required
          />
        ) : null}
        {model ? (
          <>
            <Input
              label="Input volume (million tokens)"
              name="inputMillion"
              defaultValue={r.inputMillion ?? 1}
              type="number"
              min={0}
              step="0.000001"
              required
            />
            <Input
              label="Output volume (million tokens)"
              name="outputMillion"
              defaultValue={r.outputMillion ?? 1}
              type="number"
              min={0}
              step="0.000001"
              required
            />
            <Input
              label="Service duration (days)"
              name="days"
              defaultValue={r.days || 30}
              type="number"
              min={1}
              max={1095}
              required
            />
            <Input
              label="Required TPS"
              name="tps"
              defaultValue={r.tps || ''}
              type="number"
              min={1}
            />
          </>
        ) : (
          <>
            <Input
              label="GPU quantity"
              name="count"
              defaultValue={r.count || workspace.count || 8}
              type="number"
              min={1}
              max={4096}
              step={1}
              required
              onChange={track('count')}
            />
            {hardware ? (
              <Input
                label="Condition"
                name="condition"
                defaultValue={r.condition || 'Brand new'}
                required
              />
            ) : (
              <>
                <Input
                  label="Memory (GB / GPU)"
                  name="memory"
                  defaultValue={r.memory ?? ''}
                  type="number"
                  min="0.01"
                  max={65536}
                  step="0.01"
                  required
                />
                <Input
                  label="Duration (hours)"
                  name="hours"
                  defaultValue={r.hours || 72}
                  type="number"
                  min={1}
                  max={26280}
                  step={1}
                  required
                  onChange={track('hours')}
                />
              </>
            )}
          </>
        )}
        {hardware ? (
          <input type="hidden" name="term" value="Physical GPU" />
        ) : (
          <div>
            <label className="form-label">Market terms</label>
            <select className="field" name="term" defaultValue={String(r.term || workspace.term)}>
              {terms.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="form-label" htmlFor="proc-budget">
            {model
              ? 'Maximum total budget (USD)'
              : hardware
                ? 'Maximum unit price (USD / GPU)'
                : 'Maximum USD / GPU-hour'}
          </label>
          <input
            className="field"
            id="proc-budget"
            name="budget"
            type="number"
            min="0.000001"
            step="0.000001"
            required
            value={budgetValue}
            onChange={(e) => {
              setBudgetValue(e.target.value);
              setLive((prev) => ({ ...prev, budget: e.target.value }));
            }}
          />
        </div>
        <BudgetRange
          r={r}
          model={String(r.model || workspace.model)}
          onPick={(value) => {
            setBudgetValue(String(value));
            setLive((prev) => ({ ...prev, budget: value }));
          }}
        />
        <Input
          label={hardware ? 'Required arrival (UTC)' : 'Required start (UTC)'}
          name="start"
          defaultValue={defaults.start}
          type="datetime-local"
          required
        />
        <Input
          label="Quotes due (UTC)"
          name="quoteDeadline"
          defaultValue={defaults.deadline}
          type="datetime-local"
          required
        />
        {hardware ? (
          <>
            <Input
              label="Shipping destination / address"
              name="shippingAddress"
              defaultValue={r.shippingAddress || ''}
              required
              maxLength={600}
            />
            <Input
              label="Incoterms / shipping responsibility"
              name="incoterms"
              defaultValue={r.incoterms || 'DAP · taxes and fees to confirm'}
            />
            <Input
              label="Warranty and return requirements"
              name="warranty"
              defaultValue={r.warranty || 'Warranty, authenticity and inspection terms required'}
            />
          </>
        ) : model ? (
          <Input
            label="Access and data policy requirements"
            name="accessPolicy"
            defaultValue={
              r.accessPolicy || 'Authorized access; data location and retention to confirm'
            }
          />
        ) : (
          <>
            <Input
              label={
                <>
                  Network / interconnect <Optional />
                </>
              }
              name="network"
              defaultValue={r.network || ''}
            />
            <Input
              label={
                <>
                  Storage capacity / type <Optional />
                </>
              }
              name="storage"
              defaultValue={r.storage || ''}
            />
            <Input
              label={
                <>
                  Runtime / OS / image <Optional />
                </>
              }
              name="image"
              defaultValue={r.image || ''}
            />
          </>
        )}
        <Input
          label={
            <>
              {hardware ? 'Inspection / support requirements' : 'SLA / support needs'} <Optional />
            </>
          }
          name="sla"
          defaultValue={r.sla || ''}
        />
        <Input
          label="Delivery / access method"
          name="deliveryMethod"
          defaultValue={r.deliveryMethod || deliveryMethod(r)}
        />
        <div>
          <label className="form-label">Urgency</label>
          <select className="field" name="urgency" defaultValue={String(r.urgency || 'Standard')}>
            {['Standard', 'High urgency', 'Flexible start'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label">Visibility</label>
          <select
            className="field"
            name="visibility"
            disabled={Boolean(r.originSupply)}
            defaultValue={
              r.originSupply ? 'Private RFQ' : String(r.visibility || 'Public requirements')
            }
          >
            {['Public requirements', 'Private RFQ'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </div>
        <div className="full">
          <label className="form-label">
            {hardware
              ? 'Hardware specifications and acceptance requirements'
              : 'Workload and acceptance requirements'}{' '}
            <Optional />
          </label>
          <textarea
            className="field"
            name="notes"
            rows={4}
            maxLength={4000}
            defaultValue={String(r.notes || '')}
          />
        </div>
      </div>
      <label className="row form-note">
        <input
          type="checkbox"
          name="shareClosingPrice"
          defaultChecked={r.shareClosingPrice !== false}
        />
        Share the awarded price with participating suppliers after the RFQ closes.
      </label>
      <p className="form-note">
        No payment is taken. A supplier quote confirms the exact capacity, availability window and
        payable amount.
      </p>
      <div className="modal-footer proc-rfq-footer">
        <div className="proc-maximum-quote">
          Maximum Quote Price:{' '}
          <strong data-proc-maximum-quote aria-live="polite">
            {maximum === null ? '—' : money(maximum)}
          </strong>
        </div>
        <PBtn data-act="close-modal" onClick={closeModal}>
          Cancel
        </PBtn>
        <button className="btn" type="submit" disabled={submitting}>
          {editing
            ? 'Save requirement'
            : quoteRequest
              ? 'Submit request'
              : r.originSupply
                ? 'Request supplier quote'
                : 'Post RFQ'}
        </button>
      </div>
    </form>
  );
}
