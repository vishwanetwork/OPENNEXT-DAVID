'use client';

import type { ReactNode } from 'react';
import { Arrow } from '@/components/icons';
import { useSiteActions } from './site-actions';
import type { PublicRole, PublicTarget } from '../lib/workspace-links';

/** `cta()` from the legacy landing: a workspace button with target / mode / role hints. */
export function WorkspaceCta({
  children,
  target = 'models',
  style = 'primary',
  mode = '',
  role = '',
  className = '',
}: {
  children: ReactNode;
  target?: PublicTarget;
  style?: 'primary' | 'outline' | 'text';
  mode?: string;
  role?: PublicRole | '';
  className?: string;
}) {
  const { openWorkspace } = useSiteActions();
  return (
    <button
      type="button"
      className={['on-button', `on-button-${style}`, className].filter(Boolean).join(' ')}
      data-public-action="open-workspace"
      data-target={target}
      data-mode={mode || undefined}
      data-preferred-role={role || undefined}
      onClick={() => openWorkspace({ target, preferredRole: role })}
    >
      {children}
      {style === 'text' ? <Arrow /> : null}
    </button>
  );
}
