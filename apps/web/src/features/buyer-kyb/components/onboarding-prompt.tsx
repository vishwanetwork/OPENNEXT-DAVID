'use client';

import { useEffect } from 'react';
import { useRegistrationIntent } from '@/features/auth';
import { useSessionStore } from '@/lib/session-store';
import { ModalFrame, useIsDemo, useOpenModal, useWorkspaceStore } from '@/terminal-kit';
import '../buyer-kyb.css';

/** First completed registration only; existing sign-ins never create this UI intent. */
export function BuyerKybOnboardingPrompt() {
  const pendingAccount = useRegistrationIntent((state) => state.buyerKybAccount);
  const clear = useRegistrationIntent((state) => state.clear);
  const user = useSessionStore((state) => state.user);
  const status = useSessionStore((state) => state.status);
  const modal = useWorkspaceStore((state) => state.modal);
  const demo = useIsDemo();
  const openModal = useOpenModal();
  const owned = Boolean(
    status === 'verified' &&
      user?.role === 'buyer' &&
      user.onboardingCompleted &&
      pendingAccount === user.id &&
      !demo,
  );
  useEffect(() => {
    if (pendingAccount && !owned) clear();
  }, [pendingAccount, owned, clear]);
  if (!owned || modal) return null;
  const dismiss = () => {
    clear();
  };
  return (
    <ModalFrame
      title="Complete your business verification"
      eyebrow="WELCOME TO OPENNEXT"
      close={dismiss}
    >
      <div className="buyer-kyb">
        <p className="buyer-kyb-intro">
          Complete KYB to add credit and purchase capacity. You can explore Terminal first and
          return to business verification from your Profile.
        </p>
        <div className="modal-footer">
          <button type="button" className="btn secondary" onClick={dismiss}>
            Skip for now
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              dismiss();
              openModal('buyer-kyb', {});
            }}
          >
            Complete KYB
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}
