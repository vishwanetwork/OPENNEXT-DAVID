'use client';

import type { ReactNode } from 'react';
import { money, stampUtc } from '@/lib/format';
import { regionText, useRegions, type Offer } from '@/features/market';
import {
  Button,
  ModalFrame,
  findOffer,
  useTerminal,
  useToast,
  useWorkspaceStore,
  StatusTag,
  type ModalComponent,
} from '@/terminal-kit';
import { Comparison } from './comparison';
import { useCurrentOffers } from './market-page';

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

export const DetailModal: ModalComponent<'detail'> = ({ modal, close }) => {
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
    <ModalFrame title={o.model + ' ' + o.provider} close={close}>
      <div className="row spread">
        <div>
          <span className="form-note">
            {o.region} {o.term}
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
        <Button
          cls=""
          data-act="quote"
          data-id={o.id}
          onClick={() => openModal('rfq-form', { offer: o })}
        >
          Request quote
        </Button>
      </div>
    </ModalFrame>
  );
};

export const CompareModal: ModalComponent<'compare'> = ({ close }) => {
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
        onCart={(x) =>
          toast(state.addToCart(x) ? 'Added to quote cart' : 'Already in your quote cart')
        }
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
