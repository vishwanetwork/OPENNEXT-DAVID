'use client';

import type { ReactNode } from 'react';
import type { OwnedRfq } from '@opennext/contracts';
import { money } from '@/lib/format';
import { useWorkspaceStore } from '@/terminal-kit';
import { deliveryMethod, isHardware, isModel, totalFor, unitSuffix } from '../exchange';
import { FieldList, date, volume } from './shared';

/* ---------- RFQ record ---------- */
const txt = (v: unknown): string | undefined =>
  v === null || v === undefined ? undefined : String(v);

export function RequirementFields({ r }: { r: OwnedRfq }) {
  const identity = useWorkspaceStore((s) => s.identity);
  const hardware = isHardware(r);
  const model = isModel(r);
  const common: [ReactNode, ReactNode][] = [
    ['Project / purpose', r.project || r.title],
    ['Client / procurement owner', r.client || identity.company || identity.name],
    ['GPU / model', r.model],
    ['Capacity', volume(r)],
    ['Region / data location', r.region],
    ['Commercial terms', r.term || 'Model capacity'],
    [hardware ? 'Required arrival' : 'Start time', date(r.start)],
    [
      'Budget',
      money(r.budget) +
        unitSuffix(r) +
        (model ? '' : ' ' + money(totalFor(r, r.budget)) + ' maximum'),
    ],
    ['Quote deadline', date(r.quoteDeadline)],
    ['Delivery method', r.deliveryMethod || deliveryMethod(r)],
    ['Urgency', r.urgency],
    ['Visibility', r.visibility],
  ];
  const specific: [ReactNode, ReactNode][] = hardware
    ? [
        ['Condition', txt(r.condition) || 'Brand new'],
        [
          'Shipping address / destination',
          txt(r.shippingAddress) || 'Confirm securely before shipment',
        ],
        ['Incoterms', txt(r.incoterms) || 'DAP confirm fees'],
        ['Warranty', txt(r.warranty) || 'Confirm in quotation'],
      ]
    : model
      ? [
          ['Exact model / tier SKU', r.sku || 'Confirm in quotation'],
          ['Duration', r.days + ' days'],
          ['Required throughput', (r.tps || 'To confirm') + ' TPS'],
          [
            'Access / data policy',
            txt(r.accessPolicy) || 'Confirm authorization, retention and region',
          ],
        ]
      : [
          ['Duration', r.hours + ' hours'],
          [
            'Network / storage',
            `${txt(r.network) || 'Confirm with supplier'} / ${txt(r.storage) || 'Confirm with supplier'}`,
          ],
          ['Image / runtime', txt(r.image) || 'Confirm with supplier'],
        ];
  return (
    <>
      <div className="details-grid proc-details">
        <FieldList
          items={[...common, ...specific, ['SLA / support', txt(r.sla) || 'Confirm with supplier']]}
        />
      </div>
      <h3>Requirement notes</h3>
      <p className="proc-notes">{r.notes || 'No additional requirements.'}</p>
    </>
  );
}
