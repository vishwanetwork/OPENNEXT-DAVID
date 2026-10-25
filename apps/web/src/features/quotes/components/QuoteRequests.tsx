'use client';

import { useOpenModal } from '@/features/terminal/context';
import { formatDate, visibleStatus } from '../notifications';
import { useQuoteNotifications } from '../hooks';
import '../quotes.css';

/** "Quote requests" section for the RFQ page (legacy `requests()`). */
export function QuoteRequests() {
  const { requests } = useQuoteNotifications();
  const openModal = useOpenModal();
  return (
    <section className="qp-requests" data-qp-requests>
      <div className="qp-request-heading">
        <div>
          <h2>Quote requests</h2>
          <p>
            On-demand and Reserved requirements. Operations approval is required before publication.
          </p>
        </div>
      </div>
      {requests.length ? (
        <div className="qp-table-scroll">
          <table className="qp-request-table">
            <thead>
              <tr>
                <th>Request</th>
                <th>Resource</th>
                <th>Term</th>
                <th>Quantity</th>
                <th>Submitted</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={String(r.id)}>
                  <td>
                    {String(r.id)}
                    <small>{String(r.project ?? '')}</small>
                  </td>
                  <td>
                    <strong>{String(r.model ?? '')}</strong>
                    <small>{String(r.region ?? '')}</small>
                  </td>
                  <td>
                    {String(r.term ?? '')}
                    <small>{String(r.hours ?? '')} hours</small>
                  </td>
                  <td>{String(r.count ?? '')} GPUs</td>
                  <td>{formatDate(r.createdAt || r.created)}</td>
                  <td>
                    <span className="qp-status">{visibleStatus(r)}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn secondary small"
                      data-qp-action="request"
                      data-qp-id={String(r.id)}
                      onClick={() => openModal('proc-request-details', { id: r.id })}
                    >
                      View details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="qp-request-empty">
          Choose <strong>Ask for quote</strong> on an On-demand or Reserved resource to send your
          requirements.
        </p>
      )}
    </section>
  );
}
