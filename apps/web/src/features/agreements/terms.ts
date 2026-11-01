import type { SpotAgreementDocument } from '@/lib/spot-agreement';

export const AGREEMENT_TERMS = [
  {
    title: '1. Resources and purchased runtime',
    text: 'The order summary identifies the GPU model, quantity, vCPU, GPU memory per GPU, country, hourly retail rate and purchased runtime. Runtime starts automatically when a matching instance is provisioned and ready for use, whether or not the Buyer connects, adds an SSH key or starts a workload. Idle but available time counts. The service ends when cumulative available runtime reaches the purchased hours, or earlier if the Buyer ends the order. Signing, payment, initial provisioning and interruption downtime do not count. There is no fixed calendar deadline measured from the first ready instance. The Buyer receives remote use rights, not ownership of hardware.',
  },
  {
    title: '2. Spot interruptions and replacement',
    text: 'Spot capacity may be interrupted or reclaimed. Interruptions pause both purchased-runtime consumption and compute billing. Until the purchased runtime is completed or the order is ended, the OpenNEXT agent continues to seek a replacement meeting the agreed specifications and country. When the replacement is ready, operation and timing resume with the remaining purchased hours; previously consumed hours are not reset. Calendar time to completion may therefore exceed the purchased runtime. The Buyer does not need to keep the Terminal open. Availability and a specific recovery time are not guaranteed. Material changes to specifications, country or price require renewed Buyer agreement.',
  },
  {
    title: '3. Price and settlement',
    text: 'The agreed retail hourly rate already includes the OpenNEXT markup; no additional fixed 5% service fee is added. The order limit equals the whole-instance hourly rate multiplied by the purchased hours, without multiplying the GPU quantity a second time. Credit payments reserve this amount; Direct Pay transfers fund the order. Compute billing begins automatically when the instance is ready for use, pauses during interruptions and ends when the purchased runtime is completed or the instance is released. Available runtime is metered by minute, subject to the minimum-charge rule below. Idle but available instances remain billable regardless of GPU utilization. No charges exceed the agreed order limit without further consent. Additional storage or traffic charges require separate agreement. The usage ledger and settlement are available in Billing.',
  },
  {
    title: '4. Data preservation and use',
    text: 'OpenNEXT preserves the Buyer’s workload data across Spot interruptions and restores it to the replacement instance during the remaining service term, so the Buyer does not need to upload that data again. Preserved storage, recovery checkpoints, any recovery limitations and post-service retention must be disclosed in the order’s data-preservation terms before signing. The Buyer retains ownership of its data and outputs and must use the service lawfully and protect its credentials. OpenNEXT processes data only to provide and secure the service, including through authorized infrastructure providers subject to appropriate safeguards. Separate customer backups remain advisable.',
  },
  {
    title: '5. Unused funds and Cashout',
    text: 'Unused paid amounts are released or returned as Credit after settlement. If a paid Spot order cannot be fulfilled, the full unconsumed payment is returned as Credit; signing and payment do not reserve upstream capacity. The Buyer may submit a Cashout request for eligible paid Credit to a bank account held by the same legal entity approved in KYB. Promotional Credit, unsettled amounts and funds already reserved for an order or another Cashout are not withdrawable. A Cashout request reserves its amount until processed or released, preventing double spending. Operations verifies the request and completes the bank transfer. Completion is recorded with a transfer reference and communicated by Terminal notification and email; receiving-bank posting times may differ. Any applicable transfer costs must be disclosed before confirmation.',
  },
  {
    title: '6. Confidentiality and responsibility',
    text: 'Each party protects non-public business, technical and account information and limits access to authorized personnel and service providers. These duties survive termination. Spot interruption alone is not a breach, but does not excuse failures in the agreed preservation, security, confidentiality or settlement obligations, or liability that cannot lawfully be excluded. The Buyer may end the order at any time; recorded usage is settled under the disclosed minimum-charge rule and remaining paid funds return to Credit.',
  },
  {
    title: '7. Electronic execution',
    text: 'Each signatory confirms authority to bind its party and expressly agrees to electronic execution of this version and order summary. The agreement becomes effective only when both parties’ execution or authorized acceptance is recorded by the signing service. Signature time is not the service start time. Both parties may retain the complete executed document and the identity, timestamp and integrity evidence. A changed price, duration, configuration or contracting entity requires a new agreement or an expressly accepted amendment. A signature image or a browser checkbox alone is not represented as completed bilateral execution.',
  },
  {
    title: '8. Law and notices',
    text: 'The governing law, dispute forum and notice addresses are stated in the verified commercial terms below. Notices and material order updates are recorded in the Terminal and sent to the agreed notice email. Applicable mandatory rights remain unaffected.',
  },
] as const;

export function commercialTerms(doc: SpotAgreementDocument) {
  return [
    ['Minimum charge', doc.policies.minimumChargeRule],
    ['Taxes', doc.policies.taxTreatment],
    ['Data preservation and retention', doc.policies.retentionAfterEnd],
    ['Settlement timing', doc.policies.settlementTiming],
    ['Payment collection authority', doc.policies.paymentCollectionAuthority],
    ['Cashout timing and transfer costs', doc.policies.cashoutTerms],
    ['Governing law', doc.provider.governingLaw],
    ['Dispute forum', doc.provider.disputeForum],
  ];
}
