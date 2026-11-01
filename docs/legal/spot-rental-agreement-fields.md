# Spot rental agreement template

Template: [English Word agreement](spot-rental-agreement-en.docx).

Version: `opennext-spot-runtime-v2`. Canonical clauses are in
`apps/web/src/features/agreements/terms.ts`; types are in
`apps/web/src/lib/spot-agreement.ts`. The legal provider is Bitfintech Group Limited,
trading under the OpenNEXT brand, BVI company number 2180739. The name and supplied
representative/address are not evidence of signing authority or independent registry
verification. Existing bank instructions are unchanged.

This editable template is not an executed agreement. All order, account, KYB and
policy values must come from the authenticated, backend-frozen `SpotAgreementDocument`.
Do not use browser storage or sample values. Execution fields come only from a verified
`SignedSpotAgreement` receipt after both parties' acceptance is recorded.

## Field mapping

The following merge fields map to the identically named paths on `SpotAgreementDocument`:

- `accountNumber`
- `id`
- `documentHash`
- `context.country`
- `context.gpuCount`
- `context.memoryGbPerGpu`
- `context.model`
- `context.offerFingerprint`
- `context.offerId`
- `context.paymentMethod`
- `context.pricing.durationHours`
- `context.pricing.hourlyCents`
- `context.pricing.totalCents`
- `context.purchaseReference`
- `context.vcpu`
- `kyb.caseId`
- `kyb.companyName`
- `kyb.country`
- `kyb.noticeEmail`
- `kyb.registrationNumber`
- `kyb.revision`
- `policies.cashoutTerms`
- `policies.minimumChargeRule`
- `policies.paymentCollectionAuthority`
- `policies.retentionAfterEnd`
- `policies.settlementTiming`
- `policies.taxTreatment`
- `provider.disputeForum`
- `provider.governingLaw`
- `provider.noticeEmail`

The remaining fields map to identically named paths on `SignedSpotAgreement`:

- `providerExecutedAt`
- `signatoryName`
- `signatoryTitle`
- `signatureId`
- `signedAt`

The fixed provider legal name must match `provider.legalName` before signing.

## Display transforms

- Format integer USD cents as major currency units with two decimals, dividing by
  100 exactly once. Never print raw cents beside the template's USD label.
- Render payment method `credit` as Credit and `bank_transfer` as Direct Pay by bank transfer.
- GPU memory is GB per GPU. Unknown memory/vCPU must show Not specified, not invented values.
- Display signature timestamps in UTC. Leave execution fields blank before signing.
- Re-render after filling: long company names and approved policy text can change pagination.
- Define the canonical document-hash scope before filling hash/execution metadata to
  avoid a circular hash dependency.

## Activation requirements

Validate owner, approved KYB case/revision, offer fingerprint, specifications, country,
price, duration, document hash/version and expiry. Require confirmed, non-demo responses,
approved policies and backend-supported preservation and Cashout capabilities. Reject
unresolved or empty required fields. Governing law, notices, signing authority,
minimum/rounding, taxes, collection authority, preservation, settlement and Cashout
policies still require approval before production execution.

Purchased hours are cumulative available runtime. Provisioned readiness starts timing
automatically, including idle time without SSH/workload use. Interruptions pause both
runtime and billing; a replacement consumes only the remaining purchased hours. Later
runtime records must not rewrite the signed agreement or introduce a calendar expiry.

See [backend handoff](../SPOT_AGREEMENT_CASHOUT_HANDOFF.md) for idempotency, ledger,
signature, recovery, notification and email integration requirements.
