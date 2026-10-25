'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { money, stampUtc } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { basePrice, CATALOG, regionText, type Offer } from '@/features/market/catalog';
import { usePrices, useRegions } from '@/features/market/hooks';
import { getModelQuote, listModelQuotes } from '@/features/market/model-quotes';
import { useTerminal } from '../context';
import { findOffer, useWorkspaceStore, type ModalState, type Record_ } from '../store';
import { Comparison } from './Comparison';
import { useCurrentOffers } from './MarketPage';
import { ModelRateSummary, tokenMoney, tokenVolume } from './ModelsPage';
import { EmptyState, StatusTag, TButton } from './ui';

export interface ModalRender {
  title: ReactNode;
  body: ReactNode;
  wide?: boolean;
  eyebrow?: string;
}
export type ModalRenderer = (modal: ModalState) => ModalRender | null;

/**
 * Modal registry: other features register renderers for their modal types
 * (legacy `OpenNEXTProcurement.modal`, `OpenNEXTBilling.modal`, …). The first renderer that
 * returns content wins; the built-in terminal modals are the fallback.
 */
const renderers = new Set<ModalRenderer>();
export function registerTerminalModal(renderer: ModalRenderer): () => void {
  renderers.add(renderer);
  return () => renderers.delete(renderer);
}

/** Generic dialog frame (`.overlay > .modal`) with focus trap and Escape. */
export function ModalShell({
  title,
  eyebrow = 'OPENNEXT WORKSPACE',
  wide = false,
  onClose,
  children,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const previous = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      if (node.isConnected && !node.contains(document.activeElement))
        node.focus({ preventScroll: true });
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [
        ...node.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])',
        ),
      ].filter((item) => item.getClientRects().length);
      if (!items.length) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === node)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    node.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      node.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <div
      className="overlay"
      data-dismiss="modal"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialog}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow muted">{eyebrow}</span>
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            data-act="close-modal"
            aria-label="Close dialog"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
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

/** Built-in modals owned by the terminal core. */
function useBuiltInModal(modal: ModalState): ModalRender | null {
  const state = useWorkspaceStore();
  const regions = useRegions();
  const prices = usePrices();
  const current = useCurrentOffers();
  const toast = useToast();
  const { closeModal, go, openModal } = useTerminal();
  const [defaultStart] = useState(() => new Date(Date.now() + 3600000).toISOString().slice(0, 16));
  const o =
    (modal.offer as Offer | undefined) || findOffer(state, modal.id as string | undefined, current);
  const r = (modal.requirement as Record_ | undefined) || state.rfqs.find((x) => x.id === modal.id);
  const close = (
    <TButton data-act="close-modal" onClick={closeModal}>
      Cancel
    </TButton>
  );
  switch (modal.type) {
    case 'history-access':
      return {
        title: 'More market history',
        body: (
          <>
            <p className="form-note">
              Historical data up to 3 months is free. Contact Sales to access 6 months, 1 year or
              all available history.
            </p>
            <div className="modal-footer">
              <TButton data-act="close-modal" onClick={closeModal}>
                Back to chart
              </TButton>
              <TButton
                cls=""
                data-act="history-contact"
                onClick={() => {
                  closeModal();
                  contactSlot?.({
                    message:
                      'I would like access to more than 3 months of ' +
                      state.model +
                      ' GPU price history.',
                  });
                }}
              >
                Contact Sales
              </TButton>
            </div>
          </>
        ),
      };
    case 'sources':
      return {
        title: 'GPU pricing methodology',
        body: (
          <>
            <h3 style={{ fontSize: 14 }}>Three comparable price types</h3>
            <div className="callout">
              The chart compares Spot, On-demand and Reserved prices of one reference offering: the
              same GPU configuration from the same supplier in the same region. Prices from
              different suppliers are never mixed into one comparison.
            </div>
            <p className="form-note">
              Among the offerings that match the selected GPU model, GPU count and region scope, the
              reference is one whose Spot price is observed live, then the one with the most current
              price types, then the lowest On-demand rate. Published fixed rates are used when no
              live Spot offering matches. Instance prices are divided by the verified physical GPU
              count. Memory and form-factor variants are filtered when selected. Fractional GPU
              rates are excluded from full-GPU comparisons.
            </p>
            <p className="form-note">
              Reserved means a 12-month, no-upfront commitment. It is a billing commitment and does
              not by itself guarantee capacity. Spot may be interrupted; all launch types remain
              subject to quotas and inventory.
            </p>
            <p className="form-note">
              The page checks for updates every 30 seconds. New observations are collected every
              five minutes; published tariffs are refreshed hourly. Quotes are recorded only while
              fresh. Longer periods use coarser time buckets showing the lowest price observed in
              each bucket.
            </p>
            <p className="form-note">
              History uses saved observations and vendor-published effective prices. Spot, On-demand
              and Reserved history covers up to 90 days where available. Published tariffs apply
              only within confirmed effective intervals. No current price is inserted into the past.
              Unreported prices remain empty, and long gaps are not joined. Source attribution and
              credentials stay on the server.
            </p>
          </>
        ),
      };
    case 'info':
      return {
        title: modal.info === 'contact' ? 'Contact OpenNEXT' : 'Privacy',
        body:
          modal.info === 'contact' ? (
            <>
              <div className="callout">
                For procurement, supplier onboarding and delivery support, contact your OpenNEXT
                account team. Include the RFQ ID, supply reference or instance ID so the team can
                locate the record.
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn"
                  data-nav="help"
                  onClick={() => {
                    closeModal();
                    go('help');
                  }}
                >
                  Open Help & documentation
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="form-note">
                Your profile, quote requests and procurement records belong to your workspace.
                Supplier access should be limited to the requirements and delivery information
                needed for a transaction.
              </p>
              <div className="callout">
                Never upload a private SSH key. Public keys can be shared for instance access.
                Review your account permissions and credential scopes from the workspace settings.
              </div>
            </>
          ),
      };
    case 'detail': {
      if (!o) return null;
      const fields: [string, ReactNode][] = [
        ['Region', regionText(regions, o.regionCode || o.region)],
        ['GPU count', o.count],
        [
          'Price per instance-hour',
          o.instanceHourly ? money(o.instanceHourly) : 'Confirm in quote',
        ],
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
      return {
        title: o.model + ' · ' + o.provider,
        body: (
          <>
            <div className="row spread">
              <div>
                <span className="form-note">
                  {o.region} · {o.term}
                </span>
                <div className="detail-price">
                  {money(o.price)}{' '}
                  <span style={{ fontSize: 12, fontWeight: 400, color: '#8b958e' }}>
                    / GPU-hour
                  </span>
                </div>
              </div>
              <StatusTag status={o.stale ? 'Stale reference' : 'API reference'} />
            </div>
            <DetailsGrid items={fields} />
            <div className="callout">
              This is a collected provider catalog rate, not a firm OpenNEXT offer. Inventory
              quantity, delivery speed, support and quote validity are not inferred from a price
              API. Confirm the whole-instance allocation and commercial terms before purchase.
            </div>
            <h3 style={{ fontSize: 13, marginTop: 24 }}>Transaction reputation</h3>
            <p className="form-note">
              No verified transaction reviews are attached to this imported pricing record. API
              availability is not an OpenNEXT supplier rating.
            </p>
            <div className="modal-footer">
              <TButton
                data-act="save"
                data-id={o.id}
                onClick={() =>
                  toast(state.toggleSaved(o) ? 'Capacity saved' : 'Removed from saved')
                }
              >
                ☆ Save
              </TButton>
              <TButton
                data-act="cart"
                data-id={o.id}
                onClick={() =>
                  toast(state.addToCart(o) ? 'Added to quote cart' : 'Already in your quote cart')
                }
              >
                + Quote cart
              </TButton>
              <TButton
                cls=""
                data-act="quote"
                data-id={o.id}
                onClick={() => openModal('rfq-form', { offer: o })}
              >
                Request quote
              </TButton>
            </div>
          </>
        ),
      };
    }
    case 'compare':
      return {
        title: 'Compare selected capacity',
        wide: true,
        body: (
          <>
            <Comparison
              offers={state.selected
                .map((id) => findOffer(state, id, current))
                .filter((x): x is Offer => Boolean(x))}
              model={state.model}
              full
              onSave={(x) => toast(state.toggleSaved(x) ? 'Capacity saved' : 'Removed from saved')}
              onCart={(x) =>
                toast(state.addToCart(x) ? 'Added to quote cart' : 'Already in your quote cart')
              }
              onDetail={(x) => openModal('detail', { offer: x })}
            />
            <div className="modal-footer">
              <TButton
                cls=""
                data-act="collection-quotes"
                onClick={() => {
                  closeModal();
                  go('cart');
                }}
              >
                Request quotes
              </TButton>
            </div>
          </>
        ),
      };
    case 'model-rfq-form': {
      const q = getModelQuote(modal.sku as string | undefined) || listModelQuotes()[0];
      return {
        title: 'Request model capacity',
        wide: true,
        eyebrow: 'MODEL CAPACITY REQUEST',
        body: q ? (
          <>
            <ModelRateSummary q={q} />
            <p>Model request submission is currently unavailable. Please refresh.</p>
          </>
        ) : (
          <EmptyState title="Model quotes are not available">
            Close this window and try again when supplier quotes have loaded.
          </EmptyState>
        ),
      };
    }
    case 'model-rfq': {
      if (!r || r.kind !== 'model_capacity')
        return {
          title: 'Model capacity request',
          wide: true,
          eyebrow: 'MODEL CAPACITY REQUEST',
          body: (
            <EmptyState title="Model request not found">
              Return to My RFQs to choose another request.
            </EmptyState>
          ),
        };
      const q = (r.priceSnapshot as Record_ | undefined) || {};
      const subtotal =
        Number(r.inputMillion) * Number(q.input) + Number(r.outputMillion) * Number(q.output);
      const details: [string, ReactNode][] = [
        ['Exact model SKU', String(r.sku ?? '')],
        ['Model', String(r.model ?? '')],
        ['Input usage', tokenVolume(r.inputMillion) + ' million tokens'],
        ['Output usage', tokenVolume(r.outputMillion) + ' million tokens'],
        ['Service duration', r.days + ' days'],
        ['Requested throughput', r.tps ? tokenVolume(r.tps) + ' TPS' : 'To confirm'],
        ['Total budget', tokenMoney(r.budget) + ' USD'],
        ['Service / data region', String(r.region ?? '')],
        ['Rate snapshot date', String(q.recordedAt || 'Not supplied')],
        ['Quote validity', 'Not confirmed'],
      ];
      return {
        title: String(r.title || 'Model capacity request'),
        wide: true,
        eyebrow: 'MODEL CAPACITY REQUEST',
        body: (
          <>
            <div className="row spread">
              <span className="form-note">{String(r.id)} · Model capacity request</span>
              <StatusTag status={String(r.status)} />
            </div>
            <div className="callout">
              Your request is recorded. Supplier confirmation is pending; the saved token rates are
              indicative and do not establish capacity, delivery, access rights or a valid
              executable quote.
            </div>
            <DetailsGrid items={details} />
            <h3 style={{ fontSize: 13, marginTop: 22 }}>
              Saved supplier rate indication · USD / 1M tokens
            </h3>
            <ModelRateSummary q={getModelQuote(String(r.sku)) ?? null} />
            <p className="form-note">
              Indicative token subtotal: {tokenMoney(subtotal)}. Cache adjustments, fees, taxes and
              minimum commitments remain subject to confirmation.
            </p>
            {r.notes ? (
              <>
                <h3 style={{ fontSize: 13, marginTop: 22 }}>Requirements</h3>
                <p className="form-note model-rfq-notes" style={{ whiteSpace: 'pre-line' }}>
                  {String(r.notes)}
                </p>
              </>
            ) : null}
            <p className="form-note">
              {String(
                q.terms ||
                  'Final pricing, access and delivery terms require supplier confirmation.',
              )}
            </p>
            <div className="modal-footer">
              <TButton
                data-act="model-market"
                onClick={() => {
                  closeModal();
                  go('models');
                }}
              >
                Browse model capacity
              </TButton>
              <TButton cls="" data-act="close-modal" onClick={closeModal}>
                Done
              </TButton>
            </div>
          </>
        ),
      };
    }
    case 'rfq-form': {
      const prefill = (modal.prefill as Record_ | undefined) || {};
      const model = String(modal.model || prefill.model || o?.model || state.model);
      const selectedRegion = String(prefill.region || o?.region || state.region);
      const budget =
        (prefill.budget as number | undefined) ??
        o?.price ??
        basePrice(
          prices.data?.records || [],
          CATALOG.find((x) => x.name === state.model),
          state.term,
          regions,
        );
      const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<
          string,
          string
        >;
        const rfq = {
          ...data,
          id: 'RFQ-' + Date.now().toString().slice(-6),
          count: Number(data.count),
          hours: Number(data.hours),
          budget: Number(data.budget),
          status: 'Open',
          created: new Date().toISOString(),
        };
        state.patch({ rfqs: [rfq, ...state.rfqs], modal: null });
        go('rfqs');
        openModal('rfq', { id: rfq.id });
        toast('Quote request sent');
      };
      return {
        title: modal.model ? 'Request ' + modal.model + ' quote' : 'Request capacity quote',
        body: (
          <form data-form="rfq" onSubmit={submit}>
            <input type="hidden" name="offerId" value={o?.id || ''} />
            <input
              type="hidden"
              name="originListingId"
              value={String(prefill.originListingId || '')}
            />
            {prefill.priceKind === 'buyer_target' ? (
              <div className="callout listing-buy-note">
                Create your own purchase request for similar capacity. The listing shows another
                buyer’s target budget, not an available supplier offer. Adjust your quantity,
                location and budget below.
              </div>
            ) : null}
            <div className="form-grid">
              <div className="full">
                <label className="form-label">Requirement name</label>
                <input
                  className="field"
                  name="title"
                  placeholder="e.g. Training cluster for next week"
                  defaultValue={String(prefill.title || model + ' capacity request')}
                  required
                />
              </div>
              <div>
                <label className="form-label">GPU / Model</label>
                <input className="field" name="model" defaultValue={model} required />
              </div>
              <div>
                <label className="form-label">Region</label>
                <select className="field" name="region" defaultValue={selectedRegion}>
                  {[...new Set([selectedRegion, ...regions.map((x) => x.name)])].map((region) => (
                    <option key={region}>{region}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">GPU count / Capacity units</label>
                <input
                  className="field"
                  name="count"
                  type="number"
                  min={1}
                  max={4096}
                  defaultValue={Number(prefill.count || o?.count || state.count)}
                  required
                />
              </div>
              <div>
                <label className="form-label">Market terms</label>
                <select
                  className="field"
                  name="term"
                  defaultValue={String(prefill.term || o?.term || state.term)}
                >
                  {['Spot', 'On-demand', 'Reserved'].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Start time (UTC)</label>
                <input
                  className="field"
                  name="start"
                  type="datetime-local"
                  defaultValue={defaultStart}
                  required
                />
              </div>
              <div>
                <label className="form-label">Rental duration (hours)</label>
                <input
                  className="field"
                  name="hours"
                  type="number"
                  min={1}
                  max={26280}
                  defaultValue={Number(prefill.hours || 72)}
                  required
                />
              </div>
              <div>
                <label className="form-label">Maximum $ / GPU-hour</label>
                <input
                  className="field"
                  name="budget"
                  type="number"
                  min={0.01}
                  step={0.01}
                  defaultValue={typeof budget === 'number' ? budget.toFixed(2) : ''}
                  required
                />
              </div>
              <div>
                <label className="form-label">Project</label>
                <input
                  className="field"
                  name="project"
                  placeholder="Training / inference / research"
                />
              </div>
              <div className="full">
                <label className="form-label">Delivery requirements</label>
                <textarea
                  name="notes"
                  className="field"
                  placeholder="Interconnect, storage, access, SLA or support requirements…"
                  defaultValue={String(prefill.notes || '')}
                />
              </div>
            </div>
            <p className="form-note">
              The supplier quote confirms capacity, the rental window and interruption terms. No
              payment is taken at this step.
            </p>
            <div className="modal-footer">
              {close}
              <button type="submit" className="btn">
                Request quote
              </button>
            </div>
          </form>
        ),
      };
    }
    case 'rfq': {
      if (!r) return null;
      const steps = ['Open', 'Quoted', 'Confirmed', 'Provisioning', 'Active', 'Completed'];
      return {
        title: String(r.title),
        wide: true,
        body: (
          <>
            <div className="row spread">
              <span className="form-note">
                {String(r.id)} · {String(r.count)} × {String(r.model)} · {String(r.region)}
              </span>
              <StatusTag status={String(r.status)} />
            </div>
            <div className="stepper">
              {steps.map((t, n) => (
                <span
                  key={t}
                  className={`step ${steps.indexOf(String(r.status)) >= n ? 'done' : ''}`}
                >
                  {n + 1} {t}
                </span>
              ))}
            </div>
            <div className="callout">
              {String(r.hours)} hours · {String(r.term)} · budget {money(r.budget)}/GPU-hour.{' '}
              {r.status === 'Open'
                ? 'Your request is ready for supplier responses.'
                : 'Review each quote’s delivery window and terms before accepting.'}
            </div>
            <p className="form-note">
              Supplier responses are managed through the verified procurement workspace.
            </p>
          </>
        ),
      };
    }
    case 'review':
      return {
        title: 'Supplier review',
        wide: true,
        body: (
          <p className="form-note">
            The verified supplier review form is unavailable. Refresh the page before submitting
            business information.
          </p>
        ),
      };
    case 'supply-form':
      return {
        title: 'List capacity',
        body: (
          <p className="form-note">
            The verified supply workflow is unavailable. No capacity has been submitted.
          </p>
        ),
      };
    default:
      return null;
  }
}

/** Contact modal hook point (the site feature owns the Contact Us form). */
let contactSlot: ((options?: { message?: string }) => void) | null = null;
export function registerContactOpener(fn: ((options?: { message?: string }) => void) | null) {
  contactSlot = fn;
}
export const openContact = (options?: { message?: string }) => contactSlot?.(options);

export function TerminalModal() {
  const modal = useWorkspaceStore((s) => s.modal);
  const { closeModal } = useTerminal();
  if (!modal) return null;
  let content: ModalRender | null = null;
  for (const render of renderers) {
    content = render(modal);
    if (content) break;
  }
  return <ModalContent modal={modal} content={content} onClose={closeModal} />;
}

function ModalContent({
  modal,
  content,
  onClose,
}: {
  modal: ModalState;
  content: ModalRender | null;
  onClose: () => void;
}) {
  const builtIn = useBuiltInModal(modal);
  const render = content || builtIn;
  if (!render) return null;
  return (
    <ModalShell title={render.title} eyebrow={render.eyebrow} wide={render.wide} onClose={onClose}>
      {render.body}
    </ModalShell>
  );
}
