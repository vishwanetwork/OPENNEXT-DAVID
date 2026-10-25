'use client';

import { ProcurementRegistrar } from '@/features/procurement';
import { InstancesRegistrar } from '@/features/instances';
import { BillingRegistrar } from '@/features/billing';
// Side-effect registrations (header bell, Spot checkout dialogs, account dialogs). The legacy
// site loaded every module script up front; this file is the explicit equivalent.
import '@/features/quotes/register';
import '@/features/spot-market/register';
import '@/features/account/register';

/** Feature modules that plug into the shell (modals, market panels, refreshers, registries). */
export function FeatureRegistrations() {
  return (
    <>
      <ProcurementRegistrar />
      <InstancesRegistrar />
      <BillingRegistrar />
    </>
  );
}
