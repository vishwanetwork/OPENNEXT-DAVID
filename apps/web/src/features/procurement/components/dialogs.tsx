'use client';

import { useTerminal, useTerminalSlots } from '@/terminal-kit';
import { maximumQuotePrice } from '../fees';
import { FieldList, PBtn, date } from './shared';

/* ---------- Submission + history ---------- */
export interface SubmissionModalState {
  id: string;
  recordKind: 'rfq' | 'supply';
  receipt: { receiptId: string; receivedAt: string; revision?: number } | null;
  recordStatus: string;
  warnings: string[];
  demo: boolean;
}

export const submissionTitle = (m: SubmissionModalState) =>
  m.recordKind !== 'supply'
    ? m.receipt
      ? 'Request submitted successfully'
      : 'Request saved'
    : m.demo
      ? 'Demo submission saved'
      : m.receipt
        ? 'Submission received'
        : 'Submission saved';

export function SubmissionModal({ m }: { m: SubmissionModalState }) {
  const { closeModal, go } = useTerminal();
  const confirmed = !!m.receipt;
  const supply = m.recordKind === 'supply';
  const view = (route: string) => {
    closeModal();
    go(route);
  };
  if (!supply)
    return (
      <>
        <div className="proc-request-success">
          <p>
            {confirmed
              ? 'Your request has been submitted successfully. Our team will match suitable capacity as soon as possible and notify you of the latest progress. Our sales team may also contact you by email.'
              : 'Your request has been saved. Operations receipt is not yet confirmed; refresh your records before submitting again.'}
          </p>
          <p className="form-note">
            You can find this request in RFQs &amp; Quote. It remains Reviewing until operations
            approves publication.
          </p>
          {m.warnings.map((message, i) => (
            <p key={i} className="form-note" role="status">
              {message}
            </p>
          ))}
        </div>
        <div className="modal-footer">
          <PBtn data-act="proc-submission-view" data-id="rfq" onClick={() => view('rfqs')}>
            RFQs &amp; Quote
          </PBtn>
          <PBtn primary data-act="close-modal" onClick={closeModal}>
            OK
          </PBtn>
        </div>
      </>
    );
  return (
    <>
      <p className="form-note">
        {m.demo
          ? 'This record belongs only to your isolated test workspace. It is not a production submission.' +
            (confirmed
              ? ' Operations can find it in Console under Demo submissions while this workspace is active.'
              : '')
          : confirmed
            ? 'Your capacity submission is available in the OpenNEXT operations inbox.'
            : 'The server saved your record. A Console receipt has not been confirmed by the connected backend.'}
      </p>
      <div className="details-grid">
        <FieldList
          items={[
            ['Record', m.id],
            ['Operations receipt', m.receipt?.receiptId || 'Not confirmed'],
            ['Received', m.receipt ? date(m.receipt.receivedAt) : 'Not confirmed'],
            ['Version', m.receipt?.revision || '—'],
            ['Marketplace status', m.recordStatus],
          ]}
        />
      </div>
      <div className="callout">
        Receipt does not publish capacity. KYB approval and verified agent installation are still
        required.
      </div>
      {m.warnings.map((message, i) => (
        <p key={i} className="form-note" role="status">
          {message}
        </p>
      ))}
      <div className="modal-footer">
        <PBtn data-act="close-modal" onClick={closeModal}>
          Close
        </PBtn>
        <PBtn
          primary
          data-act="proc-submission-view"
          data-id="supply"
          onClick={() => view('supply')}
        >
          View My Supply
        </PBtn>
      </div>
    </>
  );
}

export function HistoryUpgrade() {
  const { closeModal } = useTerminal();
  const { openContact } = useTerminalSlots();
  return (
    <>
      <p className="form-note">
        Historical data for up to 3 months is free. Contact Sales for access to 6M, 1Y or all
        available history.
      </p>
      <div className="modal-footer">
        <PBtn data-act="close-modal" onClick={closeModal}>
          Not now
        </PBtn>
        <PBtn
          primary
          data-act="proc-contact-sales"
          onClick={() => {
            closeModal();
            openContact();
          }}
        >
          Contact Sales
        </PBtn>
      </div>
    </>
  );
}

export { maximumQuotePrice };
export { AcceptReview } from './rfq-dialogs';
export { ExternalDetails } from './listing-dialogs';
export { ListingDialog } from './listing-dialogs';
export { OrderAction } from './order-dialogs';
export { QuoteDetails } from './rfq-dialogs';
export { RecordView } from './rfq-dialogs';
export { RequestDetails } from './rfq-dialogs';
export { ResponseDialog } from './listing-dialogs';
export { ResponseRecord } from './listing-dialogs';
export { ReviewDialog } from './review-dialogs';
export { SupplyDialog } from './review-dialogs';
export { SupplyStatus } from './review-dialogs';
export { externalTitle } from './listing-dialogs';
export { listingTitle } from './listing-dialogs';
export { orderActionTitle } from './order-dialogs';
export { reviewTitle } from './review-dialogs';
