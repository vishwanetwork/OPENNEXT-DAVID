'use client';

import { useState, type FormEvent } from 'react';
import type { OwnedRfq, OwnedSupply } from '@opennext/contracts';
import { useToast } from '@/components/ui/toast';
import { useTerminal, useWorkspaceData, useWorkspaceStore } from '@/terminal-kit';
import { procurementApi } from '../api';
import { FEE_LABEL } from '../fees';
import { useRunServer, useSubmissionId } from '../hooks';
import { useFindMarketRow } from '../market-view';
import { PBtn, SellerEstimate } from './shared';
import { Input, formData } from './fields';

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
