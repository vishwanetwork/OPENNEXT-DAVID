'use client';

import { useMemo } from 'react';
import { useToast } from '@/components/ui/toast';
import { useOverlay } from '../components/overlay';
import { useConsoleStore } from '../store';
import { Btn } from '../components/forms';
import { useConsoleNav } from '../components/shell';
import type { DialogContext } from './context';
import { buildRunLog } from './run-log';
import { buildScheduleWizard } from './schedule-wizard';
import { buildScheduleDialogs } from './schedule-dialogs';
import { buildOfferDialogs } from './offer-dialogs';
import { buildOrderDialogs } from './order-dialogs';
import { buildInstanceDialogs } from './instance-dialogs';
import { buildPeopleDialogs } from './people-dialogs';
import { buildBillingDialogs } from './billing-dialogs';

/**
 * Legacy drawers / modals of the browser-local console (offer, order, instance, schedule,
 * advisory, user, invite, import, billing limit). Each opener renders a snapshot of the record;
 * form submissions mutate the store, write an audit entry and re-open the updated record.
 * The builders live in one file per record family; this hook composes them.
 */
export function useConsoleDialogs() {
  const overlay = useOverlay();
  const toast = useToast();
  const nav = useConsoleNav();
  const store = useConsoleStore;
  return useMemo(() => {
    const ctx: DialogContext = {
      overlay,
      toast,
      nav,
      store,
      closeBtn: (label = 'Close') => <Btn onClick={overlay.close}>{label}</Btn>,
    };
    const runlog = buildRunLog(ctx);
    const schedulewizard = buildScheduleWizard(ctx);
    const scheduledialogs = buildScheduleDialogs(ctx, {
      runLog: runlog.runLog,
      scheduleWizard: schedulewizard.scheduleWizard,
    });
    const offerdialogs = buildOfferDialogs(ctx, { scheduleNew: scheduledialogs.scheduleNew });
    const orderdialogs = buildOrderDialogs(ctx);
    const instancedialogs = buildInstanceDialogs(ctx);
    const peopledialogs = buildPeopleDialogs(ctx);
    const billingdialogs = buildBillingDialogs(ctx);
    return {
      close: overlay.close,
      ...runlog,
      ...schedulewizard,
      ...scheduledialogs,
      ...offerdialogs,
      ...orderdialogs,
      ...instancedialogs,
      ...peopledialogs,
      ...billingdialogs,
    };
  }, [overlay, toast, nav, store]);
}
