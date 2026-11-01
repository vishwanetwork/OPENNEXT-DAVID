import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderTerminal, signIn } from '@/test/render';
import {
  agreementContextFixture,
  agreementDocumentFixture,
  signedAgreementFixture,
} from '@/test/spot-agreement-fixture';
import type { BuyerKybService, BuyerKybSnapshot } from '@/lib/buyer-kyb';
import {
  OPENNEXT_COMPANY,
  SPOT_AGREEMENT_VERSION,
  type SpotAgreementService,
} from '@/lib/spot-agreement';
import { useSessionStore } from '@/lib/session-store';
import { AgreementReview } from './components/agreement-review';
import { agreementApi } from './api';
import { validateAgreementDocument, validateAgreementReceipt } from './validation';

const snapshot = (): BuyerKybSnapshot => ({
  confirmed: true,
  accountId: 'u1',
  demo: false,
  verification: {
    id: 'kyb-1',
    accountId: 'u1',
    email: 'ada@example.com',
    status: 'Approved',
    mode: 'Full',
    revision: 2,
    company: {
      companyName: 'Example Limited',
      registrationNumber: '123456',
      country: 'GB',
      email: 'billing@example.com',
      website: '',
      taxId: '',
      monthlyVolumeUsd: '',
      monthlyTransactions: '',
      businessDescription: '',
      incorporationDate: '',
      legalForm: '',
      legalAddress: '1 Example Road',
      phone: '',
    },
    documents: [],
    submittedAt: '2026-11-01T00:00:00Z',
  },
});
const kybService: BuyerKybService = {
  load: async () => snapshot(),
  submit: async () => snapshot(),
};
function serviceFixture(): SpotAgreementService {
  return {
    prepare: vi.fn(async (context) => agreementDocumentFixture(context)),
    sign: vi.fn(async () => signedAgreementFixture()),
    purchaseByCredit: vi.fn(),
    createBankTransfer: vi.fn(),
    download: vi.fn(),
  };
}
const fill = () => {
  fireEvent.change(screen.getByLabelText('Full legal name'), { target: { value: 'Ada Lovelace' } });
  fireEvent.change(screen.getByLabelText('Job title'), { target: { value: 'Director' } });
  screen.getAllByRole('checkbox').forEach((checkbox) => fireEvent.click(checkbox));
};
beforeEach(() => signIn());

describe('Spot agreement review', () => {
  it('accepts Bitfintech Group Limited and rejects other or placeholder provider names', () => {
    const context = agreementContextFixture();
    const document = agreementDocumentFixture(context);
    expect(OPENNEXT_COMPANY.legalName).toBe('Bitfintech Group Limited');
    expect(document.provider.legalName).toBe('Bitfintech Group Limited');
    expect(validateAgreementDocument(document, context).provider.legalName).toBe(
      'Bitfintech Group Limited',
    );
    for (const legalName of [
      'OpenNEXT Test Entity Limited',
      'Another Company Limited',
      'OpenNEXT',
      'OpenNEXT — registered legal name pending confirmation',
      '',
      '   ',
    ])
      expect(() =>
        validateAgreementDocument(
          { ...document, provider: { ...document.provider, legalName } },
          context,
        ),
      ).toThrow();
  });
  it('accepts only cumulative running-time documents and rejects old elapsed-time versions and policies', () => {
    const context = agreementContextFixture();
    const document = agreementDocumentFixture(context);
    expect(SPOT_AGREEMENT_VERSION).toBe('opennext-spot-runtime-v2');
    expect(document.policies.serviceWindow).toBe('cumulative-running-time');
    expect(validateAgreementDocument(document, context)).toEqual(document);
    for (const legacy of [
      { ...document, version: 'opennext-spot-window-v1' },
      {
        ...document,
        policies: { ...document.policies, serviceWindow: 'elapsed-from-first-ready' },
      },
      {
        ...document,
        version: 'opennext-spot-window-v1',
        policies: { ...document.policies, serviceWindow: 'elapsed-from-first-ready' },
      },
    ])
      expect(() => validateAgreementDocument(legacy, context)).toThrow();
    expect(() =>
      validateAgreementReceipt(
        { ...signedAgreementFixture(context), version: 'opennext-spot-window-v1' },
        context,
      ),
    ).toThrow();
    expect(validateAgreementReceipt(signedAgreementFixture(context), context).version).toBe(
      'opennext-spot-runtime-v2',
    );
  });
  it('shows 72 cumulative running hours starting automatically at readiness, with unchanged whole-instance pricing', () => {
    const initial = agreementContextFixture();
    const context = {
      ...initial,
      pricing: {
        ...initial.pricing,
        durationHours: 72,
        baseCents: initial.pricing.hourlyCents * 72,
        totalCents: initial.pricing.hourlyCents * 72,
      },
    };
    renderTerminal(<AgreementReview context={context} onSigned={vi.fn()} onCancel={vi.fn()} />);
    const summaryElement = screen.getByRole('complementary');
    const summary = within(summaryElement);
    expect(summary.getByText('Purchased runtime')).toBeInTheDocument();
    expect(summary.getByText('72 cumulative running hours')).toBeInTheDocument();
    expect(summaryElement).toHaveTextContent(
      'Timing starts automatically when the instance is ready for use, even if you have not connected or started a workload.',
    );
    expect(summaryElement).toHaveTextContent('Idle available time counts.');
    expect(summaryElement).toHaveTextContent(
      'Interruptions pause runtime and billing; reconnection resumes the remaining hours.',
    );
    expect(summary.getByText('$14.40 / hour')).toBeInTheDocument();
    expect(summary.getByText('$1,036.80')).toBeInTheDocument();
    const document = screen.getByRole('region', { name: 'Spot computing rental agreement' });
    expect(document).toHaveTextContent(/automatically/i);
    expect(document).toHaveTextContent(/ready/i);
    expect(document).toHaveTextContent(/SSH/);
    expect(document).toHaveTextContent(/idle/i);
    expect(document).toHaveTextContent(/pause/i);
    expect(document).toHaveTextContent(/remaining/i);
    expect(document).not.toHaveTextContent('selected elapsed duration');
    expect(document).not.toHaveTextContent(
      'Replacement does not restart or extend the service window.',
    );
  });
  it('shows the confirmed provider legal name but keeps signing disabled without a service', () => {
    renderTerminal(
      <AgreementReview context={agreementContextFixture()} onSigned={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(
      screen.getByText(/Agreement preview — electronic signing is not connected/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Bitfintech Group Limited \(OpenNEXT\)/)).toBeInTheDocument();
    expect(
      screen.queryByText(/registered legal name pending confirmation/),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/2180739/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign & continue' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  });
  it('keeps signing unavailable when the prepared document names a different provider', async () => {
    const service = serviceFixture();
    service.prepare = vi.fn(async (context) => {
      const document = agreementDocumentFixture(context);
      return {
        ...document,
        provider: { ...document.provider, legalName: 'OpenNEXT Test Entity Limited' },
      };
    });
    renderTerminal(
      <AgreementReview context={agreementContextFixture()} onSigned={vi.fn()} onCancel={vi.fn()} />,
      { slots: { services: { buyerKyb: kybService, spotAgreement: service } } },
    );
    await screen.findByText(/verified agreement could not be prepared/);
    expect(screen.getByRole('button', { name: 'Sign & continue' })).toBeDisabled();
    expect(service.sign).not.toHaveBeenCalled();
  });
  it('requires three explicit confirmations and passes only an exact verified signature receipt', async () => {
    const service = serviceFixture();
    const signed = vi.fn();
    renderTerminal(
      <AgreementReview context={agreementContextFixture()} onSigned={signed} onCancel={vi.fn()} />,
      { slots: { services: { buyerKyb: kybService, spotAgreement: service } } },
    );
    await screen.findByText('Example Limited', { exact: false });
    expect(screen.getByRole('button', { name: 'Sign & continue' })).toBeDisabled();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign & continue' }));
    await waitFor(() => expect(signed).toHaveBeenCalledTimes(1));
    expect(service.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        authorityConfirmed: true,
        termsAccepted: true,
        interruptionAccepted: true,
        signatoryName: 'Ada Lovelace',
        signatoryTitle: 'Director',
        kybRevision: 2,
      }),
    );
  });
  it('rejects a signature for another document even if its quote is identical', async () => {
    const service = serviceFixture();
    service.sign = vi.fn(async () => ({
      ...signedAgreementFixture(),
      documentHash: 'b'.repeat(64),
    }));
    const signed = vi.fn();
    renderTerminal(
      <AgreementReview context={agreementContextFixture()} onSigned={signed} onCancel={vi.fn()} />,
      { slots: { services: { buyerKyb: kybService, spotAgreement: service } } },
    );
    await screen.findByText('Example Limited', { exact: false });
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign & continue' }));
    await screen.findByText(/signing receipt does not match/);
    expect(signed).not.toHaveBeenCalled();
  });
  it('ignores delayed signing confirmation after logout', async () => {
    const service = serviceFixture();
    let resolve: ((value: ReturnType<typeof signedAgreementFixture>) => void) | undefined;
    service.sign = vi.fn(
      () =>
        new Promise<ReturnType<typeof signedAgreementFixture>>((done) => {
          resolve = done;
        }),
    );
    const signed = vi.fn();
    renderTerminal(
      <AgreementReview context={agreementContextFixture()} onSigned={signed} onCancel={vi.fn()} />,
      { slots: { services: { buyerKyb: kybService, spotAgreement: service } } },
    );
    await screen.findByText('Example Limited', { exact: false });
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign & continue' }));
    await waitFor(() => expect(service.sign).toHaveBeenCalledTimes(1));
    await act(async () => {
      useSessionStore.getState().markExpired();
      resolve?.(signedAgreementFixture());
    });
    expect(signed).not.toHaveBeenCalled();
  });
  it('rejects mismatched KYB before preparing a signable agreement', async () => {
    const service = serviceFixture();
    service.prepare = vi.fn(async () => ({
      ...agreementDocumentFixture(),
      kyb: { ...agreementDocumentFixture().kyb, revision: 1 },
    }));
    renderTerminal(
      <AgreementReview context={agreementContextFixture()} onSigned={vi.fn()} onCancel={vi.fn()} />,
      { slots: { services: { buyerKyb: kybService, spotAgreement: service } } },
    );
    await screen.findByText(/verified agreement could not be prepared/);
    expect(screen.getByRole('button', { name: 'Sign & continue' })).toBeDisabled();
  });
  it('does not download a PDF returned for a different agreement', async () => {
    const service = serviceFixture();
    service.download = vi.fn(async () => ({
      agreementId: 'other',
      documentHash: 'a'.repeat(64),
      fileName: 'agreement.pdf',
      blob: new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
    }));
    await expect(agreementApi.download(service, agreementDocumentFixture())).rejects.toThrow(
      'could not be verified',
    );
  });
  it('rechecks KYB before signing and rejects a later revision', async () => {
    const service = serviceFixture();
    const load = vi.fn(async () => snapshot());
    renderTerminal(
      <AgreementReview context={agreementContextFixture()} onSigned={vi.fn()} onCancel={vi.fn()} />,
      { slots: { services: { buyerKyb: { ...kybService, load }, spotAgreement: service } } },
    );
    await screen.findByText('Example Limited', { exact: false });
    load.mockImplementation(async () => {
      const result = snapshot();
      if (result.verification) result.verification.revision = 3;
      return result;
    });
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign & continue' }));
    await screen.findByText(/verified business has changed/);
    expect(service.sign).not.toHaveBeenCalled();
  });
});
