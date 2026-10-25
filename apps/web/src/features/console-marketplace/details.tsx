'use client';

import { type ReactNode } from 'react';
import type { FeaturedCandidate, KybRecord, MarketRecord } from '@opennext/contracts';
import { RfqDetails } from '@/features/rfq-details';
import {
  date,
  isExternal,
  money,
  present,
  receivedReceipt,
  safeSourceUrl,
  type InboxScope,
  type InboxTab,
} from './marketplace';
import { Info, recordInfo, sourceInfo } from './record-info';
import { DecisionForm } from './review-forms';

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
export { ExternalReviewForm } from './review-forms';
export { RfqReviewForm } from './review-forms';
