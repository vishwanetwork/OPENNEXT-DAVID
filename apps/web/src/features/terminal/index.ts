/**
 * Terminal feature API for other features (procurement, instances, billing, account, seller…).
 *
 * State:      useWorkspaceStore (legacy `S`), findOffer
 * Navigation: useGo (legacy go()), useTerminal().route
 * Modals:     useOpenModal / useCloseModal, ModalShell, registerTerminalModal(type renderer)
 * Overlays:   registerOpportunityOpener, registerContactOpener, registerHeaderBell,
 *             registerMatchesPanel, registerListingTable
 * Data:       registerWorkspaceRefresher (30 s loop), refreshWorkspace(), registerIntentResumer
 * UI:         PageHeading, EmptyState, StatusTag, TButton, useToast
 * Gate:       TerminalPage (auth / onboarding), PendingFeaturePage (stub)
 */
export { useWorkspaceStore, findOffer, initialWorkspace, type WorkspaceData, type WorkspaceStore, type ModalState, type Record_ } from './store';
export { useTerminal, useGo, useOpenModal, useCloseModal, registerWorkspaceRefresher, refreshWorkspace, registerIntentResumer, resumePendingIntents, type IntentResumer } from './context';
export { TERMINAL_ROUTES, routeTarget, resolveTarget, defaultRoute, type TerminalRoute, type WorkspaceRole } from './routing';
export { ModalShell, registerTerminalModal, registerContactOpener, openContact, type ModalRender, type ModalRenderer } from './components/TerminalModal';
export { registerOpportunityOpener, openOpportunity } from './components/TerminalOverlays';
export { registerHeaderBell } from './components/TerminalHeader';
export { registerMatchesPanel } from './components/Matches';
export { registerListingTable } from './components/MarketPage';
export { useCurrentOffers, useRefreshPrices, MarketPage } from './components/MarketPage';
export { ModelsPage, ModelRateSummary, tokenMoney, tokenVolume } from './components/ModelsPage';
export { CollectionPage } from './components/CollectionPage';
export { SettingsPage, exportWorkspace } from './components/SettingsPage';
export { HelpPage } from './components/HelpPage';
export { Filters, MarketSwitcher } from './components/Filters';
export { PageHeading, EmptyState, StatusTag, TButton } from './components/ui';
export { useToast } from '@/components/ui/toast';
export { TerminalPage } from './TerminalPage';
export { TerminalShell } from './TerminalShell';
export { PendingFeaturePage } from './placeholders';
export { downloadWorkspace, csvFrom } from './export';
