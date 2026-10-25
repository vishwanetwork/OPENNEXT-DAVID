import type { ReactNode } from 'react';
import { useOverlay } from '../components/overlay';
import { useConsoleStore } from '../store';

/** Shared services every console dialog builder receives. */
export interface DialogContext {
  overlay: ReturnType<typeof useOverlay>;
  toast: (message: string) => void;
  nav: (page: string) => void;
  store: typeof useConsoleStore;
  closeBtn: (label?: string) => ReactNode;
}
