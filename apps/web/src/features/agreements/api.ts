import type { BuyerKybCase } from '@/lib/buyer-kyb';
import type {
  SpotAgreementContext,
  SpotAgreementDocument,
  SpotAgreementService,
} from '@/lib/spot-agreement';
import { validateAgreementDocument, validateAgreementReceipt } from './validation';

export function assertAgreementKyb(document: SpotAgreementDocument, kyb: BuyerKybCase) {
  if (
    kyb.status !== 'Approved' ||
    kyb.accountId !== document.context.accountId ||
    kyb.id !== document.kyb.caseId ||
    kyb.revision !== document.kyb.revision ||
    kyb.company.companyName !== document.kyb.companyName ||
    kyb.company.registrationNumber !== document.kyb.registrationNumber ||
    kyb.company.country !== document.kyb.country ||
    kyb.company.email !== document.kyb.noticeEmail
  )
    throw new Error('Your verified business has changed. Refresh and review a new agreement.');
}

export const agreementApi = {
  async prepare(
    service: SpotAgreementService,
    context: SpotAgreementContext,
    kyb: BuyerKybCase,
    signal?: AbortSignal,
  ) {
    const document = validateAgreementDocument(await service.prepare(context, signal), context);
    assertAgreementKyb(document, kyb);
    return document;
  },
  async sign(
    service: SpotAgreementService,
    document: SpotAgreementDocument,
    kyb: BuyerKybCase,
    input: Parameters<SpotAgreementService['sign']>[0],
  ) {
    validateAgreementDocument(document, document.context);
    assertAgreementKyb(document, kyb);
    if (
      input.agreementId !== document.id ||
      input.documentHash !== document.documentHash ||
      input.kybRevision !== document.kyb.revision ||
      !input.authorityConfirmed ||
      !input.termsAccepted ||
      !input.interruptionAccepted ||
      !input.signatoryName.trim() ||
      !input.signatoryTitle.trim()
    )
      throw new Error('Review the agreement and complete all signing confirmations.');
    const receipt = validateAgreementReceipt(await service.sign(input), document.context);
    if (
      receipt.agreementId !== document.id ||
      receipt.documentHash !== document.documentHash ||
      receipt.kybCaseId !== document.kyb.caseId ||
      receipt.kybRevision !== document.kyb.revision ||
      receipt.signatoryName !== input.signatoryName ||
      receipt.signatoryTitle !== input.signatoryTitle
    )
      throw new Error(
        'The signing receipt does not match this agreement and authorized signatory.',
      );
    return receipt;
  },
  async download(service: SpotAgreementService, document: SpotAgreementDocument) {
    const file = await service.download({
      agreementId: document.id,
      documentHash: document.documentHash,
    });
    if (
      file.agreementId !== document.id ||
      file.documentHash !== document.documentHash ||
      !(file.blob instanceof Blob) ||
      file.blob.type !== 'application/pdf' ||
      file.blob.size === 0 ||
      file.blob.size > 20 * 1024 * 1024 ||
      !/^[^/\\\x00-\x1F]+\.pdf$/i.test(file.fileName) ||
      (await file.blob.slice(0, 5).text()) !== '%PDF-'
    )
      throw new Error('The agreement PDF could not be verified. Please retry.');
    return file;
  },
};
