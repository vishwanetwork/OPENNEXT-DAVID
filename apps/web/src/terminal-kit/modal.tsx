'use client';

import type { ComponentType, ReactNode } from 'react';
import { Dialog } from '@/components/ui/dialog';

/**
 * Terminal modal registry — typed, static and assembled once in the composition root.
 *
 * Every feature declares the modals it owns by augmenting `TerminalModalMap`
 * (key = modal type, value = payload) and exports a `ModalComponents` map. The composition root
 * merges the maps with `composeModals()`; duplicate keys are a programming error.
 *
 *   declare module '@/terminal-kit/modal' {
 *     interface TerminalModalMap { 'proc-request-details': { id: string } }
 *   }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmented by features
export interface TerminalModalMap {}

export type ModalType = keyof TerminalModalMap & string;
export type ModalPayload<K extends ModalType> = TerminalModalMap[K];
export type ModalOf<K extends ModalType> = K extends ModalType
  ? { type: K } & TerminalModalMap[K]
  : never;
export type ModalState = { [K in ModalType]: ModalOf<K> }[ModalType];

export interface ModalProps<K extends ModalType = ModalType> {
  modal: ModalOf<K>;
  close: () => void;
}
export type ModalComponent<K extends ModalType = ModalType> = ComponentType<ModalProps<K>>;
export type ModalComponents = { [K in ModalType]?: ModalComponent<K> };

/** Payload argument of `openModal`: optional when every field of the payload is optional. */
export type ModalArgs<K extends ModalType> =
  Record<string, never> extends TerminalModalMap[K]
    ? [payload?: TerminalModalMap[K]]
    : [payload: TerminalModalMap[K]];

/** Merges feature modal maps; throws on a duplicated modal type so shadowing cannot happen silently. */
export function composeModals(...maps: ModalComponents[]): ModalComponents {
  const out: Record<string, ModalComponent> = {};
  for (const map of maps)
    for (const [type, component] of Object.entries(map)) {
      if (!component) continue;
      if (out[type]) throw new Error(`Modal type "${type}" is provided by two features.`);
      out[type] = component as ModalComponent;
    }
  return out as ModalComponents;
}

/** Generic dialog frame (`.overlay > .modal`) on the shared dialog behaviour. */
export function ModalShell({
  title,
  eyebrow = 'OPENNEXT WORKSPACE',
  wide = false,
  onClose,
  children,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      onClose={onClose}
      overlayClassName="overlay"
      overlayProps={{ 'data-dismiss': 'modal' }}
      className={`modal ${wide ? 'wide' : ''}`}
      label={typeof title === 'string' ? title : undefined}
    >
      <header className="modal-head">
        <div>
          <span className="eyebrow muted">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        <button
          type="button"
          className="icon-btn"
          data-act="close-modal"
          aria-label="Close dialog"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </Dialog>
  );
}

/** Convenience for modal components that only produce title + body. */
export function ModalFrame({
  title,
  eyebrow,
  wide,
  close,
  children,
}: {
  title: ReactNode;
  eyebrow?: string;
  wide?: boolean;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <ModalShell title={title} eyebrow={eyebrow} wide={wide} onClose={close}>
      {children}
    </ModalShell>
  );
}
