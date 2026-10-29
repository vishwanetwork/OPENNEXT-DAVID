/** User-provided beneficiary. A live adapter must verify and version these instructions. */
export function BankDetails() {
  return (
    <section className="bank-transfer-card" aria-label="USD bank transfer details">
      <h3>
        Stable X Limited <span>USD</span>
      </h3>
      <p className="bank-transfer-bank">Singapore Gulf Bank, Bahrain</p>
      <dl className="bank-transfer-fields">
        <div>
          <dt>Account name</dt>
          <dd>Stable X Limited</dd>
        </div>
        <div>
          <dt>Currency</dt>
          <dd>USD</dd>
        </div>
        <div>
          <dt>Bank name</dt>
          <dd>SINGAPORE GULF BANK B.S.C. CLOSED</dd>
        </div>
        <div>
          <dt>Country / Region</dt>
          <dd>Bahrain</dd>
        </div>
        <div>
          <dt>Bank account</dt>
          <dd className="bank-transfer-code">79211900001010</dd>
        </div>
        <div>
          <dt>SWIFT code</dt>
          <dd className="bank-transfer-code">SGBDBHB2XXX</dd>
        </div>
        <div className="bank-transfer-full">
          <dt>IBAN</dt>
          <dd className="bank-transfer-code">BH10SGBD79211900001010</dd>
        </div>
        <div className="bank-transfer-full">
          <dt>Bank address</dt>
          <dd>UNIT 2901, BUILDING 1B, ISA AL-KABEER AVENUE 365, BLOCK 316, MANAMA, BAHRAIN</dd>
        </div>
      </dl>
      <div className="bank-transfer-correspondent">
        <h4>Correspondent bank — USD (optional)</h4>
        <dl className="bank-transfer-fields">
          <div>
            <dt>Bank name</dt>
            <dd>JPMORGAN CHASE BANK N.A.</dd>
          </div>
          <div>
            <dt>SWIFT code</dt>
            <dd className="bank-transfer-code">CHASUS33XXX</dd>
          </div>
        </dl>
        <p>Provide correspondent bank details only if the remitting bank asks for them.</p>
      </div>
    </section>
  );
}
