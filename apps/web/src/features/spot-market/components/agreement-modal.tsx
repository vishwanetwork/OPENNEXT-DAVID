'use client';

import { useToast } from '@/components/ui/toast';
import { AgreementReview } from '@/features/agreements';
import type { AgreementPaymentMethod } from '@/lib/spot-agreement';
import { ModalFrame, type ModalComponent } from '@/terminal-kit';
import { useSpotCheckout } from '../hooks';

declare module '@/terminal-kit/modal' {
  interface TerminalModalMap {
    'spot-agreement': { method: AgreementPaymentMethod };
  }
}

export const AgreementModal: ModalComponent<'spot-agreement'> = ({ modal, close }) => {
  const checkout = useSpotCheckout();
  const toast = useToast();
  let context;
  try {
    context = checkout.agreementContext(modal.method);
  } catch {
    return (
      <ModalFrame title="Purchase unavailable" close={close}>
        <p>The offer or account changed. Return to the market to review a current offer.</p>
      </ModalFrame>
    );
  }
  const back = () => {
    close();
    checkout.action('spot-checkout-payment');
  };
  return (
    <ModalFrame title="Review & sign agreement" eyebrow="SPOT COMPUTE" wide close={back}>
      <AgreementReview
        context={context}
        onCancel={back}
        onSigned={(receipt) => {
          try {
            checkout.recordAgreement(receipt);
            close();
            if (modal.method === 'credit') void checkout.chooseCredit();
            else void checkout.chooseDirect();
          } catch (cause) {
            toast(cause instanceof Error ? cause.message : 'Review the purchase again.');
          }
        }}
      />
    </ModalFrame>
  );
};
