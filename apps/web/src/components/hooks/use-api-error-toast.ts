'use client';

import { useCallback } from 'react';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/errors';

/** Shows the user-facing message of any failure; use as `promise.catch(toastError)`. */
export function useApiErrorToast(fallback?: string) {
  const toast = useToast();
  return useCallback(
    (error: unknown) => {
      toast(describeError(error, fallback).message);
    },
    [toast, fallback],
  );
}
