import type { ReactNode } from 'react';

/** Terminal page heading (`.page-heading`), identical to legacy `pageHead()`. */
export function PageHeading({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

/** Status tag with the legacy tone rules. */
export function StatusTag({ status }: { status: string }) {
  const tone = /Pending|Open|Review|Quoted|Provision/.test(status) ? 'warning' : /Fail|Stopped/.test(status) ? 'red' : '';
  return <span className={`tag ${tone}`}>{status}</span>;
}

export const SaveIcon = () => (
  <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9L12 3Z" /></svg>
);
export const PlusIcon = () => (
  <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);

/** Terminal `.btn` with the legacy class variants (`secondary`, `small`, `ghost`, `danger`, '' = primary). */
export function TButton({ cls = 'secondary', children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { cls?: string; children: ReactNode }) {
  return (
    <button type="button" className={`btn ${cls}`} {...rest}>
      <span className="btn-label">{children}</span>
    </button>
  );
}
