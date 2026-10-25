import { create } from 'zustand';
import { emptyChoice, type ChoiceState } from './regional-history';

interface HistoryChoicesState {
  map: Record<string, ChoiceState>;
  commit: (key: string, state: ChoiceState) => void;
  update: (key: string, patch: Partial<ChoiceState>) => void;
}

/** Remembered chart choices per selection key, shared by every chart instance (legacy module map). */
export const useHistoryChoices = create<HistoryChoicesState>((set, get) => ({
  map: {},
  commit: (key, state) => set({ map: { ...get().map, [key]: state } }),
  update: (key, patch) =>
    set({ map: { ...get().map, [key]: { ...(get().map[key] || emptyChoice()), ...patch } } }),
}));

export const choiceStateFor = (key: string): ChoiceState =>
  useHistoryChoices.getState().map[key] || emptyChoice();
