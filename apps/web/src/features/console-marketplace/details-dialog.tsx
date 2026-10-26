'use client';

import type { MarketRecord } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { NativeDialog } from '@/features/console';
import { isExternal, type InboxData, type InboxScope, type InboxTab } from './marketplace';
import { marketplaceApi } from './api';
import {
  ExternalReviewForm,
  FeaturedDialogBody,
  GenericRecordBody,
  KybDialogBody,
  RfqDialogBody,
  RfqReviewForm,
} from './details';

export function DetailsDialog({
  id,
  workspace,
  tab,
  scope,
  data,
  onClose,
  onDecided,
}: {
  id: string;
  workspace: string;
  tab: InboxTab;
  scope: InboxScope;
  data: InboxData;
  onClose: () => void;
  onDecided: () => Promise<void>;
}) {
  const api = useApi();
  const demo = scope === 'demo';
  const decide = async (
    collection: 'rfqs' | 'kyb' | 'featured',
    status: string,
    reason: string,
    extra: Record<string, unknown>,
  ) => {
    if (demo && (collection === 'featured' || !workspace))
      throw new Error('Select a valid demo submission.');
    await marketplaceApi.decide(api, scope, collection, id, {
      status,
      reason,
      ...(demo ? { workspaceId: workspace } : {}),
      ...extra,
    });
    await onDecided();
  };
  const external = async (r: MarketRecord, status: string, reason: string, revision: number) => {
    if (demo || !isExternal(r, demo)) throw new Error('Select a valid external market record.');
    if (!Number.isInteger(revision) || revision < 1 || revision !== Number(r.reviewRevision))
      throw new Error('The record has changed. Refresh and review its current revision.');
    await marketplaceApi.external(api, r.id, { status, reason, expectedRevision: revision });
    await onDecided();
  };
  let title = '';
  let body: React.ReactNode = null;
  if (tab === 'featured') {
    const row = data.featured.find((f) => f.id === id);
    if (!row) return null;
    title = 'Homepage candidate · ' + row.model;
    body = (
      <FeaturedDialogBody
        row={row}
        onDecide={(status, reason, fingerprint) =>
          decide('featured', status, reason, { fingerprint })
        }
      />
    );
  } else if (tab === 'kyb') {
    const r = data.kyb.find((k) => k.id === id && (!demo || k.workspaceId === workspace));
    if (!r) return null;
    title = r.id;
    body = (
      <KybDialogBody
        r={r}
        demo={demo}
        onDecide={(status, reason) => decide('kyb', status, reason, {})}
      />
    );
  } else {
    const r = data[tab].find((x) => x.id === id && (!demo || x.workspaceId === workspace));
    if (!r) return null;
    const review = isExternal(r, demo) ? (
      <ExternalReviewForm
        r={r}
        onDecide={(status, reason, revision) => external(r, status, reason, revision)}
      />
    ) : tab === 'rfqs' ? (
      <RfqReviewForm
        r={r}
        demo={demo}
        onDecide={(status, reason) =>
          decide('rfqs', status, reason, { expectedRevision: Number(r.reviewRevision) })
        }
      />
    ) : null;
    if (tab === 'rfqs' && !isExternal(r, demo)) {
      title = r.requestKind === 'quote_request' ? 'Ask for quote' : 'Capacity RFQ';
      body = (
        <>
          <RfqDialogBody r={r} demo={demo} />
          {review}
        </>
      );
    } else {
      title = tab === 'supplies' && !isExternal(r, demo) ? 'Supply details' : r.id;
      body = (
        <GenericRecordBody r={r} tab={tab} demo={demo}>
          {review}
        </GenericRecordBody>
      );
    }
  }
  return (
    <NativeDialog className="market-console-dialog" onClose={onClose}>
      <header>
        <h2>{title}</h2>
        <button type="button" className="btn" onClick={onClose} aria-label="Close dialog">
          ×
        </button>
      </header>
      {body}
    </NativeDialog>
  );
}
