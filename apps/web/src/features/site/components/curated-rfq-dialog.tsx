'use client';

import { NativeDialog } from '@/components/ui/dialog';
import type { CuratedRfq } from '@opennext/contracts';
import { requirementRows } from '../lib/curated';

/** "View requirements" dialog for a curated buyer RFQ (legacy OpenNEXT-curated-inquiries.js). */
export function CuratedRfqDialog({
  item,
  error = '',
  onClose,
  onOffer,
}: {
  item: CuratedRfq;
  error?: string;
  onClose: () => void;
  onOffer: (item: CuratedRfq) => void;
}) {
  return (
    <NativeDialog
      className="on-curated-dialog"
      labelledBy="on-curated-heading"
      describedBy="on-curated-intro"
      onClose={onClose}
      initialFocus=".on-curated-close"
      lockScroll
    >
      <header>
        <div>
          <span className="on-curated-eyebrow">
            Buyer RFQ <span>{item.id}</span>
          </span>
          <h2 id="on-curated-heading">{item.title}</h2>
          <p id="on-curated-intro">
            {item.description ||
              'Review the requirements and share your available capacity with the OpenNEXT team.'}
          </p>
        </div>
        <button
          type="button"
          className="on-curated-close"
          aria-label="Close RFQ details"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <dl className="on-curated-specs">
        {requirementRows(item).map((row) => (
          <div key={`${row.label}\n${row.value}`}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="on-curated-notice">
        Submit your proposed capacity and terms. OpenNEXT will review your response and coordinate
        the next steps. Availability and final pricing are confirmed by quote.
      </p>
      <p className="on-curated-error" data-curated-error role="alert" hidden={!error}>
        {error}
      </p>
      <footer>
        <button type="button" className="on-curated-back" onClick={onClose}>
          Close
        </button>
        <button type="button" className="on-curated-offer" onClick={() => onOffer(item)}>
          Offer capacity <span aria-hidden="true">↗</span>
        </button>
      </footer>
    </NativeDialog>
  );
}
