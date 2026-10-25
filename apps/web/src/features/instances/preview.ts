/**
 * Browser-local example instance and demo end-states (legacy `previewState`). These only
 * describe the illustrative example card and locally ended demo allocations; they are never
 * real resources, so localStorage is acceptable here (keyed per identity and role).
 */
import type { Instance } from '@opennext/contracts';
import { lifecycle } from './lifecycle';

export interface PreviewState {
  version: 2;
  example: { status: 'Running' | 'Connecting' | 'End'; createdAt: string; serviceEnd: string; endedAt?: string };
  endedDemo: Record<string, string>;
}

const memory = new Map<string, PreviewState>();
const listeners = new Set<() => void>();
export const subscribePreview = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const notify = () => listeners.forEach((fn) => fn());

export const previewScope = (identity: string | undefined, role: string) => String(identity || 'anonymous') + ':' + String(role || 'Buyer');
const keyFor = (scope: string) => 'opennext-instance-preview-v2:' + scope;

const freshExample = (): PreviewState['example'] => ({ status: 'Running', createdAt: new Date().toISOString(), serviceEnd: new Date(Date.now() + 172800000).toISOString() });

export function previewState(scope: string): PreviewState {
  const key = keyFor(scope);
  let saved = memory.get(key) || null;
  if (!saved) {
    try {
      saved = JSON.parse(window.localStorage?.getItem(key) || 'null') as PreviewState | null;
    } catch {
      saved = null;
    }
  }
  let created = false;
  if (!saved || saved.version !== 2 || !saved.example || !['Running', 'Connecting', 'End'].includes(saved.example.status) || !Number.isFinite(Date.parse(saved.example.createdAt)) || !Number.isFinite(Date.parse(saved.example.serviceEnd))) {
    saved = { version: 2, example: freshExample(), endedDemo: {} };
    created = true;
  }
  if (!saved.endedDemo || typeof saved.endedDemo !== 'object' || Array.isArray(saved.endedDemo)) saved.endedDemo = {};
  memory.set(key, saved);
  if (created) persist(scope, saved);
  return saved;
}

function persist(scope: string, saved: PreviewState) {
  memory.set(keyFor(scope), saved);
  try {
    window.localStorage?.setItem(keyFor(scope), JSON.stringify(saved));
  } catch {
    /* storage unavailable */
  }
  notify();
}

export function example(scope: string): Instance & { telemetry: { utilizationPercent: number | null; observedAt: string } } {
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
    telemetry: { utilizationPercent: saved.status === 'Running' ? 71 : null, observedAt: new Date().toISOString() },
  };
}

export function setExampleScenario(scope: string, value: 'reset' | 'interrupted' | 'running') {
  const saved = previewState(scope);
  if (value === 'reset') saved.example = freshExample();
  else if (!lifecycle(example(scope)).ended) saved.example.status = value === 'interrupted' ? 'Connecting' : 'Running';
  persist(scope, saved);
}

export function endExample(scope: string) {
  const saved = previewState(scope);
  saved.example.status = 'End';
  saved.example.endedAt = new Date().toISOString();
  persist(scope, saved);
}

export function endDemo(scope: string, id: string) {
  const saved = previewState(scope);
  saved.endedDemo[id] = new Date().toISOString();
  persist(scope, saved);
}

/** Applies a locally recorded demo end-state to a demo allocation. */
export function instanceView(i: Instance, scope: string, demoActive: boolean): Instance {
  const local = demoActive && (i.sample === true || i.demo === true || i.preview === true);
  const ends = local ? previewState(scope).endedDemo : null;
  const ended = ends && Object.prototype.hasOwnProperty.call(ends, i.id) ? ends[i.id] : null;
  return ended ? { ...i, status: 'Ended', endedAt: ended } : i;
}
export const localDemo = (i: Instance, demoActive: boolean) => demoActive && (i.sample === true || i.demo === true || i.preview === true);
