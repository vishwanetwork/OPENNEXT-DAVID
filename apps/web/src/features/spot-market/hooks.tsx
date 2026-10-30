'use client';

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import type { BillingAccount } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { useToast } from '@/components/ui/toast';
import type { ApiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import { useSessionStore } from '@/lib/session-store';
import {
  useAccountIdentity,
  useBalance,
  useInvalidateWorkspace,
  useIsDemo,
  usePublicMarket,
  useRefreshBillingAccount,
  useTerminal,
  useTerminalSlots,
  useWorkspaceStore,
  type ModalArgs,
  type ModalType,
  type PurchaseContext,
} from '@/terminal-kit';
import { countryFor } from '@/features/market';
import { fingerprint, validatePublicKey } from '@/features/account';
import { useBuyerKyb } from '@/features/buyer-kyb';
import { useStartBankTransfer } from '@/features/bank-transfer';
import {
  agentInventory,
  inventoryState,
  pruneSelections,
  type Inventory,
  type SpotRow,
} from './inventory';
import { SpotCheckout } from './checkout';
import { spotMarketApi } from './api';
import { useSpotMarketStore } from './store';

export { usePublicMarket };

/** Legacy `exchange.regionCountry` for inventory rows. */
export const regionCountry = (region: unknown) =>
  countryFor(region) || (typeof region === 'string' ? region : null);

/** Current Spot market inventory: injected rows, connected marketplace rows, or Demo fixtures. */
export function useSpotInventory(): Inventory {
  const demo = useIsDemo();
  const market = usePublicMarket();
  const injected = useSpotMarketStore((s) => s.injected);
  return useMemo(() => {
    const agentRows = agentInventory(market.data?.supplies || [], regionCountry);
    return inventoryState({ injected, agentRows, demoActive: demo });
  }, [market.data, injected, demo]);
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

/* ---------- checkout engine ---------- */

interface EngineContextValue {
  engine: SpotCheckout;
  setInventory: (rows: SpotRow[]) => void;
}
const EngineContext = createContext<EngineContextValue | null>(null);

interface LatestDeps {
  openModal: ReturnType<typeof useTerminal>['openModal'];
  closeModal: () => void;
  go: (route: string) => void;
  toast: (message: string) => void;
  demo: boolean;
  services: ReturnType<typeof useTerminalSlots>['services'];
  balance: ReturnType<typeof useBalance>;
  user: ReturnType<typeof useSessionStore.getState>['user'];
  role: ReturnType<typeof useWorkspaceStore.getState>['role'];
  identity: string;
  refreshBilling: ReturnType<typeof useRefreshBillingAccount>;
  api: ApiClient;
  invalidateWorkspace: ReturnType<typeof useInvalidateWorkspace>;
  verifyKyb: () => Promise<boolean>;
  beginBankTransfer: ReturnType<typeof useStartBankTransfer>['start'];
}

interface EngineState {
  /** The mounted engine, readable outside the provider tree (composition root, purchase context). */
  engine: SpotCheckout | null;
  /** Latest React values the engine reads lazily at event time. */
  deps: LatestDeps | null;
  inventory: SpotRow[];
}
export const useSpotEngineStore = create<EngineState>(() => ({
  engine: null,
  deps: null,
  inventory: [],
}));

const deps = (): LatestDeps => {
  const current = useSpotEngineStore.getState().deps;
  if (!current) throw new Error('The Spot checkout engine is not mounted.');
  return current;
};

/** Builds the engine outside React; every dependency is read from the engine store when used. */
function buildEngine(client: QueryClient): SpotCheckout {
  const engine = new SpotCheckout({
    owner: () => {
      const { user, demo, role } = deps();
      return user?.id ? (demo || user.demo ? 'demo:' : 'account:') + user.id + ':' + role : null;
    },
    role: () => deps().role,
    userId: () => deps().user?.id,
    isDemo: () => deps().demo || Boolean(deps().user?.demo),
    balance: () => deps().balance.available,
    setBalance: (value) => {
      const key = queryKeys.account.billing(deps().identity);
      client.setQueryData<BillingAccount>(key, (prev) =>
        prev ? { ...prev, availableCredit: value } : prev,
      );
    },
    inventory: () => useSpotEngineStore.getState().inventory,
    // Purchases go to the backend's Spot purchase endpoint unless the host injects a service.
    service: () => ({
      refreshBillingAccount: () => deps().refreshBilling(),
      beginPurchase: async (input) => {
        const result = await spotMarketApi.purchase(deps().api, input);
        void deps().invalidateWorkspace();
        return result;
      },
      ...deps().services.spotCheckout,
    }),
    verifyKyb: () => deps().verifyKyb(),
    beginBankTransfer: (input) => deps().beginBankTransfer(input),
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
    open: (type, extra) =>
      deps().openModal(type as ModalType, ...([extra] as unknown as ModalArgs<ModalType>)),
    closeModal: () => deps().closeModal(),
    toast: (message) => deps().toast(message),
    go: (route) => deps().go(route),
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

const setInventory = (rows: SpotRow[]) => useSpotEngineStore.setState({ inventory: rows });

/**
 * Creates the Credit purchase engine for the mounted terminal and publishes the latest React
 * values to the engine store after every render, so the engine never holds stale values.
 */
export function SpotCheckoutProvider({ children }: { children: ReactNode }) {
  const { openModal, closeModal, go } = useTerminal();
  const toast = useToast();
  const demo = useIsDemo();
  const { services } = useTerminalSlots();
  const balance = useBalance();
  const user = useSessionStore((s) => s.user);
  const role = useWorkspaceStore((s) => s.role);
  const identity = useAccountIdentity();
  const refreshBilling = useRefreshBillingAccount();
  const api = useApi();
  const invalidateWorkspace = useInvalidateWorkspace();
  const { refreshApproved: verifyKyb } = useBuyerKyb();
  const bankTransfer = useStartBankTransfer();
  const client = useQueryClient();
  const snapshot: LatestDeps = {
    openModal,
    closeModal,
    go,
    toast,
    demo,
    services,
    balance,
    user,
    role,
    identity,
    refreshBilling,
    api,
    invalidateWorkspace,
    verifyKyb,
    beginBankTransfer: bankTransfer.start,
  };
  const value = useMemo<EngineContextValue>(() => {
    // First publication happens before the children render; later renders update it below.
    useSpotEngineStore.setState({ deps: snapshot });
    return { engine: buildEngine(client), setInventory };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the engine is created once per client
  }, [client]);
  useLayoutEffect(() => {
    useSpotEngineStore.setState({ deps: snapshot });
  });
  useEffect(() => {
    useSpotEngineStore.setState({ engine: value.engine });
    return () => useSpotEngineStore.setState({ engine: null, deps: null, inventory: [] });
  }, [value]);
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

/** The shared checkout engine, kept in sync with the current inventory. */
export function useSpotCheckout(inventory?: Inventory): SpotCheckout {
  const context = useContext(EngineContext);
  if (!context) throw new Error('useSpotCheckout must be used inside <SpotCheckoutProvider>.');
  const { engine, setInventory } = context;
  useEffect(() => {
    if (inventory) setInventory(inventory.rows);
  }, [inventory, setInventory]);
  useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.version,
    () => engine.version,
  );
  return engine;
}

/** Purchase waiting for credit, for the billing top-up dialogs (composition root wiring). */
export function useSpotPurchaseContext(): PurchaseContext {
  const engine = useSpotEngineStore((s) => s.engine);
  return useMemo(
    () => ({
      hasPending: () => Boolean(engine?.hasPending()),
      reference: () => engine?.purchaseReference() || '',
      resume: () => {
        engine?.resumeCheckout();
      },
    }),
    [engine],
  );
}
