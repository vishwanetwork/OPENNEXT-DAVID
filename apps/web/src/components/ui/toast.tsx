'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface ToastApi {
  toast: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Bottom toast identical to the legacy `#toast` element (2.4 s, `role="status"`). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((text: string) => {
    setMessage(text);
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 2400);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div id="toast" className={`toast${visible ? ' show' : ''}`} role="status">
        {message}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string) => void {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>.');
  return value.toast;
}
