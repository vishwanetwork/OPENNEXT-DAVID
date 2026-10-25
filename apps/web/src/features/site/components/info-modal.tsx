'use client';

import { useEffect, useRef } from 'react';
import type { InfoKind } from './site-actions';

const FOCUSABLE =
  'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

/** The legacy `open("info")` modal: Privacy copy for every policy link; Contact routes to the form. */
export function InfoModal({
  kind,
  onClose,
  onHelp,
}: {
  kind: InfoKind;
  onClose: () => void;
  onHelp: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const contact = kind === 'contact';
  const title = contact ? 'Contact OpenNEXT' : 'Privacy';
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const previous = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      if (node.isConnected && !node.contains(document.activeElement))
        node.focus({ preventScroll: true });
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (item) => item.getClientRects().length,
      );
      if (!items.length) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <div
      className="overlay"
      data-dismiss="modal"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow muted">OPENNEXT WORKSPACE</span>
            <h2>{title}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </header>
        <div className="modal-body">
          {contact ? (
            <>
              <div className="callout">
                For procurement, supplier onboarding and delivery support, contact your OpenNEXT
                account team. Include the RFQ ID, supply reference or instance ID so the team can
                locate the record.
              </div>
              <div className="modal-footer">
                <button type="button" className="btn" onClick={onHelp}>
                  Open Help &amp; documentation
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="form-note">
                Your profile, quote requests and procurement records belong to your workspace.
                Supplier access should be limited to the requirements and delivery information
                needed for a transaction.
              </p>
              <div className="callout">
                Never upload a private SSH key. Public keys can be shared for instance access.
                Review your account permissions and credential scopes from the workspace settings.
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
