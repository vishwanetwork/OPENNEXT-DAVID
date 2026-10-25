import { create } from 'zustand';

export type SettlementDays = 1 | 3 | 7 | 30 | 90;
export const SETTLEMENT_PERIODS: [number | 'all', string][] = [[1, '1D'], [3, '3D'], [7, '1W'], [30, '1M'], [90, '3M'], [180, '6M'], [365, '1Y'], ['all', 'ALL']];
export const FREE_SETTLEMENT_DAYS: SettlementDays[] = [1, 3, 7, 30, 90];

interface ProcurementUi {
  settlementDays: SettlementDays;
  rfqFilter: string;
  setSettlementDays: (days: SettlementDays) => void;
  setRfqFilter: (value: string) => void;
}

/** Page-level UI state the legacy module kept in closures / `S.rfqFilter`. */
export const useProcurementUi = create<ProcurementUi>((set) => ({
  settlementDays: 3,
  rfqFilter: 'All',
  setSettlementDays: (settlementDays) => set({ settlementDays }),
  setRfqFilter: (rfqFilter) => set({ rfqFilter }),
}));
