'use client';

import { create } from 'zustand';
import type { SessionUser } from '@opennext/contracts';

/** A one-shot navigation prompt, not a registration or verification record. Never persisted. */
export const useRegistrationIntent = create<{
  buyerKybAccount: string;
  completed: (before: SessionUser, after: SessionUser) => void;
  clear: () => void;
}>((set) => ({
  buyerKybAccount: '',
  completed: (before, after) => {
    if (
      !before.onboardingCompleted &&
      before.id === after.id &&
      after.onboardingCompleted &&
      after.role === 'buyer' &&
      !after.demo
    )
      set({ buyerKybAccount: after.id });
  },
  clear: () => set({ buyerKybAccount: '' }),
}));
