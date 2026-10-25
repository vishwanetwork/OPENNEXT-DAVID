/**
 * Browser-local example instance and demo end-states (legacy `previewState`). These only
 * describe the illustrative example card and locally ended demo allocations; they are never
 * real resources, so localStorage is acceptable here (keyed per identity and role).
 */
import type { Instance } from '@opennext/contracts';
import { create } from 'zustand';
import { lifecycle } from './lifecycle';

export interface PreviewState {
  version: 2;
  example: {
    status: 'Running' | 'Connecting' | 'End';
    createdAt: string;
    serviceEnd: string;
    endedAt?: string;
  };
  endedDemo: Record<string, string>;
}

/** In-memory mirror of the per-scope localStorage records; components subscribe to it. */
export const usePreviewStore = create<{ states: Record<string, PreviewState> }>(() => ({
  states: {},
}));

export const previewScope = (identity: string | undefined, role: string) =>
  String(identity || 'anonymous') + ':' + String(role || 'Buyer');
const keyFor = (scope: string) => 'opennext-instance-preview-v2:' + scope;

const freshExample = (): PreviewState['example'] => ({
  status: 'Running',
  createdAt: new Date().toISOString(),
  serviceEnd: new Date(Date.now() + 172800000).toISOString(),
});

export function previewState(scope: string): PreviewState {
  const key = keyFor(scope);
  let saved: PreviewState | null = usePreviewStore.getState().states[key] || null;
  if (!saved) {
    try {
      saved = JSON.parse(window.localStorage?.getItem(key) || 'null') as PreviewState | null;
    } catch {
      saved = null;
    }
  }
  let created = false;
  if (
    !saved ||
    saved.version !== 2 ||
    !saved.example ||
    !['Running', 'Connecting', 'End'].includes(saved.example.status) ||
    !Number.isFinite(Date.parse(saved.example.createdAt)) ||
    !Number.isFinite(Date.parse(saved.example.serviceEnd))
  ) {
    saved = { version: 2, example: freshExample(), endedDemo: {} };
    created = true;
  }
  if (!saved.endedDemo || typeof saved.endedDemo !== 'object' || Array.isArray(saved.endedDemo))
    saved.endedDemo = {};
  if (created) persist(scope, saved);
  else remember(key, saved);
  return saved;
}

const remember = (key: string, saved: PreviewState) => {
  if (usePreviewStore.getState().states[key] !== saved)
    usePreviewStore.setState((s) => ({ states: { ...s.states, [key]: saved } }));
};

function persist(scope: string, saved: PreviewState) {
  const next = { ...saved, example: { ...saved.example }, endedDemo: { ...saved.endedDemo } };
  try {
    window.localStorage?.setItem(keyFor(scope), JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  usePreviewStore.setState((s) => ({ states: { ...s.states, [keyFor(scope)]: next } }));
}

export function example(
  scope: string,
): Instance & { telemetry: { utilizationPercent: number | null; observedAt: string } } {
  const saved = previewState(scope).example;
  return {
    ...saved,
    id: 'INSTANCE-EXAMPLE',
    name: 'Training workspace',
    model: 'H100 SXM',
    region: 'US East',
    term: 'Spot',
    count: 8,
    rate: 2.3,
    paymentStatus: 'Example only',
    resaleAllowed: false,
    telemetry: {
      utilizationPercent: saved.status === 'Running' ? 71 : null,
      observedAt: new Date().toISOString(),
    },
  };
}

export function setExampleScenario(scope: string, value: 'reset' | 'interrupted' | 'running') {
  const saved = previewState(scope);
  if (value === 'reset') persist(scope, { ...saved, example: freshExample() });
  else if (!lifecycle(example(scope)).ended)
    persist(scope, {
      ...saved,
      example: { ...saved.example, status: value === 'interrupted' ? 'Connecting' : 'Running' },
    });
}

export function endExample(scope: string) {
  const saved = previewState(scope);
  persist(scope, {
    ...saved,
    example: { ...saved.example, status: 'End', endedAt: new Date().toISOString() },
  });
}

export function endDemo(scope: string, id: string) {
  const saved = previewState(scope);
  persist(scope, { ...saved, endedDemo: { ...saved.endedDemo, [id]: new Date().toISOString() } });
}

/** Applies a locally recorded demo end-state to a demo allocation. */
export function instanceView(i: Instance, scope: string, demoActive: boolean): Instance {
  const local = demoActive && (i.sample === true || i.demo === true || i.preview === true);
  const ends = local ? previewState(scope).endedDemo : null;
  const ended = ends && Object.prototype.hasOwnProperty.call(ends, i.id) ? ends[i.id] : null;
  return ended ? { ...i, status: 'Ended', endedAt: ended } : i;
}
export const localDemo = (i: Instance, demoActive: boolean) =>
  demoActive && (i.sample === true || i.demo === true || i.preview === true);
