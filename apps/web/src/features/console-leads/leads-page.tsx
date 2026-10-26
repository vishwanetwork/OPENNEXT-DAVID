'use client';

import './console-leads.css';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ContactLead } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { AdminLoginForm, NativeDialog, isAccessError } from '@/features/console';
import { leadsApi } from './api';
import { LEAD_STATUSES, POLL_MS, filterLeads, leadTime } from './leads';
import { LeadDetails } from './lead-details';

type Dialog = { kind: 'details'; id: string; version: string } | { kind: 'login' };

/** Contact requests inbox (legacy OpenNEXT-console-leads.js). */
export function ConsoleLeadsPage() {
  const params = useSearchParams();
  const api = useApi();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState(() => params.get('record') || '');
  const [filter, setFilter] = useState('All requests');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const leads = useQuery({
    queryKey: ['admin', 'contacts'],
    queryFn: ({ signal }) => leadsApi.list(api, signal),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const blocked = isAccessError(leads.error);
  const rows: ContactLead[] = blocked ? [] : (leads.data ?? []);
  // A failed poll shows its error; a healthy poll shows the last action notice. Access loss closes the editor.
  const shownNotice = leads.error
    ? {
        text: leads.error instanceof Error ? leads.error.message : 'The request failed.',
        error: true,
      }
    : notice;
  const detailsOpen = dialog?.kind === 'details' && !blocked ? dialog : null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'contacts'] });
  const matches = filterLeads(rows, query, filter);
  return (
    <section className="on-leads">
      <div className="page-head">
        <div>
          <h1>Contact requests</h1>
          <p>Website enquiries, ready for a personal follow-up.</p>
        </div>
        <button type="button" className="btn" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <div
        className={`on-leads-message${shownNotice?.error ? ' is-error' : ''}`}
        role="status"
        hidden={!shownNotice}
      >
        {shownNotice?.text}
      </div>
      <div className="on-leads-stats">
        {LEAD_STATUSES.map((status) => (
          <div key={status}>
            <span>{status}</span>
            <strong>{rows.filter((lead) => lead.status === status).length}</strong>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="on-leads-toolbar">
          <label>
            <span className="sr-only">Search contact requests</span>
            <input
              type="search"
              maxLength={256}
              placeholder="Search name, company, email or request…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Request status</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              {['All requests', ...LEAD_STATUSES].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="on-leads-table">
          {blocked ? (
            <div className="on-leads-empty">
              <strong>Administrator access required</strong>
              <p>Connect the server administrator session to view private contact details.</p>
              <button
                type="button"
                className="btn primary"
                onClick={() => setDialog({ kind: 'login' })}
              >
                Connect administrator session
              </button>
            </div>
          ) : leads.isPending ? (
            <p className="on-leads-empty">Loading contact requests…</p>
          ) : matches.length ? (
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Company</th>
                  <th>
                    Submitted time <small>UTC</small>
                  </th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Request details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {matches.map((lead) => {
                  const status = LEAD_STATUSES.includes(lead.status as never)
                    ? String(lead.status)
                    : 'Unknown';
                  return (
                    <tr key={lead.id}>
                      <td>
                        <strong className="on-lead-email">{lead.email}</strong>
                        <small>{lead.name}</small>
                      </td>
                      <td>
                        <strong>{lead.company}</strong>
                        <small>{lead.title}</small>
                      </td>
                      <td className="on-lead-submitted">{leadTime(lead.createdAt)}</td>
                      <td>
                        <span className={`on-lead-status ${status.toLowerCase()}`}>{status}</span>
                      </td>
                      <td className="on-lead-action-cell">
                        <button
                          type="button"
                          className="btn small"
                          aria-label={`View details for ${lead.email}`}
                          onClick={() =>
                            setDialog({
                              kind: 'details',
                              id: lead.id,
                              version: String(lead.updatedAt || ''),
                            })
                          }
                        >
                          Detail
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="on-leads-empty">
              <strong>{rows.length ? 'No matching requests' : 'No contact requests yet'}</strong>
              <p>
                {rows.length
                  ? 'Try a different search or status.'
                  : 'Submissions from the website Contact us form will appear here.'}
              </p>
            </div>
          )}
        </div>
      </section>
      <p className="on-leads-footnote">
        Private customer data · Refreshes automatically while this page is open · Status changes do
        not send emails automatically.
      </p>
      {dialog?.kind === 'login' ? (
        <NativeDialog
          className="on-lead-dialog"
          labelledBy="on-lead-heading"
          onClose={() => setDialog(null)}
        >
          <header>
            <h2 id="on-lead-heading">Administrator session</h2>
            <button
              type="button"
              className="btn"
              onClick={() => setDialog(null)}
              aria-label="Close request details"
            >
              ×
            </button>
          </header>
          <AdminLoginForm
            intro={
              <p>
                Use your OpenNEXT server administrator token. It is exchanged for a short-lived,
                HTTP-only session.
              </p>
            }
            errorClassName="on-lead-form-error"
            onConnected={async () => {
              setDialog(null);
              await refresh();
            }}
          />
        </NativeDialog>
      ) : null}
      {detailsOpen ? (
        <LeadDetails
          id={detailsOpen.id}
          version={detailsOpen.version}
          leads={rows}
          onClose={() => setDialog(null)}
          onSaved={(lead) => {
            queryClient.setQueryData<ContactLead[]>(['admin', 'contacts'], (current) =>
              (current || []).map((item) => (item.id === lead.id ? lead : item)),
            );
            setNotice({ text: 'Request status saved. No email has been sent.', error: false });
            setDialog({ kind: 'details', id: lead.id, version: String(lead.updatedAt || '') });
            void refresh();
          }}
          onAccessLost={(message) => {
            setDialog(null);
            setNotice({ text: message, error: true });
            void refresh();
          }}
        />
      ) : null}
    </section>
  );
}
