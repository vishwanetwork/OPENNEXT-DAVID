import type { FeaturedCandidate, KybRecord, MarketRecord } from '@opennext/contracts';
import {
  MARKETS,
  date,
  duration,
  isExternal,
  money,
  number,
  present,
  quantity,
  recordKind,
  unit,
  type InboxTab,
} from './marketplace';
import { DetailsButton, ReceiptCell, SourceCell, StatusSpan, WorkspaceCell } from './inbox-cells';

export type OpenDetails = (id: string, workspace: string) => void;

const COLUMNS: Record<Exclude<InboxTab, 'featured'>, string[]> = {
  kyb: ['Business / account', 'Country', 'Registration', 'Submitted', 'Status', ''],
  rfqs: ['Email', 'Model', 'vCPU', 'Memory', 'Request type', 'Details'],
  supplies: [
    'Supply / account',
    'Source',
    'Market / location',
    'Offered capacity',
    'Quoted price',
    'Console receipt',
    'Marketplace status',
    '',
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

function RfqRow({ r, demo, open }: { r: MarketRecord; demo: boolean; open: OpenDetails }) {
  const request = r.requestKind === 'quote_request' ? 'Ask for quote' : 'RFQ';
  return (
    <tr>
      <td>
        <strong>
          {r.ownerEmail ||
            r.email ||
            (isExternal(r, demo) ? 'No OpenNEXT account assigned' : 'Not provided')}
        </strong>
        <SourceCell record={r} demo={demo} />
        <WorkspaceCell record={r} demo={demo} />
      </td>
      <td>
        <strong>{r.model}</strong>
      </td>
      <td>{number(r.vcpu)}</td>
      <td>{present(r.memory) ? number(r.memory) + ' GB / GPU' : 'Not provided'}</td>
      <td>
        <strong>{r.term || request}</strong>
        <small>{request}</small>
        <StatusSpan status={r.status} />
      </td>
      <td>
        <DetailsButton label="Details" onClick={() => open(r.id, r.workspaceId || '')} />
      </td>
    </tr>
  );
}

function SupplyRow({ r, demo, open }: { r: MarketRecord; demo: boolean; open: OpenDetails }) {
  return (
    <tr>
      <td>
        <strong>{r.title || r.model}</strong>
        {isExternal(r, demo) ? (
          <small>External market record · no OpenNEXT account assigned</small>
        ) : (
          <>
            <small>{r.ownerName || r.accountName || ''}</small>
            <small>{r.company || r.ownerCompany || ''}</small>
            <small>{r.ownerEmail || r.email || 'Account email unavailable'}</small>
          </>
        )}
        <small>{r.id}</small>
        <WorkspaceCell record={r} demo={demo} />
      </td>
      <td>
        <SourceCell record={r} demo={demo} />
      </td>
      <td>
        <strong>{r.model}</strong>
        <small>{MARKETS[recordKind(r)] || recordKind(r)}</small>
        <small>{r.region}</small>
      </td>
      <td>
        {quantity(r, demo)}
        <small>{duration(r, demo)}</small>
        <small>{r.term}</small>
      </td>
      <td>
        {money(r.netPrice)}
        <small>{unit(r)}</small>
      </td>
      <td>
        <ReceiptCell record={r} demo={demo} />
      </td>
      <td>
        <StatusSpan status={r.status} />
        {r.agentStatus ? <small>Agent: {r.agentStatus}</small> : null}
      </td>
      <td>
        <DetailsButton label="View details" onClick={() => open(r.id, r.workspaceId || '')} />
      </td>
    </tr>
  );
}

export function RecordsTable({
  tab,
  rows,
  demo,
  open,
}: {
  tab: Exclude<InboxTab, 'featured'>;
  rows: (MarketRecord | KybRecord)[];
  demo: boolean;
  open: OpenDetails;
}) {
  const Row = tab === 'kyb' ? KybRow : tab === 'rfqs' ? RfqRow : SupplyRow;
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
        {rows.map((r) => (
          // Each tab renders a single record shape; the union is narrowed by `tab` above.
          <Row key={r.id + (r.workspaceId || '')} r={r as never} demo={demo} open={open} />
        ))}
      </tbody>
    </table>
  );
}
