'use client';

import { useCallback } from 'react';
import type { MarketRow, OwnedRfq } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { useToast } from '@/components/ui/toast';
import { useSessionStore } from '@/lib/session-store';
import { useTerminal } from '@/features/terminal/context';
import { openContact } from '@/features/terminal/components/TerminalModal';
import { useWorkspaceStore } from '@/features/terminal/store';
import { procurementApi } from '../api';
import {
  deliveryMethod,
  findRow,
  isHardware,
  isModel,
  kindOf,
  tokenTotal,
  useMarketplaceStore,
} from '../exchange';
import { refreshMarketplace } from '../workspace';
import { canInquire, externalCommitment, externalQuantity, rowPrice } from './shared';

export const findMarketRow = (id: string | null | undefined): MarketRow | null => {
  const S = useWorkspaceStore.getState();
  return findRow(useMarketplaceStore.getState(), id, [...S.cart, ...S.saved] as unknown as {
    id: string;
    side?: string;
    kind?: string;
    originSupply?: unknown;
  }[]);
};

/** Opens the operations contact form for a sourced (external) row. */
export function inquireExternal(item: MarketRow | null, role: string, toast: (m: string) => void) {
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
  openContact({
    message: [
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
    ].join('\n'),
  });
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

/** Resumes a pending opportunity once records are authoritative (legacy `resume(c)`). */
export function resumeOpportunity(go: (route: string) => void, toast: (m: string) => void) {
  const S = useWorkspaceStore.getState();
  const pending = S.pendingOpportunity;
  const user = useSessionStore.getState().user;
  if (!pending || !user) return;
  const item = findMarketRow(pending.id);
  S.patch({ pendingOpportunity: null });
  if (!item) {
    toast('This listing is no longer available.');
    return;
  }
  if (item.external) {
    inquireExternal(item, S.role, toast);
    return;
  }
  if (item.referenceOnly) {
    S.openModal('proc-listing', { id: item.id });
    return;
  }
  if (pending.intent === 'offer') {
    const requirement = requirementFromRow(item, S.rfqs as OwnedRfq[]);
    S.patch({ activeRequirement: requirement });
    go('supply');
    if (S.review.status !== 'Approved') {
      S.patch({ afterReview: { type: 'respond', requirement } });
      S.openModal('review');
    } else S.openModal('respond', { requirement });
  } else {
    go('rfqs');
    S.openModal('rfq-form', { prefill: prefillFromRow(item) });
  }
}

/** Buy / Offer entry point for a market row (legacy `opportunity(c, id, intent)`). */
export function useOpportunity() {
  const api = useApi();
  const toast = useToast();
  const { go } = useTerminal();
  const open = useCallback(
    (id: string, intent: 'buy' | 'offer') => {
      const S = useWorkspaceStore.getState();
      const item = findMarketRow(id);
      if (!item) {
        toast('Listing unavailable. Refresh the market.');
        return;
      }
      if (item.external) {
        inquireExternal(item, S.role, toast);
        return;
      }
      if (item.referenceOnly) {
        S.openModal('proc-listing', { id });
        return;
      }
      const user = useSessionStore.getState().user;
      if (
        user &&
        ((intent === 'offer' && S.role !== 'Seller') || (intent === 'buy' && S.role !== 'Buyer'))
      ) {
        toast(
          intent === 'offer'
            ? 'Use a verified Seller account to offer capacity.'
            : 'Use a Buyer account to request this capacity.',
        );
        return;
      }
      S.patch({ pendingOpportunity: { id, intent } });
      if (!user) {
        go(intent === 'offer' ? 'supply' : 'rfqs');
        return;
      }
      if (intent === 'buy') {
        procurementApi
          .quoteInterest(api, id)
          .then(() => refreshMarketplace())
          .then(() => resumeOpportunity(go, toast))
          .catch((error: Error) => toast(error.message));
      } else resumeOpportunity(go, toast);
    },
    [api, toast, go],
  );
  const inquire = useCallback(
    (row: MarketRow | null) => inquireExternal(row, useWorkspaceStore.getState().role, toast),
    [toast],
  );
  return { open, inquire };
}
