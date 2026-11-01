import { Dialog } from '@/components/ui/dialog';
import { money, stampUtc } from '@/lib/format';
import type { PaymentReviewRecord } from '@/lib/payment-review';
import { reviewable } from './validation';

export function PaymentDetails({
  record,
  onClose,
}: {
  record: PaymentReviewRecord;
  onClose: () => void;
}) {
  return (
    <Dialog
      overlayClassName="payment-review-overlay"
      className="payment-review-dialog"
      label="Payment request details"
      onClose={onClose}
    >
      <h2>Payment request details</h2>
      <dl>
        {[
          ['Account #', record.accountNumber ?? 'Not assigned'],
          ['Email', record.email],
          ['Request', record.id],
          ['Order', record.orderId ?? '—'],
          [
            record.kind === 'topup' ? 'Top-up Amount' : 'Payment Amount',
            money(record.amountCents / 100),
          ],
          ...(record.kind === 'topup'
            ? [
                [
                  'Current Credit',
                  record.currentCreditCents === undefined
                    ? 'Unavailable'
                    : money(record.currentCreditCents / 100),
                ],
              ]
            : []),
          ['Reference', record.reference],
          ['Submitted', stampUtc(record.submittedAt)],
          ['Status', record.status === 'Confirmed' ? 'Completed' : record.status],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {!reviewable(record) && record.status === 'Pending' && (
        <p className="payment-review-state">
          This record needs a verified, versioned payment basis before review. Legacy amounts are
          not re-priced or charged a second fee.
        </p>
      )}
      <footer>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </footer>
    </Dialog>
  );
}
