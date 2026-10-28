import { describe, expect, it, vi } from 'vitest';
import { countryList } from '@/lib/countries';
import { buyerKybApi, confirmedKybSnapshot } from './api';
import {
  AUTO_COUNTRIES,
  DOCUMENT_KINDS,
  documentRequirements,
  MAX_FILE_BYTES,
  modeForCountry,
  validateCompany,
  validateFiles,
  type KybFiles,
} from './requirements';
import { companyFixture, serviceFixture, snapshotFixture } from './test-fixtures';

describe('Buyer KYB requirements', () => {
  it.each(AUTO_COUNTRIES)('%s uses Auto collection', (country) =>
    expect(modeForCountry(country)).toBe('Auto'),
  );
  it('uses Full only for other valid ISO countries, never arbitrary input', () => {
    expect(AUTO_COUNTRIES).toHaveLength(14);
    for (const country of countryList()) {
      if (!AUTO_COUNTRIES.some((code) => code === country.code))
        expect(modeForCountry(country.code)).toBe('Full');
    }
    for (const country of ['', 'ALL', 'US-other', 'ZZ', 'Singapore'])
      expect(modeForCountry(country)).toBeNull();
  });
  it('requires Full company fields without applying Hong Kong rules elsewhere', () => {
    expect(validateCompany(companyFixture())).toBeNull();
    const full = { ...companyFixture(), country: 'US' };
    expect(validateCompany(full)).toMatch(/required/);
    expect(
      validateCompany({
        ...full,
        incorporationDate: '2020-01-01',
        legalForm: 'LLC',
        legalAddress: '1 Example St',
        phone: '+1 555 0100',
      }),
    ).toBeNull();
    expect(documentRequirements('Auto', 'HK')[1]?.help).toContain('NNC1');
    expect(documentRequirements('Auto', 'SG')[1]?.help).toContain('signed');
    expect(documentRequirements('Full', 'US')[0]?.help).toContain('constitutive');
  });
  it('validates volume, transaction count and website', () => {
    expect(validateCompany({ ...companyFixture(), monthlyVolumeUsd: '-5' })).toMatch(/volume/);
    expect(validateCompany({ ...companyFixture(), monthlyTransactions: '1.5' })).toMatch(
      /whole number/,
    );
    expect(validateCompany({ ...companyFixture(), website: 'javascript:alert(1)' })).toMatch(
      /website/,
    );
  });
  it('requires all five categories and enforces type, extension and size limits', () => {
    const pdf = new File(['pdf'], 'document.pdf', { type: 'application/pdf' });
    const files: KybFiles = Object.fromEntries(DOCUMENT_KINDS.map((kind) => [kind, [pdf]]));
    expect(validateFiles(files)).toBeNull();
    expect(validateFiles({ ...files, 'legal-presence': [] })).toMatch(/five/);
    expect(
      validateFiles({
        ...files,
        'legal-presence': [new File(['x'], 'fake.pdf', { type: 'text/html' })],
      }),
    ).toMatch(/extension/);
    expect(
      validateFiles({
        ...files,
        'legal-presence': [new File([], 'empty.pdf', { type: 'application/pdf' })],
      }),
    ).toMatch(/1 byte/);
    const large = new File(['pdf'], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(large, 'size', { value: MAX_FILE_BYTES + 1 });
    expect(validateFiles({ ...files, 'legal-presence': [large] })).toMatch(/10 MB/);
    const ten = new File(['pdf'], 'ten.pdf', { type: 'application/pdf' });
    Object.defineProperty(ten, 'size', { value: MAX_FILE_BYTES });
    expect(validateFiles({ ...files, 'legal-presence': [ten, ten, ten, ten, ten, ten] })).toMatch(
      /50 MB/,
    );
  });
});

describe('Buyer KYB service-port validation', () => {
  it('rejects wrong-owner, unconfirmed, wrong-scope and invalid-status snapshots', () => {
    const approved = snapshotFixture('Approved');
    expect(confirmedKybSnapshot(approved, 'u1', false)?.verification?.status).toBe('Approved');
    expect(confirmedKybSnapshot(approved, 'u2', false)).toBeNull();
    expect(confirmedKybSnapshot(approved, 'u1', true)).toBeNull();
    expect(confirmedKybSnapshot({ ...approved, confirmed: false }, 'u1', false)).toBeNull();
    expect(
      confirmedKybSnapshot(
        { ...approved, verification: { ...approved.verification, accountId: 'u2' } },
        'u1',
        false,
      ),
    ).toBeNull();
    expect(
      confirmedKybSnapshot(
        { ...approved, verification: { ...approved.verification, status: 'verified' } },
        'u1',
        false,
      ),
    ).toBeNull();
    expect(
      confirmedKybSnapshot(
        { ...approved, verification: { ...approved.verification, mode: 'Full' } },
        'u1',
        false,
      ),
    ).toBeNull();
  });
  it('does not accept an approval as a submission receipt, or submit real documents in Demo', async () => {
    const service = serviceFixture();
    service.submit = vi.fn(async () => snapshotFixture('Approved'));
    const input = {
      company: companyFixture(),
      mode: 'Auto' as const,
      documents: [],
      consent: true as const,
      idempotencyKey: 'test',
    };
    await expect(buyerKybApi.submit(service, input, 'u1', false)).rejects.toThrow(/not confirmed/);
    await expect(buyerKybApi.submit(service, input, 'u1', true)).rejects.toThrow(/Demo/);
    expect(service.submit).toHaveBeenCalledTimes(1);
  });
});
