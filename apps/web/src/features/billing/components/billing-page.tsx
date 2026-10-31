'use client';

import { type FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { downloadText, useBalance, useTerminal } from '@/terminal-kit';
import { useBillingData } from '../hooks';
import { analytics, csv, dateKey, exportRows, metrics, num, usd } from '../analytics';
import { useBillingUi } from '../ui-store';
import { Btn } from './billing-ui';
import { BillingChart } from './billing-chart';
import { Activity, CapacityPanel, DailyTable, Payouts } from './billing-panels';

/** Billing & usage / Earnings & payouts page (legacy `OpenNEXTBilling.page`). */
export function BillingPage() {
  const accountBilling = useBillingData();
  const billing = {
    ...accountBilling,
    billingUI: { ...accountBilling.billingUI, sample: false },
  };
  const ui = useBillingUi();
  const { openModal } = useTerminal();
  const toast = useToast();
  const { available: balance, earnings: earningsBalance } = useBalance();
  const a = analytics(billing);
  const r = billing.role;
  const onExport = (type: string, id?: string) => {
    const rows = exportRows(billing, type, id);
    if (!rows.length) return toast('No records to export in this period');
    downloadText('OpenNEXT-' + type + '.csv', csv(rows), 'text/csv;charset=utf-8');
  };
  const applyFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const from = dateKey(data.from);
    const to = dateKey(data.to);
    if (!from || !to || from > to || Date.parse(to) - Date.parse(from) > 365 * 86400000)
      return toast('Choose a valid range of up to 366 days');
    ui.patch({ from, to });
  };
  return (
    <div className="page-content bill-page">
      <div className="page-heading">
        <div>
          <h1>{r === 'seller' ? 'Earnings & payouts' : 'Billing & usage'}</h1>
          <p>
            {r === 'seller'
              ? 'Track sales, delivery settlement and withdrawals.'
              : 'Manage your credit and understand your capacity spending.'}
          </p>
        </div>
        <div className="bill-actions">
          {r !== 'seller' ? (
            <Btn act="pay-start" primary onClick={() => openModal('pay-start')}>
              Add credit
            </Btn>
          ) : null}
          {r !== 'buyer' ? (
            <Btn act="cashout-start" primary onClick={() => openModal('cashout-start')}>
              Cash out
            </Btn>
          ) : null}
        </div>
      </div>
      <div className="bill-wallets">
        <section className="bill-wallet">
          <span>Available credit</span>
          <strong>{usd(balance)}</strong>
          <p>For purchases and usage charges</p>
          {r === 'seller' ? (
            <Btn act="pay-start" onClick={() => openModal('pay-start')}>
              Add credit
            </Btn>
          ) : null}
        </section>
        {r !== 'buyer' ? (
          <>
            <section className="bill-wallet">
              <span>Available to withdraw</span>
              <strong>{usd(earningsBalance)}</strong>
              <p>Settled earnings, excluding prepaid credit</p>
            </section>
            <section className="bill-wallet">
              <span>Payouts in progress</span>
              <strong>
                {usd(
                  billing.payouts
                    .filter((p) => p.status === 'Pending')
                    .reduce((sum, p) => sum + num(p.amount), 0),
                )}
              </strong>
              <p>Already reserved from withdrawable earnings</p>
            </section>
          </>
        ) : (
          <section className="bill-wallet bill-wallet-note">
            <strong>One account. Clear records.</strong>
            <p>
              Your welcome credit is a one-time, non-withdrawable reward. Additional credit is added
              after verified payment. Orders and delivery records stay linked.
            </p>
          </section>
        )}
      </div>
      <div className="bill-controls">
        <form data-form="bill-filter" className="bill-date-filter" onSubmit={applyFilter}>
          <label>
            From
            <input className="field" type="date" name="from" defaultValue={ui.from} required />
          </label>
          <label>
            To
            <input className="field" type="date" name="to" defaultValue={ui.to} required />
          </label>
          <button type="submit" className="btn secondary small">
            Apply
          </button>
        </form>
      </div>
      <div className="bill-metrics">
        {metrics(billing, a).map((card) => (
          <div key={card.label} className="bill-metric">
            <span>{card.label}</span>
            <strong>{card.count ? card.value : usd(card.value)}</strong>
            <small>{card.note}</small>
          </div>
        ))}
      </div>
      <BillingChart billing={billing} a={a} />
      <CapacityPanel billing={billing} />
      <DailyTable billing={billing} a={a} onExport={onExport} />
      <Activity billing={billing} onExport={onExport} />
      <Payouts billing={billing} />
    </div>
  );
}

export { exportRows, csv };
export { Detail } from './billing-ui';
