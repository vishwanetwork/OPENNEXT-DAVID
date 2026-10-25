'use client';

import { useState } from 'react';
import type { RfqRequest, SupplyRequest } from '@opennext/contracts';
import { useToast } from '@/components/ui/toast';
import { useInvalidateWorkspace, useIsDemo, useWorkspaceStore } from '@/terminal-kit';
import { procurementApi } from '../api';
import { useSubmissionId } from '../hooks';
import { receiptFor } from './shared';

/* ---------- Submission (receipt / idempotency contract) ---------- */
interface SubmitOptions {
  recordKind: 'rfq' | 'supply';
  id?: string;
  data: Record<string, string>;
}

/** Legacy `submitRecord`: one in-flight request per form, stable client submission id, receipts, warnings. */
export function useSubmitRecord() {
  const { api, id: submissionId } = useSubmissionId();
  const toast = useToast();
  const invalidate = useInvalidateWorkspace();
  const demo = useIsDemo();
  const [submitting, setSubmitting] = useState(false);
  const submit = async ({ recordKind, id, data }: SubmitOptions) => {
    if (submitting) return;
    setSubmitting(true);
    let saved: { id: string } | null = null;
    const workspace = useWorkspaceStore.getState();
    try {
      let result: { id: string; status?: string | null; submission?: unknown };
      const warnings: string[] = [];
      if (recordKind === 'supply') {
        const input: SupplyRequest = {
          ...(data as unknown as SupplyRequest),
          serviceStart: new Date(data.serviceStart + 'Z').toISOString(),
          serviceEnd: new Date(data.serviceEnd + 'Z').toISOString(),
        };
        if (!id) input.clientSubmissionId = submissionId();
        result = (await procurementApi.createSupply(api, input)).supply;
      } else {
        const requestKind = data.requestKind === 'quote_request' ? 'quote_request' : 'rfq';
        const input: RfqRequest = {
          ...(data as unknown as RfqRequest),
          start: new Date(data.start + 'Z').toISOString(),
          quoteDeadline: new Date(data.quoteDeadline + 'Z').toISOString(),
          shareClosingPrice: !!data.shareClosingPrice,
          requestKind,
          title: String(
            data.title ||
              [
                data.model,
                data.term,
                requestKind === 'quote_request' ? 'quote request' : 'capacity request',
              ]
                .filter(Boolean)
                .join(' · '),
          ).slice(0, 140),
        };
        if (data.selectedOffer)
          input.selectedOffer =
            typeof data.selectedOffer === 'string'
              ? JSON.parse(data.selectedOffer)
              : data.selectedOffer;
        if (!id) input.clientSubmissionId = submissionId();
        result = id
          ? (await procurementApi.updateRfq(api, id, input)).rfq
          : (await procurementApi.createRfq(api, input)).rfq;
      }
      if (!result || typeof result.id !== 'string' || !result.id)
        throw new Error(
          'The server did not return a submission reference. Refresh your records before trying again.',
        );
      saved = { id: result.id };
      const modal = {
        type: 'proc-submission' as const,
        id: result.id,
        recordKind,
        receipt: receiptFor(result),
        recordStatus: result.status || 'Saved',
        warnings,
        demo,
      };
      workspace.patch({ modal });
      if (recordKind === 'supply') {
        try {
          const installation = await procurementApi.requestAgent(api, result.id);
          if (installation.message) warnings.push(installation.message);
        } catch {
          warnings.push(
            'Capacity is saved. The agent setup request is pending; use Refresh status in My Supply instead of submitting the capacity again.',
          );
        }
      }
      try {
        await invalidate();
      } catch {
        warnings.push(
          'Your submission is saved, but the workspace could not refresh. Keep this reference and refresh your records. Do not submit it again.',
        );
      }
      useWorkspaceStore.getState().patch({ modal: { ...modal, warnings: [...warnings] } });
      toast(
        modal.receipt
          ? modal.demo
            ? 'Saved to the isolated Demo workspace.'
            : 'Submission received by OpenNEXT operations.'
          : 'Saved to your account. Operations receipt has not been confirmed.',
      );
    } catch (error) {
      toast(
        saved
          ? 'Your submission is saved. Keep reference ' + saved.id + ' and refresh your records.'
          : (error as Error).message,
      );
    } finally {
      setSubmitting(false);
    }
  };
  return { submit, submitting };
}
