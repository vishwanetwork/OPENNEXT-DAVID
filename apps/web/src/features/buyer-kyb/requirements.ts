import type { BuyerKybCompany, BuyerKybMode, KybDocumentKind } from '@/lib/buyer-kyb';
import { countryList } from '@/lib/countries';

export const AUTO_COUNTRIES = [
  'CN',
  'IN',
  'JP',
  'NZ',
  'SG',
  'TW',
  'TH',
  'VN',
  'HK',
  'ID',
  'MY',
  'PH',
  'KR',
  'AU',
] as const;

export const DOCUMENT_KINDS: readonly KybDocumentKind[] = [
  'legal-presence',
  'ownership-structure',
  'proof-of-address',
  'company-details',
  'representative-authorization',
];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export type KybFiles = Partial<Record<KybDocumentKind, File[]>>;

export function modeForCountry(country: string): BuyerKybMode | null {
  if (!countryList().some((item) => item.code === country)) return null;
  return AUTO_COUNTRIES.some((code) => code === country) ? 'Auto' : 'Full';
}

export const emptyCompany = (): BuyerKybCompany => ({
  country: '',
  companyName: '',
  registrationNumber: '',
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
});

const CORE_FIELDS = [
  'country',
  'companyName',
  'registrationNumber',
  'email',
  'taxId',
  'monthlyVolumeUsd',
  'monthlyTransactions',
  'businessDescription',
] as const;
const FULL_FIELDS = ['incorporationDate', 'legalForm', 'legalAddress', 'phone'] as const;

export function validateCompany(company: BuyerKybCompany): string | null {
  const mode = modeForCountry(company.country);
  if (!mode) return 'Select a valid country or region of incorporation.';
  if ([...CORE_FIELDS, ...(mode === 'Full' ? FULL_FIELDS : [])].some((key) => !company[key].trim()))
    return 'Complete every required company information field.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(company.email.trim()))
    return 'Enter a valid business email.';
  if (company.website.trim() && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(company.website.trim()))
    return 'Enter a complete website URL beginning with https:// or http://.';
  const volume = Number(company.monthlyVolumeUsd);
  const transactions = Number(company.monthlyTransactions);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1_000_000_000_000)
    return 'Enter a valid estimated monthly USD volume.';
  if (!Number.isSafeInteger(transactions) || transactions < 0)
    return 'Enter a whole number for estimated monthly transactions.';
  if (
    mode === 'Full' &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(company.incorporationDate) ||
      !Number.isFinite(Date.parse(company.incorporationDate)) ||
      new Date(company.incorporationDate).toISOString().slice(0, 10) !==
        company.incorporationDate ||
      new Date(company.incorporationDate).getTime() > Date.now())
  )
    return 'Enter a valid incorporation date that is not in the future.';
  return null;
}

export function validateFiles(files: KybFiles, requireAll = true): string | null {
  if (requireAll && DOCUMENT_KINDS.some((kind) => !files[kind]?.length))
    return 'Attach at least one document in each of the five required categories.';
  const all = DOCUMENT_KINDS.flatMap((kind) => files[kind] ?? []);
  if (all.length > 20) return 'Attach no more than 20 files in total.';
  for (const file of all) {
    const accepted =
      (/\.pdf$/i.test(file.name) && file.type === 'application/pdf') ||
      (/\.png$/i.test(file.name) && file.type === 'image/png') ||
      (/\.jpe?g$/i.test(file.name) && file.type === 'image/jpeg');
    if (!accepted) return 'Use PDF, PNG or JPEG files with a matching file extension.';
    if (file.size <= 0 || file.size > MAX_FILE_BYTES)
      return 'Each file must be between 1 byte and 10 MB.';
  }
  if (all.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES)
    return 'The total document size must not exceed 50 MB.';
  return null;
}

export function documentRequirements(mode: BuyerKybMode, country: string) {
  return [
    {
      kind: 'legal-presence' as const,
      title: 'Proof of legal presence',
      help:
        mode === 'Auto'
          ? 'Certificate of incorporation or business registration certificate.'
          : 'Certificate of incorporation. For a trust or foundation, provide its constitutive documents.',
    },
    {
      kind: 'ownership-structure' as const,
      title: 'Ownership structure',
      help:
        country === 'HK' && mode === 'Auto'
          ? 'Hong Kong: NNC1 incorporation form showing the ownership structure.'
          : 'A dated ownership chart naming shareholders and their ownership percentages, signed by a Director or Ultimate Beneficial Owner (UBO).',
    },
    {
      kind: 'proof-of-address' as const,
      title: 'Proof of business address',
      help: 'Bank statement, lease or utility bill issued within the last 3 months and showing the company name. For a fully remote business, a Director or UBO’s address proof is accepted. Bank balances may be redacted.',
    },
    {
      kind: 'company-details' as const,
      title: 'Company details',
      help:
        mode === 'Auto'
          ? 'Articles of association or bylaws.'
          : 'Articles of association, memorandum of association or bylaws.',
    },
    {
      kind: 'representative-authorization' as const,
      title: 'Representative authorization',
      help: 'A signed authorization letter. Request the required template from OpenNEXT support before uploading.',
    },
  ];
}
