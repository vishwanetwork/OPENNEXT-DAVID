import type {
  BuyerKybAdminService,
  BuyerKybCase,
  BuyerKybCompany,
  BuyerKybDocument,
} from '@/lib/buyer-kyb';

const COMPANY_FIELDS: (keyof BuyerKybCompany)[] = [
  'country',
  'companyName',
  'registrationNumber',
  'email',
  'website',
  'taxId',
  'monthlyVolumeUsd',
  'monthlyTransactions',
  'businessDescription',
  'incorporationDate',
  'legalForm',
  'legalAddress',
  'phone',
];

export const DOCUMENT_NAMES: Record<BuyerKybDocument['kind'], string> = {
  'legal-presence': 'Proof of legal presence',
  'ownership-structure': 'Ownership structure',
  'proof-of-address': 'Proof of business address',
  'company-details': 'Company details / registry extract',
  'representative-authorization': 'Representative authorization',
};

/** A service port is not a wire contract. Reject incomplete adapters rather than invent records. */
export function confirmedCases(result: Awaited<ReturnType<BuyerKybAdminService['list']>>) {
  if (
    result?.confirmed !== true ||
    !Array.isArray(result.cases) ||
    !result.cases.every(
      (row) =>
        row &&
        typeof row.id === 'string' &&
        row.id.length > 0 &&
        typeof row.accountId === 'string' &&
        row.accountId.length > 0 &&
        typeof row.email === 'string' &&
        ['Auto', 'Full'].includes(row.mode) &&
        ['Reviewing', 'Approved', 'Rejected'].includes(row.status) &&
        Number.isSafeInteger(row.revision) &&
        row.revision > 0 &&
        row.company &&
        COMPANY_FIELDS.every((field) => typeof row.company[field] === 'string') &&
        Number.isFinite(Date.parse(row.submittedAt)) &&
        Array.isArray(row.documents) &&
        new Set(row.documents.map((doc) => doc?.id)).size === row.documents.length &&
        row.documents.every(
          (doc) =>
            doc &&
            typeof doc.id === 'string' &&
            doc.id.length > 0 &&
            typeof doc.fileName === 'string' &&
            Object.hasOwn(DOCUMENT_NAMES, doc.kind) &&
            typeof doc.contentType === 'string' &&
            Number.isSafeInteger(doc.sizeBytes) &&
            doc.sizeBytes > 0,
        ),
    ) ||
    new Set(result.cases.map((row) => row.id)).size !== result.cases.length
  )
    throw new Error('The Buyer KYB queue could not be confirmed. Refresh before reviewing cases.');
  return result.cases;
}

export function filterCases(rows: BuyerKybCase[], search: string, status: string) {
  const query = search.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (status === 'All' || row.status === status) &&
      (!query ||
        [row.email, row.company.companyName, row.company.country, row.id]
          .join(' ')
          .toLowerCase()
          .includes(query)),
  );
}

export function confirmedDecision(
  result: Awaited<ReturnType<BuyerKybAdminService['decide']>>,
  record: BuyerKybCase,
  decision: 'Approved' | 'Rejected',
) {
  return (
    result?.confirmed === true &&
    result.caseId === record.id &&
    result.status === decision &&
    Number.isSafeInteger(result.revision) &&
    result.revision === record.revision + 1 &&
    result.notificationQueued === true
  );
}

/** Only download the authorized binary returned for this exact case/document, never a URL. */
export function checkedDownload(
  result: Awaited<ReturnType<BuyerKybAdminService['download']>>,
  record: BuyerKybCase,
  document: BuyerKybDocument,
) {
  const extension = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };
  const kind = result?.blob?.type as keyof typeof extension;
  if (
    result?.caseId !== record.id ||
    result.documentId !== document.id ||
    !(result.blob instanceof Blob) ||
    !Object.hasOwn(extension, kind) ||
    kind !== document.contentType ||
    result.blob.size <= 0 ||
    result.blob.size !== document.sizeBytes ||
    result.blob.size > 20 * 1024 * 1024
  )
    throw new Error('The secure document response could not be verified. No file was downloaded.');
  const basename = String(result.fileName || document.fileName)
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069<>:"|?*]/g, '_')
    .replace(/\.[^.]*$/, '')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 120);
  return { blob: result.blob, fileName: `kyb-${basename || 'document'}.${extension[kind]}` };
}
