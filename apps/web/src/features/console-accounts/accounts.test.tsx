import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse, mockFetch, renderConsole } from '@/test/render';
import { ConsoleAccountsPage } from './page';
import { adapter, mockDirectory, summary, detail } from '@/test/console-account-fixture';
import { confirmedDetail, confirmedSummaries } from './validation';

describe('Console account directory', () => {
  it('uses live identities without inventing account numbers, balances or bank information', async () => {
    const fetch = mockDirectory();
    renderConsole(<ConsoleAccountsPage />);
    expect(await screen.findByText('ada@example.test')).toBeInTheDocument();
    expect(screen.getByText('Not provided')).toBeInTheDocument();
    expect(screen.queryByText('user-1')).not.toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText(/No values are estimated/)).toBeInTheDocument();
    expect(fetch.mock.calls.map(([path]) => path)).toEqual([
      '/api/admin/operations/session',
      '/api/admin/users?search=&cursor=&limit=50',
    ]);
  });

  it('shows confirmed account facts and separate bank, Credit and purchase history tabs', async () => {
    mockDirectory();
    const service = adapter();
    renderConsole(<ConsoleAccountsPage service={service} />);
    expect(await screen.findByText(summary.accountNumber ?? '')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('$100.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(await screen.findByText('Customer Bank')).toBeInTheDocument();
    expect(screen.getByText('•••• 1234')).toBeInTheDocument();
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Credit History' }));
    expect(dialog.getByText('+$150.00')).toBeInTheDocument();
    expect(dialog.getByText('-$50.00')).toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'History' }));
    expect(dialog.getByText('H100')).toBeInTheDocument();
    expect(dialog.getByText('8 GPUs')).toBeInTheDocument();
    expect(service.details).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', creditCursor: '', purchaseCursor: '' }),
    );
  });

  it('does not read private accounts before an authenticated operator session', async () => {
    const request = mockFetch(() => jsonResponse({ error: 'Administrator sign-in required' }, 401));
    const service = adapter();
    renderConsole(<ConsoleAccountsPage service={service} />);
    expect(await screen.findByLabelText('Administrator token')).toBeInTheDocument();
    expect(service.summaries).not.toHaveBeenCalled();
    expect(service.details).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not use an adapter belonging to another operator session', async () => {
    mockDirectory('operator-two');
    const service = adapter();
    renderConsole(<ConsoleAccountsPage service={service} />);
    expect(await screen.findByText('ada@example.test')).toBeInTheDocument();
    expect(service.summaries).not.toHaveBeenCalled();
    expect(screen.queryByText('ON-00421')).not.toBeInTheDocument();
  });

  it('sends filters and paging to the user directory', async () => {
    const request = mockDirectory();
    renderConsole(<ConsoleAccountsPage />);
    await screen.findByText('ada@example.test');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ada' } });
    await waitFor(() =>
      expect(request.mock.calls.some(([path]) => String(path).includes('search=ada'))).toBe(true),
    );
  });
});

describe('confirmed account adapter responses', () => {
  it('rejects mismatched account identities, administrator scopes and Demo results', () => {
    expect(() => confirmedDetail(detail, 'operator-two', 'user-1')).toThrow();
    expect(() => confirmedDetail(detail, 'operator-one', 'user-2')).toThrow();
    expect(() => confirmedDetail({ ...detail, demo: true }, 'operator-one', 'user-1')).toThrow();
    expect(() =>
      confirmedSummaries({ ...detail, accounts: [summary] }, 'operator-one', ['user-2']),
    ).toThrow();
    expect(() =>
      confirmedSummaries({ ...detail, accounts: [summary, summary] }, 'operator-one', ['user-1']),
    ).toThrow();
  });

  it('requires safe integer cents and never manufactures a balance', () => {
    expect(() =>
      confirmedDetail(
        { ...detail, account: { ...summary, currentCreditCents: 1.5 } },
        'operator-one',
        'user-1',
      ),
    ).toThrow();
    expect(
      confirmedDetail(
        { ...detail, account: { ...summary, currentCreditCents: null } },
        'operator-one',
        'user-1',
      ).account.currentCreditCents,
    ).toBeNull();
  });
});
