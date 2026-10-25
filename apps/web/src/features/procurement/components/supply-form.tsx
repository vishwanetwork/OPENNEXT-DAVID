'use client';

import { useState, type FormEvent } from 'react';
import { useWorkspaceStore } from '@/terminal-kit';
import { FEE_LABEL } from '../fees';
import { SellerEstimate } from './shared';
import { CountrySelect, Input, formData } from './fields';
import { useSubmitRecord } from './use-submit-record';

/* ---------- Supply ---------- */
export function SupplyForm() {
  const workspace = useWorkspaceStore();
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
        <Input
          label="GPU model"
          name="model"
          defaultValue={workspace.model}
          required
          maxLength={100}
        />
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
