'use client';

import { useTerminal } from '@/terminal-kit';
import { num, orderSide, type BillingData } from '../analytics';
import { Btn, Detail } from './billing-ui';

export function CapacityPanel({ billing }: { billing: BillingData }) {
  const { openModal } = useTerminal();
  const paid = billing.orders.filter(
    (o) => orderSide(o) === 'buy' && o.paymentStatus === 'Paid' && !/cancelled/i.test(o.status),
  );
  const gpuOrders = paid.filter(
    (o) => !/model|token|physical|hardware/i.test(String(o.kind || '')) && o.count && o.hours,
  );
  let reserved = gpuOrders.reduce((sum, o) => sum + num(o.count) * num(o.hours), 0);
  const withTelemetry = gpuOrders.filter(
    (o) => o.telemetry && Number.isFinite(Number(o.telemetry.usedGpuHours)),
  );
  let used = withTelemetry.reduce((sum, o) => sum + num(o.telemetry?.usedGpuHours), 0);
  let coverage = reserved > 0 && withTelemetry.length === gpuOrders.length;
  const sample = billing.billingUI.sample;
  if (sample) {
    reserved = 11520;
    used = 7920;
    coverage = true;
  }
  const seller = billing.role === 'seller';
  const delivering = billing.orders.filter(
    (o) => orderSide(o) === 'sell' && /provisioning|active/i.test(o.status),
  ).length;
  return (
    <section className="panel bill-capacity">
      <div className="bill-panel-head">
        <div>
          <h2>
            {seller ? 'Supply performance' : 'Capacity efficiency'}
            {sample ? ' example' : ''}
          </h2>
          <p>
            {sample
              ? 'Illustrative capacity and utilization metrics, not connected telemetry.'
              : seller
                ? 'Inventory and delivery metrics, separate from earnings.'
                : 'Purchased capacity and observed utilization, kept separate.'}
          </p>
        </div>
        <Btn act="bill-measurement" onClick={() => openModal('bill-measurement')}>
          Measurement details
        </Btn>
      </div>
      <div className="bill-efficiency-grid">
        <Detail
          label={seller ? 'Published listings' : 'Reserved GPU-hours'}
          value={
            seller
              ? sample
                ? 12
                : billing.listings.filter((l) => l.status === 'Published').length
              : reserved.toLocaleString('en-US')
          }
        />
        <Detail
          label={seller ? 'Orders in delivery' : 'Metered GPU-hours'}
          value={
            seller
              ? sample
                ? 7
                : delivering
              : coverage
                ? used.toLocaleString('en-US')
                : 'Awaiting usage telemetry'
          }
        />
        <Detail
          label={seller ? 'Acceptance rate' : 'Capacity utilization'}
          value={
            seller
              ? sample
                ? '97.2%'
                : 'Awaiting delivery history'
              : coverage
                ? ((used / reserved) * 100).toFixed(1) + '%'
                : 'Not available'
          }
        />
      </div>
      <div className="bill-meter">
        <span
          style={{
            width: `${coverage ? Math.min(100, Math.max(0, (used / reserved) * 100)) : 0}%`,
          }}
        ></span>
      </div>
      {sample ? (
        <div className="bill-efficiency-sample">
          <div>
            <span>Reserved capacity</span>
            <strong>11,520 GPU-hours</strong>
            <div className="bill-resource-bar">
              <i style={{ width: '100%', background: '#a7bdcf' }}></i>
            </div>
          </div>
          <div>
            <span>Productive GPU time</span>
            <strong>7,920 GPU-hours</strong>
            <div className="bill-resource-bar">
              <i style={{ width: '68.75%', background: '#629173' }}></i>
            </div>
          </div>
          <div>
            <span>Unutilized allocation</span>
            <strong>3,600 GPU-hours (31.3%)</strong>
            <div className="bill-resource-bar">
              <i style={{ width: '31.25%', background: '#c5ac78' }}></i>
            </div>
          </div>
        </div>
      ) : null}
      <p className="bill-footnote">
        {sample
          ? 'Example only. Utilization = 7,920 / 11,520 GPU-hours. This illustration does not create orders, metering records or earnings.'
          : coverage
            ? 'Calculated from metered GPU-hours divided by reserved GPU-hours for paid GPU orders.'
            : 'Connect provider usage and delivery records before evaluating idle capacity, efficiency or SLA compliance.'}
      </p>
    </section>
  );
}
