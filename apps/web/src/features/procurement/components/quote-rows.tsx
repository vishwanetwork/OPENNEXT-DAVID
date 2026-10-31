'use client';

import type { OwnedRfq, Quote } from '@opennext/contracts';
import { money } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { useApi } from '@/components/providers/api-context';
import { useTerminal } from '@/terminal-kit';
import { procurementApi } from '../api';
import { FEE_LABEL, currentFees } from '../fees';
import { isHardware, isModel, unitSuffix } from '../exchange';
import { useRunServer } from '../hooks';
import { PBtn, date, deliveryTime } from './shared';

const tokenPrice = (v: unknown) =>
  '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 });

const expired = (q: Quote) => !q.validUntil || new Date(q.validUntil) <= new Date();

export function QuoteRows({ r }: { r: OwnedRfq }) {
  const { openModal } = useTerminal();
  const api = useApi();
  const toast = useToast();
  const { run, busy } = useRunServer();
  const quotes = (r.quotes || []).filter((q) => q.status === 'Pending');
  const reject = (q: Quote) =>
    void run(async () => {
      if (!r.serverRecord) throw new Error('Refresh the verified quotation record.');
      await procurementApi.decideQuote(api, r.id, q.id, 'reject');
      toast('Quote rejected.');
    });
  return (
    <>
      <div className="row spread">
        <h3>{r.originSupply ? 'Selected supplier quotation' : 'Competing supplier quotes'}</h3>
        <span className="form-note">{quotes.length} to review</span>
      </div>
      {quotes.length ? (
        quotes.map((q) => (
          <article key={q.id} className="proc-quote">
            <div className="row spread">
              <div>
                <strong>{q.provider}</strong>
                <small className="proc-sub">
                  {q.id}
                  {q.sample ? ' Preview quote' : ''}
                </small>
              </div>
              <strong>
                {money(q.price)}
                {unitSuffix(r)}
              </strong>
            </div>
            {isModel(r) && q.input != null && q.output != null ? (
              <p className="form-note">
                Input {tokenPrice(q.input)} / 1M tokens Output {tokenPrice(q.output)} / 1M tokens
              </p>
            ) : null}
            <div className="proc-quote-meta">
              <span>Base {money(q.subtotal ?? q.total)}</span>
              <span>
                {currentFees(q)
                  ? FEE_LABEL + ' ' + money(q.buyerFee) + ' Total payable ' + money(q.buyerTotal)
                  : 'Updated fee breakdown required'}
              </span>
              <span>Delivery {deliveryTime(q.delivery, r)}</span>
              <span>
                {isHardware(r) ? 'Warranty' : 'SLA'} {q.sla || 'Confirm'}
              </span>
              <span>{expired(q) ? 'Expired' : 'Valid until ' + date(q.validUntil)}</span>
            </div>
            <p className="form-note">
              {q.deliveryMethod || r.deliveryMethod} {q.notes || 'Terms attached to the quotation.'}
            </p>
            <div className="row">
              <PBtn
                data-act="proc-quote-details"
                data-id={r.id}
                data-quote={q.id}
                onClick={() => openModal('proc-quote-details', { id: r.id, quoteId: q.id })}
              >
                Details
              </PBtn>
              <span className="gap"></span>
              <PBtn
                busy={busy}
                data-act="proc-reject"
                data-id={r.id}
                data-quote={q.id}
                disabled={busy}
                onClick={() => reject(q)}
              >
                Reject
              </PBtn>
              <button
                type="button"
                className="btn small"
                data-act="proc-accept-review"
                data-id={r.id}
                data-quote={q.id}
                disabled={expired(q)}
                onClick={() => openModal('proc-accept-review', { id: r.id, quoteId: q.id })}
              >
                Accept
              </button>
            </div>
          </article>
        ))
      ) : (
        <p className="form-note">No pending quotes. Rejected quotes remain in the audit trail.</p>
      )}
    </>
  );
}
