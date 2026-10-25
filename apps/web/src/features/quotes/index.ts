import './quotes.css';

/**
 * Quotes feature: account notifications (header bell + history page) and quote requests
 * for On-demand / Reserved offers (legacy OpenNEXT-quote-preview.js).
 */
export { NotificationBell } from './components/notification-bell';
export { NotificationsPage } from './components/notifications-page';
export { QuoteRequests } from './components/quote-requests';
export { useQuoteNotifications, useOpenQuoteRequest, useOpenNotice } from './hooks';
export { useQuoteStore } from './store';
export {
  notices,
  quoteRequests,
  prefill,
  visibleStatus,
  ownerKey,
  accountRows,
  countryName,
  formatDate,
  readPreferences,
  writePreferences,
  QUOTE_MARKER,
  NOTIFICATION_PAGE,
  PREF_PREFIX,
  type Notice,
  type QuoteOffer,
  type NotificationPreferences,
} from './notifications';
