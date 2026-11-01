import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ConsoleAccountDetail, ConsoleAccountService } from '@/lib/console-account';
import { ApiError } from '@/lib/api/client';
import { renderConsole } from '@/test/render';
import { ConsoleAccountsPage } from './page';
import { adapter, detail, mockDirectory } from '@/test/console-account-fixture';

function Harness({
  first,
  second,
}: {
  first: ConsoleAccountService;
  second?: ConsoleAccountService;
}) {
  const [changed, setChanged] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setChanged(true)}>
        Replace adapter
      </button>
      <ConsoleAccountsPage service={changed ? second : first} />
    </>
  );
}

describe('Console account session isolation', () => {
  it('closes details and deletes cached private records when the adapter is removed', async () => {
    mockDirectory();
    const service = adapter();
    const { queryClient } = renderConsole(<Harness first={service} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }, { timeout: 5000 }));
    expect(await screen.findByText('Customer Bank')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Replace adapter' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Customer Bank')).not.toBeInTheDocument();
    expect(screen.queryByText('ON-00421')).not.toBeInTheDocument();
    expect(
      queryClient
        .getQueriesData({ queryKey: ['admin', 'accounts', 'operator-one'] })
        .every(([, value]) => value === undefined),
    ).toBe(true);
  });

  it('discards late account details after session replacement even if the service ignores abort', async () => {
    mockDirectory();
    const first = adapter();
    const second = adapter();
    let resolve: (value: ConsoleAccountDetail) => void = () => {};
    const pending = new Promise<ConsoleAccountDetail>((complete) => {
      resolve = complete;
    });
    first.details.mockReturnValue(pending);
    renderConsole(<Harness first={first} second={second} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }, { timeout: 5000 }));
    await waitFor(() => expect(first.details).toHaveBeenCalledOnce());
    const signal = first.details.mock.calls[0]?.[0].signal;
    fireEvent.click(screen.getByRole('button', { name: 'Replace adapter' }));
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(detail));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Customer Bank')).not.toBeInTheDocument();
    expect(second.details).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    'latches %s account access loss and removes previously displayed balances',
    async (status) => {
      mockDirectory();
      const service = adapter();
      service.details.mockRejectedValue(new ApiError('Access denied', status));
      const { queryClient } = renderConsole(<ConsoleAccountsPage service={service} />);
      expect(await screen.findByText('ON-00421')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Details' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Access is no longer authorized');
      expect(screen.queryByText('ON-00421')).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ['admin', 'accounts'] });
      });
      expect(service.details).toHaveBeenCalledOnce();
      expect(
        queryClient
          .getQueriesData({ queryKey: ['admin', 'accounts'] })
          .every(([, value]) => value === undefined),
      ).toBe(true);
    },
  );
});
