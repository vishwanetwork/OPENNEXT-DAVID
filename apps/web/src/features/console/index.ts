/**
 * Operations Console shell and browser-local preview pages (legacy OpenNEXT-admin.js).
 * Server-backed pages live in console-marketplace, console-leads, console-topups, pricing-admin.
 */
export { ConsoleShell, useConsoleNav } from './components/shell';
export { useConsoleStore, loadDb, migrateIdentity, STORAGE_KEY } from './store';
export { CONSOLE_PAGES, legacyHashToPath, pagePath } from './pages';
export { useOverlay, OverlayProvider } from './components/overlay';
export { NativeDialog } from './components/native-dialog';
export { AdminLoginForm, useAdminLogin, isAccessError } from './components/admin-access';
export { OverviewPage } from './pages/overview';
export { MarketPage as ConsoleMarketPage } from './pages/market';
export { AdvisoryPage } from './pages/advisory';
export { OrdersPage } from './pages/orders';
export { InstancesPage as ConsoleInstancesPage } from './pages/instances';
export { SchedulesPage } from './pages/schedules';
export { AgentPage } from './pages/agent';
export { BillingPage as ConsoleBillingPage } from './pages/billing';
export { UsersPage } from './pages/users';
export { AuditPage } from './pages/audit';
export { SettingsPage as ConsoleSettingsPage } from './pages/settings';
