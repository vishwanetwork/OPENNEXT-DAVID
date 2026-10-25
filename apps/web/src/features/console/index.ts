/**
 * Operations Console shell and browser-local preview pages (legacy OpenNEXT-admin.js).
 * Server-backed pages live in console-marketplace, console-leads, console-topups, pricing-admin.
 */
export { ConsoleShell, useConsoleNav } from './components/shell';
export { useConsoleStore, loadDb, migrateIdentity, STORAGE_KEY } from './store';
export { CONSOLE_PAGES, legacyHashToPath, pagePath } from './pages';
export { useOverlay } from './components/overlay';
export { NativeDialog } from './components/native-dialog';
export { AdminLoginForm, useAdminLogin, isAccessError } from './components/admin-access';
