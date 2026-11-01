'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { AsyncButton } from '@/components/ui/async-feedback';
import { describeError, isUnauthorized } from '@/lib/api/errors';
import type { BuyerKybAdminService, BuyerKybBundle, BuyerKybCase } from '@/lib/buyer-kyb';

/** Check the backend's private manifest before offering its archive, never an external URL. */
export function checkedBundle(result: BuyerKybBundle, record: BuyerKybCase) {
  if (
    result?.confirmed !== true ||
    result.caseId !== record.id ||
    result.accountId !== record.accountId ||
    result.revision !== record.revision ||
    !(result.blob instanceof Blob) ||
    result.blob.type !== 'application/zip' ||
    result.blob.size <= 0 ||
    result.blob.size > 100 * 1024 * 1024 ||
    result.form?.contentType !== 'application/pdf' ||
    typeof result.form.fileName !== 'string' ||
    !result.form.fileName.trim() ||
    !Number.isSafeInteger(result.form.sizeBytes) ||
    result.form.sizeBytes <= 0 ||
    result.form.sizeBytes > 20 * 1024 * 1024 ||
    !Array.isArray(result.documents) ||
    result.documents.length !== record.documents.length ||
    new Set(result.documents.map((document) => document?.id)).size !== record.documents.length ||
    !record.documents.every((document) =>
      result.documents.some(
        (entry) =>
          entry &&
          entry.id === document.id &&
          entry.kind === document.kind &&
          entry.fileName === document.fileName &&
          entry.contentType === document.contentType &&
          entry.sizeBytes === document.sizeBytes,
      ),
    )
  )
    throw new Error('The complete KYB package could not be verified. No file was downloaded.');
  const name = record.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'application';
  return { blob: result.blob, fileName: `kyb-${name}-r${record.revision}.zip` };
}

export function KybBundleDownload({
  record,
  service,
  onAccessDenied,
}: {
  record: BuyerKybCase;
  service: BuyerKybAdminService;
  onAccessDenied: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const locked = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const download = async () => {
    if (locked.current || !service.downloadBundle) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await service.downloadBundle({
        caseId: record.id,
        accountId: record.accountId,
        expectedRevision: record.revision,
      });
      if (!active.current) return;
      const file = checkedBundle(response, record);
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.fileName;
      link.hidden = true;
      document.body.append(link);
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
      if (active.current) setBusy(false);
    }
  };
  return (
    <div className="buyer-kyb-download">
      <AsyncButton
        type="button"
        className="btn small"
        busy={busy}
        disabled={busy || !service.downloadBundle}
        aria-label={`Download KYB package for ${record.email}`}
        title="Submitted form PDF and original uploaded documents"
        onClick={() => void download()}
      >
        {busy ? 'Downloading…' : 'Download'}
      </AsyncButton>
      {!service.downloadBundle && <small>Package unavailable</small>}
      {error && (
        <p className="buyer-kyb-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
