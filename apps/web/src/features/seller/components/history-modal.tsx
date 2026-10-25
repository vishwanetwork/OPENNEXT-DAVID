'use client';

import { Dialog } from '@/components/ui/dialog';
import { useTerminalSlots } from '@/terminal-kit';
import { useSellerStore } from '../store';

export function HistoryModal() {
  const { openContact } = useTerminalSlots();
  const ui = useSellerStore();
  const gated = ui.modal === 'range-gate';
  if (!ui.modal) return null;
  const contact = () => {
    ui.closeHistory();
    openContact({
      message:
        'I would like access to older anonymized GPU settlement activity and historical market data.',
    });
  };
  return (
    <Dialog
      onClose={ui.closeHistory}
      overlayClassName="onx-sa-modal-overlay"
      overlayProps={{ 'data-sa-modal-overlay': '' }}
      className="onx-sa-modal"
      labelledBy="onx-sa-history-title"
      describedBy="onx-sa-history-copy"
      initialFocus="[data-sa-modal-close]"
      lockScroll={false}
    >
      <header>
        <div>
          <h2 id="onx-sa-history-title">
            {gated ? 'Historical data access' : 'Request older activity'}
          </h2>
        </div>
        <button
          type="button"
          className="icon-btn"
          data-sa-modal-close
          aria-label="Close historical data dialog"
          onClick={ui.closeHistory}
        >
          ×
        </button>
      </header>
      <div className="onx-sa-modal-body">
        <p id="onx-sa-history-copy">
          {gated
            ? 'To view three months or more of historical data, please contact Sales.'
            : 'Up to the latest 100 settlements matching your current filters are available here. Contact Sales for additional history.'}
        </p>
        <footer>
          <button
            type="button"
            className="btn secondary"
            data-sa-modal-close
            onClick={ui.closeHistory}
          >
            Not now
          </button>
          <button type="button" className="btn" data-sa-contact onClick={contact}>
            Contact Sales
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
