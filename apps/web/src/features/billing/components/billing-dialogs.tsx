'use client';

import type { LedgerEntry, Payout } from '@opennext/contracts';
import { useToast } from '@/components/ui/toast';
import { downloadText, useBalance, useTerminal, useWorkspaceStore } from '@/terminal-kit';
import { useBillingData } from '../hooks';
import {
  FEE_LABEL,
  csv,
  exportRows,
  ledgerAmount,
  ledgerLabel,
  stamp,
  usd,
  type BillingData,
} from '../analytics';
import { Detail } from './billing-page';
import { Btn } from './billing-modals';

export function exportDownload(
  billing: BillingData,
  type: string,
  id: string | undefined,
  toast: (m: string) => void,
) {
  const rows = exportRows(billing, type, id);
  if (!rows.length) return toast('No records to export in this period');
  downloadText('OpenNEXT-' + type + '.csv', csv(rows), 'text/csv;charset=utf-8');
}

export function Measurement() {
  const role = useWorkspaceStore((s) => s.role);
  return (
    <>
      <div className="callout">
        Spending comes from posted account charges, not GPU utilization estimates. Credit additions
        and withdrawals are excluded from operating spend.
      </div>
      <div className="bill-detail-grid">
        <Detail label="Reserved GPU-hours" value="Paid GPU count × contracted hours" />
        <Detail label="Metered GPU-hours" value="Usage recorded by your resource provider" />
        <Detail
          label="Utilization"
          value="Metered / reserved GPU-hours; only when coverage is complete"
        />
        <Detail
          label="Earnings"
          value="Net settled sale proceeds, after the recorded OpenNEXT fee; excludes top-ups"
        />
        <Detail
          label={FEE_LABEL}
          value="Buyer: base order amount + 5%. Seller: base order amount − 5%. Top-ups are not charged this order fee."
        />
        <Detail label="Trading margin" value="Sales revenue minus purchase charges" />
        <Detail
          label={role === 'seller' ? 'Commission paid' : 'Commission earned'}
          value={
            role === 'seller'
              ? 'Broker fees are negative expenses'
              : 'Broker fees, reported separately'
          }
        />
      </div>
      <p className="form-note">
        Provider telemetry and actual payment processing will be connected separately. Unknown
        values remain unavailable rather than being estimated as fact.
      </p>
    </>
  );
}

export function CashoutStart() {
  const { closeModal } = useTerminal();
  const { earnings } = useBalance();
  return (
    <>
      <div className="pay-summary">
        <span>Available to withdraw</span>
        <strong>{usd(earnings)}</strong>
      </div>
      <p className="form-note">
        Payout processing is not configured yet. Contact your OpenNEXT account team to arrange a
        verified payout. Promotional credit and prepaid purchasing credit cannot be withdrawn.
      </p>
      <div className="modal-footer">
        <Btn act="close-modal" onClick={closeModal}>
          Close
        </Btn>
      </div>
    </>
  );
}

export function CashoutDetail({ payout }: { payout: Payout }) {
  const { closeModal } = useTerminal();
  return (
    <>
      <div className="bill-detail-grid">
        <Detail label="Amount" value={usd(payout.amount)} />
        <Detail label="Status" value={payout.status} />
        <Detail label="Destination" value={payout.destination} />
        <Detail label="Beneficiary" value={payout.beneficiary} />
        <Detail label="Requested" value={stamp(payout.createdAt)} />
        <Detail label="Completed" value={stamp(payout.paidAt)} />
      </div>
      <p className="form-note">
        Payout status is confirmed by the payment service. It cannot be changed from this page.
      </p>
      <div className="modal-footer">
        <Btn act="close-modal" onClick={closeModal}>
          Close
        </Btn>
      </div>
    </>
  );
}

export function RecordModal({ l }: { l: LedgerEntry }) {
  const billing = useBillingData();
  const toast = useToast();
  const identity = useWorkspaceStore((s) => s.identity);
  return (
    <>
      {l.test ? (
        <div className="bill-test-notice">
          <strong>Test transaction</strong>No real funds were charged or transferred.
        </div>
      ) : null}
      <div className="bill-detail-grid">
        <Detail label="Description" value={ledgerLabel(billing.role, l)} />
        <Detail label="Amount" value={usd(ledgerAmount(billing.role, l))} />
        <Detail label="Status" value={l.status || 'Posted'} />
        <Detail label="Date" value={stamp(l.createdAt || l.date)} />
        <Detail label="Account" value={identity.email} />
        <Detail label="Payment method" value={l.paymentMethod || 'Not recorded'} />
        <Detail label="Destination" value={l.destination || 'Not applicable'} />
        <Detail label="Transaction ID" value={l.paymentId || l.id} />
      </div>
      <div className="modal-footer">
        <Btn
          act="bill-export"
          value="record"
          id={l.id}
          onClick={() => exportDownload(billing, 'record', l.id, toast)}
        >
          Download record
        </Btn>
      </div>
    </>
  );
}
