/**
 * terminal-kit — everything a terminal feature may depend on from the shell.
 *
 * - state:      useWorkspaceStore (UI state only), findOffer
 * - data:       useWorkspace / useWorkspaceData, usePublicMarket, useReferenceCatalog,
 *               useMatches, useSettlements, useBillingAccount, useBalance, useTopupRequests,
 *               useNotifications, useInvalidateWorkspace, useRunServer
 * - navigation: useTerminal, useGo, routing helpers
 * - modals:     useOpenModal / useCloseModal, ModalShell / ModalFrame, ModalComponents,
 *               composeModals; features augment `TerminalModalMap` (see ./modal.tsx)
 * - slots:      useTerminalSlots (bell, listing table, matches, SSH library, contact, opportunity, services)
 * - ui:         PageHeading, EmptyState, StatusTag, Button, useToast
 *
 * Features never import the shell (`@/features/terminal`); the composition root in
 * `src/app/terminal` wires features into the shell.
 */
export * from './types';
export * from './routing';
export {
  useWorkspaceStore,
  findOffer,
  initialWorkspace,
  readPreferences,
  sessionKey,
  PREFERENCE_KEY,
  type WorkspaceUiState,
  type WorkspaceStore,
} from './store';
export {
  TerminalProvider,
  useTerminal,
  useGo,
  useOpenModal,
  useCloseModal,
  useInitialUser,
  type TerminalApi,
} from './context';
export {
  ModalShell,
  ModalFrame,
  composeModals,
  type TerminalModalMap,
  type ModalType,
  type ModalState,
  type ModalOf,
  type ModalPayload,
  type ModalProps,
  type ModalComponent,
  type ModalComponents,
  type ModalArgs,
} from './modal';
export { TerminalSlotsProvider, useTerminalSlots, EMPTY_SLOTS, type TerminalSlots } from './slots';
export type {
  TerminalServices,
  AccountService,
  InstanceLifecycleAdapter,
  SpotCheckoutService,
  PurchaseContext,
  CreditBalanceResult,
  PurchaseResult,
} from './services';
export {
  accountIdentity,
  useAccountIdentity,
  usePublicMarket,
  useReferenceCatalog,
  useWorkspace,
  useWorkspaceData,
  EMPTY_WORKSPACE,
  useMatches,
  useSettlements,
  useBillingAccount,
  confirmedBillingAccount,
  useBalance,
  useTopupRequests,
  useNotifications,
  useInvalidateWorkspace,
  useRunServer,
  useIntentResume,
  useIsDemo,
  useRefreshBillingAccount,
  type Balance,
  type IntentResumer,
} from './data';
export { workspaceApi } from './api';
export { mergeNotifications } from './notifications';
export { PageHeading, EmptyState, StatusTag, Button, SaveIcon, PlusIcon } from './ui';
export { downloadWorkspace, downloadText, csvFrom } from './export';
export { useToast } from '@/components/ui/toast';
