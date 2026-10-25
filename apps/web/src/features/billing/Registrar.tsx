'use client';

import { useEffect } from 'react';
import { registerTerminalModal } from '@/features/terminal/components/TerminalModal';
import { billingModalRenderer } from './components/BillingModals';
import { useTopupPolling } from './components/PaymentModals';
import './billing.css';

/** Mounts billing/payment modals and the pending top-up polling into the terminal shell. */
export function BillingRegistrar() {
  useEffect(() => registerTerminalModal(billingModalRenderer), []);
  useTopupPolling();
  return null;
}
