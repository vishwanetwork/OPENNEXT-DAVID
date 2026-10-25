'use client';

import type { MarketRecord } from '@opennext/contracts';
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
  sourceName,
  unit,
  type InboxTab,
} from './marketplace';

export type Info = [string, unknown][];

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
