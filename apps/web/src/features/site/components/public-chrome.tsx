'use client';

import { BrandLink } from './brand';
import { WorkspaceCta } from './cta';
import { useSiteActions } from './site-actions';
import { COPY } from './landing-sections';

export function PublicHeader() {
  const { openContact } = useSiteActions();
  return (
    <header className="public-header">
      <div className="public-header-inner">
        <BrandLink />
        <nav className="public-header-actions" aria-label="Main navigation">
          <button
            type="button"
            className="on-button on-button-outline on-button-small"
            data-act="contact-us"
            onClick={() => openContact()}
          >
            Contact Us
          </button>
          <WorkspaceCta target="gpus" style="primary" className="on-button-small">
            {COPY.signin}
          </WorkspaceCta>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter({ compact = false }: { compact?: boolean }) {
  const { openContact, openInfo } = useSiteActions();
  return (
    <footer className={`public-footer${compact ? ' public-footer-compact' : ''}`}>
      <BrandLink />
      <div className="public-footer-links">
        <button type="button" data-act="contact-us" onClick={() => openContact()}>
          {COPY.contact}
        </button>
        <button
          type="button"
          data-public-action="info"
          data-info="privacy"
          onClick={() => openInfo('privacy')}
        >
          {COPY.privacy}
        </button>
        {compact ? null : <span>{COPY.footer}</span>}
      </div>
    </footer>
  );
}
