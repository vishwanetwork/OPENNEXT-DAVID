import { money } from '@/lib/format';
import type {
  PaymentReviewKind,
  PaymentReviewRecord,
  PaymentReviewService,
} from '@/lib/payment-review';
import { canComplete, reviewable } from './validation';

export function PaymentRequestTable({
  kind,
  rows,
  service,
  onSelect,
}: {
  kind: PaymentReviewKind;
  rows: PaymentReviewRecord[];
  service?: PaymentReviewService;
  onSelect: (id: string, action: 'Details' | 'Confirm' | 'Fail') => void;
}) {
  const topup = kind === 'topup';
  const headings = topup
    ? ['Account #', 'Top-up Amount', 'Current Credit', 'Action']
    : ['Order', 'Payment Amount', 'Account #', 'Email', 'Action'];
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headings.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <button
                  type="button"
                  className="payment-request-link"
                  aria-label={`View request ${row.id}`}
                  onClick={() => onSelect(row.id, 'Details')}
                >
                  {topup ? (row.accountNumber ?? 'Not assigned') : (row.orderId ?? 'Not recorded')}
                </button>
              </td>
              <td>{money(row.amountCents / 100)}</td>
              {topup ? (
                <td>
                  {row.currentCreditCents === undefined
                    ? 'Unavailable'
                    : money(row.currentCreditCents / 100)}
                </td>
              ) : (
                <>
                  <td>{row.accountNumber ?? 'Not assigned'}</td>
                  <td>{row.email}</td>
                </>
              )}
              <td>
                {row.status === 'Pending' ? (
                  <div className="payment-review-actions">
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={!canComplete(row, service)}
                      onClick={() => onSelect(row.id, 'Confirm')}
                    >
                      Completed
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      disabled={!reviewable(row)}
                      onClick={() => onSelect(row.id, 'Fail')}
                    >
                      Failed
                    </button>
                  </div>
                ) : row.status === 'Confirmed' ? (
                  'Completed'
                ) : (
                  'Failed'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
