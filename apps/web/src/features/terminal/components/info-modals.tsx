'use client';

import {
  Button,
  ModalFrame,
  useTerminal,
  useTerminalSlots,
  useWorkspaceStore,
  type ModalComponent,
} from '@/terminal-kit';

export const HistoryAccessModal: ModalComponent<'history-access'> = ({ close }) => {
  const model = useWorkspaceStore((s) => s.model);
  const { openContact } = useTerminalSlots();
  return (
    <ModalFrame title="More market history" close={close}>
      <p className="form-note">
        Historical data up to 3 months is free. Contact Sales to access 6 months, 1 year or all
        available history.
      </p>
      <div className="modal-footer">
        <Button data-act="close-modal" onClick={close}>
          Back to chart
        </Button>
        <Button
          cls=""
          data-act="history-contact"
          onClick={() => {
            close();
            openContact({
              message:
                'I would like access to more than 3 months of ' + model + ' GPU price history.',
            });
          }}
        >
          Contact Sales
        </Button>
      </div>
    </ModalFrame>
  );
};

export const SourcesModal: ModalComponent<'sources'> = ({ close }) => (
  <ModalFrame title="GPU pricing methodology" close={close}>
    <h3 style={{ fontSize: 14 }}>Three comparable price types</h3>
    <div className="callout">
      The chart compares Spot, On-demand and Reserved prices of one reference offering: the same GPU
      configuration from the same supplier in the same region. Prices from different suppliers are
      never mixed into one comparison.
    </div>
    <p className="form-note">
      Among the offerings that match the selected GPU model, GPU count and region scope, the
      reference is one whose Spot price is observed live, then the one with the most current price
      types, then the lowest On-demand rate. Published fixed rates are used when no live Spot
      offering matches. Instance prices are divided by the verified physical GPU count. Memory and
      form-factor variants are filtered when selected. Fractional GPU rates are excluded from
      full-GPU comparisons.
    </p>
    <p className="form-note">
      Reserved means a 12-month, no-upfront commitment. It is a billing commitment and does not by
      itself guarantee capacity. Spot may be interrupted; all launch types remain subject to quotas
      and inventory.
    </p>
    <p className="form-note">
      The page checks for updates every 30 seconds. New observations are collected every five
      minutes; published tariffs are refreshed hourly. Quotes are recorded only while fresh. Longer
      periods use coarser time buckets showing the lowest price observed in each bucket.
    </p>
    <p className="form-note">
      History uses saved observations and vendor-published effective prices. Spot, On-demand and
      Reserved history covers up to 90 days where available. Published tariffs apply only within
      confirmed effective intervals. No current price is inserted into the past. Unreported prices
      remain empty, and long gaps are not joined. Source attribution and credentials stay on the
      server.
    </p>
  </ModalFrame>
);

export const InfoModal: ModalComponent<'info'> = ({ modal, close }) => {
  const { go } = useTerminal();
  if (modal.info === 'contact')
    return (
      <ModalFrame title="Contact OpenNEXT" close={close}>
        <div className="callout">
          For procurement, supplier onboarding and delivery support, contact your OpenNEXT account
          team. Include the RFQ ID, supply reference or instance ID so the team can locate the
          record.
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="btn"
            data-nav="help"
            onClick={() => {
              close();
              go('help');
            }}
          >
            Open Help & documentation
          </button>
        </div>
      </ModalFrame>
    );
  return (
    <ModalFrame title="Privacy" close={close}>
      <p className="form-note">
        Your profile, quote requests and procurement records belong to your workspace. Supplier
        access should be limited to the requirements and delivery information needed for a
        transaction.
      </p>
      <div className="callout">
        Never upload a private SSH key. Public keys can be shared for instance access. Review your
        account permissions and credential scopes from the workspace settings.
      </div>
    </ModalFrame>
  );
};
