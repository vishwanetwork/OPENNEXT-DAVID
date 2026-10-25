'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PublicMarketResponse } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { useApp } from '@/components/providers/app-context';
import { useToast } from '@/components/ui/toast';
import { useSessionStore } from '@/lib/session-store';
import { useTerminal } from '@/features/terminal/context';
import { useWorkspaceStore } from '@/features/terminal/store';
import { countryFor } from '@/features/market/insight-index';
import { fingerprint, validatePublicKey } from '@/features/account/ssh-keys';
import { agentInventory, inventoryState, pruneSelections, type Inventory, type SpotRow } from './inventory';
import { SpotCheckout, type CreditBalanceResult, type SpotCheckoutService } from './checkout';
import { useSpotMarketStore } from './store';

export const spotKeys = { publicMarket: ['marketplace', 'public'] as const };

/** Published marketplace supplies (GET /api/marketplace/public). */
export function usePublicMarket() {
  const api = useApi();
  return useQuery({
    queryKey: spotKeys.publicMarket,
    queryFn: async () => PublicMarketResponse.parse(await api.get('/api/marketplace/public')),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

/** Legacy `exchange.regionCountry` for inventory rows. */
export const regionCountry = (region: unknown) => countryFor(region) || (typeof region === 'string' ? region : null);

/** Current Spot market inventory: injected rows, connected marketplace rows, or Demo fixtures. */
export function useSpotInventory(): Inventory {
  const { demo } = useApp();
  const user = useSessionStore((s) => s.user);
  const market = usePublicMarket();
  const injected = useSpotMarketStore((s) => s.injected);
  return useMemo(() => {
    const agentRows = agentInventory(market.data?.supplies || [], regionCountry);
    return inventoryState({ injected, agentRows, demoActive: demo || Boolean(user?.demo) });
  }, [market.data, injected, demo, user?.demo]);
}

/** Keeps selections pruned to the available rows (legacy `pruneSelections` on render). */
export function usePrunedSelections(rows: SpotRow[]) {
  const selected = useSpotMarketStore((s) => s.selected);
  const setSelected = useSpotMarketStore((s) => s.setSelected);
  useEffect(() => {
    const pruned = pruneSelections(selected, rows);
    if (JSON.stringify(pruned) !== JSON.stringify(selected)) setSelected(pruned);
  }, [rows, selected, setSelected]);
}

/* ---------- checkout engine wiring ---------- */

let serviceOverride: SpotCheckoutService | null = null;
/** Connects the Credit purchase backend (legacy `window.OpenNEXTSpotCheckout`). */
export function registerSpotCheckoutService(service: SpotCheckoutService | null) {
  serviceOverride = service;
}

/** Mutable bindings the engine reads lazily; updated from React in an effect, never during render. */
const bindings: {
  inventory: SpotRow[];
  open: ((type: string, extra?: Record<string, unknown>) => void) | null;
  close: (() => void) | null;
  toast: ((message: string) => void) | null;
  go: ((route: string) => void) | null;
  demo: boolean;
  balanceRefresh: (() => Promise<CreditBalanceResult | null>) | null;
} = { inventory: [], open: null, close: null, toast: null, go: null, demo: false, balanceRefresh: null };
let engine: SpotCheckout | null = null;

function owner(): string | null {
  const user = useSessionStore.getState().user;
  const role = useWorkspaceStore.getState().role;
  return user?.id ? (bindings.demo || user.demo ? 'demo:' : 'account:') + user.id + ':' + role : null;
}

function getEngine(): SpotCheckout {
  if (engine) return engine;
  engine = new SpotCheckout({
    owner,
    role: () => useWorkspaceStore.getState().role,
    userId: () => useSessionStore.getState().user?.id,
    isDemo: () => bindings.demo || Boolean(useSessionStore.getState().user?.demo),
    balance: () => useWorkspaceStore.getState().balance,
    setBalance: (value) => useWorkspaceStore.getState().patch({ balance: value }),
    inventory: () => bindings.inventory,
    service: () => serviceOverride || { refreshBillingAccount: bindings.balanceRefresh || undefined },
    validateSsh: async (value) => {
      const text = String(value || '').trim();
      if (!text) return '';
      const parsed = validatePublicKey(text);
      await fingerprint(parsed);
      return parsed.publicKey;
    },
    storage: () => (typeof window === 'undefined' ? null : window.sessionStorage),
    now: () => Date.now(),
    uuid: () => crypto.randomUUID(),
    open: (type, extra) => bindings.open?.(type, extra),
    closeModal: () => bindings.close?.(),
    toast: (message) => bindings.toast?.(message),
    go: (route) => bindings.go?.(route),
  });
  engine.restoreSsh = (value) => {
    try {
      return validatePublicKey(value).publicKey;
    } catch {
      return '';
    }
  };
  return engine;
}

/** The shared checkout engine, kept in sync with the current inventory and terminal context. */
export function useSpotCheckout(inventory?: Inventory): SpotCheckout {
  const { openModal, closeModal, go } = useTerminal();
  const toast = useToast();
  const { demo } = useApp();
  const api = useApi();
  const instance = getEngine();
  useEffect(() => {
    bindings.open = openModal;
    bindings.close = closeModal;
    bindings.toast = toast;
    bindings.go = go;
    bindings.demo = demo;
    // Verified billing account; the backend confirms the account id and the available Credit.
    bindings.balanceRefresh = async () => (await api.get('/api/billing/account')) as CreditBalanceResult | null;
  }, [openModal, closeModal, toast, go, demo, api]);
  useEffect(() => {
    if (inventory) bindings.inventory = inventory.rows;
  }, [inventory]);
  useSyncExternalStore(
    (listener) => instance.subscribe(listener),
    () => instance.version,
    () => instance.version,
  );
  return instance;
}

/** Test/tool hook: replaces the inventory the engine sees without rendering the page. */
export const setCheckoutInventory = (rows: SpotRow[]) => {
  bindings.inventory = rows;
};
