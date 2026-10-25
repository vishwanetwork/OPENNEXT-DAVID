import type { WorkspaceNotification } from '@opennext/contracts';

/** Merge marketplace and billing notifications owned by the signed-in account, newest first. */
export function mergeNotifications(
  ownerId: string | undefined,
  marketplaceRows: WorkspaceNotification[],
  billingRows: WorkspaceNotification[],
): WorkspaceNotification[] {
  const rows = new Map<string, WorkspaceNotification>();
  for (const row of [...marketplaceRows, ...billingRows])
    if (ownerId && row?.ownerId === ownerId && typeof row.id === 'string') rows.set(row.id, row);
  return [...rows.values()].sort(
    (a, b) =>
      (Date.parse(String(b.created || b.createdAt)) || 0) -
      (Date.parse(String(a.created || a.createdAt)) || 0),
  );
}
