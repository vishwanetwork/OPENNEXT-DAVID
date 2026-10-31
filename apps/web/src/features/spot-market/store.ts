import { create } from 'zustand';
import {
  emptySelected,
  SORTS,
  TERMS,
  type GroupKey,
  type MarketTerm,
  type Selected,
  type SortKey,
  type SpotRow,
} from './inventory';

export interface SpotMarketUi {
  term: MarketTerm;
  view: 'list' | 'cards';
  sort: SortKey;
  showFilters: boolean;
  page: number;
  selected: Selected;
  /** Explicitly empty groups; an empty selected array otherwise means unrestricted. */
  emptyGroups: GroupKey[];
  search: Record<'model' | 'country', string>;
  openGroups: string[];
  maxPrice: number | null;
  /** Rows injected by tests/tools (legacy `setInventory`); `null` = live inventory. */
  injected: SpotRow[] | null;
}

interface SpotMarketActions {
  setTerm: (term: string) => void;
  setView: (view: 'list' | 'cards') => void;
  setSort: (sort: string) => void;
  toggleFilters: () => void;
  movePage: (delta: number) => void;
  setPage: (page: number) => void;
  toggleOption: (key: GroupKey, value: string, checked: boolean, options: string[]) => void;
  selectGroup: (key: GroupKey, values: string[]) => void;
  clearGroup: (key: GroupKey) => void;
  setSearch: (key: 'model' | 'country', value: string) => void;
  setGroupOpen: (key: string, open: boolean) => void;
  setMaxPrice: (value: number | null) => void;
  reset: () => void;
  setSelected: (selected: Selected) => void;
  setInjected: (rows: SpotRow[] | null) => void;
}

const initialUi = (): SpotMarketUi => ({
  term: 'Spot',
  view: 'list',
  sort: 'recent',
  showFilters:
    typeof window === 'undefined' ||
    typeof window.innerWidth !== 'number' ||
    window.innerWidth > 650,
  page: 0,
  selected: emptySelected(),
  emptyGroups: [],
  search: { model: '', country: '' },
  openGroups: ['model'],
  maxPrice: null,
  injected: null,
});

const canonical = (value: string): MarketTerm =>
  (TERMS as readonly string[]).includes(value) ? (value as MarketTerm) : 'Spot';

/** Spot market page state. Module-level like the legacy `state` object, so it survives navigation. */
export const useSpotMarketStore = create<SpotMarketUi & SpotMarketActions>((set, get) => ({
  ...initialUi(),
  setTerm: (term) => set({ term: canonical(term), maxPrice: null, page: 0 }),
  setView: (view) => set({ view: view === 'cards' ? 'cards' : 'list', page: 0 }),
  setSort: (sort) =>
    set({ sort: SORTS.some(([value]) => value === sort) ? (sort as SortKey) : 'recent', page: 0 }),
  toggleFilters: () => set({ showFilters: !get().showFilters }),
  movePage: (delta) => set({ page: get().page + delta }),
  setPage: (page) => set({ page }),
  toggleOption: (key, value, checked, options) => {
    const state = get();
    const current =
      !state.selected[key].length && !state.emptyGroups.includes(key)
        ? options
        : state.selected[key];
    const next = checked
      ? [...new Set([...current, value])]
      : current.filter((item) => item !== value);
    if (options.length > 0 && options.every((option) => next.includes(option))) {
      state.clearGroup(key);
    } else {
      state.selectGroup(key, next);
    }
  },
  selectGroup: (key, values) =>
    set({
      selected: { ...get().selected, [key]: [...new Set(values)] },
      emptyGroups: values.length
        ? get().emptyGroups.filter((group) => group !== key)
        : [...new Set([...get().emptyGroups, key])],
      page: 0,
    }),
  clearGroup: (key) =>
    set({
      selected: { ...get().selected, [key]: [] },
      emptyGroups: get().emptyGroups.filter((group) => group !== key),
      page: 0,
    }),
  setSearch: (key, value) => set({ search: { ...get().search, [key]: value } }),
  setGroupOpen: (key, open) =>
    set({
      openGroups: open
        ? [...new Set([...get().openGroups, key])]
        : get().openGroups.filter((value) => value !== key),
    }),
  setMaxPrice: (value) => set({ maxPrice: value, page: 0 }),
  reset: () =>
    set({
      selected: emptySelected(),
      emptyGroups: [],
      search: { model: '', country: '' },
      maxPrice: null,
      page: 0,
    }),
  setSelected: (selected) =>
    set({ selected, emptyGroups: get().emptyGroups.filter((key) => !selected[key].length) }),
  setInjected: (rows) => set({ injected: rows, page: 0 }),
}));
