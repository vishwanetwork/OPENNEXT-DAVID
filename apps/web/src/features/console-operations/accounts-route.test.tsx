import { expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { json, mockFetch, renderConsole } from '@/test/render';
import { asOf, detail, person, summary } from '@/test/console-account-fixture';
import { AccountsRoute } from './routes';

it('connects the account directory and details through the advertised live API', async () => {
  const fetch = mockFetch((path) => {
    if (path === '/api/admin/operations/session')
      return json(200, {
        confirmed: true,
        sessionScope: 'operator-one',
        capabilities: ['accounts-v1'],
      });
    if (path.startsWith('/api/admin/users?'))
      return json(200, {
        users: [person],
        totalUsers: 1,
        filteredTotal: 1,
        growth: { '7D': 1, '1M': 1, '3M': 1, '6M': 1, '1Y': 1 },
        nextCursor: null,
        asOf,
      });
    if (path.startsWith('/api/admin/accounts?'))
      return json(200, {
        confirmed: true,
        demo: false,
        sessionScope: 'operator-one',
        accounts: [summary],
        asOf,
      });
    if (path.startsWith('/api/admin/accounts/user-1?')) return json(200, detail);
    return json(404, {});
  });
  renderConsole(<AccountsRoute />);
  expect(await screen.findByText(summary.accountNumber ?? '')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(await screen.findByText('Customer Bank')).toBeInTheDocument();
  expect(fetch.mock.calls.map(([path]) => path)).toContain(
    '/api/admin/accounts/user-1?creditCursor=&purchaseCursor=',
  );
});
