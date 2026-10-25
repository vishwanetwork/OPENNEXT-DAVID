'use client';

import type { OwnedRfq, Quote } from '@opennext/contracts';
import { money } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { useApi } from '@/components/providers/api-context';
import { RfqDetails } from '@/features/rfq-details';
import { useTerminal } from '@/terminal-kit';
import { procurementApi } from '../api';
import { currentFees } from '../fees';
import { unitSuffix } from '../exchange';
import { useRunServer } from '../hooks';
import { FeeBreakdown, Field, FieldList, PBtn, date, deliveryTime } from './shared';
import { RequirementFields } from './requirement-fields';

export function AcceptReview({ r, q }: { r: OwnedRfq; q: Quote | undefined }) {
  const { openModal } = useTerminal();
  const api = useApi();
  const toast = useToast();
  const { run, busy } = useRunServer();
  const accept = () =>
    void run(async () => {
      if (!r.serverRecord || !q) throw new Error('Refresh the verified quotation record.');
      if (!currentFees(q))
        throw new Error(
          'Request an updated quote with the complete fee breakdown before acceptance.',
        );
      await procurementApi.decideQuote(api, r.id, q.id, 'accept');
      toast('Supplier selected. The order awaits payment integration.');
    });
  return (
    <>
      <div className="details-grid">
        <Field label="Supplier" value={q?.provider} />
        <Field label="Base unit price" value={money(q?.price) + unitSuffix(r)} />
        <Field label="Delivery" value={deliveryTime(q?.delivery, r)} />
        <Field label="Valid until" value={date(q?.validUntil)} />
      </div>
      <FeeBreakdown record={q} />
      <p className="form-note">
        Accepting selects this supplier and closes the other pending quotes.{' '}
        {r.shareClosingPrice
          ? 'Participating suppliers will see the closing price.'
          : 'The closing price remains private.'}{' '}
        Payment is a separate step.
      </p>
      {!currentFees(q) ? (
        <p className="form-note">
          Request an updated quote with the complete fee breakdown before acceptance.
        </p>
      ) : null}
      <div className="modal-footer">
        <PBtn data-act="view-rfq" data-id={r.id} onClick={() => openModal('rfq', { id: r.id })}>
          Back to quotes
        </PBtn>
        <PBtn
          primary
          data-act="proc-accept-confirm"
          data-id={r.id}
          data-quote={q?.id}
          disabled={!currentFees(q) || busy}
          onClick={accept}
        >
          Confirm acceptance
        </PBtn>
      </div>
    </>
  );
}

export function QuoteDetails({ r, q }: { r: OwnedRfq; q: Quote | undefined }) {
  const { openModal } = useTerminal();
  return (
    <>
      <RequirementFields r={r} />
      <div className="details-grid">
        <FieldList
          items={[
            ['Base unit price', money(q?.price) + unitSuffix(r)],
            ['Delivery lead time', deliveryTime(q?.delivery, r)],
            ['SLA / warranty', q?.sla],
            ['Payment terms', q?.paymentTerms],
            ['Delivery method', q?.deliveryMethod],
            ['Cancellation', q?.cancellation],
            ['Valid until', date(q?.validUntil)],
          ]}
        />
      </div>
      <FeeBreakdown record={q} />
      <div className="modal-footer">
        <PBtn data-act="view-rfq" data-id={r.id} onClick={() => openModal('rfq', { id: r.id })}>
          Back to quotes
        </PBtn>
      </div>
    </>
  );
}

export function RequestDetails({ r }: { r: OwnedRfq | undefined }) {
  const { closeModal } = useTerminal();
  return (
    <>
      {r ? (
        <RfqDetails
          record={r as unknown as Parameters<typeof RfqDetails>[0]['record']}
          money={money}
          date={date}
        />
      ) : (
        <p className="form-note">Refresh RFQs &amp; Quote to load this request.</p>
      )}
      <div className="modal-footer">
        <PBtn data-act="close-modal" onClick={closeModal}>
          Close
        </PBtn>
      </div>
    </>
  );
}
export { RecordView } from './record-view';
