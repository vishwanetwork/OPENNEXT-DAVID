'use client';

import { ModalFrame, type ModalComponent, type ModalComponents } from '@/terminal-kit';
import {
  CompleteBody,
  CreditConfirmBody,
  PaymentChoiceBody,
  PendingTitle,
  ReviewBody,
} from './checkout-bodies';

declare module '@/terminal-kit/modal' {
  interface TerminalModalMap {
    'spot-review': Record<string, never>;
    'spot-payment-choice': Record<string, never>;
    'spot-credit-confirm': Record<string, never>;
    'spot-purchase-complete': Record<string, never>;
  }
}

const ReviewModal: ModalComponent<'spot-review'> = ({ close }) => (
  <ModalFrame title={<PendingTitle fallback="Review Spot purchase" />} close={close}>
    <ReviewBody />
  </ModalFrame>
);

const PaymentChoiceModal: ModalComponent<'spot-payment-choice'> = ({ close }) => (
  <ModalFrame title={<PendingTitle fallback="Choose payment" />} close={close}>
    <PaymentChoiceBody />
  </ModalFrame>
);

const CreditConfirmModal: ModalComponent<'spot-credit-confirm'> = ({ close }) => (
  <ModalFrame title={<PendingTitle fallback="Confirm Credit payment" />} close={close}>
    <CreditConfirmBody />
  </ModalFrame>
);

const CompleteModal: ModalComponent<'spot-purchase-complete'> = ({ close }) => (
  <ModalFrame title={<PendingTitle fallback="Purchase confirmed" />} close={close}>
    <CompleteBody />
  </ModalFrame>
);

/** Spot checkout dialogs, keyed by type for the composition root. */
export const spotCheckoutModals: ModalComponents = {
  'spot-review': ReviewModal,
  'spot-payment-choice': PaymentChoiceModal,
  'spot-credit-confirm': CreditConfirmModal,
  'spot-purchase-complete': CompleteModal,
};
