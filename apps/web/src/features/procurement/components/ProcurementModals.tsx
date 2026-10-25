'use client';

import type { MarketRow, Order, OwnedRfq, SettlementRow, SupplierResponse } from '@opennext/contracts';
import type { ModalRender, ModalRenderer } from '@/features/terminal/components/TerminalModal';
import { useWorkspaceStore, type ModalState, type Record_ } from '@/features/terminal/store';
import { settlementRows } from './MatchesPanel';
import { RfqForm } from './forms';
import { findMarketRow } from './opportunity';
import {
  AcceptReview, ExternalDetails, HistoryUpgrade, ListingDialog, OrderAction, QuoteDetails, RecordView, RequestDetails, ResponseDialog, ResponseRecord, ReviewDialog,
  SubmissionModal, SupplyDialog, SupplyStatus, externalTitle, listingTitle, orderActionTitle, reviewTitle, submissionTitle, type SubmissionModalState,
} from './dialogs';

/** Converts a legacy price-record "offer" into RFQ form prefill. */
const offerPrefill = (o: Record_): Record_ => ({ model: o.model, region: o.region, count: o.count, term: o.term, budget: o.price, offerId: o.id });

/** Modal renderer registered with the terminal (legacy `OpenNEXTProcurement.modal`). */
export const procurementModalRenderer: ModalRenderer = (modal: ModalState): ModalRender | null => {
  const S = useWorkspaceStore.getState();
  const id = modal.id as string | undefined;
  const r = ((modal.requirement as OwnedRfq | undefined) || (S.rfqs as OwnedRfq[]).find((x) => x.id === id)) as OwnedRfq | undefined;
  const q = r?.quotes?.find((x) => x.id === modal.quoteId);
  switch (modal.type) {
    case 'proc-submission': {
      const m = modal as unknown as SubmissionModalState & ModalState;
      return { title: submissionTitle(m), body: <SubmissionModal m={m} /> };
    }
    case 'proc-history-upgrade':
      return { title: 'More market history', body: <HistoryUpgrade /> };
    case 'proc-request-details':
      return { title: r?.requestKind === 'quote_request' ? 'Ask for quote details' : 'RFQ details', wide: true, body: <RequestDetails r={r} /> };
    case 'review':
      return { title: reviewTitle(S.review.status), wide: !['Reviewing', 'Approved', 'Rejected'].includes(S.review.status), body: <ReviewDialog /> };
    case 'supply-form':
    case 'supply-type':
      return S.review.status === 'Approved' ? { title: 'List GPU capacity', wide: true, body: <SupplyDialog /> } : { title: reviewTitle(S.review.status), wide: !['Reviewing', 'Approved', 'Rejected'].includes(S.review.status), body: <SupplyDialog /> };
    case 'proc-supply-status':
    case 'listing': {
      const row = S.listings.find((x) => x.id === id) as { model?: string } | undefined;
      return { title: row ? row.model + ' capacity' : 'Supply unavailable', body: <SupplyStatus id={id || ''} /> };
    }
    case 'rfq':
    case 'model-rfq':
      return { title: r?.title || 'Requirement', wide: true, body: <RecordView r={r} /> };
    case 'rfq-form':
    case 'proc-edit': {
      const editing = modal.type === 'proc-edit';
      const item = (modal.prefill as Record_ | undefined) || (modal.offer ? offerPrefill(modal.offer as Record_) : {});
      const title = editing ? 'Edit requirement' : item.requestKind === 'quote_request' ? 'Ask for quote' : item.originSupply ? 'Request this listed offer' : 'Post capacity RFQ';
      const record = editing ? r : { ...item, model: (modal.model as string | undefined) || item.model || S.model, budget: item.budget ?? item.price };
      return { title, wide: true, body: <RfqForm key={String(id || 'new')} r={(record || {}) as Partial<OwnedRfq> & Record_} editing={editing} /> };
    }
    case 'proc-accept-review':
      return r ? { title: 'Accept supplier quote', body: <AcceptReview r={r} q={q} /> } : null;
    case 'proc-quote-details':
      return r ? { title: q?.provider + ' quotation', wide: true, body: <QuoteDetails r={r} q={q} /> } : null;
    case 'proc-payment':
    case 'proc-delivery':
    case 'proc-verify':
    case 'proc-manage': {
      const o = (S.orders as Order[]).find((x) => x.id === id);
      return { title: orderActionTitle(modal.type, o), body: <OrderAction type={modal.type} o={o} /> };
    }
    case 'proc-listing':
    case 'proc-settlement': {
      const item = (modal.type === 'proc-settlement' ? (settlementRows.get(id || '') as unknown as MarketRow & Partial<SettlementRow>) : findMarketRow(id)) || null;
      return { title: listingTitle(item), body: <ListingDialog type={modal.type} item={item} /> };
    }
    case 'respond': {
      const req = r || findMarketRow(id) || undefined;
      const external = req && (req as MarketRow).external;
      return { title: !req ? 'RFQ unavailable' : external ? externalTitle(req as MarketRow) : 'Respond to ' + req.id, wide: !external, body: external ? <ExternalDetails item={req as MarketRow} /> : <ResponseDialog req={req} /> };
    }
    case 'proc-response': {
      const response = (S.responses as SupplierResponse[]).find((x) => x.id === id);
      return { title: response ? 'Supplier response · ' + response.id : 'Response unavailable', body: <ResponseRecord response={response} /> };
    }
    default:
      return null;
  }
};
