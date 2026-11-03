'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AsyncButton } from '@/components/ui/async-feedback';
import { BuyerKybButton } from '@/features/buyer-kyb';
import { useSessionStore } from '@/lib/session-store';
import type {
  SignedSpotAgreement,
  SpotAgreementContext,
  SpotAgreementService,
} from '@/lib/spot-agreement';
import { agreementApi } from '../api';
import { useAgreement } from '../hooks';
import { contextKey } from '../validation';
import { AgreementDocument, AgreementSummary } from './agreement-document';
import '../agreements.css';

interface ReviewProps {
  context: SpotAgreementContext;
  onSigned: (receipt: SignedSpotAgreement) => void;
  onCancel: () => void;
}

export function AgreementReview(props: ReviewProps) {
  return <AgreementReviewBody key={contextKey(props.context)} {...props} />;
}

function AgreementReviewBody({ context, onSigned, onCancel }: ReviewProps) {
  const agreement = useAgreement(context);
  const [signatoryName, setSignatoryName] = useState('');
  const [signatoryTitle, setSignatoryTitle] = useState('');
  const [authority, setAuthority] = useState(false);
  const [terms, setTerms] = useState(false);
  const [interruptions, setInterruptions] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [retryInput, setRetryInput] = useState<Parameters<SpotAgreementService['sign']>[0] | null>(
    null,
  );
  const inFlight = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, [agreement.service, agreement.kyb.identity]);
  const current = (expectedGeneration: number) => {
    const session = useSessionStore.getState();
    return (
      generation.current === expectedGeneration &&
      session.status === 'verified' &&
      session.user?.id === context.accountId &&
      session.user.role === 'buyer' &&
      !session.user.demo
    );
  };
  const signing = useMutation({
    gcTime: 0,
    mutationFn: async (input: Parameters<SpotAgreementService['sign']>[0]) => {
      const requestGeneration = generation.current;
      if (!agreement.service || !agreement.document || !current(requestGeneration))
        throw new Error('Verified agreement signing is unavailable.');
      const refreshed = await agreement.kyb.query.refetch();
      const freshKyb = refreshed.data?.verification;
      if (refreshed.isError || !freshKyb || !current(requestGeneration))
        throw new Error('Your approved KYB could not be refreshed. Please try again.');
      const receipt = await agreementApi.sign(
        agreement.service,
        agreement.document,
        freshKyb,
        input,
      );
      if (!current(requestGeneration)) throw new Error('Your account session has changed.');
      return receipt;
    },
  });
  const sign = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || !agreement.document || !authority || !terms || !interruptions) return;
    inFlight.current = true;
    const requestGeneration = generation.current;
    setError('');
    try {
      const input =
        retryInput ??
        ({
          agreementId: agreement.document.id,
          documentHash: agreement.document.documentHash,
          kybRevision: agreement.document.kyb.revision,
          signatoryName: signatoryName.trim(),
          signatoryTitle: signatoryTitle.trim(),
          authorityConfirmed: true,
          termsAccepted: true,
          interruptionAccepted: true,
          idempotencyKey: `spot-sign:${agreement.document.id}:${agreement.document.documentHash}`,
        } as const);
      setRetryInput(input);
      const receipt = await signing.mutateAsync(input);
      if (current(requestGeneration)) onSigned(receipt);
    } catch (cause) {
      if (current(requestGeneration))
        setError(cause instanceof Error ? cause.message : 'Signing could not be confirmed.');
    } finally {
      inFlight.current = false;
    }
  };
  const download = async () => {
    if (!agreement.service || !agreement.document || downloading) return;
    const requestGeneration = generation.current;
    setDownloading(true);
    setError('');
    try {
      const file = await agreementApi.download(agreement.service, agreement.document);
      if (!current(requestGeneration)) return;
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      if (current(requestGeneration))
        setError(cause instanceof Error ? cause.message : 'The agreement PDF is unavailable.');
    } finally {
      if (current(requestGeneration)) setDownloading(false);
    }
  };
  const ready = Boolean(agreement.document && agreement.kyb.approved && agreement.service);
  const status = !agreement.service
    ? 'Agreement preview — electronic signing is not connected yet. No contract has been signed and no payment has been taken.'
    : !agreement.kyb.approved
      ? 'An approved Buyer KYB is required to prepare and sign this agreement.'
      : agreement.query.isError
        ? 'A verified agreement could not be prepared. The provider legal details and commercial policies must be confirmed before signing.'
        : agreement.query.isLoading
          ? 'Preparing your verified agreement…'
          : '';
  return (
    <form className="spot-agreement" onSubmit={(event) => void sign(event)}>
      <div className="agreement-topline">
        <p>Review the automatically filled order and business details before payment.</p>
        <AsyncButton
          type="button"
          className="btn secondary small"
          busy={downloading}
          disabled={!ready}
          onClick={() => void download()}
        >
          Download PDF
        </AsyncButton>
      </div>
      {status && (
        <p className="agreement-status form-note" role="status">
          {status}
        </p>
      )}
      {!agreement.kyb.approved && <BuyerKybButton returnTo="spot" />}
      <div className="agreement-layout">
        <AgreementDocument
          document={agreement.document}
          buyer={agreement.kyb.snapshot?.verification}
        />
        <AgreementSummary context={context} />
      </div>
      <fieldset
        className="agreement-signatory"
        disabled={!ready || signing.isPending || Boolean(retryInput)}
      >
        <legend>Authorized signatory</legend>
        <div className="agreement-signatory-fields">
          <label>
            Full legal name
            <input
              className="field"
              value={signatoryName}
              onChange={(event) => setSignatoryName(event.target.value)}
              required
              maxLength={150}
              autoComplete="name"
            />
          </label>
          <label>
            Job title
            <input
              className="field"
              value={signatoryTitle}
              onChange={(event) => setSignatoryTitle(event.target.value)}
              required
              maxLength={150}
              autoComplete="organization-title"
            />
          </label>
        </div>
        <label className="agreement-consent">
          <input
            type="checkbox"
            checked={authority}
            onChange={(event) => setAuthority(event.target.checked)}
          />
          <span>I am authorized to sign this agreement on behalf of the verified business.</span>
        </label>
        <label className="agreement-consent">
          <input
            type="checkbox"
            checked={terms}
            onChange={(event) => setTerms(event.target.checked)}
          />
          <span>
            I have reviewed the agreement and order summary, accept the terms and consent to
            electronic execution.
          </span>
        </label>
        <label className="agreement-consent">
          <input
            type="checkbox"
            checked={interruptions}
            onChange={(event) => setInterruptions(event.target.checked)}
          />
          <span>
            I understand Spot capacity may be interrupted. Interruptions pause runtime and billing;
            replacements resume the remaining purchased hours, with data preserved under the stated
            recovery and retention terms.
          </span>
        </label>
      </fieldset>
      {error && (
        <p className="payment-error form-note" role="alert">
          {error}
        </p>
      )}
      {retryInput && !signing.isSuccess && (
        <p className="form-note">
          Retry uses the same document and signing reference. This signing step does not take
          payment.
        </p>
      )}
      <div className="modal-footer">
        <button type="button" className="btn secondary" onClick={onCancel}>
          Back
        </button>
        {agreement.query.isError && (
          <button
            type="button"
            className="btn secondary"
            onClick={() => void agreement.query.refetch()}
          >
            Retry preparation
          </button>
        )}
        <AsyncButton
          type="submit"
          className="btn"
          busy={signing.isPending}
          busyLabel="Confirming signature…"
          disabled={
            !ready ||
            !authority ||
            !terms ||
            !interruptions ||
            !signatoryName.trim() ||
            !signatoryTitle.trim()
          }
        >
          {retryInput ? 'Retry signing' : 'Sign & continue'}
        </AsyncButton>
      </div>
    </form>
  );
}
