'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BuyerKybCompany, KybDocumentKind } from '@/lib/buyer-kyb';
import { queryKeys } from '@/lib/api/query-keys';
import { describeError } from '@/lib/api/errors';
import { useSessionStore } from '@/lib/session-store';
import { useCloseModal } from '@/terminal-kit';
import { buyerKybApi } from '../api';
import { useBuyerKyb } from '../hooks';
import {
  DOCUMENT_KINDS,
  emptyCompany,
  modeForCountry,
  validateCompany,
  validateFiles,
  type KybFiles,
} from '../requirements';
import { CompanyFields } from './company-fields';
import { DocumentFields } from './document-fields';

export function KybForm() {
  const kyb = useBuyerKyb();
  const close = useCloseModal();
  const client = useQueryClient();
  const [company, setCompany] = useState(emptyCompany);
  const [files, setFiles] = useState<KybFiles>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(false);
  const requestId = useRef('');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const mode = modeForCountry(company.country);
  const available = kyb.connected && kyb.query.isSuccess && !kyb.query.isError;
  const change = (key: keyof BuyerKybCompany, value: string) => {
    setCompany((current) => ({ ...current, [key]: value }));
    if (key === 'country') setFiles({});
    requestId.current = '';
    setError('');
  };
  const changeFiles = (kind: KybDocumentKind, values: File[]) => {
    const next = { ...files, [kind]: values };
    const issue = validateFiles(next, false);
    setError(issue ?? '');
    if (!issue) {
      setFiles(next);
      requestId.current = '';
    }
  };
  const currentAccount = () => {
    const session = useSessionStore.getState();
    return (
      alive.current &&
      session.status === 'verified' &&
      session.user?.id === kyb.accountId &&
      session.user?.role === 'buyer' &&
      !session.user?.demo &&
      session.user?.onboardingCompleted
    );
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!available || !kyb.service || kyb.demo || busy || !currentAccount()) return;
    const issue = validateCompany(company) ?? validateFiles(files);
    if (issue || !mode || !consent) {
      setError(issue ?? 'Confirm the verification consent before submitting.');
      return;
    }
    setBusy(true);
    setError('');
    requestId.current ||= crypto.randomUUID();
    const inputCompany =
      mode === 'Auto'
        ? { ...company, incorporationDate: '', legalForm: '', legalAddress: '', phone: '' }
        : company;
    try {
      const result = await buyerKybApi.submit(
        kyb.service,
        {
          company: inputCompany,
          mode,
          consent: true,
          idempotencyKey: requestId.current,
          documents: DOCUMENT_KINDS.flatMap((kind) =>
            (files[kind] ?? []).map((file) => ({ kind, file })),
          ),
        },
        kyb.accountId,
        kyb.demo,
      );
      if (!currentAccount()) return;
      setFiles({});
      client.setQueryData(queryKeys.account.buyerKyb(kyb.identity), result);
    } catch (problem) {
      if (currentAccount())
        setError(
          describeError(problem, 'We could not confirm your KYB submission. Please try again.')
            .message,
        );
    } finally {
      if (currentAccount()) setBusy(false);
    }
  };
  return (
    <form className="buyer-kyb-form" onSubmit={submit} aria-label="Buyer KYB form">
      <p className="buyer-kyb-intro">
        Verify your business before adding credit or purchasing capacity. Choose where your company
        is registered to see the information OpenNEXT requires.
      </p>
      {!available && !kyb.demo && (
        <div className="buyer-kyb-notice" role="status">
          {kyb.connected
            ? 'Your secure KYB status must be verified before document uploads and submission can be enabled.'
            : 'Secure Buyer KYB submission is not connected yet. You can review the requirements below; document uploads and submission are disabled.'}
        </div>
      )}
      <CompanyFields company={company} onChange={change} disabled={busy} />
      {mode && (
        <>
          <DocumentFields
            mode={mode}
            country={company.country}
            files={files}
            onChange={changeFiles}
            disabled={!available || busy}
          />
          <label className="buyer-kyb-consent">
            <input
              type="checkbox"
              checked={consent}
              disabled={!available || busy}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              I am authorized to represent this business. I confirm the information is accurate and
              authorize OpenNEXT and its authorized verification partners to process these documents
              for business verification.
            </span>
          </label>
        </>
      )}
      {error && (
        <p className="buyer-kyb-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-footer">
        <button type="button" className="btn secondary" onClick={close}>
          Cancel
        </button>
        <button type="submit" className="btn" disabled={!available || !mode || !consent || busy}>
          {busy ? 'Submitting…' : 'Submit KYB'}
        </button>
      </div>
    </form>
  );
}
