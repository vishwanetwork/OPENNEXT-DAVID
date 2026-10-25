import type { MarketRecord } from '@opennext/contracts';
import { date, isExternal, receivedReceipt, sourceName } from './marketplace';

export function WorkspaceCell({
  record,
  demo,
}: {
  record: { workspaceId?: string | null; workspaceExpiresAt?: string | null };
  demo: boolean;
}) {
  if (!demo) return null;
  return (
    <>
      <small className="market-demo-workspace">{record.workspaceId}</small>
      <small>Expires {date(record.workspaceExpiresAt)}</small>
    </>
  );
}

export function SourceCell({ record, demo }: { record: MarketRecord; demo: boolean }) {
  const external = isExternal(record, demo);
  return (
    <>
      <span className={`market-source ${external ? 'external' : demo ? 'demo' : 'terminal'}`}>
        {sourceName(record, demo)}
      </span>
      {external ? (
        <small>External · operations handled</small>
      ) : demo ? (
        <small>Isolated test workspace</small>
      ) : (
        <small>First-party submission</small>
      )}
    </>
  );
}

export function ReceiptCell({ record: r, demo }: { record: MarketRecord; demo: boolean }) {
  if (isExternal(r, demo))
    return (
      <>
        <span className="market-receipt imported">Imported</span>
        <small>{date(r.provenance?.importedAt)}</small>
        <small>Source observed {date(r.provenance?.observedAt)}</small>
      </>
    );
  const received = receivedReceipt(r);
  return (
    <>
      <span className={`market-receipt ${received ? 'received' : 'recorded'}`}>
        {received ? 'Received' : 'Recorded'}
      </span>
      <small>{received ? r.submission?.receiptId : 'Receipt not available'}</small>
      <small>{date(received ? r.submission?.receivedAt : r.createdAt)}</small>
      {r.submission?.updatedAt && r.submission.updatedAt !== r.submission.receivedAt ? (
        <small>Updated {date(r.submission.updatedAt)}</small>
      ) : null}
    </>
  );
}

export function StatusSpan({ status }: { status: unknown }) {
  const tone = status === 'Reviewing' ? ' reviewing' : status === 'Rejected' ? ' rejected' : '';
  return <span className={`market-status${tone}`}>{String(status ?? '')}</span>;
}

export function DetailsButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn small" onClick={onClick}>
      {label}
    </button>
  );
}
