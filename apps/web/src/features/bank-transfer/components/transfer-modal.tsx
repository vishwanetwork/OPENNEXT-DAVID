'use client';

import { BuyerKybGate } from '@/features/buyer-kyb';
import { money, stampUtc } from '@/lib/format';
import { ModalFrame, type ModalComponent, type ModalComponents } from '@/terminal-kit';
import { useBankTransfer } from '../hooks';
import '../bank-transfer.css';

declare module '@/terminal-kit/modal' {
  interface TerminalModalMap {
    'bank-transfer': { id: string };
  }
}

/** User-provided beneficiary. A live adapter must verify and version these instructions. */
function BankDetails() {
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

export function BankTransferBody({ id, close }: { id: string; close: () => void }) {
  const transfer = useBankTransfer(id);
  if (!transfer.intent)
    return (
      <div className="bank-transfer-unavailable" role="status">
        <p>
          Verified payment instructions are unavailable or have expired. Please start again from
          your purchase or Add credit.
        </p>
        <button type="button" className="btn secondary" onClick={close}>
          Close
        </button>
      </div>
    );
  if (transfer.reported)
    return (
      <div className="bank-transfer-pending" role="status">
        <h3>Awaiting payment confirmation</h3>
        <p>
          Your transfer report for {money(transfer.intent.amountCents / 100)} has been received. Our
          team will confirm receipt of funds and notify you when the review is complete.
        </p>
        <p>No credit or capacity has been issued by this report.</p>
        <button type="button" className="btn" onClick={close}>
          Done
        </button>
      </div>
    );
  return (
    <div className="bank-transfer">
      <div className="bank-transfer-summary">
        <div>
          <span>{transfer.intent.purpose === 'topup' ? 'Credit top-up' : 'Order payment'}</span>
          <strong>{money(transfer.intent.amountCents / 100)}</strong>
        </div>
        <div>
          <span>Payment reference</span>
          <strong>{transfer.intent.reference}</strong>
        </div>
      </div>
      <p className="form-note">
        Include this payment reference in your transfer so our team can match your payment.
      </p>
      <BankDetails />
      <p className="form-note">
        Instructions valid until {stampUtc(transfer.intent.expiresAt)}. Credit or capacity is issued
        only after receipt of funds is confirmed.
      </p>
      {transfer.error && (
        <p className="payment-error form-note" role="alert">
          {transfer.error}
        </p>
      )}
      <div className="modal-footer">
        <button type="button" className="btn secondary" onClick={close}>
          Close
        </button>
        <button
          type="button"
          className="btn"
          disabled={transfer.busy}
          onClick={() => void transfer.reportSent()}
        >
          {transfer.busy ? 'Submitting…' : 'I have made the transfer'}
        </button>
      </div>
    </div>
  );
}

const BankTransferModal: ModalComponent<'bank-transfer'> = ({ modal, close }) => (
  <ModalFrame title="Pay by bank transfer" wide close={close}>
    <BuyerKybGate returnTo="billing">
      <BankTransferBody key={modal.id} id={modal.id} close={close} />
    </BuyerKybGate>
  </ModalFrame>
);

export const bankTransferModals: ModalComponents = { 'bank-transfer': BankTransferModal };
