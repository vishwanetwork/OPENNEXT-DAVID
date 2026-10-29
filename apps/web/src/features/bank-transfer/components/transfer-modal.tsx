'use client';

import { BuyerKybGate } from '@/features/buyer-kyb';
import { money, stampUtc } from '@/lib/format';
import { ModalFrame, type ModalComponent, type ModalComponents } from '@/terminal-kit';
import { useBankTransfer } from '../hooks';
import { BankDetails } from './bank-details';
import '../bank-transfer.css';

declare module '@/terminal-kit/modal' {
  interface TerminalModalMap {
    'bank-transfer': { id: string };
  }
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

export const bankTransferModals: ModalComponents = {
  'bank-transfer': BankTransferModal,
};
