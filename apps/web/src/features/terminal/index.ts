/**
 * Terminal shell and core pages. Other features never import this module; the composition
 * root (src/app/terminal) mounts the shell and passes feature slots to it.
 */
export { TerminalShell, type TerminalShellProps } from './TerminalShell';
export { TerminalPage } from './TerminalPage';
export { terminalModals, TerminalModal } from './components/modals';
export { useCurrentOffers, useRefreshPrices, MarketPage } from './components/MarketPage';
export { ModelsPage, ModelRateSummary, tokenMoney, tokenVolume } from './components/ModelsPage';
export { CollectionPage } from './components/CollectionPage';
export { SettingsPage } from './components/SettingsPage';
export { HelpPage } from './components/HelpPage';
export { Filters, MarketSwitcher } from './components/Filters';
export { TerminalHeader } from './components/TerminalHeader';
