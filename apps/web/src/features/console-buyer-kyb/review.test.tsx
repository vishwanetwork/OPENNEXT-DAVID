import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { BuyerKybAdminService, BuyerKybCase } from '@/lib/buyer-kyb';
import { ApiError } from '@/lib/api/client';
import { renderConsole } from '@/test/render';
import { BuyerKybReviewPage, KybReviewWorkspace } from './page';
import { checkedDownload, confirmedCases, confirmedDecision } from './review';

const record: BuyerKybCase = {
  id: 'BUYER-KYB-1',
  accountId: 'buyer-1',
  email: 'buyer@example.com',
  mode: 'Full',
  status: 'Reviewing',
  revision: 1,
  submittedAt: '2026-10-27T08:00:00Z',
  company: {
    country: 'United States',
    companyName: 'Example Computing',
    registrationNumber: 'REG-123',
    email: 'business@example.com',
    website: 'https://example.com',
    taxId: '',
    monthlyVolumeUsd: '10000',
    monthlyTransactions: '10',
    businessDescription: 'Compute procurement',
    incorporationDate: '2020-01-01',
    legalForm: 'Corporation',
    legalAddress: 'Example address',
    phone: '+12025550123',
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
    sessionScope: 'operator-session-a',
    list: vi
      .fn<BuyerKybAdminService['list']>()
      .mockResolvedValue({ confirmed: true, cases: [record] }),
    download: vi.fn<BuyerKybAdminService['download']>().mockResolvedValue({
      caseId: record.id,
      documentId: 'DOC-1',
      fileName: 'registration.pdf',
      blob: new Blob(['test'], { type: 'application/pdf' }),
    }),
    decide: vi.fn<BuyerKybAdminService['decide']>().mockResolvedValue({
      confirmed: true,
      caseId: record.id,
      status: 'Approved',
      revision: 2,
      notificationQueued: true,
    }),
  };
}
async function openDetails() {
  fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Buyer KYB Console', () => {
  it('defaults to a disconnected Buyer queue and preserves a Supplier tab', () => {
    renderConsole(<KybReviewWorkspace />);
    expect(screen.getByRole('link', { name: 'Buyer KYB' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Supplier KYB' })).toHaveAttribute(
      'href',
      '/admin/kyb?tab=supplier',
    );
    expect(screen.getByText(/Awaiting backend · Buyer KYB/)).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByText('buyer@example.com')).not.toBeInTheDocument();
  });
  it('shows confirmed cases and filters by country, email and status', async () => {
    renderConsole(<BuyerKybReviewPage service={adapter()} />);
    expect(await screen.findByText('buyer@example.com')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Singapore' } });
    expect(screen.queryByText('buyer@example.com')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'example.com' } });
    expect(screen.getByText('buyer@example.com')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Approved' } });
    expect(screen.queryByText('buyer@example.com')).not.toBeInTheDocument();
  });
  it('rejects unconfirmed queue data', async () => {
    const service = adapter();
    service.list.mockResolvedValue({ confirmed: false, cases: [record] });
    renderConsole(<BuyerKybReviewPage service={service} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');
    expect(screen.queryByText('buyer@example.com')).not.toBeInTheDocument();
  });
  it('requires ALLScale confirmation and validates the acknowledged decision', async () => {
    const service = adapter();
    renderConsole(<BuyerKybReviewPage service={service} />);
    await openDetails();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(service.decide).toHaveBeenCalledWith(
        expect.objectContaining({
          caseId: record.id,
          expectedRevision: 1,
          decision: 'Approved',
          allscaleApproved: true,
          reason: '',
        }),
      ),
    );
    expect(
      await screen.findByText(
        'KYB decision confirmed. The applicant notification has been queued.',
      ),
    ).toBeInTheDocument();
  });
  it('does not claim approval or notification for a wrong acknowledgment', async () => {
    const service = adapter();
    service.decide.mockResolvedValue({
      confirmed: true,
      caseId: 'different',
      status: 'Approved',
      revision: 2,
      notificationQueued: true,
    });
    renderConsole(<BuyerKybReviewPage service={service} />);
    await openDetails();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not fully confirmed');
    expect(
      screen.queryByText('KYB decision confirmed. The applicant notification has been queued.'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Buyer KYB details' })).toBeInTheDocument();
  });
  it('asks for the rejection reason in a separate dialog and sends it only in the decision', async () => {
    const service = adapter();
    service.decide.mockResolvedValue({
      confirmed: true,
      caseId: record.id,
      status: 'Rejected',
      revision: 2,
      notificationQueued: true,
    });
    renderConsole(<BuyerKybReviewPage service={service} />);
    await openDetails();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject Buyer KYB' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm rejection' }));
    expect(service.decide).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter the rejection reason');
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'The registration document has expired.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm rejection' }));
    await waitFor(() =>
      expect(service.decide).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'Rejected',
          reason: 'The registration document has expired.',
          allscaleApproved: false,
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('The registration document has expired.')).not.toBeInTheDocument();
  });
  it('requests the exact private document and rejects wrong-case download responses', async () => {
    const service = adapter();
    service.download.mockResolvedValue({
      caseId: 'different',
      documentId: 'DOC-1',
      fileName: 'registration.pdf',
      blob: new Blob(['test'], { type: 'application/pdf' }),
    });
    renderConsole(<BuyerKybReviewPage service={service} />);
    await openDetails();
    fireEvent.click(screen.getByRole('button', { name: 'Download registration.pdf' }));
    await waitFor(() =>
      expect(service.download).toHaveBeenCalledWith({
        caseId: record.id,
        documentId: 'DOC-1',
        expectedRevision: 1,
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('No file was downloaded');
  });
  it('removes private queue data after access expires', async () => {
    const service = adapter();
    const { queryClient } = renderConsole(<BuyerKybReviewPage service={service} />);
    await screen.findByText('buyer@example.com');
    service.list.mockRejectedValue(new ApiError('Session expired.', 401));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Session expired');
    expect(screen.queryByText('buyer@example.com')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(queryClient.getQueriesData({ queryKey: ['admin', 'buyer-kyb'] })).toEqual([]),
    );
  });
  it('downloads an authorized binary using a temporary object URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:private-kyb');
    const revokeObjectURL = vi.fn();
    const NativeURL = URL;
    vi.stubGlobal(
      'URL',
      class extends NativeURL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      },
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderConsole(<BuyerKybReviewPage service={adapter()} />);
    await openDetails();
    fireEvent.click(screen.getByRole('button', { name: 'Download registration.pdf' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:private-kyb'), {
      timeout: 2000,
    });
  });
  it('ignores a late review response after the details are closed', async () => {
    let resolve: (value: Awaited<ReturnType<BuyerKybAdminService['decide']>>) => void = () => {};
    const service = adapter();
    service.decide.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderConsole(<BuyerKybReviewPage service={service} />);
    await openDetails();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Buyer KYB details' }));
    await act(async () => {
      resolve({
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
  });
});

describe('Buyer KYB acknowledgment and download safety', () => {
  it('requires the next revision and a queued user notification', () => {
    const result = {
      confirmed: true,
      caseId: record.id,
      status: 'Approved' as const,
      revision: 2,
      notificationQueued: true,
    };
    expect(confirmedDecision(result, record, 'Approved')).toBe(true);
    expect(confirmedDecision({ ...result, notificationQueued: false }, record, 'Approved')).toBe(
      false,
    );
    expect(confirmedDecision({ ...result, revision: 1 }, record, 'Approved')).toBe(false);
  });
  it('sanitizes a private binary filename and rejects unexpected MIME types or sizes', () => {
    const doc = record.documents[0];
    if (!doc) throw new Error('Fixture missing');
    const result = {
      caseId: record.id,
      documentId: doc.id,
      fileName: '../../CON.exe',
      blob: new Blob(['test'], { type: 'application/pdf' }),
    };
    expect(checkedDownload(result, record, doc).fileName).toBe('kyb-CON.pdf');
    expect(() =>
      checkedDownload({ ...result, blob: new Blob(['test'], { type: 'text/html' }) }, record, doc),
    ).toThrow('No file was downloaded');
    expect(() =>
      checkedDownload(
        { ...result, blob: new Blob(['other'], { type: 'application/pdf' }) },
        record,
        doc,
      ),
    ).toThrow('No file was downloaded');
  });
  it('rejects duplicate or malformed private cases', () => {
    expect(() => confirmedCases({ confirmed: true, cases: [record, record] })).toThrow();
    expect(() =>
      confirmedCases({ confirmed: true, cases: [{ ...record, revision: 0 }] }),
    ).toThrow();
  });
});
