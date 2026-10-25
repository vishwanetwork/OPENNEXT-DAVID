'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { LedgerEntry, Order, Payout } from '@opennext/contracts';
import { useToast } from '@/components/ui/toast';
import { useTerminal } from '@/features/terminal/context';
import { downloadText } from '@/features/terminal/export';
import { useWorkspaceStore } from '@/features/terminal/store';
import { COLORS, activityRows, analytics, chartWidth, csv, dateKey, exportRows, metrics, num, orderSide, roleOf, seriesFor, stamp, usd, type Analytics, type BillingData } from '../analytics';
import { useBillingUi } from '../ui-store';

export function useBillingData(): BillingData {
  const role = useWorkspaceStore((s) => s.role);
  const ledger = useWorkspaceStore((s) => s.ledger) as LedgerEntry[];
  const orders = useWorkspaceStore((s) => s.orders) as Order[];
  const payouts = useWorkspaceStore((s) => s.payouts) as Payout[];
  const listings = useWorkspaceStore((s) => s.listings);
  const billingUI = useBillingUi();
  return useMemo(() => ({ role: roleOf(role), ledger, orders, payouts, listings, billingUI }), [role, ledger, orders, payouts, listings, billingUI]);
}

const Btn = ({ act, primary = false, children, onClick, value, id, pressed }: { act: string; primary?: boolean; children: React.ReactNode; onClick?: () => void; value?: string; id?: string; pressed?: boolean }) => (
  <button type="button" className={`btn ${primary ? '' : 'secondary'} small`} data-act={act} data-value={value} data-id={id} aria-pressed={pressed} onClick={onClick}>
    {children}
  </button>
);

export const Detail = ({ label, value }: { label: string; value: unknown }) => (
  <div>
    <small>{label}</small>
    <strong>{value == null || value === '' ? 'Not recorded' : String(value)}</strong>
  </div>
);

function useViewportWidth() {
  const [width, setWidth] = useState(1440);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth || 1440);
    update();
    window.addEventListener('resize', update, { passive: true });
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}

export function BillingChart({ S, a }: { S: BillingData; a: Analytics }) {
  const ui = useBillingUi();
  const series = seriesFor(S.role);
  const visible = series.filter(([key]) => !ui.hidden.includes(key));
  const w = chartWidth(useViewportWidth());
  const h = 240, left = 70, right = 20, top = 20, bottom = 35, inner = w - left - right, ch = h - top - bottom;
  const bounds = a.rows.map((r) => {
    const values = visible.map(([key]) => num(r[key]));
    return ui.chart === 'bars' ? [values.reduce((sum, value) => sum + Math.min(0, value), 0), values.reduce((sum, value) => sum + Math.max(0, value), 0)] : [Math.min(0, ...values), Math.max(0, ...values)];
  });
  const min = Math.min(0, ...bounds.map((b) => b[0]));
  const max = Math.max(1, ...bounds.map((b) => b[1]));
  const span = max - min;
  const y = (value: number) => top + ((max - value) / span) * ch;
  const zero = y(0);
  const step = inner / Math.max(1, a.rows.length);
  const bw = Math.max(1, Math.min(25, step * 0.62));
  const indexes = [...new Set([0, Math.floor((a.rows.length - 1) / 3), Math.floor(((a.rows.length - 1) * 2) / 3), a.rows.length - 1])].filter((i) => i >= 0);
  const totalActivity = visible.reduce((sum, [key]) => sum + a.rows.reduce((value, row) => value + Math.abs(row[key]), 0), 0);
  return (
    <section className="panel bill-chart-panel">
      <div className="bill-panel-head">
        <div>
          <h2>{S.role === 'Buyer' ? 'Compute spend' : S.role === 'Seller' ? 'Earnings over time' : 'Buying, selling & commission'}</h2>
          <p>{a.sample ? 'Example analysis · not your balance or transaction history' : 'Posted account activity · USD · UTC'}</p>
        </div>
        <div className="bill-segment">
          <Btn act="bill-chart" value="bars" pressed={ui.chart === 'bars'} onClick={() => ui.patch({ chart: 'bars' })}>Bars</Btn>
          <Btn act="bill-chart" value="lines" pressed={ui.chart === 'lines'} onClick={() => ui.patch({ chart: 'lines' })}>Lines</Btn>
        </div>
      </div>
      <div className="bill-chart-legend">
        {series.map(([key, label]) => (
          <button key={key} className="bill-legend" type="button" data-act="bill-series" data-value={key} aria-pressed={!ui.hidden.includes(key)} onClick={() => ui.toggleSeries(key, series.map(([k]) => k))}>
            <i style={{ ['--series-color' as string]: COLORS[key] } as React.CSSProperties}></i>
            {label}
            <strong>{usd(a.sums[key])}</strong>
          </button>
        ))}
      </div>
      <div className="bill-svg-wrap">
        <svg className="bill-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Daily financial activity from ${ui.from} to ${ui.to}`}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const value = min + span * f;
            return (
              <g key={f}>
                <line x1={left} x2={w - right} y1={y(value)} y2={y(value)} stroke="#e8eee9" />
                <text x={left - 10} y={y(value) + 4} textAnchor="end">{usd(value)}</text>
              </g>
            );
          })}
          <line data-bill-zero="true" x1={left} x2={w - right} y1={zero} y2={zero} stroke="#9bac9f" strokeWidth="1.2" />
          {ui.chart === 'bars'
            ? a.rows.map((r, i) => {
                let positive = 0;
                let negative = 0;
                return visible.map(([key, label]) => {
                  const value = num(r[key]);
                  const start = value < 0 ? negative : positive;
                  const end = start + value;
                  if (value < 0) negative = end;
                  else positive = end;
                  return (
                    <rect key={key} tabIndex={0} role="img" data-bill-series={key} aria-label={`${r.day}, ${label}: ${usd(value)}`} x={left + step * i + (step - bw) / 2} y={Math.min(y(start), y(end))} width={bw} height={Math.abs(y(end) - y(start))} rx="2" fill={COLORS[key]}>
                      <title>{`${r.day} · ${label} · ${usd(value)}`}</title>
                    </rect>
                  );
                });
              })
            : visible.map(([key, label]) => (
                <g key={key}>
                  <polyline data-bill-series={key} fill="none" stroke={COLORS[key]} strokeWidth="2" points={a.rows.map((r, i) => left + step * (i + 0.5) + ',' + y(r[key])).join(' ')} />
                  {a.rows.map((r, i) => (
                    <circle key={r.day} tabIndex={0} role="img" aria-label={`${r.day}, ${label}: ${usd(r[key])}`} cx={left + step * (i + 0.5)} cy={y(r[key])} r="3" fill={COLORS[key]}>
                      <title>{`${r.day} · ${label} · ${usd(r[key])}`}</title>
                    </circle>
                  ))}
                </g>
              ))}
          {indexes.map((i) => (
            <text key={i} x={left + step * (i + 0.5)} y={h - 10} textAnchor="middle">{new Date(a.rows[i].day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })}</text>
          ))}
        </svg>
        {totalActivity === 0 ? <div className="bill-chart-empty">No posted activity in this period</div> : null}
      </div>
      <p className="bill-footnote">
        {S.role === 'Buyer'
          ? 'Payments and posted usage charges are shown on their posting date. Prepaid orders are not a measure of actual GPU utilization.'
          : S.role === 'Seller'
            ? 'Net settlement earnings already include the OpenNEXT fee deduction. Broker commissions, if recorded, are separate expenses shown below zero. Only settled earnings are withdrawable.'
            : 'Only settled earnings are withdrawable. Quotes and projected sales are not spendable funds.'}
      </p>
    </section>
  );
}

function CapacityPanel({ S }: { S: BillingData }) {
  const { openModal } = useTerminal();
  const paid = S.orders.filter((o) => orderSide(o) === 'buy' && o.paymentStatus === 'Paid' && !/cancelled/i.test(o.status));
  const gpuOrders = paid.filter((o) => !/model|token|physical|hardware/i.test(String(o.kind || '')) && o.count && o.hours);
  let reserved = gpuOrders.reduce((sum, o) => sum + num(o.count) * num(o.hours), 0);
  const withTelemetry = gpuOrders.filter((o) => o.telemetry && Number.isFinite(Number(o.telemetry.usedGpuHours)));
  let used = withTelemetry.reduce((sum, o) => sum + num(o.telemetry?.usedGpuHours), 0);
  let coverage = reserved > 0 && withTelemetry.length === gpuOrders.length;
  const sample = S.billingUI.sample;
  if (sample) {
    reserved = 11520;
    used = 7920;
    coverage = true;
  }
  const seller = S.role === 'Seller';
  const delivering = S.orders.filter((o) => orderSide(o) === 'sell' && /provisioning|active/i.test(o.status)).length;
  return (
    <section className="panel bill-capacity">
      <div className="bill-panel-head">
        <div>
          <h2>{seller ? 'Supply performance' : 'Capacity efficiency'}{sample ? ' · example' : ''}</h2>
          <p>{sample ? 'Illustrative capacity and utilization metrics, not connected telemetry.' : seller ? 'Inventory and delivery metrics, separate from earnings.' : 'Purchased capacity and observed utilization, kept separate.'}</p>
        </div>
        <Btn act="bill-measurement" onClick={() => openModal('bill-measurement')}>Measurement details</Btn>
      </div>
      <div className="bill-efficiency-grid">
        <Detail label={seller ? 'Published listings' : 'Reserved GPU-hours'} value={seller ? (sample ? 12 : S.listings.filter((l) => l.status === 'Published').length) : reserved.toLocaleString('en-US')} />
        <Detail label={seller ? 'Orders in delivery' : 'Metered GPU-hours'} value={seller ? (sample ? 7 : delivering) : coverage ? used.toLocaleString('en-US') : 'Awaiting usage telemetry'} />
        <Detail label={seller ? 'Acceptance rate' : 'Capacity utilization'} value={seller ? (sample ? '97.2%' : 'Awaiting delivery history') : coverage ? ((used / reserved) * 100).toFixed(1) + '%' : 'Not available'} />
      </div>
      <div className="bill-meter"><span style={{ width: `${coverage ? Math.min(100, Math.max(0, (used / reserved) * 100)) : 0}%` }}></span></div>
      {sample ? (
        <div className="bill-efficiency-sample">
          <div><span>Reserved capacity</span><strong>11,520 GPU-hours</strong><div className="bill-resource-bar"><i style={{ width: '100%', background: '#a7bdcf' }}></i></div></div>
          <div><span>Productive GPU time</span><strong>7,920 GPU-hours</strong><div className="bill-resource-bar"><i style={{ width: '68.75%', background: '#629173' }}></i></div></div>
          <div><span>Unutilized allocation</span><strong>3,600 GPU-hours · 31.3%</strong><div className="bill-resource-bar"><i style={{ width: '31.25%', background: '#c5ac78' }}></i></div></div>
        </div>
      ) : null}
      <p className="bill-footnote">{sample ? 'Example only. Utilization = 7,920 / 11,520 GPU-hours. This illustration does not create orders, metering records or earnings.' : coverage ? 'Calculated from metered GPU-hours divided by reserved GPU-hours for paid GPU orders.' : 'Connect provider usage and delivery records before evaluating idle capacity, efficiency or SLA compliance.'}</p>
    </section>
  );
}

function DailyTable({ S, a, onExport }: { S: BillingData; a: Analytics; onExport: (type: string) => void }) {
  const columns = seriesFor(S.role);
  const hasActivity = a.rows.some((row) => columns.some(([key]) => Math.abs(num(row[key])) > 0));
  const rows = hasActivity ? a.rows.slice().reverse() : a.rows.slice(-1);
  const emptyLabel = S.role === 'Buyer' ? 'No spent history yet' : S.role === 'Seller' ? 'No earnings history yet' : 'No financial history yet';
  return (
    <section className="panel">
      <div className="bill-panel-head">
        <h2>Daily {S.role === 'Buyer' ? 'spend' : 'financial'} details{a.sample ? ' · example' : ''}</h2>
        <Btn act="bill-export" value="daily" onClick={() => onExport('daily')}>Export daily data</Btn>
      </div>
      <div className="table-scroll bill-daily-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date · UTC</th>
              {columns.map(([, label]) => <th key={label}>{label}</th>)}
              <th>{S.role === 'Broker' ? 'Trading margin' : 'Total'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day}>
                <td>{r.day}</td>
                {columns.map(([key]) => <td key={key} className="bill-number">{usd(r[key])}</td>)}
                <td className="bill-number"><strong>{usd(S.role === 'Broker' ? r.revenue - r.purchase : columns.reduce((sum, [k]) => sum + r[k], 0))}</strong></td>
              </tr>
            ))}
            {hasActivity ? null : (
              <tr className="bill-daily-empty">
                <td colSpan={columns.length + 2}><div>{emptyLabel}</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Activity({ S, onExport }: { S: BillingData; onExport: (type: string) => void }) {
  const { openModal } = useTerminal();
  const rows = activityRows(S);
  return (
    <section className="panel bill-activity">
      <div className="bill-panel-head">
        <div>
          <h2>Activity</h2>
          <p>Your account records · test transactions are identified individually</p>
        </div>
        <Btn act="bill-export" value="activity" onClick={() => onExport('activity')}>Export CSV</Btn>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr><th>Order</th><th>Description</th><th>Date · UTC</th><th>Status</th><th>Amount</th><th></th></tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((l) => (
                <tr key={l.id}>
                  <td>{l.orderId ? <button type="button" className="detail-link bill-order-link" data-act="bill-order" data-id={l.orderId} onClick={() => openModal('bill-order', { id: l.orderId })}>{l.orderId}</button> : <span className="muted">—</span>}</td>
                  <td>
                    {l.type}
                    {l.test ? <small className="bill-test-tag">Test transaction</small> : null}
                    <small className="bill-row-meta">{l.id}</small>
                  </td>
                  <td>{stamp(l.createdAt || l.date)}</td>
                  <td><span className="tag">{l.status || 'Posted'}</span></td>
                  <td className={`bill-number ${l.displayAmount > 0 ? 'positive' : ''}`}>{l.displayAmount > 0 ? '+' : ''}{usd(l.displayAmount)}</td>
                  <td><Btn act={l.orderId ? 'bill-order' : 'bill-record'} id={l.orderId || l.id} onClick={() => openModal(l.orderId ? 'bill-order' : 'bill-record', { id: l.orderId || l.id })}>View details</Btn></td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}><div className="empty-state"><strong>No account activity yet</strong>Add credit or complete an order to begin your account history.</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Payouts({ S }: { S: BillingData }) {
  const { openModal } = useTerminal();
  if (S.role === 'Buyer') return null;
  return (
    <section className="panel">
      <div className="bill-panel-head">
        <div>
          <h2>Payouts</h2>
          <p>Funds are reserved when a cashout request is submitted.</p>
        </div>
        <Btn act="cashout-start" onClick={() => openModal('cashout-start')}>Cash out</Btn>
      </div>
      {S.payouts.length ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Payout</th><th>Destination</th><th>Requested</th><th>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {S.payouts.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.destination}</td>
                  <td>{stamp(p.createdAt)}</td>
                  <td>{usd(p.amount)}</td>
                  <td>{p.status} {p.test ? <small className="bill-test-tag">Test</small> : null}</td>
                  <td><Btn act="cashout-detail" id={p.id} onClick={() => openModal('cashout-detail', { id: p.id })}>View details</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state"><strong>No payouts yet</strong>Settled sale proceeds become available for withdrawal. Prepaid purchasing credit cannot be cashed out.</div>
      )}
    </section>
  );
}

/** Billing & usage / Earnings & payouts page (legacy `OpenNEXTBilling.page`). */
export function BillingPage() {
  const S = useBillingData();
  const ui = useBillingUi();
  const { openModal } = useTerminal();
  const toast = useToast();
  const balance = useWorkspaceStore((s) => s.balance);
  const earningsBalance = useWorkspaceStore((s) => s.earningsBalance);
  const a = analytics(S);
  const r = S.role;
  const onExport = (type: string, id?: string) => {
    const rows = exportRows(S, type, id);
    if (!rows.length) return toast('No records to export in this period');
    downloadText('OpenNEXT-' + (type === 'daily' && ui.sample ? 'example-' : '') + type + '.csv', csv(rows), 'text/csv;charset=utf-8');
  };
  const applyFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const from = dateKey(data.from);
    const to = dateKey(data.to);
    if (!from || !to || from > to || Date.parse(to) - Date.parse(from) > 365 * 86400000) return toast('Choose a valid range of up to 366 days');
    ui.patch({ from, to });
  };
  return (
    <div className="page-content bill-page">
      <div className="page-heading">
        <div>
          <h1>{r === 'Seller' ? 'Earnings & payouts' : r === 'Broker' ? 'Billing & earnings' : 'Billing & usage'}</h1>
          <p>{r === 'Seller' ? 'Track sales, delivery settlement and withdrawals.' : r === 'Broker' ? 'Keep procurement, sales proceeds and commissions in clear view.' : 'Manage your credit and understand your capacity spending.'}</p>
        </div>
        <div className="bill-actions">
          {r !== 'Seller' ? <Btn act="pay-start" primary onClick={() => openModal('pay-start')}>Add credit</Btn> : null}
          {r !== 'Buyer' ? <Btn act="cashout-start" primary onClick={() => openModal('cashout-start')}>Cash out</Btn> : null}
        </div>
      </div>
      <div className="bill-wallets">
        <section className="bill-wallet">
          <span>Available credit</span>
          <strong>{usd(balance)}</strong>
          <p>For purchases and usage charges</p>
          {r === 'Seller' ? <Btn act="pay-start" onClick={() => openModal('pay-start')}>Add credit</Btn> : null}
        </section>
        {r !== 'Buyer' ? (
          <>
            <section className="bill-wallet"><span>Available to withdraw</span><strong>{usd(earningsBalance)}</strong><p>Settled earnings · excludes prepaid credit</p></section>
            <section className="bill-wallet"><span>Payouts in progress</span><strong>{usd(S.payouts.filter((p) => p.status === 'Pending').reduce((sum, p) => sum + num(p.amount), 0))}</strong><p>Already reserved from withdrawable earnings</p></section>
          </>
        ) : (
          <section className="bill-wallet bill-wallet-note"><strong>One account. Clear records.</strong><p>Your welcome credit is a one-time, non-withdrawable reward. Additional credit is added after verified payment. Orders and delivery records stay linked.</p></section>
        )}
      </div>
      <div className="bill-controls">
        <form data-form="bill-filter" className="bill-date-filter" onSubmit={applyFilter}>
          <label>From<input className="field" type="date" name="from" defaultValue={ui.from} required /></label>
          <label>To<input className="field" type="date" name="to" defaultValue={ui.to} required /></label>
          <button className="btn secondary small">Apply</button>
        </form>
        <button type="button" className="btn secondary small" data-act="bill-sample" aria-pressed={a.sample} onClick={() => ui.patch({ sample: !ui.sample })}>{a.sample ? 'Return to my activity' : 'Preview example analytics'}</button>
      </div>
      {a.sample ? <div className="bill-example-banner"><strong>Example analytics</strong>These illustrative charts show the reporting layout. Your credit, earnings and account activity below are unchanged.</div> : null}
      <div className="bill-metrics">
        {metrics(S, a).map((card) => (
          <div key={card.label} className="bill-metric">
            <span>{card.label}</span>
            <strong>{card.count ? card.value : usd(card.value)}</strong>
            <small>{card.note}</small>
          </div>
        ))}
      </div>
      <BillingChart S={S} a={a} />
      <CapacityPanel S={S} />
      <DailyTable S={S} a={a} onExport={onExport} />
      <Activity S={S} onExport={onExport} />
      <Payouts S={S} />
    </div>
  );
}

export { exportRows, csv };
