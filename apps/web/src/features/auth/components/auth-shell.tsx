'use client';

import type { ReactNode } from 'react';
import { TerminalBrand } from '@/components/ui/terminal-brand';
import { ArrowIcon } from '@/components/icons';
import '../auth.css';

/** Two-column sign-in / onboarding frame (`.onx-auth-root`). */
export function AuthShell({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <main className="onx-auth-root" data-onx-auth-root>
      <aside className="onx-auth-story">
        <TerminalBrand light />
        <div className="onx-auth-story-copy">
          <h2>
            A clearer market.
            <br />A better match.
          </h2>
          <p>Your next compute opportunity starts here.</p>
        </div>
        <div className="onx-auth-orbits" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </aside>
      <section className="onx-auth-main">
        <button type="button" className="onx-auth-back" data-auth-back onClick={onBack}>
          <ArrowIcon />
          Back to OpenNEXT
        </button>
        <div className="onx-auth-card">
          <div className="onx-auth-mobile-brand">
            <TerminalBrand />
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}

export function SubmitButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <button className="onx-auth-submit" type="submit" disabled={disabled}>
      <span>{children}</span>
      <ArrowIcon />
    </button>
  );
}

export function AuthError({ id, message }: { id?: string; message: string }) {
  return (
    <div
      id={id}
      className="onx-auth-error"
      data-auth-error
      role="alert"
      tabIndex={-1}
      hidden={!message}
    >
      {message}
    </div>
  );
}
