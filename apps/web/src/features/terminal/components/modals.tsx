'use client';

import type { ReactNode } from 'react';
import { money, stampUtc } from '@/lib/format';
import { regionText, useRegions, type Offer } from '@/features/market';
import {
  Button,
  ModalFrame,
  findOffer,
  useTerminal,
  useTerminalSlots,
  useToast,
  useWorkspaceStore,
  EmptyState,
  StatusTag,
  type ModalComponents,
  type ModalComponent,
  type ModalType,
} from '@/terminal-kit';
import { getModelQuote, listModelQuotes } from '@/data';
import { Comparison } from './Comparison';
import { useCurrentOffers } from './MarketPage';
import { ModelRateSummary } from './ModelsPage';

declare module '@/terminal-kit/modal' {
  interface TerminalModalMap {
    'history-access': Record<string, never>;
    sources: Record<string, never>;
    info: { info?: 'contact' | 'privacy' };
    detail: { offer?: Offer; id?: string };
    compare: Record<string, never>;
    'model-rfq-form': { sku?: string };
  }
}

/** Renders the active modal through the component map assembled by the composition root. */
export function TerminalModal() {
  const modal = useWorkspaceStore((s) => s.modal);
  const { closeModal } = useTerminal();
  const { modals } = useTerminalSlots();
  if (!modal) return null;
  const Component = modals[modal.type] as ModalComponent<ModalType> | undefined;
  if (!Component) return null;
  return <Component key={modal.type} modal={modal} close={closeModal} />;
}

const DetailsGrid = ({ items }: { items: [string, ReactNode][] }) => (
  <div className="details-grid">
    {items.map(([k, v]) => (
      <div key={k}>
        <small>{k}</small>
        <strong>{v}</strong>
      </div>
    ))}
  </div>
);

const HistoryAccessModal: ModalComponent<'history-access'> = ({ close }) => {
  const model = useWorkspaceStore((s) => s.model);
  const { openContact } = useTerminalSlots();
  return (
    <ModalFrame title="More market history" close={close}>
      <p className="form-note">
        Historical data up to 3 months is free. Contact Sales to access 6 months, 1 year or all
        available history.
      </p>
      <div className="modal-footer">
        <Button data-act="close-modal" onClick={close}>
          Back to chart
        </Button>
        <Button
          cls=""
          data-act="history-contact"
          onClick={() => {
            close();
            openContact({
              message: 'I would like access to more than 3 months of ' + model + ' GPU price history.',
            });
          }}
        >
          Contact Sales
        </Button>
      </div>
    </ModalFrame>
  );
};

const SourcesModal: ModalComponent<'sources'> = ({ close }) => (
  <ModalFrame title="GPU pricing methodology" close={close}>
    <h3 style={{ fontSize: 14 }}>Three comparable price types</h3>
    <div className="callout">
      The chart compares Spot, On-demand and Reserved prices of one reference offering: the same
      GPU configuration from the same supplier in the same region. Prices from different suppliers
      are never mixed into one comparison.
    </div>
    <p className="form-note">
      Among the offerings that match the selected GPU model, GPU count and region scope, the
      reference is one whose Spot price is observed live, then the one with the most current price
      types, then the lowest On-demand rate. Published fixed rates are used when no live Spot
      offering matches. Instance prices are divided by the verified physical GPU count. Memory and
      form-factor variants are filtered when selected. Fractional GPU rates are excluded from
      full-GPU comparisons.
    </p>
    <p className="form-note">
      Reserved means a 12-month, no-upfront commitment. It is a billing commitment and does not by
      itself guarantee capacity. Spot may be interrupted; all launch types remain subject to quotas
      and inventory.
    </p>
    <p className="form-note">
      The page checks for updates every 30 seconds. New observations are collected every five
      minutes; published tariffs are refreshed hourly. Quotes are recorded only while fresh. Longer
      periods use coarser time buckets showing the lowest price observed in each bucket.
    </p>
    <p className="form-note">
      History uses saved observations and vendor-published effective prices. Spot, On-demand and
      Reserved history covers up to 90 days where available. Published tariffs apply only within
      confirmed effective intervals. No current price is inserted into the past. Unreported prices
      remain empty, and long gaps are not joined. Source attribution and credentials stay on the
      server.
    </p>
  </ModalFrame>
);

const InfoModal: ModalComponent<'info'> = ({ modal, close }) => {
  const { go } = useTerminal();
  if (modal.info === 'contact')
    return (
      <ModalFrame title="Contact OpenNEXT" close={close}>
        <div className="callout">
          For procurement, supplier onboarding and delivery support, contact your OpenNEXT account
          team. Include the RFQ ID, supply reference or instance ID so the team can locate the
          record.
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="btn"
            data-nav="help"
            onClick={() => {
              close();
              go('help');
            }}
          >
            Open Help & documentation
          </button>
        </div>
      </ModalFrame>
    );
  return (
    <ModalFrame title="Privacy" close={close}>
      <p className="form-note">
        Your profile, quote requests and procurement records belong to your workspace. Supplier
        access should be limited to the requirements and delivery information needed for a
        transaction.
      </p>
      <div className="callout">
        Never upload a private SSH key. Public keys can be shared for instance access. Review your
        account permissions and credential scopes from the workspace settings.
      </div>
    </ModalFrame>
  );
};

const DetailModal: ModalComponent<'detail'> = ({ modal, close }) => {
  const state = useWorkspaceStore();
  const regions = useRegions();
  const current = useCurrentOffers();
  const toast = useToast();
  const { openModal } = useTerminal();
  const o = modal.offer || findOffer(state, modal.id, current);
  if (!o) return null;
  const fields: [string, ReactNode][] = [
    ['Region', regionText(regions, o.regionCode || o.region)],
    ['GPU count', o.count],
    ['Price per instance-hour', o.instanceHourly ? money(o.instanceHourly) : 'Confirm in quote'],
    [
      'Availability',
      o.availability === true
        ? 'Reported available'
        : o.availability === false
          ? 'Not currently available'
          : 'Not reported',
    ],
    ['Observed at', o.observedAt ? stampUtc(o.observedAt) : 'Legacy saved reference'],
    ['Operating system', o.operatingSystem || 'Confirm with provider'],
    ['Price type', o.priceKind || 'Saved quote reference'],
  ];
  return (
    <ModalFrame title={o.model + ' · ' + o.provider} close={close}>
      <div className="row spread">
        <div>
          <span className="form-note">
            {o.region} · {o.term}
          </span>
          <div className="detail-price">
            {money(o.price)}{' '}
            <span style={{ fontSize: 12, fontWeight: 400, color: '#8b958e' }}>/ GPU-hour</span>
          </div>
        </div>
        <StatusTag status={o.stale ? 'Stale reference' : 'API reference'} />
      </div>
      <DetailsGrid items={fields} />
      <div className="callout">
        This is a collected provider catalog rate, not a firm OpenNEXT offer. Inventory quantity,
        delivery speed, support and quote validity are not inferred from a price API. Confirm the
        whole-instance allocation and commercial terms before purchase.
      </div>
      <h3 style={{ fontSize: 13, marginTop: 24 }}>Transaction reputation</h3>
      <p className="form-note">
        No verified transaction reviews are attached to this imported pricing record. API
        availability is not an OpenNEXT supplier rating.
      </p>
      <div className="modal-footer">
        <Button
          data-act="save"
          data-id={o.id}
          onClick={() => toast(state.toggleSaved(o) ? 'Capacity saved' : 'Removed from saved')}
        >
          ☆ Save
        </Button>
        <Button
          data-act="cart"
          data-id={o.id}
          onClick={() =>
            toast(state.addToCart(o) ? 'Added to quote cart' : 'Already in your quote cart')
          }
        >
          + Quote cart
        </Button>
        <Button cls="" data-act="quote" data-id={o.id} onClick={() => openModal('rfq-form', { offer: o })}>
          Request quote
        </Button>
      </div>
    </ModalFrame>
  );
};

const CompareModal: ModalComponent<'compare'> = ({ close }) => {
  const state = useWorkspaceStore();
  const current = useCurrentOffers();
  const toast = useToast();
  const { openModal, go } = useTerminal();
  return (
    <ModalFrame title="Compare selected capacity" wide close={close}>
      <Comparison
        offers={state.selected
          .map((id) => findOffer(state, id, current))
          .filter((x): x is Offer => Boolean(x))}
        model={state.model}
        full
        onSave={(x) => toast(state.toggleSaved(x) ? 'Capacity saved' : 'Removed from saved')}
        onCart={(x) => toast(state.addToCart(x) ? 'Added to quote cart' : 'Already in your quote cart')}
        onDetail={(x) => openModal('detail', { offer: x })}
      />
      <div className="modal-footer">
        <Button
          cls=""
          data-act="collection-quotes"
          onClick={() => {
            close();
            go('cart');
          }}
        >
          Request quotes
        </Button>
      </div>
    </ModalFrame>
  );
};

const ModelRfqFormModal: ModalComponent<'model-rfq-form'> = ({ modal, close }) => {
  const q = getModelQuote(modal.sku) || listModelQuotes()[0];
  return (
    <ModalFrame title="Request model capacity" wide eyebrow="MODEL CAPACITY REQUEST" close={close}>
      {q ? (
        <>
          <ModelRateSummary q={q} />
          <p>Model request submission is currently unavailable. Please refresh.</p>
        </>
      ) : (
        <EmptyState title="Model quotes are not available">
          Close this window and try again when supplier quotes have loaded.
        </EmptyState>
      )}
    </ModalFrame>
  );
};

/** Modals owned by the terminal core (market methodology, details, comparison, info). */
export const terminalModals: ModalComponents = {
  'model-rfq-form': ModelRfqFormModal,
  'history-access': HistoryAccessModal,
  sources: SourcesModal,
  info: InfoModal,
  detail: DetailModal,
  compare: CompareModal,
};
