import { create } from 'zustand';
import { defaultBillingUi, type BillingUi } from './analytics';

interface BillingUiStore extends BillingUi {
  patch: (partial: Partial<BillingUi>) => void;
  toggleSeries: (key: string, allowed: string[]) => void;
}

/** Legacy `S.billingUI`: date range, chart type, example toggle and hidden series. */
export const useBillingUi = create<BillingUiStore>((set, get) => ({
  ...defaultBillingUi(),
  patch: (partial) => set(partial),
  toggleSeries: (key, allowed) => {
    if (!allowed.includes(key)) return;
    const hidden = get().hidden;
    set({ hidden: hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key] });
  },
}));
