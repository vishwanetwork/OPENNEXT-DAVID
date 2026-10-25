'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import type { FeaturedCandidate, KybRecord, MarketRecord } from '@opennext/contracts';
import { RfqDetails } from '@/features/rfq-details';
import {
  MARKETS,
  date,
  duration,
  isExternal,
  money,
  present,
  quantity,
  range,
  receivedReceipt,
  recordKind,
  safeSourceUrl,
  sourceName,
  unit,
  type InboxScope,
  type InboxTab,
} from './marketplace';

type Info = [string, unknown][];

export function sourceInfo(r: MarketRecord, demo: boolean): Info {
  const p = r.provenance || {};
  if (!isExternal(r, demo))
    return [
      ['Source', sourceName(r, demo)],
      ['Source type', demo ? 'Isolated demo submission' : 'First-party Terminal submission'],
    ];
  return [
    ['Source', sourceName(r, demo)],
    ['Source type', 'External market record'],
    ['Source URL', p.sourceUrl],
    ['Source ID', p.sourceId],
    [
      p.sourceRecordIdKind === 'adapter-key' ? 'Source adapter key' : 'Original external record ID',
      p.sourceRecordId,
    ],
    ['Source observed', date(p.observedAt)],
    ['Imported', date(p.importedAt)],
    ['Import batch', p.batchId],
    [
      'Response handling',
      'Operations handled; not a verified OpenNEXT account, live inventory or completed transaction',
    ],
  ];
}

export function DetailGrid({ info }: { info: Info }) {
  return (
    <div className="market-console-detail">
      {info.map(([key, value], i) => {
        const url = key === 'Source URL' ? safeSourceUrl(value) : '';
        return (
          <div key={`${key}-${i}`}>
            <small>{key}</small>
            <strong>
              {url ? (
                <a
                  className="market-source-link"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {url}
                </a>
              ) : (
                String(present(value) ? value : 'Not provided')
              )}
            </strong>
          </div>
        );
      })}
    </div>
  );
}

export function externalInfo(r: MarketRecord, tab: InboxTab, demo: boolean): Info {
  const scope = (r.regionScope || {}) as Record<string, unknown>;
  const months = (r.rentalMonths || {}) as Record<string, unknown>;
  const models = Array.isArray(r.modelOptions) ? r.modelOptions : [];
  const info: Info = [
    ['Record', r.id],
    ['Requirement / listing name', r.title],
    ...sourceInfo(r, demo),
    ['Market', MARKETS[recordKind(r)] || recordKind(r)],
    ['Model / SKU', r.model],
    ['Accepted model alternatives', models.length ? models.join(' / ') : null],
    ['Country / region', r.region || r.regionLabel],
    ['Region scope', scope.type],
    [
      'Countries / territories',
      Array.isArray(scope.countries) && scope.countries.length ? scope.countries.join(', ') : null,
    ],
    ['EU only', scope.unionOnly === true ? 'Yes' : null],
    ['Quantity', quantity(r, demo)],
    ['Rental duration', duration(r, demo)],
    [
      'Preferred rental period',
      present(months.preferred) ? range(months.preferred, ' months') : null,
    ],
    ['Rental notes', months.notes],
    ['Terms', r.term],
    ['Marketplace status', r.status],
    ['Operations review', r.reviewStatus],
    ['Review revision', r.reviewRevision],
    ['Submitted for review', date(r.reviewSubmittedAt)],
    ['Reviewed', date(r.reviewedAt)],
    ['Reviewed by', r.reviewedBy],
    ['Decision notes', r.reviewReason],
    ['Created', date(r.createdAt)],
    ['Updated', date(r.updatedAt)],
  ];
  info.push([
    tab === 'supplies' ? 'Quoted unit price' : 'Maximum buyer price',
    money(tab === 'supplies' ? r.netPrice : r.budget) + ' · ' + unit(r),
  ]);
  if (r.modelBudgets && typeof r.modelBudgets === 'object')
    for (const [model, price] of Object.entries(r.modelBudgets))
      info.push([model + ' target price', money(price) + ' · ' + unit(r)]);
  for (const [label, value] of [
    ['Service start', r.start || r.serviceStart],
    ['Service end', r.serviceEnd],
    ['Quote deadline', r.quoteDeadline],
  ] as [string, unknown][])
    if (present(value)) info.push([label, date(value)]);
  for (const [label, value] of [
    ['Network / interconnect', r.network],
    ['Storage', r.storage],
    ['SLA / acceptance', r.sla],
    ['Delivery method', r.deliveryMethod],
    ['Payment terms', r.paymentTerms],
  ] as [string, unknown][])
    if (present(value)) info.push([label, value]);
  return info.filter(([, value]) => present(value));
}

export function recordInfo(r: MarketRecord, tab: InboxTab, demo: boolean): Info {
  if (isExternal(r, demo)) return externalInfo(r, tab, demo);
  const type = recordKind(r);
  const received = receivedReceipt(r);
  const info: Info = [
    ...(demo
      ? ([
          ['Data scope', 'Demo · test only'],
          ['Demo workspace', r.workspaceId],
          ['Workspace expires', date(r.workspaceExpiresAt)],
        ] as Info)
      : []),
    ['Record', r.id],
    ['Requirement / listing name', r.title],
    ['Account', r.ownerEmail || r.email],
    ['Account name', r.ownerName || r.accountName],
    ['Company', r.company || r.ownerCompany],
    ['Account ID', r.ownerId],
    ['Market', MARKETS[type] || type],
    ['Model / SKU', r.model + (r.sku ? ' / ' + r.sku : '')],
    ['Country / territory', r.region],
    ['Quantity', quantity(r, demo)],
    ['Duration', duration(r, demo)],
    ['Terms', r.term],
    ['Marketplace status', r.status],
    ['Console receipt', received ? 'Received' : 'Recorded; receipt unavailable'],
    ['Receipt ID', r.submission?.receiptId],
    ['Submission source', r.submission?.source],
    ['Received', received ? date(r.submission?.receivedAt) : 'Not provided'],
    ['Receipt revision', r.submission?.revision],
    ['Client request ID', r.requestId],
    ['Created', date(r.createdAt)],
    ['Updated', date(r.updatedAt || r.submission?.updatedAt)],
    ['Service start', date(r.start || r.serviceStart)],
    ['Service end', date(r.serviceEnd)],
    ['Quote deadline', date(r.quoteDeadline)],
  ];
  if (tab === 'supplies')
    info.push(
      ['Quoted unit price', money(r.netPrice) + ' · ' + unit(r)],
      ['Buyer listed price', money(r.netPrice) + ' · ' + unit(r)],
      [
        'OpenNEXT Fee 5%',
        'Added to the buyer order subtotal at checkout; deducted from the seller order subtotal at settlement.',
      ],
      ['Agent status', r.agentStatus],
      ['Source instance', r.resaleOf],
    );
  else
    info.push(
      ['Maximum buyer price', money(r.budget) + ' · ' + unit(r)],
      ['Project', r.project],
      ['Visibility', r.visibility],
      ['Urgency', r.urgency],
      ['Selected supplier offer', r.originSupply],
      [
        'Share closing price',
        typeof r.shareClosingPrice === 'boolean' ? (r.shareClosingPrice ? 'Yes' : 'No') : null,
      ],
      ['Operations review', r.reviewStatus],
      ['Review revision', r.reviewRevision],
      ['Submitted for review', date(r.reviewSubmittedAt)],
      ['Reviewed', date(r.reviewedAt)],
      ['Reviewed by', r.reviewedBy],
      ['Decision notes', r.reviewReason],
    );
  const specific: Info = [
    ['Network / interconnect', r.network],
    ['Storage', r.storage],
    ['System image', r.image],
    ['SLA / acceptance', r.sla],
    ['Delivery method', r.deliveryMethod],
    ['Payment terms', r.paymentTerms],
    ['Access policy', r.accessPolicy],
    ['Required TPS', r.tps],
    ['Condition', r.condition],
    ['Shipping address', r.shippingAddress],
    ['Incoterms', r.incoterms],
    ['Warranty', r.warranty],
    ['Input price / 1M tokens', present(r.inputRate) ? money(r.inputRate) : null],
    ['Output price / 1M tokens', present(r.outputRate) ? money(r.outputRate) : null],
  ];
  info.push(...specific.filter(([, value]) => present(value)));
  info.push(...sourceInfo(r, demo));
  if (type === 'gpu_rental' && tab === 'supplies')
    info.push(['SSH endpoint', 'Handled securely by the backend; credentials are not displayed.']);
  return info;
}

export interface DecisionSubmit {
  (decision: string, reason: string): Promise<void>;
}

/** Decision form: the submitter's value is the decision; errors stay inside the dialog. */
export function DecisionForm({
  buttons,
  placeholder,
  onSubmit,
  validate,
}: {
  buttons: { value: string; label: string; primary?: boolean }[];
  placeholder: string;
  onSubmit: DecisionSubmit;
  validate?: (decision: string, reason: string) => string | null;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = submitter?.value || '';
    const reason = String(new FormData(event.currentTarget).get('reason') || '');
    const problem = validate?.(decision, reason);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setBusy(true);
    try {
      await onSubmit(decision, reason);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <label>
        Decision notes
        <textarea
          className="field"
          name="reason"
          rows={3}
          maxLength={2000}
          placeholder={placeholder}
        />
      </label>
      <p className="market-console-error" role="alert" hidden={!error}>
        {error}
      </p>
      <div className="market-console-decisions">
        {buttons.map((b) => (
          <button
            key={b.value}
            type="submit"
            className={`btn ${b.primary ? 'primary' : ''}`}
            name="decision"
            value={b.value}
            disabled={busy}
          >
            {b.label}
          </button>
        ))}
      </div>
    </form>
  );
}

export function ExternalReviewForm({
  r,
  onDecide,
}: {
  r: MarketRecord;
  onDecide: (status: string, reason: string, revision: number) => Promise<void>;
}) {
  const status = r.reviewStatus || r.status;
  const revision = Number(r.reviewRevision);
  const note = (
    <p className="market-console-review-note">
      This external record is handled by operations, not a registered buyer or seller. Approval
      publishes the reviewed requirements in the Terminal. Future imports and material changes
      require a new review. Homepage placement is a separate decision.
    </p>
  );
  if (!['Reviewing', 'Approved'].includes(String(status)))
    return (
      <>
        {note}
        <p className="market-console-notes">
          {r.reviewReason ||
            'No review action is available for this record. A new source revision requires a new review.'}
        </p>
      </>
    );
  if (!Number.isInteger(revision) || revision < 1)
    return (
      <>
        {note}
        <p className="market-console-error">
          The review revision is unavailable. Refresh before reviewing this record.
        </p>
      </>
    );
  return (
    <>
      {note}
      <DecisionForm
        placeholder="Required when rejecting or withdrawing; optional approval notes"
        buttons={
          status === 'Reviewing'
            ? [
                { value: 'Rejected', label: 'Reject external record' },
                { value: 'Approved', label: 'Approve for Terminal', primary: true },
              ]
            : [{ value: 'Withdrawn', label: 'Withdraw from Terminal' }]
        }
        validate={(decision, reason) =>
          !['Approved', 'Rejected', 'Withdrawn'].includes(decision)
            ? 'Select a valid review decision.'
            : ['Rejected', 'Withdrawn'].includes(decision) && !reason.trim()
              ? 'Explain why the external record is being rejected or withdrawn.'
              : null
        }
        onSubmit={(decision, reason) => onDecide(decision, reason.trim(), revision)}
      />
    </>
  );
}

export function RfqReviewForm({
  r,
  demo,
  onDecide,
}: {
  r: MarketRecord;
  demo: boolean;
  onDecide: (status: string, reason: string) => Promise<void>;
}) {
  const note = (
    <p className="market-console-review-note">
      Operations approval makes this RFQ available to eligible suppliers. Homepage placement
      requires a separate Homepage review. Private RFQs remain visible only to the selected
      supplier.
    </p>
  );
  if (r.reviewStatus !== 'Reviewing')
    return (
      <>
        {note}
        {r.reviewReason ? (
          <p className="market-console-notes">Decision notes: {r.reviewReason}</p>
        ) : null}
      </>
    );
  return (
    <>
      {note}
      <DecisionForm
        placeholder="Required when rejecting; optional approval notes"
        buttons={[
          { value: 'Rejected', label: 'Reject RFQ' },
          { value: 'Approved', label: demo ? 'Approve Demo RFQ' : 'Approve RFQ', primary: true },
        ]}
        validate={(decision, reason) =>
          decision === 'Rejected' && !reason.trim()
            ? 'Explain why the submission is being rejected.'
            : null
        }
        onSubmit={onDecide}
      />
    </>
  );
}

export function RfqDialogBody({ r, demo }: { r: MarketRecord; demo: boolean }) {
  const received = receivedReceipt(r);
  const metadata: Info = [
    ['Record', r.id],
    ['Email', r.ownerEmail || r.email],
    ['Account ID', r.ownerId],
    ['Account name', r.ownerName],
    ['Company', r.ownerCompany || r.company],
    ['Request type', r.requestKind === 'quote_request' ? 'Ask for quote' : 'RFQ'],
    ['Submitted', date(r.createdAt)],
    ['Console receipt', received ? 'Received' : 'Recorded; receipt unavailable'],
    ['Receipt ID', r.submission?.receiptId],
    ['Receipt revision', r.submission?.revision],
    ['Client request ID', r.requestId],
    ['Received', received ? date(r.submission?.receivedAt) : 'Not provided'],
    ['Review status', r.reviewStatus || r.status],
    ['Review revision', r.reviewRevision],
    ['Reviewed', date(r.reviewedAt)],
    ['Reviewed by', r.reviewedBy],
    ['Decision notes', r.reviewReason],
    ...sourceInfo(r, demo),
    ...(demo
      ? ([
          ['Demo workspace', r.workspaceId],
          ['Workspace expires', date(r.workspaceExpiresAt)],
        ] as Info)
      : []),
  ];
  return (
    <>
      <RfqDetails record={r} money={money} date={date} />
      <h3>Submission &amp; review</h3>
      <DetailGrid info={metadata} />
    </>
  );
}

export function KybDialogBody({
  r,
  demo,
  onDecide,
}: {
  r: KybRecord;
  demo: boolean;
  onDecide: (status: string, reason: string) => Promise<void>;
}) {
  const info: Info = [
    ...(demo
      ? ([
          ['Data scope', 'Demo · test only'],
          ['Demo workspace', r.workspaceId],
          ['Workspace expires', date(r.workspaceExpiresAt)],
        ] as Info)
      : []),
    ['Company', r.company],
    ['Account', r.email],
    ['Registration', r.registration],
    ['Country', r.country],
    ['Submitted', date(r.submittedAt)],
    ['Status', r.status],
  ];
  return (
    <>
      <DetailGrid info={info} />
      <h3>Business evidence</h3>
      <p className="market-console-notes">{r.evidence}</p>
      <h3>Supply rights</h3>
      <p className="market-console-notes">{r.rights}</p>
      {r.status === 'Reviewing' ? (
        <DecisionForm
          placeholder="Required when rejecting; optional approval notes"
          buttons={[
            { value: 'Rejected', label: 'Reject' },
            {
              value: 'Approved',
              label: demo ? 'Approve Demo KYB & rights' : 'Approve KYB & rights',
              primary: true,
            },
          ]}
          validate={(decision, reason) =>
            decision === 'Rejected' && !reason.trim()
              ? 'Explain why the submission is being rejected.'
              : null
          }
          onSubmit={onDecide}
        />
      ) : (
        <p>{r.reason || 'Decision recorded.'}</p>
      )}
    </>
  );
}

export function GenericRecordBody({
  r,
  tab,
  demo,
  children,
}: {
  r: MarketRecord;
  tab: InboxTab;
  demo: boolean;
  children?: ReactNode;
}) {
  const external = isExternal(r, demo);
  return (
    <>
      <DetailGrid info={recordInfo(r, tab, demo)} />
      <h3>Requirements / commercial terms</h3>
      <p className="market-console-notes">{r.notes || 'No additional notes supplied.'}</p>
      <p className="form-note">
        {demo
          ? 'Test-only record. It cannot enter the live marketplace or homepage.'
          : external
            ? 'Imported source facts do not confirm inventory, buyer identity, availability or an executed trade. Operations must verify commercial details before arranging a transaction.'
            : 'A Console receipt does not approve this record or publish it on the homepage.'}
        {tab === 'supplies' && !external
          ? ' Agent completion is accepted only from the trusted installer integration. Operations cannot simulate success here.'
          : ''}
      </p>
      {Array.isArray(r.audit) && r.audit.length ? (
        <>
          <h3>Record activity</h3>
          <ol className="market-console-audit">
            {r.audit.map((event, i) => (
              <li key={i}>
                <time>{date(event.at)}</time> {event.action || event.event}
                {event.actor || event.by ? ' · ' + (event.actor || event.by) : ''}
                {event.detail || event.reason ? (
                  <small>{event.detail || event.reason}</small>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {children}
    </>
  );
}

export function FeaturedDialogBody({
  row,
  onDecide,
}: {
  row: FeaturedCandidate;
  onDecide: (status: string, reason: string, fingerprint: string) => Promise<void>;
}) {
  const snapshot = row.snapshot || {};
  const supply = row.side === 'supply';
  const info: Info = [
    ['Record', row.sourceId],
    ['Account', snapshot.ownerEmail],
    ['Model', row.model],
    ['Side', supply ? 'Supplier offer' : 'Buyer RFQ'],
    ['Country', snapshot.region],
    ['Capacity', snapshot.count + ' GPUs · ' + snapshot.hours + ' hours'],
    ['Terms', snapshot.term],
    ['Homepage status', row.current ? row.status : row.status + ' · superseded'],
    [
      supply ? 'Quoted unit price' : 'Maximum buyer price',
      money(supply ? snapshot.netPrice : snapshot.price),
    ],
    ...(supply
      ? ([
          ['OpenNEXT Fee 5%', 'Calculated separately on the order subtotal for each side.'],
        ] as Info)
      : []),
    ['Start', date(snapshot.start)],
    ['End / quote deadline', date(snapshot.serviceEnd || snapshot.quoteDeadline)],
    ['Selected', date(row.submittedAt)],
    ['Reviewed by', row.reviewedBy || 'Not reviewed'],
  ];
  const buttons = [
    ...(row.status !== 'Rejected'
      ? [
          {
            value: 'Rejected',
            label: row.status === 'Approved' ? 'Remove from homepage' : 'Reject',
          },
        ]
      : []),
    ...(row.status !== 'Approved'
      ? [{ value: 'Approved', label: 'Approve for homepage', primary: true }]
      : []),
  ];
  return (
    <>
      <div className="market-console-detail">
        {info.map(([key, value]) => (
          <div key={key}>
            <small>{key}</small>
            <strong>{String(value ?? '')}</strong>
          </div>
        ))}
      </div>
      <h3>Homepage content</h3>
      <strong>{snapshot.title}</strong>
      <p className="market-console-notes">{snapshot.description}</p>
      <p className="form-note">
        Approval applies only to this record and its reviewed price and terms. It cannot transfer to
        a replacement or material edit.
      </p>
      {row.reason ? <p className="market-console-notes">Decision notes: {row.reason}</p> : null}
      {row.current ? (
        <DecisionForm
          placeholder="Required when rejecting; optional approval notes"
          buttons={buttons}
          validate={(decision, reason) =>
            decision === 'Rejected' && !reason.trim()
              ? 'Explain why the submission is being rejected.'
              : null
          }
          onSubmit={(decision, reason) => onDecide(decision, reason, String(row.fingerprint || ''))}
        />
      ) : (
        <p className="market-console-review-note">
          This candidate has been superseded. Review the current candidate instead.
        </p>
      )}
    </>
  );
}

export type { InboxScope };
