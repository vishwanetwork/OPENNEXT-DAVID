import type { FeaturedCandidate } from '@opennext/contracts';
import { money, number, present } from './marketplace';

/** Preview of the public GPU-rental card, using only the backend-selected reviewed snapshot. */
export function HomepageCandidateCard({ candidate }: { candidate: FeaturedCandidate }) {
  const snapshot = candidate.snapshot || {};
  const supply = candidate.side === 'supply';
  const fields = [
    ['GPU model', candidate.model || 'Not provided'],
    ['Quantity', present(snapshot.count) ? `${number(snapshot.count)} GPUs` : 'On inquiry'],
    [
      'Usage window',
      present(snapshot.hours)
        ? `${number(snapshot.hours)} hours`
        : snapshot.term || 'Confirm in quote',
    ],
    ['Region', snapshot.region || 'Not provided'],
  ];
  return (
    <article className="market-console-homepage-card" aria-label="Homepage card preview">
      <span className="market-console-homepage-kind">
        {supply ? 'Supplier offer' : 'Buyer RFQ'}
      </span>
      <h3>{snapshot.title || candidate.model}</h3>
      <p className="market-console-homepage-location">{snapshot.region}</p>
      <p>{snapshot.description || 'No additional description supplied.'}</p>
      <dl>
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="market-console-homepage-price">
        <span>{supply ? 'Supplier asking price' : 'Buyer target price'}</span>
        <strong>
          {money(supply ? snapshot.netPrice : snapshot.price)} <small>/ GPU-hour</small>
        </strong>
      </div>
      <div className="market-console-homepage-placement">
        Inside OpenNEXT → {supply ? 'Buy Capacity' : 'Offer Capacity'}
      </div>
    </article>
  );
}
