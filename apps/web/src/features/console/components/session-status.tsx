'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/components/providers/api-context';
import { liveApi } from '../live-api';
import { AdminLoginForm } from './admin-access';
import { NativeDialog } from './native-dialog';

export function ConsoleSessionStatus() {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const session = useQuery({
    queryKey: ['admin', 'operations-session'],
    queryFn: ({ signal }) => liveApi.session(api, signal),
    retry: false,
    gcTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const connected = !!session.data && !session.error;
  return (
    <>
      <button
        type="button"
        className="btn small"
        onClick={() => setOpen(true)}
        aria-label="Administrator connection"
      >
        {session.isPending
          ? 'Checking access…'
          : connected
            ? 'Administrator connected'
            : 'Connect administrator'}
      </button>
      {open ? (
        <NativeDialog className="pc-dialog" onClose={() => setOpen(false)}>
          <div className="pc-dialog-content">
            <h2>Administrator connection</h2>
            <p>
              The server verifies this session. The account label alone does not grant administrator
              access.
            </p>
            {connected ? (
              <p role="status">Administrator session verified.</p>
            ) : (
              <AdminLoginForm
                onConnected={async () => {
                  await session.refetch();
                  setOpen(false);
                }}
              />
            )}
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </NativeDialog>
      ) : null}
    </>
  );
}
