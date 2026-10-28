import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { BuyerKybAdminService, BuyerKybCase } from '@/lib/buyer-kyb';
import { renderConsole } from '@/test/render';
import { BuyerKybReviewPage } from './page';

const record: BuyerKybCase = {
  id: 'CASE-1',
  accountId: 'buyer-1',
  email: 'old@example.com',
  mode: 'Auto',
  status: 'Reviewing',
  revision: 1,
  submittedAt: '2026-10-27T08:00:00Z',
  company: {
    companyName: 'Example',
    country: 'Singapore',
    registrationNumber: 'REG-123',
    email: '',
    website: '',
    taxId: '',
    monthlyVolumeUsd: '',
    monthlyTransactions: '',
    businessDescription: '',
    incorporationDate: '',
    legalForm: '',
    legalAddress: '',
    phone: '',
  },
  documents: [
    {
      id: 'DOC-1',
      kind: 'legal-presence',
      fileName: 'registration.pdf',
      contentType: 'application/pdf',
      sizeBytes: 4,
    },
  ],
};

function adapter() {
  return {
    sessionScope: 'session-one',
    list: vi
      .fn<BuyerKybAdminService['list']>()
      .mockResolvedValue({ confirmed: true, cases: [record] }),
    download: vi.fn<BuyerKybAdminService['download']>(),
    decide: vi.fn<BuyerKybAdminService['decide']>(),
  };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function SwitchHarness({
  first,
  second,
  onSwitch,
}: {
  first: BuyerKybAdminService;
  second: BuyerKybAdminService;
  onSwitch?: () => void;
}) {
  const [step, setStep] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          onSwitch?.();
          setStep(1);
        }}
      >
        Switch session
      </button>
      <BuyerKybReviewPage service={step ? second : first} />
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Console Buyer KYB session boundaries', () => {
  it('remounts for a new service even with the same scope and discards an old download', async () => {
    const first = adapter(),
      second = adapter();
    second.list.mockResolvedValue({
      confirmed: true,
      cases: [{ ...record, email: 'new@example.com' }],
    });
    const pending = deferred<Awaited<ReturnType<BuyerKybAdminService['download']>>>();
    first.download.mockReturnValue(pending.promise);
    const NativeURL = URL;
    const createObjectURL = vi.fn(() => 'blob:must-not-download');
    vi.stubGlobal(
      'URL',
      class extends NativeURL {
        static createObjectURL = createObjectURL;
      },
    );
    const { queryClient } = renderConsole(<SwitchHarness first={first} second={second} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download registration.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch session' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('new@example.com')).toBeInTheDocument();
    expect(screen.queryByText('old@example.com')).not.toBeInTheDocument();
    await act(async () => {
      pending.resolve({
        caseId: record.id,
        documentId: 'DOC-1',
        fileName: 'registration.pdf',
        blob: new Blob(['test'], { type: 'application/pdf' }),
      });
    });
    expect(createObjectURL).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(queryClient.getQueriesData({ queryKey: ['admin', 'buyer-kyb'] })).toHaveLength(1),
    );
  });

  it('remounts when the same adapter changes operator scope and ignores late approval', async () => {
    const service = adapter();
    const pending = deferred<Awaited<ReturnType<BuyerKybAdminService['decide']>>>();
    service.decide.mockReturnValue(pending.promise);
    const { queryClient } = renderConsole(
      <SwitchHarness
        first={service}
        second={service}
        onSwitch={() => {
          Object.assign(service, { sessionScope: 'session-two' });
          service.list.mockResolvedValue({
            confirmed: true,
            cases: [{ ...record, email: 'new@example.com' }],
          });
        }}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch session' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('new@example.com')).toBeInTheDocument();
    await act(async () => {
      pending.resolve({
        confirmed: true,
        caseId: record.id,
        status: 'Approved',
        revision: 2,
        notificationQueued: true,
      });
    });
    expect(
      screen.queryByText('KYB decision confirmed. The applicant notification has been queued.'),
    ).not.toBeInTheDocument();
    expect(queryClient.getQueriesData({ queryKey: ['admin', 'buyer-kyb', 'session-one'] })).toEqual(
      [],
    );
  });

  it('discards an old list response even if the adapter ignores its abort signal', async () => {
    const first = adapter(),
      second = adapter();
    second.sessionScope = 'session-two';
    second.list.mockResolvedValue({ confirmed: true, cases: [] });
    const pending = deferred<Awaited<ReturnType<BuyerKybAdminService['list']>>>();
    first.list.mockReturnValue(pending.promise);
    const { queryClient } = renderConsole(<SwitchHarness first={first} second={second} />);
    await waitFor(() => expect(first.list).toHaveBeenCalledOnce());
    const signal = first.list.mock.calls[0]?.[0];
    fireEvent.click(screen.getByRole('button', { name: 'Switch session' }));
    expect(await screen.findByText('No matching applications')).toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve({ confirmed: true, cases: [record] });
    });
    expect(screen.queryByText('old@example.com')).not.toBeInTheDocument();
    expect(queryClient.getQueriesData({ queryKey: ['admin', 'buyer-kyb', 'session-one'] })).toEqual(
      [],
    );
  });

  it('does not load private data without an authenticated session scope', () => {
    const service = adapter();
    service.sessionScope = '';
    renderConsole(<BuyerKybReviewPage service={service} />);
    expect(screen.getByText(/Awaiting backend · Buyer KYB/)).toBeInTheDocument();
    expect(service.list).not.toHaveBeenCalled();
  });
});
