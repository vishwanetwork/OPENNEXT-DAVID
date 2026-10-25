'use client';

import { PageHeading } from './components/ui';

/**
 * Stub pages for routes owned by other features (procurement, instances, billing, account,
 * seller activities, quote preview). Replace the page component in src/app/terminal/<route>.
 */
export function PendingFeaturePage({ title, feature }: { title: string; feature: string }) {
  return (
    <div className="page-content" data-pending-feature={feature}>
      <PageHeading title={title} subtitle={`This area is being migrated (${feature}).`} />
    </div>
  );
}
