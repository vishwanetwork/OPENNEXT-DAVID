import { create } from 'zustand';
import type { PriceMetric } from './catalog';

export interface InsightSession {
  model: string;
  term: string;
  metrics: PriceMetric[];
}

interface InsightSessionsState {
  map: Record<string, InsightSession>;
  update: (key: string, patch: Partial<InsightSession>) => void;
}

const DEFAULT: InsightSession = { model: 'H100', term: 'Spot', metrics: ['avg'] };

/** Index model/term/metrics remembered per account + role (legacy `sessions` map). */
export const useInsightSessions = create<InsightSessionsState>((set, get) => ({
  map: {},
  update: (key, patch) => set({ map: { ...get().map, [key]: { ...(get().map[key] || DEFAULT), ...patch } } }),
}));

export const insightSessionFor = (map: Record<string, InsightSession>, key: string): InsightSession => map[key] || DEFAULT;
