'use client';

import type { ReactNode } from 'react';
import { AsyncButton, AsyncFeedback } from '@/components/ui/async-feedback';
import { AdminLoginForm } from './admin-access';

export function LiveFrame({
  title,
  state,
  children,
}: {
  title: string;
  state: {
    denied: boolean;
    loading: boolean;
    isFetching: boolean;
    error: unknown;
    refresh: () => Promise<unknown>;
  };
  children: ReactNode;
}) {
  return (
    <>
      <div className="row spread">
        <span className="muted">Server-backed operations</span>
        <AsyncButton
          type="button"
          className="btn"
          busy={state.isFetching}
          onClick={() => void state.refresh()}
        >
          Refresh {title}
        </AsyncButton>
      </div>
      {state.denied ? (
        <AdminLoginForm
          onConnected={async () => {
            await state.refresh();
          }}
        />
      ) : state.loading ? (
        <AsyncFeedback>Loading {title}…</AsyncFeedback>
      ) : state.error ? (
        <p role="alert">
          {state.error instanceof Error
            ? state.error.message
            : 'This service is temporarily unavailable.'}
        </p>
      ) : null}
      {!state.denied && !state.loading && !state.error ? children : null}
    </>
  );
}

export function LivePagination({
  next,
  previous,
  onNext,
  onPrevious,
}: {
  next: string | null;
  previous: boolean;
  onNext: () => void;
  onPrevious: () => void;
}) {
  return (
    <div className="row">
      <button type="button" className="btn" disabled={!previous} onClick={onPrevious}>
        Previous page
      </button>
      <button type="button" className="btn" disabled={!next} onClick={onNext}>
        Next page
      </button>
    </div>
  );
}
