'use client';

import { Dialog } from '@/components/ui/dialog';
import type { InfoKind } from './site-actions';

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
  const contact = kind === 'contact';
  const title = contact ? 'Contact OpenNEXT' : 'Privacy';
  return (
    <Dialog
      onClose={onClose}
      overlayClassName="overlay"
      overlayProps={{ 'data-dismiss': 'modal' }}
      className="modal"
      label={title}
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
              Supplier access should be limited to the requirements and delivery information needed
              for a transaction.
            </p>
            <div className="callout">
              Never upload a private SSH key. Public keys can be shared for instance access. Review
              your account permissions and credential scopes from the workspace settings.
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
