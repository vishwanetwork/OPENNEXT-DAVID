import { PageHeading } from './ui';

const TOPICS: [string, string][] = [
  [
    'Find capacity',
    'Choose the GPU, location, commercial terms and count. Rates, regional curves, matches and supplier comparisons update together. Use the legend to hide a series and hover the chart for a dated price.',
  ],
  [
    'Request and accept quotes',
    'Open a resource, confirm duration and start time, then request a quote. My RFQs keeps supplier responses, quote validity, acceptance and delivery milestones in one record.',
  ],
  [
    'Supplier review',
    'On your first listing or response, complete Eligibility, KYB and Rights. Subsequent submissions require capacity details and a new verification test. The review record states the exact verification scope.',
  ],
  [
    'Receive GPU access',
    'A confirmed quote moves to delivery. Upload your public SSH key, verify the instance details and connect from My Instances. Extensions are checked against the next reserved slot.',
  ],
  [
    'Save, cart and compare',
    'Use the star to save capacity, or + to build a quote cart. You can request a quote directly or select resources of the same model for a parameter comparison.',
  ],
  [
    'Market data and privacy',
    'Public GPU plan prices are normalized to USD per GPU-hour. Provider reference rates do not guarantee stock; supplier quotes establish delivery and executable terms. Never share a private SSH key.',
  ],
];

export function HelpPage() {
  return (
    <div className="page-content">
      <PageHeading
        title="Help & Documentation"
        subtitle="A practical guide to your capacity procurement workspace."
      />
      <div className="help-grid">
        {TOPICS.map(([h, p]) => (
          <article key={h} className="help-card">
            <h3>{h}</h3>
            <p>{p}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
