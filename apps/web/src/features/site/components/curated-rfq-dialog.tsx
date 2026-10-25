'use client';

import { useEffect, useRef } from 'react';
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
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const trigger = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = 'hidden';
    dialog.querySelector<HTMLElement>('.on-curated-close')?.focus();
    const close = () => onClose();
    dialog.addEventListener('close', close);
    return () => {
      dialog.removeEventListener('close', close);
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [onClose]);
  const closeDialog = () => ref.current?.close();
  return (
    <dialog
      ref={ref}
      className="on-curated-dialog"
      aria-labelledby="on-curated-heading"
      aria-describedby="on-curated-intro"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        closeDialog();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeDialog();
        }
      }}
      onClick={(event) => {
        event.stopPropagation();
        const dialog = event.currentTarget;
        if (event.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDialog();
      }}
    >
      <header>
        <div>
          <span className="on-curated-eyebrow">
            Buyer RFQ <span>{item.id}</span>
          </span>
          <h2 id="on-curated-heading">{item.title}</h2>
          <p id="on-curated-intro">
            {item.description || 'Review the requirements and share your available capacity with the OpenNEXT team.'}
          </p>
        </div>
        <button type="button" className="on-curated-close" aria-label="Close RFQ details" onClick={closeDialog}>×</button>
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
        Submit your proposed capacity and terms. OpenNEXT will review your response and coordinate the next steps. Availability and final pricing are confirmed by quote.
      </p>
      <p className="on-curated-error" data-curated-error role="alert" hidden={!error}>{error}</p>
      <footer>
        <button type="button" className="on-curated-back" onClick={closeDialog}>Close</button>
        <button type="button" className="on-curated-offer" onClick={() => onOffer(item)}>
          Offer capacity <span aria-hidden="true">↗</span>
        </button>
      </footer>
    </dialog>
  );
}
