'use client';

import { useTerminal } from '@/terminal-kit';
import { lifecycle, moneyOrNa, stampUtcFull } from '../lifecycle';
import { example, setExampleScenario } from '../preview';
import { IBtn, usePreviewScope, useTick } from './common';
import { Cell, OrderField } from './instance-shared';

export function ExampleOrder() {
  const { openModal, closeModal } = useTerminal();
  const { scope } = usePreviewScope();
  const i = example(scope);
  const subtotal = 8 * 2.3 * 48;
  return (
    <>
      <p className="instance-example-record-note">
        Example only · no purchase, payment or active resource
      </p>
      <div className="details-grid">
        <Cell label="ORDER">ORDER-EXAMPLE-1024</Cell>
        <Cell label="RESOURCE">8 × H100 SXM</Cell>
        <Cell label="REGION">US East</Cell>
        <Cell label="MARKET TERMS">Spot</Cell>
        <Cell label="UNIT RATE">$2.30 / GPU-hour</Cell>
        <Cell label="ILLUSTRATIVE DURATION">48 hours</Cell>
        <Cell label="START">{stampUtcFull(i.createdAt)}</Cell>
        <Cell label="END">{stampUtcFull(i.endedAt || i.serviceEnd)}</Cell>
        <Cell label="RESOURCE STATUS">{lifecycle(i).label}</Cell>
        <Cell label="PAYMENT">Not charged · example only</Cell>
      </div>
      <div className="instance-example-pricing">
        <div>
          <span>Illustrative capacity subtotal</span>
          <strong>{moneyOrNa(subtotal)}</strong>
        </div>
        <div>
          <span>OpenNEXT Fee 5%</span>
          <strong>{moneyOrNa(subtotal * 0.05)}</strong>
        </div>
        <div>
          <span>Illustrative total</span>
          <strong>{moneyOrNa(subtotal * 1.05)}</strong>
        </div>
      </div>
      <p className="form-note">
        This record demonstrates the information linked to a purchased instance. It is not added to
        your real orders or Billing activity.
      </p>
      <div className="modal-footer">
        <IBtn act="instance-example-manage" onClick={() => openModal('instance-example-manage')}>
          Back to instance
        </IBtn>
        <IBtn act="close-modal" onClick={closeModal}>
          Close
        </IBtn>
      </div>
    </>
  );
}

export function ExampleConnect() {
  const { closeModal } = useTerminal();
  const { scope } = usePreviewScope();
  useTick();
  const life = lifecycle(example(scope));
  return (
    <>
      <p className="form-note">
        {life.ended
          ? 'This example has ended. Reset it in Manage to explore the connection state.'
          : life.connecting
            ? 'This Spot example is reconnecting after an interruption. Access resumes only after the Running state is confirmed.'
            : 'This is an example instance, not an active resource. Delivered allocations show a verified SSH endpoint, port, username and SSH key instructions.'}
      </p>
      <div className="instance-example-access">
        <span>SSH access</span>
        <strong>{life.running ? 'Available after real delivery' : life.label}</strong>
      </div>
      <p className="form-note">No server connection is made from this example.</p>
      <div className="modal-footer">
        <IBtn act="close-modal" onClick={closeModal}>
          Close
        </IBtn>
      </div>
    </>
  );
}

export function ExampleManage() {
  const { openModal, closeModal, toast } = useTerminal();
  const { scope } = usePreviewScope();
  useTick();
  const i = example(scope);
  const life = lifecycle(i);
  return (
    <>
      <div className="details-grid">
        <div>
          <small>STATUS</small>
          <strong data-instance-status>{life.label}</strong>
        </div>
        <Cell label="CAPACITY">8 × H100 SXM</Cell>
        <Cell label="REGION">US East</Cell>
        <Cell label="UNIT RATE">$2.30/GPU-hr</Cell>
        <Cell label="UTILIZATION">
          {life.running ? '71%' : life.ended ? 'Not active' : 'Awaiting reconnection'}
        </Cell>
        <OrderField i={i} isExample />
      </div>
      <p className="form-note">
        Example only. These controls demonstrate the instance lifecycle without creating a purchase,
        connecting to a server or changing Billing.
      </p>
      <div className="instance-example-controls">
        {life.ended ? (
          <IBtn act="instance-example-reset" onClick={() => setExampleScenario(scope, 'reset')}>
            Reset example
          </IBtn>
        ) : (
          <IBtn
            act={life.connecting ? 'instance-example-recover' : 'instance-example-interrupt'}
            onClick={() => setExampleScenario(scope, life.connecting ? 'running' : 'interrupted')}
          >
            {life.connecting ? 'Restore connection' : 'Preview Spot interruption'}
          </IBtn>
        )}
        <span>Local example controls</span>
      </div>
      <div className="modal-footer">
        <IBtn
          act="instance-access"
          example
          onClick={() => openModal('instance-access', { example: true })}
        >
          SSH keys
        </IBtn>
        <IBtn act="close-modal" onClick={closeModal}>
          Close
        </IBtn>
        <IBtn
          act="instance-example-connect"
          disabled={!life.running}
          onClick={() => openModal('instance-example-connect')}
        >
          Connect
        </IBtn>
        <IBtn
          act="instance-example-resell"
          disabled
          title="Example capacity cannot be listed for resale."
          onClick={() => toast('Example capacity cannot be listed for resale.')}
        >
          Resell
        </IBtn>
        <IBtn
          act="instance-example-end"
          disabled={life.ended}
          onClick={() => openModal('instance-example-end')}
        >
          END
        </IBtn>
      </div>
    </>
  );
}
