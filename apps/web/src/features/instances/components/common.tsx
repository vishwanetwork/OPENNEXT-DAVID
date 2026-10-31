'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useSessionStore } from '@/lib/session-store';
import { useApp } from '@/components/providers/app-context';
import { useTerminalSlots, useWorkspaceStore } from '@/terminal-kit';
import type { Lifecycle } from '../lifecycle';
import { previewScope, usePreviewStore } from '../preview';
import { AsyncButton } from '@/components/ui/async-feedback';

/**
 * Re-renders every second (legacy `syncModal` 1 s refresh) so lifecycle labels stay current,
 * and immediately after a local preview change.
 */
export function useTick(ms = 1000): number {
  const [now, setTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), ms);
    const unsubscribe = usePreviewStore.subscribe(() => setTick(Date.now()));
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [ms]);
  return now;
}

export function usePreviewScope() {
  const user = useSessionStore((s) => s.user);
  const identity = useWorkspaceStore((s) => s.identity);
  const role = useWorkspaceStore((s) => s.role);
  const { demo } = useApp();
  return {
    scope: previewScope(user?.id || identity.id || identity.email, role),
    demo: demo || Boolean(user?.demo),
    role,
  };
}

export const StatusTagLive = ({ life }: { life: Lifecycle }) => (
  <span
    className={`tag instance-status instance-status-${life.ended ? 'end' : life.connecting ? 'connecting' : life.running ? 'running' : 'unknown'}`}
    data-instance-status
  >
    {life.label}
  </span>
);

export function IBtn({
  act,
  id = '',
  disabled,
  title,
  children,
  onClick,
  example,
  busy,
  busyLabel,
  onPointerEnter,
  onFocus,
}: {
  act: string;
  id?: string;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
  onClick?: () => void;
  example?: boolean;
  busy?: boolean;
  busyLabel?: string;
  onPointerEnter?: () => void;
  onFocus?: () => void;
}) {
  return (
    <AsyncButton
      className="btn secondary small"
      type="button"
      data-act={act}
      data-id={id}
      data-example={example ? 'true' : undefined}
      disabled={disabled}
      busy={busy}
      busyLabel={busyLabel}
      onPointerEnter={onPointerEnter}
      onFocus={onFocus}
      title={title}
      onClick={onClick}
    >
      {children}
    </AsyncButton>
  );
}

/** SSH public-key library, supplied by the composition root (owned by the account feature). */
export function SshLibrary({ scope }: { scope: 'instances' | 'instance-access' }) {
  const { sshLibrary } = useTerminalSlots();
  return (
    <>
      {sshLibrary ? (
        sshLibrary(scope)
      ) : (
        <p className="form-note">SSH key management is temporarily unavailable.</p>
      )}
    </>
  );
}
