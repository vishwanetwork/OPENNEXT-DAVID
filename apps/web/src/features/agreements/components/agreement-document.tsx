import {
  OPENNEXT_COMPANY,
  type SpotAgreementContext,
  type SpotAgreementDocument,
} from '@/lib/spot-agreement';
import { money } from '@/lib/format';
import type { BuyerKybCase } from '@/lib/buyer-kyb';
import { AGREEMENT_TERMS, commercialTerms } from '../terms';

export function AgreementSummary({ context }: { context: SpotAgreementContext }) {
  const values = [
    ['Model', context.model],
    ['Capacity', `${context.gpuCount} GPUs`],
    ['vCPU', context.vcpu ?? 'Not provided'],
    [
      'Memory',
      context.memoryGbPerGpu === null ? 'Not provided' : `${context.memoryGbPerGpu} GB / GPU`,
    ],
    ['Country', context.country],
    ['Purchased runtime', `${context.pricing.durationHours} cumulative running hours`],
    ['Hourly rate', `${money(context.pricing.hourlyCents / 100)} / hour`],
    [
      context.paymentMethod === 'credit' ? 'Maximum Credit reservation' : 'Order payment',
      money(context.pricing.totalCents / 100),
    ],
    ['Payment method', context.paymentMethod === 'credit' ? 'Credit' : 'Bank transfer'],
  ];
  return (
    <aside className="agreement-summary">
      <h3>Order summary</h3>
      <dl>
        {values.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p>
        Timing starts automatically when the instance is ready for use, even if you have not
        connected or started a workload. Idle available time counts. Interruptions pause runtime and
        billing; reconnection resumes the remaining hours. Signing and payment do not start runtime
        or guarantee upstream Spot availability.
      </p>
    </aside>
  );
}

export function AgreementDocument({
  document,
  buyer,
}: {
  document?: SpotAgreementDocument;
  buyer?: BuyerKybCase | null;
}) {
  return (
    <section
      className="agreement-document"
      aria-label="Spot computing rental agreement"
      tabIndex={0}
    >
      <h3>Spot Computing Rental Agreement</h3>
      <p>
        <strong>Provider:</strong> {document?.provider.legalName ?? OPENNEXT_COMPANY.legalName} (
        {OPENNEXT_COMPANY.brand})
      </p>
      <p>
        BVI company number: {OPENNEXT_COMPANY.registrationNumber}
        <br />
        Representative: {document?.provider.representative ?? OPENNEXT_COMPANY.representative}
        <br />
        {document?.provider.address ?? OPENNEXT_COMPANY.address}
        {document && (
          <>
            <br />
            Notices: {document.provider.noticeEmail}
          </>
        )}
      </p>
      {document && (
        <p>
          <strong>Buyer:</strong> {document.kyb.companyName}
          <br />
          Registration: {document.kyb.registrationNumber} · {document.kyb.country}
          <br />
          Notices: {document.kyb.noticeEmail}
          <br />
          Account #: {document.accountNumber}
        </p>
      )}
      {!document && buyer?.status === 'Approved' && (
        <p>
          <strong>Buyer (approved KYB):</strong> {buyer.company.companyName}
          <br />
          Registration: {buyer.company.registrationNumber} · {buyer.company.country}
          <br />
          Notices: {buyer.company.email}
        </p>
      )}
      {AGREEMENT_TERMS.map((term) => (
        <section key={term.title}>
          <h4>{term.title}</h4>
          <p>{term.text}</p>
        </section>
      ))}
      <h4>Verified commercial terms</h4>
      {document ? (
        <dl className="agreement-commercial">
          {commercialTerms(document).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>
          Signatory authority, governing law, notices, minimum charge, taxes, settlement timing,
          data-preservation scope and post-service retention must be confirmed before this agreement
          can be signed.
        </p>
      )}
    </section>
  );
}
