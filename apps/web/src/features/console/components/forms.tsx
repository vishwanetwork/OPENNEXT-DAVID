import type { ReactNode } from 'react';
import { ConsoleIcon as Icon } from '@/components/icons';
import { statusTone } from '../helpers';

export function Field({
  label,
  name,
  defaultValue = '',
  type = 'text',
  hint,
  className = '',
}: {
  label: string;
  name: string;
  defaultValue?: string | number;
  type?: string;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`field ${className}`}>
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        {...(type === 'number' ? { min: 0, step: 'any' } : {})}
      />
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function SelectField({
  label,
  name,
  items,
  defaultValue,
  className = '',
}: {
  label: string;
  name: string;
  items: string[];
  defaultValue?: string;
  className?: string;
}) {
  return (
    <div className={`field ${className}`}>
      <label htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={defaultValue}>
        {items.map((item) => (
          <option key={item}>{item}</option>
        ))}
      </select>
    </div>
  );
}

export function SearchBox({
  placeholder = 'Search records…',
  value,
  onChange,
}: {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="table-search">
      <Icon name="search" />
      <input
        id="table-search"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={placeholder}
      />
    </div>
  );
}

export function Empty({
  title,
  copy,
  action,
}: {
  title: string;
  copy: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon name="search" />
      <strong>{title}</strong>
      <p>{copy}</p>
      {action}
    </div>
  );
}

export function Note() {
  return (
    <div className="page-note">
      <Icon name="shield" />
      Private operations workspace · Changes are stored in this browser. External execution and
      settlement require connected services.
    </div>
  );
}

export function Head({
  title,
  copy,
  actions,
  eyebrow = 'OPERATIONS',
}: {
  title: ReactNode;
  copy?: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {copy ? <p>{copy}</p> : null}
      </div>
      <div className="head-actions">{actions}</div>
    </div>
  );
}

export function Badge({ label, tone = '' }: { label: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function Status({ label }: { label: string }) {
  return <Badge label={label} tone={statusTone(label)} />;
}

export function Btn({
  children,
  onClick,
  className = '',
  disabled,
  type = 'button',
  form,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
  form?: string;
}) {
  return (
    <button
      type={type === 'submit' ? 'submit' : 'button'}
      className={className}
      onClick={onClick}
      disabled={disabled}
      form={form}
    >
      {children}
    </button>
  );
}

export function DetailGrid({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="detail-grid">
      {items.map(([label, value]) => (
        <div key={label}>
          <label>{label}</label>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

export function Callout({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="callout" style={style}>
      {children}
    </div>
  );
}

/** Reads trimmed string values from a submitted form. */
export const formValues = (form: HTMLFormElement) => {
  const data = new FormData(form);
  return {
    data,
    get: (key: string) => String(data.get(key) || '').trim(),
    has: (key: string) => data.has(key),
  };
};
