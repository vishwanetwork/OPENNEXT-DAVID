'use client';

import { useCallback, useRef, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { useApi } from '@/components/providers/api-context';
import { useInvalidateWorkspace } from '@/terminal-kit';

/** Legacy `runServer`: disables the trigger while a server write runs, then refreshes records. */
export function useRunServer() {
  const toast = useToast();
  const invalidate = useInvalidateWorkspace();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (work: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await work();
        await invalidate();
      } catch (error) {
        toast((error as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [busy, toast, invalidate],
  );
  return { run, busy };
}

/**
 * Stable client submission identifier per mounted form so retries of the same unsaved
 * submission reuse it (server-side idempotency), and a submitting guard against double clicks.
 */
export function useSubmissionId() {
  const ref = useRef<string | null>(null);
  const api = useApi();
  return {
    api,
    id: () => {
      if (!ref.current)
        ref.current =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : 'REQ-' +
              Date.now().toString(36).toUpperCase() +
              Math.random().toString(36).slice(2, 8).toUpperCase();
      return ref.current;
    },
  };
}
