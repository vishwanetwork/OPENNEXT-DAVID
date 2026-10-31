/**
 * Operations Console shell and authenticated, server-backed operations pages.
 * Specialized review pages live in console-marketplace, console-leads, console-topups and pricing-admin.
 */
export { ConsoleShell, useConsoleNav } from './components/shell';
export { LiveUsersPage, LiveOrdersPage } from './pages/live-records';
export { LiveOverviewPage } from './pages/live-records';
export { useConsoleStore, loadDb, migrateIdentity, STORAGE_KEY } from './store';
export { CONSOLE_PAGES, legacyHashToPath, pagePath } from './pages';
export { useOverlay, OverlayProvider } from './components/overlay';
export { NativeDialog } from './components/native-dialog';
export { AdminLoginForm, useAdminLogin, isAccessError } from './components/admin-access';
export { OverviewPage } from './pages/overview';
export { RequestsPage } from './pages/requests';
export { PaymentsPage } from './pages/payments';
export { AgentWorkspace } from './pages/agent-workspace';
export { MarketPage as ConsoleMarketPage } from './pages/market';
export { AdvisoryPage } from './pages/advisory';
export { OrdersPage } from './pages/orders';
export { InstancesPage as ConsoleInstancesPage } from './pages/instances';
export { LiveSchedulesPage as SchedulesPage } from './pages/live-schedules';
export { AgentPage } from './pages/agent';
export { LiveBillingPage as ConsoleBillingPage } from './pages/live-agent';
export { UsersPage } from './pages/users';
export { LiveAuditPage as AuditPage } from './pages/live-agent';
export { SettingsPage as ConsoleSettingsPage } from './pages/settings';
