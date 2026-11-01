'use client';

import { BuyerKybGate, useBuyerKyb } from '@/features/buyer-kyb';
import { ModalFrame, type ModalComponent, type ModalComponents } from '@/terminal-kit';
import { CashoutForm } from './cashout-form';
import '../cashout.css';

declare module '@/terminal-kit/modal' {
  interface TerminalModalMap {
    'buyer-cashout': Record<string, never>;
  }
}

function CashoutBody({ close }: { close: () => void }) {
  const kyb = useBuyerKyb();
  const record = kyb.snapshot?.verification;
  if (!kyb.approved || !record) return null;
  return (
    <CashoutForm
      key={`${kyb.identity}:${record.id}:${record.revision}`}
      kyb={record}
      close={close}
    />
  );
}

const CashoutModal: ModalComponent<'buyer-cashout'> = ({ close }) => (
  <ModalFrame title="Cashout" wide close={close}>
    <BuyerKybGate returnTo="billing">
      <CashoutBody close={close} />
    </BuyerKybGate>
  </ModalFrame>
);

export const cashoutModals: ModalComponents = { 'buyer-cashout': CashoutModal };
