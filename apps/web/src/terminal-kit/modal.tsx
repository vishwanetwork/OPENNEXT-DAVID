'use client';

import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';

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
export type ModalArgs<K extends ModalType> = Record<string, never> extends TerminalModalMap[K]
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

const FOCUSABLE =
  'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

/** Generic dialog frame (`.overlay > .modal`) with focus trap, Escape and focus restore. */
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
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const previous = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      if (node.isConnected && !node.contains(document.activeElement))
        node.focus({ preventScroll: true });
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (item) => item.getClientRects().length,
      );
      if (!items.length) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === node)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    node.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      node.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <div
      className="overlay"
      data-dismiss="modal"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialog}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
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
      </section>
    </div>
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
