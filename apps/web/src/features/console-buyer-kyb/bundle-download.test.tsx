import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { BuyerKybAdminService, BuyerKybBundle, BuyerKybCase } from '@/lib/buyer-kyb';
import { ApiError } from '@/lib/api/client';
import { renderConsole } from '@/test/render';
import { BuyerKybReviewPage } from './page';
import { checkedBundle } from './bundle-download';

const record: BuyerKybCase = {
  id: 'CASE-1',
  accountId: 'buyer-1',
  email: 'buyer@example.com',
  mode: 'Auto',
  status: 'Reviewing',
  revision: 1,
  submittedAt: '2026-11-01T08:00:00Z',
  company: {
    companyName: 'Example Company',
    country: 'Singapore',
    registrationNumber: 'REG-1',
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
      kind: 'company-details',
      fileName: 'registry.pdf',
      contentType: 'application/pdf',
      sizeBytes: 4,
    },
  ],
};
function bundle(): BuyerKybBundle {
  return {
    confirmed: true,
    caseId: record.id,
    accountId: record.accountId,
    revision: record.revision,
    fileName: '../../unsafe.exe',
    blob: new Blob(['PK-test'], { type: 'application/zip' }),
    form: { fileName: 'submitted-form.pdf', contentType: 'application/pdf', sizeBytes: 10 },
    documents: record.documents,
  };
}
function adapter() {
  return {
    sessionScope: 'operator-one',
    list: vi
      .fn<BuyerKybAdminService['list']>()
      .mockResolvedValue({ confirmed: true, cases: [record] }),
    download: vi.fn<BuyerKybAdminService['download']>(),
    downloadBundle: vi
      .fn<NonNullable<BuyerKybAdminService['downloadBundle']>>()
      .mockResolvedValue(bundle()),
    decide: vi.fn<BuyerKybAdminService['decide']>().mockImplementation(async (input) => ({
      confirmed: true,
      caseId: input.caseId,
      accountId: input.accountId,
      idempotencyKey: input.idempotencyKey,
      revision: input.expectedRevision + 1,
      status: input.decision,
      notificationQueued: true,
      emailQueued: true,
    })),
  };
}
function objectUrls() {
  const create = vi.fn(() => 'blob:private-package');
  const revoke = vi.fn();
  const NativeURL = URL;
  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  return { create, revoke, click };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Buyer KYB package and action layout', () => {
  it('uses exactly five columns and describes the bounded original-document fallback', async () => {
    const service = adapter();
    const { downloadBundle: unused, ...withoutBundle } = service;
    renderConsole(<BuyerKybReviewPage service={withoutBundle} />);
    await screen.findByText(record.email);
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Email',
      'Company',
      'Country',
      'Download',
      'Action',
    ]);
    expect(
      screen.getByRole('button', { name: `Download KYB package for ${record.email}` }),
    ).toBeDisabled();
    expect(screen.getByText(/Complete package download is not yet available/)).toBeInTheDocument();
    expect(unused).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Registration number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download registry.pdf' })).toBeEnabled();
  });
  it('opens the completion review from the row and keeps the server approval protocol', async () => {
    const service = adapter();
    renderConsole(<BuyerKybReviewPage service={service} />);
    fireEvent.click(
      await screen.findByRole('button', { name: `Completed KYB for ${record.email}` }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Buyer KYB details' });
    expect(within(dialog).getByRole('button', { name: 'Completed' })).toBeDisabled();
    expect(service.decide).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Completed' }));
    await waitFor(() =>
      expect(service.decide).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'Approved',
          allscaleApproved: true,
          accountId: record.accountId,
          expectedRevision: 1,
          reason: '',
        }),
      ),
    );
    expect(
      await screen.findByText(/applicant notification and email have been queued/),
    ).toBeInTheDocument();
  });
  it('opens Failed directly, requires a private reason and sends it on Submit', async () => {
    const service = adapter();
    renderConsole(<BuyerKybReviewPage service={service} />);
    fireEvent.click(await screen.findByRole('button', { name: `Failed KYB for ${record.email}` }));
    const dialog = screen.getByRole('dialog', { name: 'Failed Buyer KYB' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
    expect(service.decide).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter the rejection reason');
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'Registry is outdated.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(service.decide).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'Rejected',
          allscaleApproved: false,
          reason: 'Registry is outdated.',
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('Registry is outdated.')).not.toBeInTheDocument();
  });
  it('downloads only a confirmed complete package with a temporary object URL', async () => {
    const urls = objectUrls();
    const service = adapter();
    renderConsole(<BuyerKybReviewPage service={service} />);
    fireEvent.click(
      await screen.findByRole('button', { name: `Download KYB package for ${record.email}` }),
    );
    await waitFor(() => expect(urls.click).toHaveBeenCalledOnce());
    expect(service.downloadBundle).toHaveBeenCalledWith({
      caseId: record.id,
      accountId: record.accountId,
      expectedRevision: record.revision,
    });
    expect(urls.create).toHaveBeenCalledWith(expect.any(Blob));
    expect(urls.click.mock.instances[0]).toHaveAttribute('download', 'kyb-CASE-1-r1.zip');
    await waitFor(() => expect(urls.revoke).toHaveBeenCalledWith('blob:private-package'), {
      timeout: 2000,
    });
  });
  it('clears private records and blocks further access if package authorization expires', async () => {
    const service = adapter();
    service.downloadBundle.mockRejectedValue(new ApiError('Forbidden', 403));
    renderConsole(<BuyerKybReviewPage service={service} />);
    fireEvent.click(
      await screen.findByRole('button', { name: `Download KYB package for ${record.email}` }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Access is no longer authorized');
    expect(screen.queryByText(record.email)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });
  it('discards an old package after the queue has a newer case revision', async () => {
    const urls = objectUrls();
    const service = adapter();
    let resolve: (value: BuyerKybBundle) => void = () => {};
    service.downloadBundle.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderConsole(<BuyerKybReviewPage service={service} />);
    fireEvent.click(
      await screen.findByRole('button', { name: `Download KYB package for ${record.email}` }),
    );
    service.list.mockResolvedValue({
      confirmed: true,
      cases: [{ ...record, revision: 2, status: 'Approved' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: `Completed KYB for ${record.email}` }),
      ).not.toBeInTheDocument(),
    );
    await act(async () => {
      resolve(bundle());
    });
    expect(urls.create).not.toHaveBeenCalled();
  });
});

describe('Buyer KYB backend package manifest', () => {
  it('uses a safe archive filename and checks the exact form and original-document set', () => {
    expect(checkedBundle(bundle(), record).fileName).toBe('kyb-CASE-1-r1.zip');
    const invalid: Partial<BuyerKybBundle>[] = [
      { confirmed: false },
      { caseId: 'OTHER' },
      { accountId: 'another-buyer' },
      { revision: 2 },
      { blob: new Blob(['html'], { type: 'text/html' }) },
      { blob: new Blob([], { type: 'application/zip' }) },
      { documents: [] },
      { documents: [...record.documents, ...record.documents] },
      { documents: record.documents.map((document) => ({ ...document, sizeBytes: 99 })) },
      { form: { fileName: 'form.pdf', contentType: 'application/pdf', sizeBytes: 0 } },
    ];
    for (const change of invalid) {
      expect(() => checkedBundle({ ...bundle(), ...change }, record)).toThrow(
        'No file was downloaded',
      );
    }
  });
});
