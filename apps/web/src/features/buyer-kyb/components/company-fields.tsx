'use client';

import type { BuyerKybCompany } from '@/lib/buyer-kyb';
import { countryList } from '@/lib/countries';
import { modeForCountry } from '../requirements';

type Field = {
  key: keyof BuyerKybCompany;
  label: string;
  type?: string;
  optional?: boolean;
  wide?: boolean;
};
const CORE: Field[] = [
  { key: 'companyName', label: 'Legal company name' },
  { key: 'registrationNumber', label: 'Company registration number' },
  { key: 'email', label: 'Business email', type: 'email' },
  { key: 'website', label: 'Company website', type: 'url', optional: true },
  { key: 'taxId', label: 'Tax identification number' },
  { key: 'monthlyVolumeUsd', label: 'Estimated monthly volume (USD)', type: 'number' },
  { key: 'monthlyTransactions', label: 'Estimated monthly transactions', type: 'number' },
];
const FULL: Field[] = [
  { key: 'incorporationDate', label: 'Incorporation date', type: 'date' },
  { key: 'legalForm', label: 'Legal form / entity type' },
  { key: 'phone', label: 'Business phone number', type: 'tel' },
  { key: 'legalAddress', label: 'Registered legal address', wide: true },
];

export function CompanyFields({
  company,
  onChange,
  disabled,
}: {
  company: BuyerKybCompany;
  onChange: (key: keyof BuyerKybCompany, value: string) => void;
  disabled: boolean;
}) {
  const mode = modeForCountry(company.country);
  return (
    <>
      <div className="buyer-kyb-country">
        <label className="form-label">
          Country / region of incorporation
          <select
            className="field"
            name="country"
            value={company.country}
            required
            disabled={disabled}
            onChange={(event) => onChange('country', event.target.value)}
          >
            <option value="">Select country / region</option>
            {countryList().map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </label>
        <div className="buyer-kyb-route" aria-live="polite">
          <span className="eyebrow muted">REVIEW ROUTE</span>
          <strong>
            {mode === 'Auto'
              ? 'Auto · Corporate registry check'
              : mode === 'Full'
                ? 'Full · Document review'
                : 'Select your company’s country'}
          </strong>
          <p>
            {mode === 'Auto'
              ? 'Registry-supported collection. OpenNEXT approval is still required.'
              : mode === 'Full'
                ? 'Additional company information is required for OpenNEXT review.'
                : 'The requested information adapts to your country of incorporation.'}
          </p>
        </div>
      </div>
      {mode && (
        <section aria-label="Company information">
          <h3>
            <span>01</span> Company information
          </h3>
          <div className="buyer-kyb-fields">
            {[...CORE, ...(mode === 'Full' ? FULL : [])].map((field) => (
              <label className={`form-label ${field.wide ? 'buyer-kyb-wide' : ''}`} key={field.key}>
                {field.label}
                {field.optional ? ' (optional)' : ''}
                <input
                  className="field"
                  name={field.key}
                  type={field.type ?? 'text'}
                  value={company[field.key]}
                  required={!field.optional}
                  disabled={disabled}
                  maxLength={field.wide ? 1000 : 254}
                  min={field.type === 'number' ? '0' : undefined}
                  step={
                    field.key === 'monthlyVolumeUsd'
                      ? '0.01'
                      : field.type === 'number'
                        ? '1'
                        : undefined
                  }
                  autoComplete="off"
                  onChange={(event) => onChange(field.key, event.target.value)}
                />
                {field.key === 'registrationNumber' && company.country === 'HK' && (
                  <small>Hong Kong: use the 8-digit business registration number.</small>
                )}
              </label>
            ))}
            <label className="form-label buyer-kyb-wide">
              Business description
              <textarea
                className="field"
                name="businessDescription"
                rows={3}
                required
                maxLength={4000}
                disabled={disabled}
                value={company.businessDescription}
                onChange={(event) => onChange('businessDescription', event.target.value)}
              />
            </label>
          </div>
        </section>
      )}
    </>
  );
}
