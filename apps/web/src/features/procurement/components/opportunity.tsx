'use client';

import { useCallback } from 'react';
import type { MarketRow, OwnedRfq } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { useToast } from '@/components/ui/toast';
import { useApiErrorToast } from '@/components/hooks/use-api-error-toast';
import { useSessionStore } from '@/lib/session-store';
import {
  useInvalidateWorkspace,
  useTerminal,
  useTerminalSlots,
  useWorkspaceData,
  useWorkspaceStore,
  type Intent,
  type RequirementDraft,
  type Role,
} from '@/terminal-kit';
import { procurementApi } from '../api';
import { deliveryMethod, isHardware, isModel, kindOf, tokenTotal } from '../exchange';
import { useFindMarketRow } from '../market-view';
import { useOwnedRfqs } from '../records';
import { canInquire, externalCommitment, externalQuantity, rowPrice } from './shared';

/** Message for the operations contact form about a sourced (external) row. */
export function externalInquiryMessage(item: MarketRow): string {
  const supply = item.side === 'supply';
  return [
    supply
      ? 'I would like to request a quote for this sourced offer.'
      : 'I would like to offer capacity for this sourced requirement.',
    (supply ? 'OpenNEXT offer: ' : 'OpenNEXT requirement: ') + item.id,
    'GPU model: ' + item.model,
    'Region: ' + item.region,
    'Quantity: ' + externalQuantity(item),
    externalCommitment(item),
    (supply ? 'Listed price: ' : 'Buyer target: ') +
      rowPrice(item) +
      (item.price == null ? '' : ' / GPU-hour'),
    'Please confirm availability and commercial terms with operations.',
  ].join('\n');
}

/** Requirement prefill built from a demand row for a seller response (legacy `resume()`). */
export function requirementFromRow(item: MarketRow, rfqs: OwnedRfq[]): OwnedRfq {
  const kind = kindOf(item);
  const existing = rfqs.find((r) => r.id === item.originRfq);
  if (existing) return existing;
  return {
    ...(item as unknown as OwnedRfq),
    kind,
    budget: isModel(item)
      ? tokenTotal(
          { inputMillion: item.count || 10, outputMillion: 2 },
          item.price,
          item.outputPrice || 0,
        )
      : item.price,
    inputMillion: item.inputMillion ?? item.count ?? 10,
    outputMillion: item.outputMillion ?? 2,
    title: item.title,
    hours: isHardware(item) ? 0 : item.hours || 72,
    deliveryMethod: deliveryMethod(item),
    priceSnapshot: isModel(item) ? { input: item.price, output: item.outputPrice } : undefined,
    status: item.status || 'Open',
    quotes: [],
    audit: [],
  };
}

/** Prefill for a buyer request against a listed supply row. */
export function prefillFromRow(item: MarketRow): Record<string, unknown> {
  const kind = kindOf(item);
  const inputMillion = item.inputMillion ?? 10;
  const outputMillion = item.outputMillion ?? 2;
  return {
    ...item,
    kind,
    title: item.model + ' · ' + item.provider,
    originSupply: item.id,
    selectedSupplier: item.provider,
    sku: item.sku,
    budget: isModel(item)
      ? tokenTotal({ inputMillion, outputMillion }, item.price, item.outputPrice || 0)
      : item.price,
    inputMillion,
    outputMillion,
    days: item.days || 30,
    project: '',
    visibility: 'Private RFQ',
    hours: isHardware(item) ? 0 : item.hours || 72,
    deliveryMethod: deliveryMethod(item),
    notes: item.description,
  };
}

/** Buy / Offer entry points for market rows (legacy `opportunity()` / `resume()` / external inquiry). */
export function useOpportunity() {
  const api = useApi();
  const toast = useToast();
  const toastError = useApiErrorToast();
  const { go, openModal } = useTerminal();
  const { openContact } = useTerminalSlots();
  const find = useFindMarketRow();
  const invalidate = useInvalidateWorkspace();
  const rfqs = useOwnedRfqs();
  const review = useWorkspaceData().review;

  /** Opens the operations contact form for a sourced (external) row. */
  const inquire = useCallback(
    (item: MarketRow | null, role: Role = useWorkspaceStore.getState().role) => {
      if (!item?.external || item.responseMode !== 'operations') {
        toast('Refresh this requirement before contacting operations.');
        return;
      }
      const supply = item.side === 'supply';
      if (!canInquire(role, item)) {
        toast(
          supply
            ? 'Use a Buyer account to request this sourced capacity.'
            : 'Use a Seller account to offer capacity for this requirement.',
        );
        return;
      }
      useWorkspaceStore.getState().closeModal();
      openContact({ message: externalInquiryMessage(item) });
    },
    [toast, openContact],
  );

  /** Resumes the pending opportunity once records are authoritative (legacy `resume(c)`). */
  const resume = useCallback(() => {
    const workspace = useWorkspaceStore.getState();
    const pending = workspace.pendingOpportunity;
    const user = useSessionStore.getState().user;
    if (!pending || !user) return;
    const item = find(pending.id);
    workspace.patch({ pendingOpportunity: null });
    if (!item) {
      toast('This listing is no longer available.');
      return;
    }
    if (item.external) {
      inquire(item, workspace.role);
      return;
    }
    if (item.referenceOnly) {
      openModal('proc-listing', { id: item.id });
      return;
    }
    if (pending.intent === 'offer') {
      const requirement = requirementFromRow(item, rfqs) as unknown as RequirementDraft;
      workspace.patch({ activeRequirement: requirement });
      go('supply');
      if (review.status !== 'Approved') {
        workspace.patch({ afterReview: { type: 'respond', requirement } });
        openModal('review');
      } else openModal('respond', { requirement });
    } else {
      go('rfqs');
      openModal('rfq-form', { prefill: prefillFromRow(item) });
    }
  }, [find, toast, inquire, openModal, go, rfqs, review.status]);

  const open = useCallback(
    (id: string, intent: Intent) => {
      const workspace = useWorkspaceStore.getState();
      const item = find(id);
      if (!item) {
        toast('Listing unavailable. Refresh the market.');
        return;
      }
      if (item.external) {
        inquire(item, workspace.role);
        return;
      }
      if (item.referenceOnly) {
        openModal('proc-listing', { id });
        return;
      }
      const user = useSessionStore.getState().user;
      if (
        user &&
        ((intent === 'offer' && workspace.role !== 'seller') ||
          (intent === 'buy' && workspace.role !== 'buyer'))
      ) {
        toast(
          intent === 'offer'
            ? 'Use a verified Seller account to offer capacity.'
            : 'Use a Buyer account to request this capacity.',
        );
        return;
      }
      workspace.patch({ pendingOpportunity: { id, intent } });
      if (!user) {
        go(intent === 'offer' ? 'supply' : 'rfqs');
        return;
      }
      if (intent === 'buy') {
        procurementApi
          .quoteInterest(api, id)
          .then(() => invalidate())
          .then(() => resume())
          .catch(toastError);
      } else resume();
    },
    [api, toast, toastError, go, openModal, find, inquire, invalidate, resume],
  );
  return { open, inquire, resume };
}
