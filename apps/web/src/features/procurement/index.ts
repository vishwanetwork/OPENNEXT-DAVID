/**
 * Procurement feature: marketplace records, RFQs, supply, quotes and the market-page listings.
 * The composition root mounts `procurementModals`, `ListingTable`, `MatchesPanel` and
 * `ProcurementIntentResumer` into the terminal shell.
 */
import './procurement.css';

export { procurementModals } from './components/modals';
export { ProcurementIntentResumer } from './components/intent';
export { ListingTable } from './components/listing-table';
export { MatchesPanel } from './components/matches-panel';
export { RfqPage } from './components/rfq-page';
export { SupplyPage, SupplyDemand, SupplyExtra } from './components/supply-page';
export { NotificationsPanel } from './components/notifications';
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
