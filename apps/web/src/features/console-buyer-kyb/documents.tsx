'use client';

import { AsyncButton } from '@/components/ui/async-feedback';
import { useLayoutEffect, useRef, useState } from 'react';
import type { BuyerKybAdminService, BuyerKybCase, BuyerKybDocument } from '@/lib/buyer-kyb';
import { describeError, isUnauthorized } from '@/lib/api/errors';
import { checkedDownload, DOCUMENT_NAMES } from './review';

export function KybDocuments({
  record,
  service,
  onAccessDenied,
}: {
  record: BuyerKybCase;
  service: BuyerKybAdminService;
  onAccessDenied: () => void;
}) {
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const active = useRef(true);
  const locked = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const download = async (document: BuyerKybDocument) => {
    if (locked.current) return;
    locked.current = true;
    setPending(document.id);
    setError('');
    try {
      const result = await service.download({
        caseId: record.id,
        documentId: document.id,
        expectedRevision: record.revision,
      });
      if (!active.current) return;
      const file = checkedDownload(result, record, document);
      const url = URL.createObjectURL(file.blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = file.fileName;
      link.hidden = true;
      window.document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (failure) {
      if (!active.current) return;
      if (isUnauthorized(failure)) onAccessDenied();
      else setError(describeError(failure).message);
    } finally {
      locked.current = false;
      if (active.current) setPending('');
    }
  };
  return (
    <section aria-labelledby="buyer-kyb-documents">
      <h3 id="buyer-kyb-documents">Submitted documents</h3>
      <p className="buyer-kyb-note">
        Download only for authorized ALLScale review. Files are available through private,
        permission-checked storage; the adapter must release only scanned documents.
      </p>
      {record.documents.length ? (
        <ul className="buyer-kyb-documents">
          {record.documents.map((document) => (
            <li key={document.id}>
              <div>
                <strong>{DOCUMENT_NAMES[document.kind]}</strong>
                <span>{document.fileName}</span>
                <small>{Math.ceil(document.sizeBytes / 1024)} KB</small>
              </div>
              <AsyncButton
                busy={pending === document.id}
                type="button"
                className="btn small"
                disabled={Boolean(pending) || typeof service.download !== 'function'}
                onClick={() => void download(document)}
                aria-label={`Download ${document.fileName}`}
              >
                {pending === document.id ? 'Downloading…' : 'Download'}
              </AsyncButton>
            </li>
          ))}
        </ul>
      ) : (
        <p>No documents were returned for this case.</p>
      )}
      {error && (
        <p role="alert" className="buyer-kyb-error">
          {error}
        </p>
      )}
    </section>
  );
}
