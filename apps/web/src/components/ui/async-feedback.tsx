import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './async-feedback.css';

/** Local progress feedback that never blocks the surrounding navigation. */
export function AsyncFeedback({ children }: { children: ReactNode }) {
  return (
    <div className="async-feedback" role="status" aria-live="polite">
      <span className="async-spinner" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function AsyncButton({
  busy = false,
  busyLabel,
  disabled,
  children,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; busyLabel?: string }) {
  return (
    <button
      {...props}
      type={type === 'submit' ? 'submit' : type === 'reset' ? 'reset' : 'button'}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <span className="async-spinner" aria-hidden="true" /> : null}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
