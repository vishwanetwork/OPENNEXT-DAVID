'use client';

import { useTerminal, useTerminalSlots } from '@/terminal-kit';

export function BuyerKybHelp() {
  const { closeModal } = useTerminal();
  const { openContact } = useTerminalSlots();
  return (
    <p className="buyer-kyb-heading-help">
      *If you need help completing business verification,{' '}
      <button
        type="button"
        onClick={() => {
          closeModal();
          openContact({ message: 'I need help completing business verification.' });
        }}
      >
        contact us
      </button>
      .
    </p>
  );
}
