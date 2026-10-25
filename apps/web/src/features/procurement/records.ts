'use client';

import { useMemo } from 'react';
import type { OwnedRfq } from '@opennext/contracts';
import { useWorkspaceData } from '@/terminal-kit';
import { deliveryMethod, isHardware, nowIso } from './exchange';

/** Legacy `init(S)` defaults so older records render completely. */
export function normalizeRfq(r: OwnedRfq): OwnedRfq {
  const record: OwnedRfq = { ...r };
  record.kind ||= 'gpu_rental';
  record.project ||= record.title;
  record.notes ||= 'Confirm the exact GPU, network, storage and delivery window before award.';
  record.urgency ||= 'Standard';
  record.quoteDeadline ||= new Date(Date.now() + 12 * 3600000).toISOString();
  record.start ||= new Date(Date.now() + 24 * 3600000).toISOString();
  record.deliveryMethod ||= deliveryMethod(record);
  if (isHardware(record)) {
    record.hours = 0;
    record.term = 'Physical GPU';
    if (record.deliveryMethod === 'SSH / dedicated instance')
      record.deliveryMethod = deliveryMethod(record);
  }
  record.visibility ||= 'Public requirements';
  record.shareClosingPrice ??= true;
  record.created ||= nowIso();
  record.audit ||= [];
  record.quotes = (record.quotes || []).map((q) => ({ ...q, status: q.status || 'Pending' }));
  return record;
}

/** The account's RFQs with legacy display defaults applied. */
export function useOwnedRfqs(): OwnedRfq[] {
  const rfqs = useWorkspaceData().rfqs;
  return useMemo(() => rfqs.map(normalizeRfq), [rfqs]);
}
