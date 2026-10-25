'use client';

import { money } from '@/lib/format';
import {
  Button,
  EmptyState,
  PageHeading,
  findOffer,
  useTerminal,
  useToast,
  useWorkspaceStore,
} from '@/terminal-kit';

/** Saved Capacity / Quote Cart (legacy `collection()`), including compare and bulk quote actions. */
export function CollectionPage({ type }: { type: 'saved' | 'cart' }) {
  const state = useWorkspaceStore();
  const toast = useToast();
  const { openModal } = useTerminal();
  const items = state[type];
  const name = type === 'cart' ? 'Quote Cart' : 'Saved Capacity';
  const compareSelected = () => {
    const list = state.selected.map((id) => findOffer(state, id)).filter(Boolean);
    if (list.length < 2) return toast('Select at least two resources to compare');
    if (new Set(list.map((o) => o!.model)).size !== 1)
      return toast('Select resources of the same GPU model');
    if (list.length > 4) return toast('Compare up to four suppliers at a time');
    openModal('compare');
  };
  // Quote requests are server records: the RFQ form submits one request at a time.
  const collectionQuotes = () => {
    const list = state.selected.length
      ? state.selected.map((id) => findOffer(state, id)).filter(Boolean)
      : state.cart;
    if (!list.length) return toast('Select or add capacity first');
    if (list.length > 1) toast('Quote requests are submitted one resource at a time');
    openModal('rfq-form', { offer: list[0]! });
  };
  const savedToCart = () => {
    const next = [...state.cart];
    for (const id of state.selected) {
      const o = findOffer(state, id);
      if (o && !next.some((x) => x.id === o.id)) next.push(o);
    }
    state.patch({ cart: next });
    toast('Selected capacity added to quote cart');
  };
  return (
    <div className="page-content">
      <PageHeading
        title={name}
        subtitle={
          type === 'cart'
            ? 'Request quotes directly or compare the suppliers you selected.'
            : 'Keep interesting capacity for purchase and comparison.'
        }
        action={
          type === 'cart' ? (
            <Button data-act="collection-quotes" onClick={collectionQuotes}>
              Request quotes
            </Button>
          ) : undefined
        }
      />
      <div className="toolbar">
        <span className="form-note">
          {items.length} resources · select up to 4 of the same model
        </span>
        <span className="gap" />
        <Button data-act="compare-selected" onClick={compareSelected}>
          Compare selected
        </Button>
        {type === 'saved' ? (
          <Button data-act="saved-to-cart" onClick={savedToCart}>
            Add selected to cart
          </Button>
        ) : null}
      </div>
      <div className="collection-grid">
        {items.map((o) => (
          <article key={o.id} className="collection-card">
            <label className="collection-select">
              <input
                type="checkbox"
                data-compare={o.id}
                checked={state.selected.includes(o.id)}
                onChange={(e) =>
                  state.setSelected(
                    e.target.checked
                      ? [...new Set([...state.selected, o.id])]
                      : state.selected.filter((x) => x !== o.id),
                  )
                }
              />{' '}
              Select for comparison
            </label>
            <div className="row spread">
              <h3>{o.model}</h3>
              <strong style={{ fontSize: 15 }}>{money(o.price)}/hr</strong>
            </div>
            <p>
              {o.provider} · {o.region}
              <br />
              {o.count} GPU · {o.term} ·{' '}
              {o.delivery != null ? o.delivery + ' min delivery' : 'Delivery to confirm'}
            </p>
            <div className="row">
              <Button
                cls="secondary small"
                data-act="detail"
                data-id={o.id}
                onClick={() => openModal('detail', { offer: o })}
              >
                Details
              </Button>
              <Button
                cls="small"
                data-act="quote"
                data-id={o.id}
                onClick={() => openModal('rfq-form', { offer: o })}
              >
                Request quote
              </Button>
              <Button
                cls="ghost small"
                data-act="remove"
                data-type={type}
                data-id={o.id}
                onClick={() => state.removeFrom(type, o.id)}
              >
                Remove
              </Button>
            </div>
          </article>
        ))}
      </div>
      {items.length ? null : (
        <EmptyState title={`Your ${name.toLowerCase()} is empty`}>
          Save or add capacity from the market to start comparing.
        </EmptyState>
      )}
    </div>
  );
}
