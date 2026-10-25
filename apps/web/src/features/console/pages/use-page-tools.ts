'use client';

import { useCallback, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { useConsoleStore } from '../store';
import { download, stamp, toCsv } from '../helpers';
import { CONSOLE_PAGES, type ConsolePage } from '../pages';

/** Search box state plus the legacy `refresh` and `export` toolbar actions. */
export function usePageTools(page: ConsolePage) {
  const [search, setSearch] = useState('');
  const toast = useToast();
  const refresh = useCallback(() => {
    const { record, setUi } = useConsoleStore.getState();
    setUi({ lastRefresh: stamp() });
    record('Workspace view refreshed', CONSOLE_PAGES[page], 'Local records reloaded.');
    toast('Workspace records refreshed.');
  }, [page, toast]);
  const exportRows = useCallback(
    (rows: object[]) => {
      if (!rows.length) {
        toast('There are no records to export.');
        return;
      }
      download(
        `OpenNEXT-${page}-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(rows as Record<string, unknown>[]),
      );
      toast('Export downloaded.');
    },
    [page, toast],
  );
  return { search, setSearch, refresh, exportRows };
}
