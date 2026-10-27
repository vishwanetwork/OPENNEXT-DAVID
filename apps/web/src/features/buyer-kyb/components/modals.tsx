'use client';

import type { BuyerKybReturn } from '@/lib/buyer-kyb';
import { ModalFrame, type ModalComponent, type ModalComponents } from '@/terminal-kit';
import { BuyerKybContent } from './kyb-content';
import type { TopupReturnIntent } from '../return-intent';

declare module '@/terminal-kit/modal' {
  interface TerminalModalMap {
    'buyer-kyb': { returnTo?: BuyerKybReturn; topupReturn?: TopupReturnIntent };
  }
}

const BuyerKybModal: ModalComponent<'buyer-kyb'> = ({ modal, close }) => (
  <ModalFrame title="Business verification" eyebrow="BUYER KYB" wide close={close}>
    <BuyerKybContent returnTo={modal.returnTo} topupReturn={modal.topupReturn} />
  </ModalFrame>
);

export const buyerKybModals: ModalComponents = { 'buyer-kyb': BuyerKybModal };
