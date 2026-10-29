'use client';

import { useMemo, useState, type ReactNode } from 'react';
import type { SessionUser } from '@opennext/contracts';
import { EMPTY_SLOTS, composeModals, type TerminalSlots } from '@/terminal-kit';
import { TerminalShell, terminalModals } from '@/features/terminal';
import {
  ListingTable,
  MatchesPanel,
  ProcurementIntentResumer,
  procurementModals,
  useOpportunity,
} from '@/features/procurement';
import { BillingPolling, billingModals } from '@/features/billing';
import { instanceModals, useInstanceLifecycleService } from '@/features/instances';
import {
  SpotCheckoutProvider,
  spotCheckoutModals,
  useSpotPurchaseContext,
} from '@/features/spot-market';
import { NotificationBell } from '@/features/quotes';
import { SshKeyLibrary, accountModals, useAccountApiService } from '@/features/account';
import { ContactDialog } from '@/features/site';
import { BuyerKybOnboardingPrompt, buyerKybModals } from '@/features/buyer-kyb';
import { bankTransferModals } from '@/features/bank-transfer';

/**
 * Composition root of the Capacity Terminal. This is the only module that knows every
 * feature: it decides which feature fills each shell slot, merges the modal maps and mounts
 * the headless integrations. Features themselves only depend on `@/terminal-kit`.
 */
const MODALS = composeModals(
  terminalModals,
  procurementModals,
  billingModals,
  instanceModals,
  spotCheckoutModals,
  accountModals,
  buyerKybModals,
  bankTransferModals,
);

function useTerminalSlotsComposition(openContact: TerminalSlots['openContact']): TerminalSlots {
  const { open: openOpportunity } = useOpportunity();
  const purchaseContext = useSpotPurchaseContext();
  const account = useAccountApiService();
  const instanceLifecycle = useInstanceLifecycleService();
  return useMemo<TerminalSlots>(
    () => ({
      ...EMPTY_SLOTS,
      headerBell: <NotificationBell />,
      listingTable: () => <ListingTable />,
      matchesPanel: (kind) => <MatchesPanel key={kind} kind={kind} />,
      sshLibrary: (scope) => <SshKeyLibrary scope={scope} />,
      modals: MODALS,
      openContact,
      openOpportunity,
      // Backend adapters: account SSH keys and instance termination. Spot purchases use the
      // Spot market feature's own endpoint unless a `spotCheckout` service is injected here.
      services: { purchaseContext, account, instanceLifecycle },
    }),
    [openContact, openOpportunity, purchaseContext, account, instanceLifecycle],
  );
}

export function TerminalApp({
  children,
  initialUser,
}: {
  children: ReactNode;
  initialUser?: SessionUser | null;
}) {
  const [contact, setContact] = useState<{ message?: string } | null>(null);
  const openContact = useMemo<TerminalSlots['openContact']>(
    () => (options) => setContact(options ?? {}),
    [],
  );
  const useSlots = () => useTerminalSlotsComposition(openContact);
  return (
    <TerminalShell
      initialUser={initialUser}
      useSlots={useSlots}
      providers={SpotCheckoutProvider}
      integrations={
        <>
          <ProcurementIntentResumer />
          <BillingPolling />
          <BuyerKybOnboardingPrompt />
        </>
      }
    >
      {children}
      {contact ? (
        <ContactDialog message={contact.message} onClose={() => setContact(null)} />
      ) : null}
    </TerminalShell>
  );
}
