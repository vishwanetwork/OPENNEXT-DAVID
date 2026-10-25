/**
 * Quotes feature: account notifications (header bell + history page) and quote requests
 * for On-demand / Reserved offers (legacy OpenNEXT-quote-preview.js).
 */
export { NotificationBell, registerNotificationBell } from './components/NotificationBell';
export { NotificationsPage } from './components/NotificationsPage';
export { QuoteRequests } from './components/QuoteRequests';
export { useQuoteNotifications, useOpenQuoteRequest, useOpenNotice } from './hooks';
export { useQuoteStore } from './store';
export { notices, quoteRequests, prefill, visibleStatus, ownerKey, accountRows, countryName, formatDate, readPreferences, writePreferences, QUOTE_MARKER, NOTIFICATION_PAGE, PREF_PREFIX, type Notice, type QuoteOffer, type NotificationPreferences } from './notifications';
