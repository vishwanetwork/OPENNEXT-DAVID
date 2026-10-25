/**
 * Procurement feature: marketplace records, RFQs, supply, quotes and the market-page listings.
 * The composition root mounts `procurementModals`, `ListingTable`, `MatchesPanel` and
 * `ProcurementIntentResumer` into the terminal shell.
 */
import './procurement.css';

export { procurementModals } from './components/modals';
export { ProcurementIntentResumer } from './components/intent';
export { ListingTable } from './components/ListingTable';
export { MatchesPanel } from './components/MatchesPanel';
export { RfqPage } from './components/RfqPage';
export { SupplyPage, SupplyDemand, SupplyExtra } from './components/SupplyPage';
export { NotificationsPanel } from './components/Notifications';
export { useOpportunity } from './components/opportunity';
export { useMarketplaceView, useFindMarketRow } from './market-view';
export { normalizeRfq, useOwnedRfqs } from './records';
export { useRunServer, useSubmissionId } from './hooks';
export {
  kindOf,
  isModel,
  isHardware,
  totalFor,
  tokenTotal,
  unitLabel,
  deliveryMethod,
  regionCountry,
  regionMatches,
  recordRegionMatches,
  type MarketplaceView,
} from './exchange';
export {
  FEE_LABEL,
  FEE_POLICY,
  currentFees,
  maximumQuotePrice,
  sellerEstimate,
  baseRate,
} from './fees';
export { countryList, findCountry, validCountry } from './countries';
export { rfqStatus, receiptFor } from './components/shared';
