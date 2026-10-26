'use client';

import '../console.css';
import '../operations.css';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, type ReactNode } from 'react';
import { useApp } from '@/components/providers/app-context';
import { useToast } from '@/components/ui/toast';
import { pageFromPath, pagePath } from '../pages';
import { useConsoleStore } from '../store';
import { detailPage, useDetailRequestStore, type DetailRequest } from '../detail-request';
import { OverlayProvider, useOverlay } from './overlay';
import { LegacyHashRedirect } from './legacy-hash-redirect';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

function useCurrentPage(): string {
  const pathname = usePathname();
  const { base } = useApp();
  const relative = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  return pageFromPath(relative);
}

/** Navigation helper mirroring legacy `nav()`: closes overlays, resets paging and scrolls to top. */
export function useConsoleNav() {
  const router = useRouter();
  const { href } = useApp();
  const { close } = useOverlay();
  const setUi = useConsoleStore((s) => s.setUi);
  return useCallback(
    (page: string) => {
      close();
      setUi({ pageNumber: 1 });
      router.push(href(pagePath(page)));
      window.scrollTo({ top: 0, behavior: 'instant' });
    },
    [close, setUi, router, href],
  );
}

/** Opens a user / order / instance drawer on its page (see ../detail-request.ts). */
export function useDetailRequest() {
  const nav = useConsoleNav();
  const request = useDetailRequestStore((s) => s.request);
  return useCallback(
    (next: DetailRequest) => {
      request(next);
      nav(detailPage(next.kind));
    },
    [nav, request],
  );
}

function StorageWarning() {
  const error = useConsoleStore((s) => s.storageError);
  const toast = useToast();
  useEffect(() => {
    if (error) toast(error);
  }, [error, toast]);
  return null;
}

function Hydrate() {
  const hydrate = useConsoleStore((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);
  return null;
}

export function ConsoleShell({ children }: { children: ReactNode }) {
  return (
    <OverlayProvider>
      <ShellLayout>{children}</ShellLayout>
    </OverlayProvider>
  );
}

function ShellLayout({ children }: { children: ReactNode }) {
  const page = useCurrentPage();
  return (
    <div id="admin-app" className="app-console">
      <Hydrate />
      <StorageWarning />
      <LegacyHashRedirect />
      <div className="app-layout">
        <Sidebar page={page} />
        <div className="workspace">
          <Topbar page={page} />
          <main className="page">{children}</main>
        </div>
      </div>
    </div>
  );
}
