'use client';

import { Dialog } from '@/components/ui/dialog';
import type { BuyerKybAdminService, BuyerKybCase, BuyerKybCompany } from '@/lib/buyer-kyb';
import { stampUtc } from '@/lib/format';
import { KybDocuments } from './documents';
import { KybDecision } from './decision';

const COMPANY_FIELDS: [keyof BuyerKybCompany, string][] = [
  ['country', 'Country / region of registration'],
  ['companyName', 'Registered company name'],
  ['registrationNumber', 'Registration number'],
  ['email', 'Business email'],
  ['website', 'Website'],
  ['taxId', 'Tax ID'],
  ['monthlyVolumeUsd', 'Estimated monthly transaction volume (USD)'],
  ['monthlyTransactions', 'Estimated monthly transaction count'],
  ['businessDescription', 'Business description'],
  ['incorporationDate', 'Date of incorporation'],
  ['legalForm', 'Legal form'],
  ['legalAddress', 'Registered business address'],
  ['phone', 'Contact phone'],
];

export function BuyerKybDetails({
  record,
  service,
  onClose,
  onConfirmed,
  onRefresh,
  onAccessDenied,
}: {
  record: BuyerKybCase;
  service: BuyerKybAdminService;
  onClose: () => void;
  onConfirmed: () => Promise<void>;
  onRefresh: () => void;
  onAccessDenied: () => void;
}) {
  return (
    <Dialog
      overlayClassName="buyer-kyb-overlay"
      className="buyer-kyb-modal"
      label="Buyer KYB details"
      onClose={onClose}
    >
      <header className="buyer-kyb-modal-header">
        <div>
          <span className="buyer-kyb-eyebrow">
            {record.mode} · {record.status}
          </span>
          <h2>Buyer KYB details</h2>
        </div>
        <button
          type="button"
          className="btn"
          aria-label="Close Buyer KYB details"
          onClick={onClose}
        >
          Close
        </button>
      </header>
      <dl className="buyer-kyb-fields">
        <div>
          <dt>Applicant email</dt>
          <dd>{record.email}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{stampUtc(record.submittedAt)}</dd>
        </div>
        {COMPANY_FIELDS.map(([field, label]) => (
          <div key={field}>
            <dt>{label}</dt>
            <dd>{record.company[field] || 'Not provided'}</dd>
          </div>
        ))}
      </dl>
      <KybDocuments record={record} service={service} onAccessDenied={onAccessDenied} />
      <KybDecision
        record={record}
        service={service}
        onConfirmed={onConfirmed}
        onRefresh={onRefresh}
        onAccessDenied={onAccessDenied}
      />
    </Dialog>
  );
}
