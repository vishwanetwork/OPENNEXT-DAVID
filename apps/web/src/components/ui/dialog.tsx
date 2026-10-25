'use client';

import {
  useEffect,
  useRef,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';

const FOCUSABLE =
  'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

export interface DialogBehaviorOptions {
  onClose: () => void;
  /** Escape closes the dialog (default true). */
  closeOnEscape?: boolean;
  /** Lock page scrolling while open (default true). */
  lockScroll?: boolean;
  /** Selector focused on open; defaults to the dialog element itself. */
  initialFocus?: string;
}

/**
 * The one focus policy for every dialog: focus moves inside on open, Tab cycles within,
 * Escape closes (unless disabled), focus returns to the opener on close, page scroll is locked.
 */
export function useDialogBehavior(
  ref: RefObject<HTMLElement | null>,
  { onClose, closeOnEscape = true, lockScroll = true, initialFocus }: DialogBehaviorOptions,
) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    requestAnimationFrame(() => {
      if (!node.isConnected || node.contains(document.activeElement)) return;
      const target = initialFocus ? node.querySelector<HTMLElement>(initialFocus) : null;
      (target ?? node).focus({ preventScroll: true });
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (closeOnEscape) onClose();
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
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === node)
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    node.addEventListener('keydown', onKey);
    if (lockScroll) document.body.style.overflow = 'hidden';
    return () => {
      node.removeEventListener('keydown', onKey);
      if (lockScroll) document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [ref, onClose, closeOnEscape, lockScroll, initialFocus]);
}

export interface DialogProps extends Omit<DialogBehaviorOptions, 'onClose'> {
  onClose: () => void;
  /** Backdrop element class (the legacy `.overlay`, `.modal-backdrop`, …). */
  overlayClassName: string;
  /** Dialog box class (the legacy `.modal`, `.drawer`, …). */
  className: string;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  /** Extra attributes on the backdrop (e.g. `data-dismiss`). */
  overlayProps?: Record<string, string>;
  children: ReactNode;
}

/**
 * Overlay dialog: a backdrop that closes on outside click and a `role="dialog"` box with the
 * shared focus policy. Callers render their own header, body and footer markup.
 */
export function Dialog({
  onClose,
  overlayClassName,
  className,
  label,
  labelledBy,
  describedBy,
  overlayProps,
  closeOnEscape,
  lockScroll,
  initialFocus,
  children,
}: DialogProps) {
  const box = useRef<HTMLElement>(null);
  useDialogBehavior(box, { onClose, closeOnEscape, lockScroll, initialFocus });
  return (
    <div
      className={overlayClassName}
      {...overlayProps}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={box}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  );
}

/** Outside-click check for a native `<dialog>` (backdrop clicks land on the element itself). */
export function clickedOutside(event: MouseEvent<HTMLDialogElement>): boolean {
  const dialog = event.currentTarget;
  if (event.target !== dialog) return false;
  const box = dialog.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}

export interface NativeDialogProps {
  className: string;
  onClose: () => void;
  closeOnEscape?: boolean;
  lockScroll?: boolean;
  initialFocus?: string;
  labelledBy?: string;
  describedBy?: string;
  onSubmit?: (event: FormEvent<HTMLDialogElement>) => void;
  children: ReactNode;
}

/**
 * Native `<dialog>` opened with `showModal()`; outside clicks close it, Escape follows the
 * shared policy, focus returns to the opener. Used where the legacy markup was a `<dialog>`.
 */
export function NativeDialog({
  className,
  onClose,
  closeOnEscape = true,
  lockScroll = false,
  initialFocus,
  labelledBy,
  describedBy,
  onSubmit,
  children,
}: NativeDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || node.open) return;
    if (typeof node.showModal === 'function') {
      try {
        node.showModal();
      } catch {
        /* jsdom and old browsers: fall back to the open attribute */
        node.setAttribute('open', '');
      }
    } else node.setAttribute('open', '');
    const onCancel = (event: Event) => event.preventDefault();
    node.addEventListener('cancel', onCancel);
    return () => {
      node.removeEventListener('cancel', onCancel);
      if (node.open && typeof node.close === 'function') node.close();
      else node.removeAttribute('open');
    };
  }, []);
  useDialogBehavior(ref, { onClose, closeOnEscape, lockScroll, initialFocus });
  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onSubmit={onSubmit}
      onClick={(event) => clickedOutside(event) && onClose()}
    >
      {children}
    </dialog>
  );
}
