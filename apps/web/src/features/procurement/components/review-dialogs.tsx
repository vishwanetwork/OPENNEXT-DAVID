'use client';

import type { KybReview, OwnedSupply } from '@opennext/contracts';
import { money } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { useApi } from '@/components/providers/api-context';
import { useWorkspaceData } from '@/terminal-kit';
import { procurementApi } from '../api';
import { FEE_LABEL, baseRate } from '../fees';
import { useRunServer } from '../hooks';
import { useProcurementUi } from '../ui-store';
import { KybForm, SupplyForm } from './forms';
import { FieldList, PBtn, ReceiptDetails, Tag, date } from './shared';

/* ---------- Supplier review (KYB) ---------- */
export function ReviewDialog() {
  const r = useWorkspaceData().review as KybReview & { step: number };
  const revising = useProcurementUi((s) => s.revisingKyb);
  const setRevising = useProcurementUi((s) => s.setRevisingKyb);
  if (
    ['Reviewing', 'Approved', 'Rejected'].includes(r.status) &&
    !(revising && r.status === 'Rejected')
  )
    return (
      <>
        <Tag className={r.status === 'Reviewing' ? 'proc-reviewing' : ''}>{r.status}</Tag>
        <div className="details-grid">
          <FieldList
            items={[
              ['Company', r.company],
              ['Registration', r.registration],
              ['Country', r.country],
              ['Submitted', date(r.submittedAt)],
            ]}
          />
        </div>
        <p className="form-note">
          {r.status === 'Reviewing'
            ? 'Your application is in review. Listing is locked until operations approves your business identity and rights.'
            : r.status === 'Approved'
              ? 'Your business is approved. Each capacity submission still requires successful agent installation.'
              : r.reason || 'Review the submission and provide the requested evidence.'}
        </p>
        {r.status === 'Rejected' ? (
          <PBtn data-act="proc-kyb-revise" onClick={() => setRevising(true)}>
            Revise submission
          </PBtn>
        ) : null}
      </>
    );
  return <KybForm />;
}

export const reviewTitle = (status: string) =>
  ['Reviewing', 'Approved', 'Rejected'].includes(status)
    ? 'Supplier review'
    : 'Verify your business';

export function SupplyDialog() {
  const status = useWorkspaceData().review.status;
  return status === 'Approved' ? <SupplyForm /> : <ReviewDialog />;
}

export function SupplyStatus({ id }: { id: string }) {
  const listings = useWorkspaceData().listings as OwnedSupply[];
  const api = useApi();
  const toast = useToast();
  const { run, busy } = useRunServer();
  const r = listings.find((row) => row.id === id);
  if (!r) return <>Refresh your supply list to load this record.</>;
  return (
    <>
      <ReceiptDetails record={r} />
      <div className="details-grid">
        <FieldList
          items={[
            ['Supply', r.id],
            ['Status', r.status],
            ['Agent', r.agentStatus],
            ['Country', r.region],
            ['Base unit price', money(baseRate(r))],
            ['Seller fee', FEE_LABEL + ' deducted at settlement'],
            ['Service starts', date(r.serviceStart)],
            ['Service ends', date(r.serviceEnd)],
          ]}
        />
      </div>
      <div className="callout">
        {r.agentStatus === 'Succeeded'
          ? 'Agent installation is verified. This supply is available in the marketplace.'
          : 'Agent installation must be completed by the backend integration before this offer can be published. Browser actions cannot approve installation.'}
      </div>
      <div className="modal-footer">
        {['Pending', 'Failed'].includes(String(r.agentStatus)) ? (
          <PBtn
            primary
            data-act="proc-agent-request"
            data-id={r.id}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await procurementApi.requestAgent(api, r.id);
                if (result.message) toast(result.message);
              })
            }
          >
            Request installation update
          </PBtn>
        ) : null}
        <PBtn data-act="proc-refresh" disabled={busy} onClick={() => void run(async () => {})}>
          Refresh status
        </PBtn>
      </div>
    </>
  );
}
