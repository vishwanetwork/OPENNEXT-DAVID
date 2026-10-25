'use client';

import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';

/**
 * `<dialog>` wrapper matching the legacy server-backed console pages (price sources, leads,
 * top-ups, marketplace inbox): opened with showModal(), closed by its close button or a click
 * outside the dialog box. Escape is swallowed so the console shell does not react to it.
 */
export function NativeDialog({
  className,
  labelledBy,
  onClose,
  onSubmit,
  children,
}: {
  className: string;
  labelledBy?: string;
  onClose: () => void;
  onSubmit?: (event: FormEvent<HTMLDialogElement>) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!node.open) {
      if (typeof node.showModal === 'function') {
        try {
          node.showModal();
        } catch {
          node.setAttribute('open', '');
        }
      } else node.setAttribute('open', '');
    }
    const onCancel = (event: Event) => {
      event.preventDefault();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') event.stopPropagation();
    };
    node.addEventListener('cancel', onCancel);
    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('cancel', onCancel);
      node.removeEventListener('keydown', onKey);
      if (node.open && typeof node.close === 'function') node.close();
      else node.removeAttribute('open');
      previous?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={labelledBy}
      onSubmit={onSubmit}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const r = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom
        )
          onClose();
      }}
    >
      {children}
    </dialog>
  );
}
