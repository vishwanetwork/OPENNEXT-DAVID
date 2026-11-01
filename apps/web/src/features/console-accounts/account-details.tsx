import type { ReactNode } from 'react';
import { NativeDialog } from '@/components/ui/dialog';
import { AsyncFeedback } from '@/components/ui/async-feedback';
import { describeError } from '@/lib/api/errors';
import { money, stampUtc } from '@/lib/format';
import type { ConsoleAccountDetail } from '@/lib/console-account';
import { creditAmount, type AccountTab } from './account-table';

function HistoryTable({ headings, children }: { headings: string[]; children: ReactNode }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headings.map((heading) => (
              <th key={heading}>{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function AccountDetails({
  email,
  tab,
  setTab,
  data,
  loading,
  error,
  connected,
  close,
  next,
  previous,
}: {
  email: string;
  tab: AccountTab;
  setTab: (tab: AccountTab) => void;
  data?: ConsoleAccountDetail;
  loading: boolean;
  error: unknown;
  connected: boolean;
  close: () => void;
  next: () => void;
  previous?: () => void;
}) {
  const history = tab === 'credit' ? data?.creditHistory : data?.purchaseHistory;
  return (
    <NativeDialog
      className="console-account-dialog"
      onClose={close}
      labelledBy="console-account-detail-title"
    >
      <header>
        <div>
          <h2 id="console-account-detail-title">Account details</h2>
          <p>{email}</p>
        </div>
        <button type="button" className="btn" aria-label="Close account details" onClick={close}>
          ×
        </button>
      </header>
      <nav className="ops-tabs" aria-label="Account details">
        {(
          [
            { id: 'bank', label: 'Bank account' },
            { id: 'credit', label: 'Credit History' },
            { id: 'purchases', label: 'History' },
          ] as const
        ).map((item) => (
          <button
            type="button"
            className="btn"
            key={item.id}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {!connected ? (
        <p className="ops-state">
          Awaiting backend · Account numbers, bank account details, KYB status, Credit balances and
          user-bound histories are not connected. No values are estimated.
        </p>
      ) : error ? (
        <p className="ops-state" role="alert">
          {describeError(error).message}
        </p>
      ) : loading ? (
        <AsyncFeedback>Loading account details…</AsyncFeedback>
      ) : data ? (
        <>
          <div className="console-account-summary">
            <div>
              <small>Account #</small>
              <strong>{data.account.accountNumber ?? 'Not provided'}</strong>
            </div>
            <div>
              <small>Current Credit</small>
              <strong>{creditAmount(data.account.currentCreditCents)}</strong>
            </div>
            <div>
              <small>As of · UTC</small>
              <strong>{stampUtc(data.asOf)}</strong>
            </div>
          </div>
          {tab === 'bank' ? (
            <>
              <p className="muted">
                Customer bank information · Account identifiers are masked by the service.
              </p>
              {data.bankAccounts === null ? (
                <p className="ops-state">Bank account information is not available.</p>
              ) : data.bankAccounts.length ? (
                data.bankAccounts.map((bank) => (
                  <section className="console-account-bank" key={bank.id}>
                    <h3>{bank.bankName || 'Bank name not provided'}</h3>
                    <dl>
                      {[
                        ['Account name', bank.accountName],
                        ['Account number', bank.maskedAccountNumber],
                        ['Country', bank.country],
                        ['Currency', bank.currency],
                        ['IBAN', bank.maskedIban],
                        ['SWIFT', bank.swiftCode],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{value || '—'}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))
              ) : (
                <p>No bank accounts have been recorded.</p>
              )}
            </>
          ) : tab === 'credit' ? (
            data.creditHistory === null ? (
              <p className="ops-state">
                The Credit ledger is not available. A balance is not a substitute for transaction
                history.
              </p>
            ) : (
              <>
                <HistoryTable
                  headings={[
                    'Time · UTC',
                    'Type',
                    'Amount',
                    'Balance after',
                    'Reference',
                    'Details',
                  ]}
                >
                  {data.creditHistory.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{stampUtc(entry.at)}</td>
                      <td>{entry.kind}</td>
                      <td>
                        {entry.amountCents > 0 ? '+' : ''}
                        {creditAmount(entry.amountCents)}
                      </td>
                      <td>{creditAmount(entry.balanceAfterCents)}</td>
                      <td>{entry.reference ?? '—'}</td>
                      <td>{entry.description}</td>
                    </tr>
                  ))}
                </HistoryTable>
                {!data.creditHistory.entries.length ? (
                  <p>No Credit transactions recorded on this page.</p>
                ) : null}
              </>
            )
          ) : data.purchaseHistory === null ? (
            <p className="ops-state">
              User-bound purchase history is not available. Platform-wide order search is not used
              to infer ownership.
            </p>
          ) : (
            <>
              <HistoryTable
                headings={[
                  'Order',
                  'Type',
                  'Model',
                  'Capacity',
                  'Total',
                  'Status',
                  'Purchased · UTC',
                ]}
              >
                {data.purchaseHistory.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.id}</td>
                    <td>{entry.kind}</td>
                    <td>{entry.model}</td>
                    <td>{entry.capacity} GPUs</td>
                    <td>
                      {entry.totalCents === null ? 'Not recorded' : money(entry.totalCents / 100)}
                    </td>
                    <td>{entry.status}</td>
                    <td>{stampUtc(entry.purchasedAt)}</td>
                  </tr>
                ))}
              </HistoryTable>
              {!data.purchaseHistory.entries.length ? (
                <p>No purchases recorded on this page.</p>
              ) : null}
            </>
          )}
          {tab !== 'bank' && history ? (
            <div className="row">
              <button type="button" className="btn" disabled={!previous} onClick={previous}>
                Previous page
              </button>
              <button type="button" className="btn" disabled={!history.nextCursor} onClick={next}>
                Next page
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </NativeDialog>
  );
}
