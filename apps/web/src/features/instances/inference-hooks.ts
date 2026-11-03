'use client';

import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/components/providers/api-context';
import { useAccountIdentity } from '@/terminal-kit';
import { instancesApi } from './api';

export function useInference(id: string, ended: boolean) {
  const api = useApi();
  const identity = useAccountIdentity();
  return useQuery({
    queryKey: ['account', 'inference', identity, id],
    queryFn: ({ signal }) => instancesApi.inference(api, id, signal),
    retry: false,
    staleTime: 3000,
    refetchInterval: ended ? false : 10000,
    refetchIntervalInBackground: false,
    gcTime: 0, // Customer inference keys stay only in the open panel's memory.
  });
}
