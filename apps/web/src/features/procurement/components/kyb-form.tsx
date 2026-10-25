'use client';

import { type FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { useWorkspaceStore } from '@/terminal-kit';
import { procurementApi } from '../api';
import { useRunServer, useSubmissionId } from '../hooks';
import { CountrySelect, Input, formData } from './fields';

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
        company: data.company ?? '',
        registration: data.registration ?? '',
        country: data.country ?? '',
        evidence: data.evidence ?? '',
        rights: data.rights ?? '',
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
