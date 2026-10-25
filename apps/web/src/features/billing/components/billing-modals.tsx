'use client';

import type { ReactNode } from 'react';
import { ModalFrame, type ModalComponent, type ModalComponents } from '@/terminal-kit';
import { useBillingData } from '../hooks';
import { PaymentAmount, PaymentMethod, PaymentProvider, TopupStatus } from './payment-modals';
import { OrderModal } from './order-modal';
import { CashoutDetail, CashoutStart, Measurement, RecordModal } from './billing-dialogs';

export const Btn = ({
  act,
  primary = false,
  children,
  onClick,
  id,
  value,
}: {
  act: string;
  primary?: boolean;
  children: ReactNode;
  onClick?: () => void;
  id?: string;
  value?: string;
}) => (
  <button
    type="button"
    className={`btn ${primary ? '' : 'secondary'} small`}
    data-act={act}
    data-id={id}
    data-value={value}
    onClick={onClick}
  >
    {children}
  </button>
);

declare module '@/terminal-kit/modal' {
  interface TerminalModalMap {
    'bill-order': { id: string };
    'bill-measurement': Record<string, never>;
    'pay-start': { orderId?: string; purchaseReference?: string; spotCheckout?: boolean };
    topup: { orderId?: string; purchaseReference?: string; spotCheckout?: boolean };
    'pay-checkout': { orderId?: string; purchaseReference?: string; spotCheckout?: boolean };
    'payment-method': Record<string, never>;
    'payment-topup-status': { id: string };
    'payment-provider': Record<string, never>;
    'cashout-start': Record<string, never>;
    'cashout-detail': { id: string };
    'bill-record': { id: string };
    receipt: { id: string };
  }
}

const BillOrderModal: ModalComponent<'bill-order'> = ({ modal, close }) => {
  const S = useBillingData();
  const id = modal.id;
  return (
    <ModalFrame
      title={S.orders.some((o) => o.id === id) ? 'Order details · ' + id : 'Order unavailable'}
      wide
      close={close}
    >
      <OrderModal id={id} />
    </ModalFrame>
  );
};

const MeasurementModal: ModalComponent<'bill-measurement'> = ({ close }) => (
  <ModalFrame title="How reporting is measured" close={close}>
    <Measurement />
  </ModalFrame>
);

const PayStartModal: ModalComponent<'pay-start' | 'topup' | 'pay-checkout'> = ({
  modal,
  close,
}) => (
  <ModalFrame title="Add credit" close={close}>
    <PaymentAmount
      orderId={modal.orderId}
      purchaseReference={modal.purchaseReference}
      spotCheckout={modal.spotCheckout === true}
    />
  </ModalFrame>
);

const PaymentMethodModal: ModalComponent<'payment-method'> = ({ close }) => (
  <ModalFrame title="Choose payment method" close={close}>
    <PaymentMethod />
  </ModalFrame>
);

const TopupStatusModal: ModalComponent<'payment-topup-status'> = ({ modal, close }) => (
  <ModalFrame title={<TopupStatus.Title id={modal.id} />} close={close}>
    <TopupStatus id={modal.id} />
  </ModalFrame>
);

const PaymentProviderModal: ModalComponent<'payment-provider'> = ({ close }) => (
  <ModalFrame title="Complete your credit top-up" close={close}>
    <PaymentProvider />
  </ModalFrame>
);

const CashoutStartModal: ModalComponent<'cashout-start'> = ({ close }) => (
  <ModalFrame title="Cash out earnings" close={close}>
    <CashoutStart />
  </ModalFrame>
);

const CashoutDetailModal: ModalComponent<'cashout-detail'> = ({ modal, close }) => {
  const S = useBillingData();
  const payout = S.payouts.find((item) => item.id === modal.id);
  if (!payout) return null;
  return (
    <ModalFrame title={'Payout details · ' + payout.id} close={close}>
      <CashoutDetail payout={payout} />
    </ModalFrame>
  );
};

const RecordDetailModal: ModalComponent<'bill-record' | 'receipt'> = ({ modal, close }) => {
  const S = useBillingData();
  const l = S.ledger.find((x) => x.id === modal.id);
  if (!l) return null;
  if (l.orderId)
    return (
      <ModalFrame title={'Order details · ' + l.orderId} wide close={close}>
        <OrderModal id={l.orderId} />
      </ModalFrame>
    );
  return (
    <ModalFrame title={'Activity details · ' + l.id} close={close}>
      <RecordModal l={l} />
    </ModalFrame>
  );
};

/** Modals owned by billing and payments (legacy `OpenNEXTBilling.modal` + `OpenNEXTPayments.modal`). */
export const billingModals: ModalComponents = {
  'bill-order': BillOrderModal,
  'bill-measurement': MeasurementModal,
  'pay-start': PayStartModal,
  topup: PayStartModal,
  'pay-checkout': PayStartModal,
  'payment-method': PaymentMethodModal,
  'payment-topup-status': TopupStatusModal,
  'payment-provider': PaymentProviderModal,
  'cashout-start': CashoutStartModal,
  'cashout-detail': CashoutDetailModal,
  'bill-record': RecordDetailModal,
  receipt: RecordDetailModal,
};
