import type { FeaturedCandidate, KybRecord, MarketRecord } from '@opennext/contracts';
import {
  date,
  duration,
  money,
  number,
  present,
  quantity,
  sourceName,
  unit,
  type InboxTab,
} from './marketplace';
import { DetailsButton, StatusSpan, WorkspaceCell } from './inbox-cells';
import { homepageCandidate, recordCountry } from './resource-filters';

export type OpenDetails = (id: string, workspace: string) => void;

const COLUMNS: Record<Exclude<InboxTab, 'featured'>, string[]> = {
  kyb: ['Business / account', 'Country', 'Registration', 'Submitted', 'Status', ''],
  rfqs: [
    'Model',
    'Capacity',
    'Max. Price',
    'Country',
    'vCPU',
    'Memory',
    'Duration',
    'Terms',
    'Details',
  ],
  supplies: [
    'Model',
    'Capacity',
    'Min. Price',
    'Country',
    'vCPU',
    'Memory',
    'Duration',
    'Terms',
    'Details',
  ],
};

export function FeaturedTable({ rows, open }: { rows: FeaturedCandidate[]; open: OpenDetails }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Model / side</th>
          <th>Selected record</th>
          <th>Price · USD / GPU-hour</th>
          <th>Review dates</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const s = row.snapshot || {};
          const supply = row.side === 'supply';
          return (
            <tr key={row.id}>
              <td>
                <strong>{row.model}</strong>
                <small>{supply ? 'Supplier offer' : 'Buyer RFQ'}</small>
                <small>{row.sourceId}</small>
              </td>
              <td>
                <strong>{s.title}</strong>
                <small>{s.ownerEmail}</small>
                <small>
                  {s.region} · {s.count} GPU · {s.hours} hours
                </small>
              </td>
              <td>
                {money(supply ? s.netPrice : s.price)}
                <small>{supply ? 'Lowest quoted unit price' : 'Highest maximum buyer price'}</small>
                {supply ? <small>OpenNEXT Fee 5% per side at checkout / settlement</small> : null}
              </td>
              <td>
                {date(row.submittedAt)}
                {row.reviewedAt ? <small>Reviewed {date(row.reviewedAt)}</small> : null}
              </td>
              <td>
                <span
                  className={`market-status ${row.status === 'Pending' ? 'reviewing' : row.status === 'Rejected' ? 'rejected' : ''}`}
                >
                  {row.status}
                </span>
                {row.current ? null : <small>Superseded · not displayed</small>}
              </td>
              <td>
                <DetailsButton
                  label={row.current ? 'Review candidate' : 'View history'}
                  onClick={() => open(row.id, '')}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function KybRow({ r, demo, open }: { r: KybRecord; demo: boolean; open: OpenDetails }) {
  return (
    <tr>
      <td>
        <strong>{r.company}</strong>
        <small>{r.email}</small>
        <WorkspaceCell record={r} demo={demo} />
      </td>
      <td>{r.country}</td>
      <td>{r.registration}</td>
      <td>{date(r.submittedAt)}</td>
      <td>
        <StatusSpan status={r.status} />
      </td>
      <td>
        <DetailsButton label="Review submission" onClick={() => open(r.id, r.workspaceId || '')} />
      </td>
    </tr>
  );
}

function MarketRecordRow({
  r,
  demo,
  open,
  supply,
  candidates,
  feature,
}: {
  r: MarketRecord;
  demo: boolean;
  open: OpenDetails;
  supply: boolean;
  candidates: FeaturedCandidate[];
  feature: (id: string) => void;
}) {
  const candidate = homepageCandidate(r, supply ? 'supply' : 'demand', candidates, demo);
  const homepageLabel =
    candidate?.status === 'Approved' ? 'Manage homepage' : 'Feature on homepage';
  const homepageHint = candidate
    ? `Review placement in Inside OpenNEXT → ${supply ? 'Buy Capacity' : 'Offer Capacity'}.`
    : demo
      ? 'Demo records cannot be featured on the live homepage.'
      : 'The backend has not selected this record as a current homepage candidate. Only eligible public RFQs and published supply can be featured.';
  return (
    <tr>
      <td>
        <strong>{r.model || 'Not provided'}</strong>
        <small>{sourceName(r, demo)}</small>
        <StatusSpan status={r.status} />
        <WorkspaceCell record={r} demo={demo} />
      </td>
      <td>{quantity(r, demo)}</td>
      <td>
        <strong>{money(supply ? r.netPrice : r.budget)}</strong>
        <small>{unit(r)}</small>
      </td>
      <td>{recordCountry(r) || 'Not provided'}</td>
      <td>{number(r.vcpu)}</td>
      <td>{present(r.memory) ? number(r.memory) + ' GB / GPU' : 'Not provided'}</td>
      <td>{duration(r, demo)}</td>
      <td>
        {r.term || 'Not provided'}
        {!supply && r.requestKind === 'quote_request' ? <small>Ask for quote</small> : null}
      </td>
      <td>
        <div className="market-console-row-actions">
          <DetailsButton label="Details" onClick={() => open(r.id, r.workspaceId || '')} />
          <span title={homepageHint}>
            <button
              type="button"
              className="btn small"
              disabled={!candidate}
              onClick={() => candidate && feature(candidate.id)}
              aria-label={`${homepageLabel}: ${r.model || r.id}`}
            >
              {homepageLabel}
            </button>
          </span>
        </div>
      </td>
    </tr>
  );
}

export function RecordsTable({
  tab,
  rows,
  demo,
  open,
  candidates,
  feature,
}: {
  tab: Exclude<InboxTab, 'featured'>;
  rows: (MarketRecord | KybRecord)[];
  demo: boolean;
  open: OpenDetails;
  candidates: FeaturedCandidate[];
  feature: (id: string) => void;
}) {
  return (
    <table>
      <thead>
        <tr>
          {COLUMNS[tab].map((c, i) => (
            <th key={i}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) =>
          tab === 'kyb' ? (
            <KybRow key={r.id + (r.workspaceId || '')} r={r as KybRecord} demo={demo} open={open} />
          ) : (
            <MarketRecordRow
              key={r.id + (r.workspaceId || '')}
              r={r as MarketRecord}
              demo={demo}
              open={open}
              supply={tab === 'supplies'}
              candidates={candidates}
              feature={feature}
            />
          ),
        )}
      </tbody>
    </table>
  );
}
