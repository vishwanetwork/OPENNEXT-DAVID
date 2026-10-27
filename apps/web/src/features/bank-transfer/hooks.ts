'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBuyerKyb } from '@/features/buyer-kyb';
import { describeError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import type { BankTransferRequest } from '@/lib/buyer-kyb';
import { useSessionStore } from '@/lib/session-store';
import { accountIdentity, useTerminal, useTerminalSlots } from '@/terminal-kit';
import {
  confirmedTransferIntent,
  confirmedTransferReport,
  transferRequestSchema,
  type TransferRecord,
} from './validation';

function useTransferSession() {
  const kyb = useBuyerKyb();
  const service = useTerminalSlots().services.bankTransfer;
  const generation = useRef(0);
  const connected = Boolean(kyb.connected && !kyb.demo && service?.create && service?.reportSent);
  useLayoutEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, [kyb.identity, kyb.demo, service, connected]);
  const capture = () => {
    const version = generation.current;
    return () => {
      const current = useSessionStore.getState();
      return (
        connected &&
        generation.current === version &&
        current.status === 'verified' &&
        current.user?.role === 'buyer' &&
        !current.user.demo &&
        accountIdentity(current.user, false) === kyb.identity
      );
    };
  };
  return { kyb, service, connected, capture };
}

export function useStartBankTransfer() {
  const context = useTransferSession();
  const { openModal } = useTerminal();
  const client = useQueryClient();
  const lock = useRef(false);
  const [state, setState] = useState({ identity: '', busy: false, error: '' });
  const update = (busy: boolean, error = '') =>
    setState({ identity: context.kyb.identity, busy, error });

  const start = async (request: BankTransferRequest) => {
    if (lock.current) return false;
    if (!context.connected || !context.service) {
      update(false, 'Bank transfers are not connected yet. No payment request has been submitted.');
      return false;
    }
    const active = context.capture();
    lock.current = true;
    update(true);
    try {
      const input = transferRequestSchema.parse(request);
      if (!(await context.kyb.refreshApproved()) || !active())
        throw new Error('Approved business verification is required before payment.');
      const response = await context.service.create(input);
      if (!active()) return false;
      const intent = confirmedTransferIntent(response, context.kyb.accountId, input);
      if (!intent)
        throw new Error('The bank transfer request could not be verified. Please retry.');
      client.setQueryData<TransferRecord>(
        queryKeys.account.bankTransfer(context.kyb.identity, intent.id),
        { intent },
      );
      openModal('bank-transfer', { id: intent.id });
      return true;
    } catch (cause) {
      if (active()) update(false, describeError(cause).message);
      return false;
    } finally {
      lock.current = false;
      if (active()) setState((current) => ({ ...current, busy: false }));
    }
  };
  return {
    start,
    busy: state.identity === context.kyb.identity && state.busy,
    error: state.identity === context.kyb.identity ? state.error : '',
    connected: context.connected,
  };
}

export function useBankTransfer(id: string) {
  const context = useTransferSession();
  const client = useQueryClient();
  const key = queryKeys.account.bankTransfer(context.kyb.identity, id);
  const query = useQuery<TransferRecord>({
    queryKey: key,
    queryFn: async () => {
      throw new Error('Start a verified bank transfer before loading instructions.');
    },
    enabled: false,
    gcTime: 0,
  });
  const [clock, setClock] = useState(() => Date.now());
  const expiresAt = query.data?.intent.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry) || expiry <= clock) return;
    const delay = Math.max(0, expiry - Date.now());
    const timer = setTimeout(() => setClock(Date.now()), Math.min(delay + 1, 86_400_000));
    return () => clearTimeout(timer);
  }, [expiresAt, clock]);
  const verified =
    context.connected && context.kyb.approved
      ? confirmedTransferIntent(query.data?.intent, context.kyb.accountId, undefined, clock)
      : null;
  const intent = verified?.id === id ? verified : null;
  const reported = Boolean(intent && confirmedTransferReport(query.data?.report, intent.id));
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const idempotencyKey = `report-transfer:${id}`;

  const reportSent = async () => {
    if (lock.current || reported || !intent || !context.service) return;
    const active = context.capture();
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (!(await context.kyb.refreshApproved()) || !active())
        throw new Error('Approved business verification is required before continuing.');
      if (!confirmedTransferIntent(intent, context.kyb.accountId))
        throw new Error('These payment instructions have expired. Start a new payment request.');
      const response = await context.service.reportSent({ intentId: intent.id, idempotencyKey });
      if (!active()) return;
      const report = confirmedTransferReport(response, intent.id);
      if (!report) throw new Error('Your transfer report could not be verified. Please retry.');
      client.setQueryData<TransferRecord>(key, { intent, report });
    } catch (cause) {
      if (active()) setError(describeError(cause).message);
    } finally {
      lock.current = false;
      if (active()) setBusy(false);
    }
  };
  return { intent, reported, reportSent, busy, error };
}
