'use client';

import { useCallback, useMemo, useState } from 'react';
import type { CuratedRfq } from '@opennext/contracts';
import '../styles/terminal-shared.css';
import '../styles/homepage.css';
import '../styles/listings.css';
import '../styles/curated-inquiries.css';
import '../styles/contact.css';
import { offerMessage, validCurated } from '../lib/curated';
import { ContactDialog } from './contact-dialog';
import { CuratedRfqDialog } from './curated-rfq-dialog';
import { InfoModal } from './info-modal';
import { LandingBody } from './landing-sections';
import {
  SiteActionsProvider,
  useWorkspaceNavigation,
  type InfoKind,
  type SiteActions,
} from './site-actions';

type Overlay =
  | { type: 'info'; kind: InfoKind }
  | { type: 'contact'; message?: string }
  | { type: 'curated'; item: CuratedRfq; error?: string }
  | null;

/** The public landing page (opennextlab.ai). Owns the overlays the sections can open. */
export function LandingPage() {
  const [overlay, setOverlay] = useState<Overlay>(null);
  const openWorkspace = useWorkspaceNavigation();
  const close = useCallback(() => setOverlay(null), []);
  const actions = useMemo<SiteActions>(
    () => ({
      openWorkspace,
      openContact: (options) => setOverlay({ type: 'contact', message: options?.message }),
      openInfo: (kind) =>
        setOverlay(kind === 'contact' ? { type: 'contact' } : { type: 'info', kind }),
      showCuratedDetails: (item) => {
        if (validCurated(item)) setOverlay({ type: 'curated', item });
      },
      offerCurated: (item) => {
        if (validCurated(item)) setOverlay({ type: 'contact', message: offerMessage(item) });
      },
    }),
    [openWorkspace],
  );
  return (
    <SiteActionsProvider value={actions}>
      <LandingBody />
      {overlay?.type === 'info' ? (
        <InfoModal
          kind={overlay.kind}
          onClose={close}
          onHelp={() => openWorkspace({ route: 'help' })}
        />
      ) : null}
      {overlay?.type === 'contact' ? (
        <ContactDialog message={overlay.message} onClose={close} />
      ) : null}
      {overlay?.type === 'curated' ? (
        <CuratedRfqDialog
          item={overlay.item}
          error={overlay.error}
          onClose={close}
          onOffer={actions.offerCurated}
        />
      ) : null}
    </SiteActionsProvider>
  );
}
