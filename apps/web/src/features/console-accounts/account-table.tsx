import type { z } from 'zod';
import type { OperationsUser } from '@opennext/contracts';
import type { ConsoleAccountSummary } from '@/lib/console-account';
import { money } from '@/lib/format';

export type AccountTab = 'bank' | 'credit' | 'purchases';
export const creditAmount = (cents: number | null | undefined) =>
  cents == null ? '—' : money(cents / 100);

export function AccountTable({
  users,
  accounts,
  onOpen,
}: {
  users: z.infer<typeof OperationsUser>[];
  accounts: ConsoleAccountSummary[];
  onOpen: (userId: string, tab: AccountTab) => void;
}) {
  const indexed = new Map(accounts.map((account) => [account.userId, account]));
  return (
    <section className="panel">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {[
                'Account #',
                'User',
                'Bank account',
                'KYB',
                'Current Credit',
                'Credit History',
                'History',
              ].map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const account = indexed.get(user.id);
              return (
                <tr key={user.id}>
                  <td>{account?.accountNumber ?? <span className="muted">Not provided</span>}</td>
                  <td>
                    <strong>{user.name || '—'}</strong>
                    <small className="console-account-email">{user.email}</small>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => onOpen(user.id, 'bank')}
                    >
                      Details
                    </button>
                  </td>
                  <td>
                    {account?.kybStatus === 'Approved'
                      ? 'Completed'
                      : account?.kybStatus === 'NotStarted'
                        ? 'Not started'
                        : (account?.kybStatus ?? '—')}
                  </td>
                  <td>{creditAmount(account?.currentCreditCents)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => onOpen(user.id, 'credit')}
                    >
                      Credit History
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => onOpen(user.id, 'purchases')}
                    >
                      History
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!users.length ? <p className="ops-empty-table">No matching users.</p> : null}
    </section>
  );
}
