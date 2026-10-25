'use client';

import { type FormEvent, type ReactNode } from 'react';
import { countryList } from './../countries';

/* ---------- Primitive fields ---------- */
export function Input({
  label,
  name,
  defaultValue,
  type = 'text',
  readOnly,
  ...rest
}: {
  label: ReactNode;
  name: string;
  defaultValue?: unknown;
  type?: string;
  readOnly?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name' | 'type' | 'defaultValue'>) {
  return (
    <div>
      <label className="form-label" htmlFor={'proc-' + name}>
        {label}
      </label>
      <input
        className="field"
        id={'proc-' + name}
        name={name}
        type={type}
        defaultValue={
          defaultValue === null || defaultValue === undefined ? '' : String(defaultValue)
        }
        readOnly={readOnly}
        {...rest}
      />
    </div>
  );
}

export function CountrySelect({
  name,
  defaultValue = '',
  label = 'Region / data location',
}: {
  name: string;
  defaultValue?: string;
  label?: string;
}) {
  const list = countryList();
  const selected =
    list.find((item) => item.name === defaultValue || item.code === defaultValue)?.name || '';
  return (
    <div>
      <label className="form-label" htmlFor={'proc-' + name}>
        {label}
      </label>
      <select className="field" id={'proc-' + name} name={name} required defaultValue={selected}>
        <option value="">Select a country / territory</option>
        {list.map((item) => (
          <option key={item.code} value={item.name}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export const Optional = () => <span className="muted">(optional)</span>;

export const formData = (event: FormEvent<HTMLFormElement>) =>
  Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
