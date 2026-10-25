'use client';

import type {
  MarketRow,
  Order,
  OwnedRfq,
  SettlementRow,
  SupplierResponse,
} from '@opennext/contracts';
import type { Offer } from '@/features/market';
import {
  ModalFrame,
  useWorkspaceData,
  useWorkspaceStore,
  type ModalComponent,
  type ModalComponents,
  type ModalOf,
  type ModalType,
  type RequirementDraft,
  type RfqPrefill,
} from '@/terminal-kit';
import { useFindMarketRow } from '../market-view';
import { useOwnedRfqs } from '../records';
import { RfqForm } from './forms';
import {
  AcceptReview,
  ExternalDetails,
  HistoryUpgrade,
  ListingDialog,
  OrderAction,
  QuoteDetails,
  RecordView,
  RequestDetails,
  ResponseDialog,
  ResponseRecord,
  ReviewDialog,
  SubmissionModal,
  SupplyDialog,
  SupplyStatus,
  externalTitle,
  listingTitle,
  orderActionTitle,
  reviewTitle,
  submissionTitle,
  type SubmissionModalState,
} from './dialogs';

declare module '@/terminal-kit/modal' {
  interface TerminalModalMap {
    'proc-submission': SubmissionModalState;
    'proc-history-upgrade': Record<string, never>;
    'proc-request-details': { id?: string; requirement?: OwnedRfq };
    review: Record<string, never>;
    'supply-form': Record<string, never>;
    'supply-type': Record<string, never>;
    'proc-supply-status': { id: string };
    listing: { id: string };
    rfq: { id?: string; requirement?: OwnedRfq };
    'model-rfq': { id?: string; requirement?: OwnedRfq };
    'rfq-form': { offer?: Offer; model?: string; prefill?: RfqPrefill; id?: string };
    'proc-edit': { id: string };
    'proc-accept-review': { id: string; quoteId: string };
    'proc-quote-details': { id: string; quoteId: string };
    'proc-payment': { id: string };
    'proc-delivery': { id: string };
    'proc-verify': { id: string };
    'proc-manage': { id: string };
    'proc-listing': { id: string };
    'proc-settlement': { id: string };
    respond: { id?: string; requirement?: RequirementDraft | OwnedRfq };
    'proc-response': { id: string };
  }
}

type ProcurementModalType =
  | 'proc-submission'
  | 'proc-history-upgrade'
  | 'proc-request-details'
  | 'review'
  | 'supply-form'
  | 'supply-type'
  | 'proc-supply-status'
  | 'listing'
  | 'rfq'
  | 'model-rfq'
  | 'rfq-form'
  | 'proc-edit'
  | 'proc-accept-review'
  | 'proc-quote-details'
  | 'proc-payment'
  | 'proc-delivery'
  | 'proc-verify'
  | 'proc-manage'
  | 'proc-listing'
  | 'proc-settlement'
  | 'respond'
  | 'proc-response';

/** Converts a legacy price-record "offer" into RFQ form prefill. */
const offerPrefill = (o: Offer): RfqPrefill => ({
  model: o.model,
  region: o.region,
  count: o.count,
  term: o.term,
  budget: o.price,
  offerId: o.id,
});

const REVIEW_LOCKED = ['Reviewing', 'Approved', 'Rejected'];

/** One component renders every procurement modal (legacy `OpenNEXTProcurement.modal`). */
function ProcurementModal({
  modal,
  close,
}: {
  modal: ModalOf<ProcurementModalType>;
  close: () => void;
}) {
  const workspace = useWorkspaceData();
  const rfqs = useOwnedRfqs();
  const currentModel = useWorkspaceStore((s) => s.model);
  const find = useFindMarketRow();
  const id = 'id' in modal ? modal.id : undefined;
  const requirement =
    'requirement' in modal ? (modal.requirement as OwnedRfq | undefined) : undefined;
  const r = requirement || rfqs.find((x) => x.id === id);
  const q = 'quoteId' in modal ? r?.quotes?.find((x) => x.id === modal.quoteId) : undefined;
  const reviewStatus = workspace.review.status;
  switch (modal.type) {
    case 'proc-submission':
      return (
        <ModalFrame title={submissionTitle(modal)} close={close}>
          <SubmissionModal m={modal} />
        </ModalFrame>
      );
    case 'proc-history-upgrade':
      return (
        <ModalFrame title="More market history" close={close}>
          <HistoryUpgrade />
        </ModalFrame>
      );
    case 'proc-request-details':
      return (
        <ModalFrame
          title={r?.requestKind === 'quote_request' ? 'Ask for quote details' : 'RFQ details'}
          wide
          close={close}
        >
          <RequestDetails r={r} />
        </ModalFrame>
      );
    case 'review':
      return (
        <ModalFrame
          title={reviewTitle(reviewStatus)}
          wide={!REVIEW_LOCKED.includes(reviewStatus)}
          close={close}
        >
          <ReviewDialog />
        </ModalFrame>
      );
    case 'supply-form':
    case 'supply-type':
      return reviewStatus === 'Approved' ? (
        <ModalFrame title="List GPU capacity" wide close={close}>
          <SupplyDialog />
        </ModalFrame>
      ) : (
        <ModalFrame
          title={reviewTitle(reviewStatus)}
          wide={!REVIEW_LOCKED.includes(reviewStatus)}
          close={close}
        >
          <SupplyDialog />
        </ModalFrame>
      );
    case 'proc-supply-status':
    case 'listing': {
      const row = workspace.listings.find((x) => x.id === id);
      return (
        <ModalFrame title={row ? row.model + ' capacity' : 'Supply unavailable'} close={close}>
          <SupplyStatus id={id || ''} />
        </ModalFrame>
      );
    }
    case 'rfq':
    case 'model-rfq':
      return (
        <ModalFrame title={r?.title || 'Requirement'} wide close={close}>
          <RecordView r={r} />
        </ModalFrame>
      );
    case 'rfq-form':
    case 'proc-edit': {
      const editing = modal.type === 'proc-edit';
      const item: RfqPrefill =
        (modal.type === 'rfq-form' && modal.prefill) ||
        (modal.type === 'rfq-form' && modal.offer ? offerPrefill(modal.offer) : {});
      const title = editing
        ? 'Edit requirement'
        : item.requestKind === 'quote_request'
          ? 'Ask for quote'
          : item.originSupply
            ? 'Request this listed offer'
            : 'Post capacity RFQ';
      const record = editing
        ? r
        : {
            ...item,
            model: (modal.type === 'rfq-form' && modal.model) || item.model || currentModel,
            budget: item.budget ?? (item.price as number | undefined),
          };
      return (
        <ModalFrame title={title} wide close={close}>
          <RfqForm
            key={String(id || 'new')}
            r={(record || {}) as Partial<OwnedRfq> & Record<string, unknown>}
            editing={editing}
          />
        </ModalFrame>
      );
    }
    case 'proc-accept-review':
      return r ? (
        <ModalFrame title="Accept supplier quote" close={close}>
          <AcceptReview r={r} q={q} />
        </ModalFrame>
      ) : null;
    case 'proc-quote-details':
      return r ? (
        <ModalFrame title={q?.provider + ' quotation'} wide close={close}>
          <QuoteDetails r={r} q={q} />
        </ModalFrame>
      ) : null;
    case 'proc-payment':
    case 'proc-delivery':
    case 'proc-verify':
    case 'proc-manage': {
      const o = (workspace.orders as Order[]).find((x) => x.id === id);
      return (
        <ModalFrame title={orderActionTitle(modal.type, o)} close={close}>
          <OrderAction type={modal.type} o={o} />
        </ModalFrame>
      );
    }
    case 'proc-listing':
    case 'proc-settlement': {
      const item = (find(id) as (MarketRow & Partial<SettlementRow>) | null) || null;
      return (
        <ModalFrame title={listingTitle(item)} close={close}>
          <ListingDialog type={modal.type} item={item} />
        </ModalFrame>
      );
    }
    case 'respond': {
      const req =
        (r as OwnedRfq | undefined) || (find(id) as unknown as OwnedRfq | null) || undefined;
      const external = req && (req as unknown as MarketRow).external;
      return (
        <ModalFrame
          title={
            !req
              ? 'RFQ unavailable'
              : external
                ? externalTitle(req as unknown as MarketRow)
                : 'Respond to ' + req.id
          }
          wide={!external}
          close={close}
        >
          {external ? (
            <ExternalDetails item={req as unknown as MarketRow} />
          ) : (
            <ResponseDialog req={req} />
          )}
        </ModalFrame>
      );
    }
    case 'proc-response': {
      const response = (workspace.responses as SupplierResponse[]).find((x) => x.id === id);
      return (
        <ModalFrame
          title={response ? 'Supplier response · ' + response.id : 'Response unavailable'}
          close={close}
        >
          <ResponseRecord response={response} />
        </ModalFrame>
      );
    }
    default:
      return null;
  }
}

const TYPES: ProcurementModalType[] = [
  'proc-submission',
  'proc-history-upgrade',
  'proc-request-details',
  'review',
  'supply-form',
  'supply-type',
  'proc-supply-status',
  'listing',
  'rfq',
  'model-rfq',
  'rfq-form',
  'proc-edit',
  'proc-accept-review',
  'proc-quote-details',
  'proc-payment',
  'proc-delivery',
  'proc-verify',
  'proc-manage',
  'proc-listing',
  'proc-settlement',
  'respond',
  'proc-response',
];

/** Modals owned by procurement, keyed by type for the composition root. */
export const procurementModals: ModalComponents = Object.fromEntries(
  TYPES.map((type) => [type, ProcurementModal as ModalComponent<ModalType>]),
) as ModalComponents;
