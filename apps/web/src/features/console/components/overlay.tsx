'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Icon } from '../icons';

export interface OverlaySpec {
  title: ReactNode;
  subtitle?: ReactNode;
  body: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Accessible label; defaults to the title when it is a string. */
  label?: string;
}

interface OverlayApi {
  modal: (spec: OverlaySpec) => void;
  drawer: (spec: OverlaySpec) => void;
  close: () => void;
}

const OverlayContext = createContext<OverlayApi | null>(null);

/**
 * Legacy `modal()` / `drawer()` / `close()`: one overlay at a time rendered into the console root,
 * closed by Escape, the close button or a backdrop click; page scrolling is locked while open.
 */
export function OverlayProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ kind: 'modal' | 'drawer'; spec: OverlaySpec } | null>(null);
  const close = useCallback(() => setState(null), []);
  const api = useMemo<OverlayApi>(
    () => ({
      modal: (spec) => setState({ kind: 'modal', spec }),
      drawer: (spec) => setState({ kind: 'drawer', spec }),
      close,
    }),
    [close],
  );
  useEffect(() => {
    if (!state) return;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [state, close]);
  const spec = state?.spec;
  const label = spec?.label ?? (typeof spec?.title === 'string' ? spec.title : undefined);
  return (
    <OverlayContext.Provider value={api}>
      {children}
      <div id="overlay-root">
        {state && spec ? (
          <div
            className={state.kind === 'modal' ? 'modal-backdrop' : 'drawer-backdrop'}
            onMouseDown={(event) => event.target === event.currentTarget && close()}
          >
            <section
              className={state.kind === 'modal' ? `modal ${spec.wide ? 'wide' : ''}` : 'drawer'}
              role="dialog"
              aria-modal="true"
              aria-label={label}
            >
              <div className="modal-head">
                <div>
                  <div className="eyebrow">OPENNEXT OPERATIONS</div>
                  <h2>{spec.title}</h2>
                  {spec.subtitle ? <p>{spec.subtitle}</p> : null}
                </div>
                <button type="button" className="icon-button" onClick={close} aria-label="Close">
                  <Icon name="close" />
                </button>
              </div>
              <div className="modal-body">{spec.body}</div>
              {spec.footer ? <div className="modal-footer">{spec.footer}</div> : null}
            </section>
          </div>
        ) : null}
      </div>
    </OverlayContext.Provider>
  );
}

export function useOverlay(): OverlayApi {
  const value = useContext(OverlayContext);
  if (!value) throw new Error('useOverlay must be used inside <OverlayProvider>.');
  return value;
}
