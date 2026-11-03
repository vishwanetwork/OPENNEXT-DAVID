import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '@/lib/api/client';
import { renderConsole } from '@/test/render';
import { ConsoleCashoutsPage } from './page';
import { adapter, bank, completion, record } from './fixtures.test-data';
import type { CashoutCompletionInput } from './validation';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function fillCompletion() {
  fireEvent.click(await screen.findByRole('button', { name: 'Completed' }));
  const dialog = screen.getByRole('dialog');
  await within(dialog).findByText(bank.accountNumber);
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Bank transfer reference' }), {
    target: { value: 'WIRE-1' },
  });
  fireEvent.click(within(dialog).getByRole('checkbox'));
  return dialog;
}

it('fails closed without a backend and exposes no fabricated requests or actions', () => {
  renderConsole(<ConsoleCashoutsPage />);
  expect(screen.getByText(/Awaiting backend · Private cashout/)).toHaveAttribute('role', 'status');
  expect(screen.queryByRole('button', { name: 'Completed' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
});

it('loads only for a scoped administrator and keeps full bank details out of the list', async () => {
  const service = adapter();
  renderConsole(<ConsoleCashoutsPage service={service} />);
  expect(await screen.findByText(record.accountNumber)).toBeInTheDocument();
  expect(screen.queryByText(bank.accountNumber)).not.toBeInTheDocument();
  expect(service.details).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(await screen.findByText(bank.accountNumber)).toBeInTheDocument();
  expect(service.details).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: record.id,
      accountId: record.accountId,
      expectedRevision: 1,
    }),
  );
});

it('does not read or complete cashouts without operator scope or private detail capability', async () => {
  const service = adapter();
  const view = renderConsole(<ConsoleCashoutsPage service={{ ...service, sessionScope: '' }} />);
  expect(service.list).not.toHaveBeenCalled();
  view.unmount();
  renderConsole(<ConsoleCashoutsPage service={{ ...service, details: undefined }} />);
  expect(await screen.findByRole('button', { name: 'Completed' })).toBeDisabled();
});

it('requires transfer reference and explicit verification before settling reserved Credit', async () => {
  const service = adapter();
  renderConsole(<ConsoleCashoutsPage service={service} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Completed' }));
  const dialog = screen.getByRole('dialog');
  await within(dialog).findByText(bank.accountNumber);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Completed' }));
  expect(service.complete).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Confirm the completed bank transfer');
  fireEvent.change(screen.getByRole('textbox', { name: 'Bank transfer reference' }), {
    target: { value: 'WIRE-1' },
  });
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Completed' }));
  expect(
    await screen.findByText(
      'Cashout completed. The customer notification and email have been queued.',
    ),
  ).toBeInTheDocument();
  expect(service.complete).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: record.id,
      accountId: record.accountId,
      expectedRevision: 1,
      transferReference: 'WIRE-1',
    }),
  );
});

it('reuses the completion key across ambiguous retries and dialog reopen', async () => {
  const service = adapter();
  service.complete.mockImplementation(async (input) => ({
    ...completion(input),
    emailQueued: false,
  }));
  renderConsole(<ConsoleCashoutsPage service={service} />);
  let dialog = await fillCompletion();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Completed' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('not fully confirmed');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  dialog = await fillCompletion();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Completed' }));
  await waitFor(() => expect(service.complete).toHaveBeenCalledTimes(2));
  expect(service.complete.mock.calls[0]?.[0].idempotencyKey).toBe(
    service.complete.mock.calls[1]?.[0].idempotencyKey,
  );
  expect(
    screen.queryByText('Cashout completed. The customer notification and email have been queued.'),
  ).not.toBeInTheDocument();
});

it('clears private queue and details after authorization expires', async () => {
  const service = adapter();
  service.complete.mockRejectedValue(new ApiError('Session expired.', 401));
  const { queryClient } = renderConsole(<ConsoleCashoutsPage service={service} />);
  const dialog = await fillCompletion();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Completed' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Administrator access expired');
  expect(screen.queryByText(record.email)).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      queryClient
        .getQueriesData({ queryKey: ['admin', 'cashouts'] })
        .every(([, value]) => value === undefined),
    ).toBe(true),
  );
});

it('ignores completion results after the operator service is removed', async () => {
  const service = adapter();
  let resolve: (value: ReturnType<typeof completion>) => void = () => {};
  service.complete.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  function Harness() {
    const [enabled, setEnabled] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setEnabled(false)}>
          Sign out operator
        </button>
        <ConsoleCashoutsPage service={enabled ? service : undefined} />
      </>
    );
  }
  renderConsole(<Harness />);
  const dialog = await fillCompletion();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Completed' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign out operator' }));
  const input = service.complete.mock.calls[0]?.[0] as CashoutCompletionInput | undefined;
  if (!input) throw new Error('Expected a submitted completion.');
  await act(async () => resolve(completion(input)));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText(record.email)).not.toBeInTheDocument();
  expect(
    screen.queryByText('Cashout completed. The customer notification and email have been queued.'),
  ).not.toBeInTheDocument();
});
