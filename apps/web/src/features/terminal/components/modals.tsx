'use client';

import { type Offer } from '@/features/market';
import {
  ModalFrame,
  useTerminal,
  useTerminalSlots,
  useWorkspaceStore,
  EmptyState,
  type ModalComponents,
  type ModalComponent,
  type ModalType,
} from '@/terminal-kit';
import { getModelQuote, listModelQuotes } from '@/data';
import { ModelRateSummary } from './models-page';
import { HistoryAccessModal, InfoModal, SourcesModal } from './info-modals';
import { CompareModal, DetailModal } from './detail-modals';

declare module '@/terminal-kit/modal' {
  interface TerminalModalMap {
    'history-access': Record<string, never>;
    sources: Record<string, never>;
    info: { info?: 'contact' | 'privacy' };
    detail: { offer?: Offer; id?: string };
    compare: Record<string, never>;
    'model-rfq-form': { sku?: string };
  }
}

/** Renders the active modal through the component map assembled by the composition root. */
export function TerminalModal() {
  const modal = useWorkspaceStore((s) => s.modal);
  const { closeModal } = useTerminal();
  const { modals } = useTerminalSlots();
  if (!modal) return null;
  const Component = modals[modal.type] as ModalComponent<ModalType> | undefined;
  if (!Component) return null;
  return <Component key={modal.type} modal={modal} close={closeModal} />;
}

const ModelRfqFormModal: ModalComponent<'model-rfq-form'> = ({ modal, close }) => {
  const q = getModelQuote(modal.sku) || listModelQuotes()[0];
  return (
    <ModalFrame title="Request model capacity" wide eyebrow="MODEL CAPACITY REQUEST" close={close}>
      {q ? (
        <>
          <ModelRateSummary q={q} />
          <p>Model request submission is currently unavailable. Please refresh.</p>
        </>
      ) : (
        <EmptyState title="Model quotes are not available">
          Close this window and try again when supplier quotes have loaded.
        </EmptyState>
      )}
    </ModalFrame>
  );
};

/** Modals owned by the terminal core (market methodology, details, comparison, info). */
export const terminalModals: ModalComponents = {
  'model-rfq-form': ModelRfqFormModal,
  'history-access': HistoryAccessModal,
  sources: SourcesModal,
  info: InfoModal,
  detail: DetailModal,
  compare: CompareModal,
};
