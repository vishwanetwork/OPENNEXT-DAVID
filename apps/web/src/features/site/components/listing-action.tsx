'use client';

import type { ReactNode } from 'react';
import { useApp } from '@/components/providers/app-context';
import { isExchange, isHighUrgency, type Listing } from '../lib/listings';
import { demoOpportunityPath, type ListingIntent, type PublicTarget } from '../lib/workspace-links';
import { ListingIcon } from '@/components/icons';
import { useSiteActions } from './site-actions';

export const tokenMoney = (value: unknown) =>
  Number(value).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });

export const Metric = ({ label, value }: { label: ReactNode; value: ReactNode }) => (
  <div>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

export const UrgencyBadge = ({ urgency }: { urgency: unknown }) =>
  isHighUrgency(urgency) ? <span className="on-listing-urgency">High Urgency</span> : null;

/** Card call-to-action (legacy `action()`): demo rows deep-link into the demo workspace. */
export function ListingAction({
  item,
  label,
  target,
  intent,
}: {
  item: Listing;
  label: string;
  target: PublicTarget;
  intent: ListingIntent;
}) {
  const { crossHref } = useApp();
  const { openWorkspace } = useSiteActions();
  const className = `on-listing-cta${intent === 'buy' ? ' on-listing-cta-buy' : ''}`;
  const name = item.name;
  if (isExchange(item) && item.demo) {
    return (
      <a
        className={className}
        href={crossHref('terminal', demoOpportunityPath(item.id, intent))}
        data-showcase-opportunity={item.id}
        aria-label={`${label}: ${name}`}
      >
        <span>{label}</span>
        <ListingIcon name="right" />
      </a>
    );
  }
  const exchange = isExchange(item);
  const kind = item.kind;
  const onClick = () => {
    if (exchange) {
      // Legacy `OpenNEXTProcurement.opportunity`: unauthenticated visitors carry the opportunity into the terminal.
      openWorkspace({
        route: intent === 'offer' ? 'supply' : 'rfqs',
        opportunity: { id: item.id, intent },
      });
      return;
    }
    // Legacy `queueListingIntent`: catalog references are only purchasable; rentals can be offered.
    const valid =
      ['rental', 'model', 'hardware'].includes(kind) && (kind === 'rental' || intent === 'buy');
    if (valid) {
      openWorkspace({
        route: intent === 'offer' ? 'supply' : kind === 'model' ? 'models' : 'rfqs',
        preferredRole: intent === 'offer' ? 'seller' : 'buyer',
        listing: { id: item.id, intent },
      });
      return;
    }
    openWorkspace({ target });
  };
  return (
    <button
      type="button"
      className={className}
      data-public-action="open-workspace"
      data-target={target}
      data-listing-selection={item.id}
      data-listing-intent={intent}
      data-exchange-id={exchange ? item.id : undefined}
      data-exchange-intent={exchange ? intent : undefined}
      data-mode={kind === 'rental' ? 'rental' : kind === 'hardware' ? 'hardware' : undefined}
      aria-label={`${label}: ${name}`}
      onClick={onClick}
    >
      <span>{label}</span>
      <ListingIcon name="right" />
    </button>
  );
}
