'use client';

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { OwnedRfq, OwnedSupply, RfqRequest, SupplyRequest } from '@opennext/contracts';
import { money } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { ALL_REGIONS, offersFor, usePrices, useRegions } from '@/features/market';
import {
  useInvalidateWorkspace,
  useIsDemo,
  useTerminal,
  useWorkspaceData,
  useWorkspaceStore,
} from '@/terminal-kit';
import { procurementApi } from '../api';
import { countryList } from './../countries';
import { FEE_LABEL, maximumQuotePrice } from '../fees';
import { deliveryMethod, isHardware, isModel, kindOf, uid } from '../exchange';
import { useRunServer, useSubmissionId } from '../hooks';
import { useFindMarketRow } from '../market-view';
import { PBtn, SellerEstimate, isoInput, receiptFor } from './shared';

/* ---------- Primitive fields ---------- */

export function Input({
  label,
  name,
  defaultValue,
  type = 'text',
  readOnly,
  ...rest
}: {
  label: ReactNode;
  name: string;
  defaultValue?: unknown;
  type?: string;
  readOnly?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name' | 'type' | 'defaultValue'>) {
  return (
    <div>
      <label className="form-label" htmlFor={'proc-' + name}>
        {label}
      </label>
      <input
        className="field"
        id={'proc-' + name}
        name={name}
        type={type}
        defaultValue={
          defaultValue === null || defaultValue === undefined ? '' : String(defaultValue)
        }
        readOnly={readOnly}
        {...rest}
      />
    </div>
  );
}

export function CountrySelect({
  name,
  defaultValue = '',
  label = 'Region / data location',
}: {
  name: string;
  defaultValue?: string;
  label?: string;
}) {
  const list = countryList();
  const selected =
    list.find((item) => item.name === defaultValue || item.code === defaultValue)?.name || '';
  return (
    <div>
      <label className="form-label" htmlFor={'proc-' + name}>
        {label}
      </label>
      <select className="field" id={'proc-' + name} name={name} required defaultValue={selected}>
        <option value="">Select a country / territory</option>
        {list.map((item) => (
          <option key={item.code} value={item.name}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
}

const Optional = () => <span className="muted">(optional)</span>;

/* ---------- Submission (receipt / idempotency contract) ---------- */

interface SubmitOptions {
  recordKind: 'rfq' | 'supply';
  id?: string;
  data: Record<string, string>;
}

/** Legacy `submitRecord`: one in-flight request per form, stable client submission id, receipts, warnings. */
export function useSubmitRecord() {
  const { api, id: submissionId } = useSubmissionId();
  const toast = useToast();
  const invalidate = useInvalidateWorkspace();
  const demo = useIsDemo();
  const [submitting, setSubmitting] = useState(false);
  const submit = async ({ recordKind, id, data }: SubmitOptions) => {
    if (submitting) return;
    setSubmitting(true);
    let saved: { id: string } | null = null;
    const S = useWorkspaceStore.getState();
    try {
      let result: { id: string; status?: string | null; submission?: unknown };
      const warnings: string[] = [];
      if (recordKind === 'supply') {
        const input: SupplyRequest = {
          ...(data as unknown as SupplyRequest),
          serviceStart: new Date(data.serviceStart + 'Z').toISOString(),
          serviceEnd: new Date(data.serviceEnd + 'Z').toISOString(),
        };
        if (!id) input.clientSubmissionId = submissionId();
        result = (await procurementApi.createSupply(api, input)).supply;
      } else {
        const requestKind = data.requestKind === 'quote_request' ? 'quote_request' : 'rfq';
        const input: RfqRequest = {
          ...(data as unknown as RfqRequest),
          start: new Date(data.start + 'Z').toISOString(),
          quoteDeadline: new Date(data.quoteDeadline + 'Z').toISOString(),
          shareClosingPrice: !!data.shareClosingPrice,
          requestKind,
          title: String(
            data.title ||
              [
                data.model,
                data.term,
                requestKind === 'quote_request' ? 'quote request' : 'capacity request',
              ]
                .filter(Boolean)
                .join(' · '),
          ).slice(0, 140),
        };
        if (data.selectedOffer)
          input.selectedOffer =
            typeof data.selectedOffer === 'string'
              ? JSON.parse(data.selectedOffer)
              : data.selectedOffer;
        if (!id) input.clientSubmissionId = submissionId();
        result = id
          ? (await procurementApi.updateRfq(api, id, input)).rfq
          : (await procurementApi.createRfq(api, input)).rfq;
      }
      if (!result || typeof result.id !== 'string' || !result.id)
        throw new Error(
          'The server did not return a submission reference. Refresh your records before trying again.',
        );
      saved = { id: result.id };
      const modal = {
        type: 'proc-submission' as const,
        id: result.id,
        recordKind,
        receipt: receiptFor(result),
        recordStatus: result.status || 'Saved',
        warnings,
        demo,
      };
      S.patch({ modal });
      if (recordKind === 'supply') {
        try {
          const installation = await procurementApi.requestAgent(api, result.id);
          if (installation.message) warnings.push(installation.message);
        } catch {
          warnings.push(
            'Capacity is saved. The agent setup request is pending; use Refresh status in My Supply instead of submitting the capacity again.',
          );
        }
      }
      try {
        await invalidate();
      } catch {
        warnings.push(
          'Your submission is saved, but the workspace could not refresh. Keep this reference and refresh your records. Do not submit it again.',
        );
      }
      useWorkspaceStore.getState().patch({ modal: { ...modal, warnings: [...warnings] } });
      toast(
        modal.receipt
          ? modal.demo
            ? 'Saved to the isolated Demo workspace.'
            : 'Submission received by OpenNEXT operations.'
          : 'Saved to your account. Operations receipt has not been confirmed.',
      );
    } catch (error) {
      toast(
        saved
          ? 'Your submission is saved. Keep reference ' + saved.id + ' and refresh your records.'
          : (error as Error).message,
      );
    } finally {
      setSubmitting(false);
    }
  };
  return { submit, submitting };
}

const formData = (event: FormEvent<HTMLFormElement>) =>
  Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;

/* ---------- RFQ form ---------- */

function BudgetRange({
  r,
  model,
  onPick,
}: {
  r: Record<string, unknown>;
  model: string;
  onPick: (value: number) => void;
}) {
  const prices = usePrices();
  const regions = useRegions();
  const storedTerm = useWorkspaceStore((s) => s.term);
  const term = String(r.term || storedTerm);
  const rates = useMemo(
    () =>
      offersFor(prices.data?.records || [], { model, term, region: ALL_REGIONS }, regions)
        .filter((o) => !o.stale && Number(o.price) > 0)
        .map((o) => Number(o.price)),
    [prices.data, model, term, regions],
  );
  if (isModel(r) || isHardware(r)) return null;
  const min = rates.length ? Math.min(...rates) : null;
  const max = rates.length ? Math.max(...rates) : null;
  const average = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max) || min <= 0)
    return (
      <div className="proc-range full">
        <p className="form-note">
          No current reference range is available for this GPU. Enter your maximum price manually.
        </p>
      </div>
    );
  const selectedValue = Number(r.budget) || min;
  return (
    <div className="proc-range full">
      <label className="form-label" htmlFor="proc-budget-slider">
        {model} reference price range
      </label>
      <input
        id="proc-budget-slider"
        type="range"
        data-proc-budget-range
        min={min}
        max={max}
        step="0.000001"
        defaultValue={Math.min(max, Math.max(min, selectedValue))}
        disabled={min === max}
        onChange={(e) => onPick(Number(Number(e.target.value).toFixed(6)))}
      />
      <div className="row spread">
        <span>Low {money(min)}</span>
        {average !== null && Number.isFinite(average) ? (
          <span>Average {money(average)}</span>
        ) : null}
        <span>High {money(max)}</span>
      </div>
      <p className="form-note">
        USD / GPU-hour · Observed market prices, not a guaranteed quote. You may enter a higher
        maximum for urgent requirements.
      </p>
    </div>
  );
}

export function RfqForm({
  r = {},
  editing = false,
}: {
  r?: Partial<OwnedRfq> & Record<string, unknown>;
  editing?: boolean;
}) {
  const S = useWorkspaceStore();
  const { closeModal } = useTerminal();
  const { submit, submitting } = useSubmitRecord();
  const findMarketRow = useFindMarketRow();
  const model = isModel(r);
  const hardware = isHardware(r);
  const chosen = findMarketRow(r.originSupply as string | undefined);
  const quoteRequest = r.requestKind === 'quote_request';
  const [live, setLive] = useState({
    budget: r.budget ?? '',
    count: r.count || S.count || 8,
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
          defaultValue={r.model || S.model}
          required
          readOnly={Boolean(r.originSupply)}
        />
        <CountrySelect name="region" defaultValue={String(r.region || S.region)} />
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
              defaultValue={r.count || S.count || 8}
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
            <select className="field" name="term" defaultValue={String(r.term || S.term)}>
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
          model={String(r.model || S.model)}
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

/* ---------- KYB ---------- */

export function KybForm() {
  const { api } = useSubmissionId();
  const { run, busy } = useRunServer();
  const toast = useToast();
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = formData(event);
    void run(async () => {
      await procurementApi.submitKyb(api, {
        company: data.company,
        registration: data.registration,
        country: data.country,
        evidence: data.evidence,
        rights: data.rights,
        eligibility: !!data.eligibility,
        rightsConfirmed: !!data.rightsConfirmed,
      });
      useWorkspaceStore.getState().closeModal();
      toast(
        'Your supplier review is in progress. You will be notified when the review is complete.',
      );
    });
  };
  return (
    <form data-form="proc-kyb" onSubmit={onSubmit}>
      <h3>Eligibility &amp; business verification</h3>
      <div className="form-grid">
        <Input label="Registered company name" name="company" required maxLength={160} />
        <Input
          label="Registration / business identifier"
          name="registration"
          required
          maxLength={160}
        />
        <CountrySelect name="country" label="Country of registration" />
        <div className="full">
          <label className="form-label">Business verification evidence</label>
          <textarea
            className="field"
            name="evidence"
            rows={3}
            maxLength={3000}
            required
            placeholder="Provide a secure document reference or the evidence operations should review. Do not include passwords or private keys."
          />
        </div>
        <div className="full">
          <label className="form-label">Ownership / authorized supply rights</label>
          <textarea
            className="field"
            name="rights"
            rows={3}
            maxLength={3000}
            required
            placeholder="Explain ownership or contractual rights to offer the capacity."
          />
        </div>
      </div>
      <label className="row proc-check">
        <input name="eligibility" type="checkbox" required />I am authorized to represent this
        business and meet supplier eligibility requirements.
      </label>
      <label className="row proc-check">
        <input name="rightsConfirmed" type="checkbox" required />
        The business has valid ownership or authorized supply rights.
      </label>
      <p className="form-note">
        Operations reviews every submission. Completing this form does not automatically approve
        your business.
      </p>
      <div className="modal-footer">
        <button className="btn" type="submit" disabled={busy}>
          Submit for review
        </button>
      </div>
    </form>
  );
}

/* ---------- Supply ---------- */

export function SupplyForm() {
  const S = useWorkspaceStore();
  const { submit, submitting } = useSubmitRecord();
  const [live, setLive] = useState({ rate: '', count: '', hours: '' });
  const track = (name: keyof typeof live) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setLive((prev) => ({ ...prev, [name]: event.target.value }));
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit({ recordKind: 'supply', data: formData(event) });
  };
  return (
    <form data-form="proc-supply" onSubmit={onSubmit}>
      <input type="hidden" name="kind" value="gpu_rental" />
      <div className="form-grid">
        <Input label="Listing title" name="title" required maxLength={140} />
        <Input label="GPU model" name="model" defaultValue={S.model} required maxLength={100} />
        <CountrySelect name="region" />
        <Input
          label="Available GPU count"
          name="count"
          type="number"
          required
          min={1}
          max={65536}
          step={1}
          onChange={track('count')}
        />
        <Input
          label="Available duration (hours)"
          name="hours"
          type="number"
          required
          min={1}
          max={26280}
          step={1}
          onChange={track('hours')}
        />
        <div>
          <label className="form-label">Market terms</label>
          <select className="field" name="term" defaultValue="Spot">
            <option>Spot</option>
            <option>On-demand</option>
            <option>Reserved</option>
          </select>
        </div>
        <Input
          label="Your unit price (USD / GPU-hour)"
          name="netPrice"
          type="number"
          required
          min="0.01"
          step="0.01"
          data-proc-net-price
          onChange={track('rate')}
        />
        <SellerEstimate rate={live.rate} count={live.count} hours={live.hours} />
        <Input label="Available from (UTC)" name="serviceStart" type="datetime-local" required />
        <Input label="Available until (UTC)" name="serviceEnd" type="datetime-local" required />
        <div className="full">
          <label className="form-label">Specifications and commercial terms</label>
          <textarea className="field" name="notes" rows={3} maxLength={4000} required />
        </div>
      </div>
      <p className="form-note">
        Your listed unit price remains unchanged. {FEE_LABEL} is deducted from the base order amount
        at settlement. Final amounts depend on the quantity and duration ordered.
      </p>
      <h3>Agent installation handoff</h3>
      <p className="form-note">
        Provide the SSH endpoint for the backend installation team. Never paste a private key or
        password. Supply stays unavailable until the trusted installer reports successful
        verification.
      </p>
      <div className="form-grid">
        <Input label="SSH host / IP" name="sshHost" required maxLength={253} />
        <Input label="SSH user" name="sshUser" required maxLength={100} />
        <Input
          label="SSH port"
          name="sshPort"
          defaultValue="22"
          type="number"
          required
          min={1}
          max={65535}
        />
      </div>
      <div className="modal-footer">
        <button className="btn" type="submit" disabled={submitting}>
          Submit capacity &amp; request agent setup
        </button>
      </div>
    </form>
  );
}

/* ---------- Seller response (quote) ---------- */

export function ResponseForm({ req }: { req: OwnedRfq }) {
  const workspace = useWorkspaceData();
  const listings = workspace.listings as OwnedSupply[];
  const findMarketRow = useFindMarketRow();
  const { api } = useSubmissionId();
  const { run, busy } = useRunServer();
  const toast = useToast();
  const { openModal } = useTerminal();
  const [rate, setRate] = useState('');
  const choices = listings.filter(
    (s) => s.status === 'Published' && s.model === req.model && s.region === req.region,
  );
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = formData(event);
    if (/^EXT-/.test(req.id) || findMarketRow(req.id)?.external) {
      toast('Use Offer capacity to contact OpenNEXT operations for this sourced requirement.');
      return;
    }
    void run(async () => {
      await procurementApi.submitQuote(api, req.id, {
        supplyId: data.supplyId,
        rate: data.rate,
        delivery: data.delivery,
        validUntil: new Date(data.validUntil + 'Z').toISOString(),
        notes: data.notes,
      });
      useWorkspaceStore.getState().closeModal();
      toast('Your quote has been submitted to the buyer.');
    });
  };
  if (!choices.length)
    return (
      <>
        <div className="callout">
          Publish matching, agent-verified capacity before responding to this requirement.
        </div>
        <PBtn
          data-act="new-supply"
          onClick={() =>
            openModal(workspace.review.status === 'Approved' ? 'supply-form' : 'review')
          }
        >
          List matching supply
        </PBtn>
      </>
    );
  return (
    <form data-form="proc-response" data-id={req.id} onSubmit={onSubmit}>
      <div className="form-grid">
        <div>
          <label className="form-label">Verified supply</label>
          <select className="field" name="supplyId" required defaultValue={choices[0].id}>
            {choices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.model} · {s.count} GPU · {s.id}
              </option>
            ))}
          </select>
        </div>
        <Input
          label="Your unit price (USD / GPU-hour)"
          name="rate"
          type="number"
          required
          min="0.01"
          step="0.01"
          data-proc-net-price
          onChange={(e) => setRate(e.target.value)}
        />
        <Input
          label="Delivery lead time (minutes)"
          name="delivery"
          type="number"
          required
          min={1}
        />
        <Input label="Quote valid until (UTC)" name="validUntil" type="datetime-local" required />
        <div className="full">
          <label className="form-label">Commercial and service terms</label>
          <textarea name="notes" className="field" required maxLength={4000} />
        </div>
        <SellerEstimate rate={rate} count={req.count} hours={req.hours} />
      </div>
      <p className="form-note">
        Your base unit price is shown unchanged. {FEE_LABEL} is deducted from your base order amount
        at settlement. The buyer pays their own 5% fee separately at checkout. Only verified
        installed capacity can be quoted.
      </p>
      <div className="modal-footer">
        <button className="btn" type="submit" disabled={busy}>
          Submit quote
        </button>
      </div>
    </form>
  );
}

export const newId = uid;
