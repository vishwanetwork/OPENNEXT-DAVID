/**
 * Shared RFQ detail presentation (legacy OpenNEXT-rfq-details.js).
 *
 *   <RfqDetails record={rfq} money={money} date={date} />
 *   maximumQuote(rfq)  → number | null   (same rounding as the server's maximumQuotePrice)
 *   rfqKind(rfq)       → 'gpu_rental' | 'physical_gpu' | 'model_capacity'
 */
export { RfqDetails, type RfqDetailsProps } from './rfq-details';
export { maximumQuote, rfqKind, defaultMoney, defaultDate, present, numeric } from './maximum';
