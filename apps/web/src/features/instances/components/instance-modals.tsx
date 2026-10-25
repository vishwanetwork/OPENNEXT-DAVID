'use client';

import type { Instance } from '@opennext/contracts';
import {
  ModalFrame,
  useWorkspaceData,
  type ModalComponent,
  type ModalComponents,
  type ModalOf,
  type ModalType,
} from '@/terminal-kit';
import { ExampleConnect, ExampleManage, ExampleOrder } from './example-dialogs';
import { EndDialog } from './end-dialog';
import { Access, Connect, Manage, Resell } from './instance-dialogs';

declare module '@/terminal-kit/modal' {
  interface TerminalModalMap {
    'instance-example-order': Record<string, never>;
    'instance-example-connect': Record<string, never>;
    'instance-example-manage': Record<string, never>;
    'instance-example-end': Record<string, never>;
    instance: { id: string };
    'instance-manage': { id: string };
    'instance-resell': { id: string };
    'instance-end-confirm': { id: string };
    'instance-access': { id?: string; example?: boolean };
    connect: { id: string };
  }
}

type InstanceModalType =
  | 'instance-example-order'
  | 'instance-example-connect'
  | 'instance-example-manage'
  | 'instance-example-end'
  | 'instance'
  | 'instance-manage'
  | 'instance-resell'
  | 'instance-end-confirm'
  | 'instance-access'
  | 'connect';

/** One component renders every instance modal (legacy `OpenNEXTInstances.modal` + terminal `connect`). */
function InstanceModal({ modal, close }: { modal: ModalOf<InstanceModalType>; close: () => void }) {
  const instances = useWorkspaceData().instances as Instance[];
  const id = 'id' in modal ? modal.id : undefined;
  const name = () => {
    const i = instances.find((row) => row.id === id);
    return i ? i.name || i.model || 'Instance' : 'Instance unavailable';
  };
  switch (modal.type) {
    case 'instance-example-order':
      return (
        <ModalFrame title="Example purchase record" wide close={close}>
          <ExampleOrder />
        </ModalFrame>
      );
    case 'instance-example-connect':
      return (
        <ModalFrame title="Connect to your workspace" close={close}>
          <ExampleConnect />
        </ModalFrame>
      );
    case 'instance-example-manage':
      return (
        <ModalFrame title="Training workspace · example" close={close}>
          <ExampleManage />
        </ModalFrame>
      );
    case 'instance-example-end':
      return (
        <ModalFrame title="End this instance?" close={close}>
          <EndDialog isExample />
        </ModalFrame>
      );
    case 'instance':
    case 'instance-manage':
      return (
        <ModalFrame title={name()} close={close}>
          <Manage id={id} />
        </ModalFrame>
      );
    case 'instance-resell':
      return (
        <ModalFrame title="Resell idle capacity" close={close}>
          <Resell id={id} />
        </ModalFrame>
      );
    case 'instance-end-confirm':
      return (
        <ModalFrame title="End this instance?" close={close}>
          <EndDialog id={id} isExample={false} />
        </ModalFrame>
      );
    case 'instance-access':
      return (
        <ModalFrame title="SSH access" wide close={close}>
          <Access id={id} isExample={modal.example === true} />
        </ModalFrame>
      );
    case 'connect':
      return (
        <ModalFrame title="Connection details" close={close}>
          <Connect id={id} />
        </ModalFrame>
      );
    default:
      return null;
  }
}

const TYPES: InstanceModalType[] = [
  'instance-example-order',
  'instance-example-connect',
  'instance-example-manage',
  'instance-example-end',
  'instance',
  'instance-manage',
  'instance-resell',
  'instance-end-confirm',
  'instance-access',
  'connect',
];

/** Modals owned by the instances feature, keyed by type for the composition root. */
export const instanceModals: ModalComponents = Object.fromEntries(
  TYPES.map((type) => [type, InstanceModal as ModalComponent<ModalType>]),
) as ModalComponents;
