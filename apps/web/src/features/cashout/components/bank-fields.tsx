'use client';

import type { CashoutBankDetails } from '@/lib/cashout';
import { countryList } from '@/lib/countries';

export function CashoutBankFields({
  value,
  change,
  lockedAddress,
}: {
  value: CashoutBankDetails;
  change: (next: CashoutBankDetails) => void;
  lockedAddress: boolean;
}) {
  const field = (
    key: keyof CashoutBankDetails,
    label: string,
    required = true,
    readOnly = false,
  ) => (
    <label>
      {label}
      <input
        className="field"
        name={key}
        value={value[key]}
        onChange={(event) =>
          change({
            ...value,
            [key]:
              key.toLowerCase().includes('swift') || key === 'iban'
                ? event.target.value.toUpperCase()
                : event.target.value,
          })
        }
        required={required}
        readOnly={readOnly}
        maxLength={500}
        autoComplete="off"
      />
    </label>
  );
  return (
    <div className="cashout-field-grid">
      {field('beneficiaryName', 'Beneficiary legal name (approved KYB)', true, true)}
      {field('beneficiaryAddress', 'Beneficiary address', true, lockedAddress)}
      {field('bankName', 'Bank name')}
      <label>
        Bank country
        <select
          className="field"
          name="bankCountry"
          value={value.bankCountry}
          onChange={(event) => change({ ...value, bankCountry: event.target.value })}
          required
        >
          <option value="">Select country</option>
          {countryList().map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
      </label>
      {field('bankAddress', 'Bank address')}
      {field('accountNumber', 'Account number (or provide IBAN)', false)}
      {field('iban', 'IBAN (or provide account number)', false)}
      {field('swiftBic', 'SWIFT / BIC')}
      {field('routingCode', 'Routing / clearing code (if required)', false)}
      {field('intermediaryBank', 'Intermediary bank (if required)', false)}
      {field('intermediarySwiftBic', 'Intermediary SWIFT / BIC (if required)', false)}
    </div>
  );
}
