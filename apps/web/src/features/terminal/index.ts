/**
 * Terminal shell and core pages. Other features never import this module; the composition
 * root (src/app/terminal) mounts the shell and passes feature slots to it.
 */
export { TerminalShell, type TerminalShellProps } from './terminal-shell';
export { TerminalPage } from './terminal-page';
export { terminalModals, TerminalModal } from './components/modals';
export { useCurrentOffers, useRefreshPrices, MarketPage } from './components/market-page';
export { ModelsPage, ModelRateSummary, tokenMoney, tokenVolume } from './components/models-page';
export { CollectionPage } from './components/collection-page';
export { SettingsPage } from './components/settings-page';
export { HelpPage } from './components/help-page';
export { Filters } from './components/filters';
export { MarketSwitcher } from './components/market-switcher';
export { TerminalHeader } from './components/terminal-header';
