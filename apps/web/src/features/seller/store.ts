import { create } from 'zustand';
import {
  ACTIVITY_SHOW_OPTIONS,
  emptySelected,
  GROUPING_STEPS,
  PANELS,
  RANGES,
  TERMS,
  allowedActivityLimit,
  type GroupKey,
  type GroupingStep,
  type InsightTerm,
  type Panel,
  type Selected,
  type Settlement,
} from './settlements';

export interface SellerUi {
  term: InsightTerm;
  showFilters: boolean;
  selected: Selected;
  tradeModel: string | null;
  search: Record<'model' | 'tradeModel' | 'country', string>;
  openGroups: string[];
  groupingStepCents: GroupingStep;
  activityShow: number;
  range: string;
  panels: Panel[];
  modal: 'range-gate' | 'history' | null;
  requestedRange: string | null;
  injected: Settlement[] | null;
}
interface SellerActions {
  setTerm: (term: string) => void;
  toggleFilters: () => void;
  toggleOption: (key: GroupKey, value: string, checked: boolean) => void;
  clearGroup: (key: GroupKey) => void;
  setSelected: (selected: Selected) => void;
  setTradeModel: (model: string | null) => void;
  setSearch: (key: 'model' | 'tradeModel' | 'country', value: string) => void;
  setGroupOpen: (key: string, open: boolean) => void;
  setStep: (step: number) => void;
  setActivityShow: (value: unknown) => boolean;
  requestRange: (key: string) => void;
  togglePanel: (panel: Panel) => void;
  openHistory: () => void;
  closeHistory: () => void;
  clear: () => void;
  setInjected: (rows: Settlement[] | null) => void;
}

const initial = (): SellerUi => ({
  term: 'All',
  showFilters:
    typeof window === 'undefined' ||
    typeof window.innerWidth !== 'number' ||
    window.innerWidth > 650,
  selected: emptySelected(),
  tradeModel: null,
  search: { model: '', tradeModel: '', country: '' },
  openGroups: ['model', 'tradeModel'],
  groupingStepCents: 10,
  activityShow: ACTIVITY_SHOW_OPTIONS[0],
  range: '7D',
  panels: [...PANELS],
  modal: null,
  requestedRange: null,
  injected: null,
});

/** Market Insight page state (module-level like the legacy `state`). */
export const useSellerStore = create<SellerUi & SellerActions>((set, get) => ({
  ...initial(),
  setTerm: (term) =>
    set({ term: (TERMS as readonly string[]).includes(term) ? (term as InsightTerm) : 'All' }),
  toggleFilters: () => set({ showFilters: !get().showFilters }),
  toggleOption: (key, value, checked) => {
    const current = get().selected[key];
    set({
      selected: {
        ...get().selected,
        [key]: checked
          ? [...new Set([...current, value])]
          : current.filter((item) => item !== value),
      },
    });
  },
  clearGroup: (key) => set({ selected: { ...get().selected, [key]: [] } }),
  setSelected: (selected) => set({ selected }),
  setTradeModel: (tradeModel) => set({ tradeModel }),
  setSearch: (key, value) => set({ search: { ...get().search, [key]: value } }),
  setGroupOpen: (key, open) =>
    set({
      openGroups: open
        ? [...new Set([...get().openGroups, key])]
        : get().openGroups.filter((value) => value !== key),
    }),
  setStep: (step) => {
    if ((GROUPING_STEPS as readonly number[]).includes(step))
      set({ groupingStepCents: step as GroupingStep });
  },
  setActivityShow: (value) => {
    const limit = allowedActivityLimit(value);
    if (limit === null) return false;
    set({ activityShow: limit });
    return true;
  },
  requestRange: (key) => {
    const range = RANGES.find((item) => item.key === key);
    if (!range) return;
    if (range.gated) set({ requestedRange: range.key, modal: 'range-gate' });
    else set({ range: range.key });
  },
  togglePanel: (panel) => {
    const { panels } = get();
    const active = panels.includes(panel);
    if (active && panels.length === 1) return;
    set({
      panels: active
        ? panels.filter((value) => value !== panel)
        : PANELS.filter((value) => panels.includes(value) || value === panel),
    });
  },
  openHistory: () => set({ modal: 'history' }),
  closeHistory: () => set({ modal: null, requestedRange: null }),
  clear: () =>
    set({
      term: 'All',
      selected: emptySelected(),
      search: { model: '', tradeModel: '', country: '' },
    }),
  setInjected: (rows) => set({ injected: rows }),
}));
