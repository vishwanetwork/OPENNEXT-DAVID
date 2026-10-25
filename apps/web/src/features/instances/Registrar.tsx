'use client';

import { useEffect } from 'react';
import { registerTerminalModal } from '@/features/terminal/components/TerminalModal';
import { instanceModalRenderer } from './components/InstanceModals';
import './instances.css';

/** Mounts the instance modals into the terminal shell. */
export function InstancesRegistrar() {
  useEffect(() => registerTerminalModal(instanceModalRenderer), []);
  return null;
}
