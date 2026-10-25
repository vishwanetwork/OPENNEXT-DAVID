'use client';

import { useState, type FormEvent } from 'react';
import type { ContactLead } from '@opennext/contracts';
import { ApiError } from '@/lib/api/client';
import { useApi } from '@/components/providers/api-context';
import { NativeDialog, isAccessError } from '@/features/console';
import { leadsApi } from './api';
import { LEAD_STATUSES, leadTime } from './leads';

export function LeadDetails({
  id,
  version,
  leads,
  onClose,
  onSaved,
  onAccessLost,
}: {
  id: string;
  version: string;
  leads: ContactLead[];
  onClose: () => void;
  onSaved: (lead: ContactLead) => void;
  onAccessLost: (message: string) => void;
}) {
  const api = useApi();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const lead = leads.find((item) => item.id === id);
  if (!lead) return null;
  // The editor keeps the version the operator opened; polling only shows a passive hint.
  const changed = String(lead.updatedAt || '') !== version;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (saving) return;
    const data = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    try {
      const result = await leadsApi.update(api, id, {
        status: String(data.get('status')),
        note: String(data.get('note')),
        updatedAt: version,
      });
      if (result.lead?.id === id) onSaved(result.lead);
      else onSaved({ ...lead, status: String(data.get('status')) });
    } catch (e) {
      if (isAccessError(e)) {
        onAccessLost(e instanceof Error ? e.message : 'Administrator access required.');
        return;
      }
      setError(
        e instanceof ApiError && e.status === 409
          ? 'This request has changed. Your draft has been preserved. Copy any notes, close the details, and reopen the latest version before saving.'
          : e instanceof Error
            ? e.message
            : 'The request failed.',
      );
    } finally {
      setSaving(false);
    }
  };
  const info: [string, unknown][] = [
    ['Name', lead.name],
    ['Title', lead.title],
    ['Email', lead.email],
    ['Company', lead.company],
    ['Submitted time · UTC', leadTime(lead.createdAt)],
    ['Source', lead.source],
  ];
  return (
    <NativeDialog className="on-lead-dialog" labelledBy="on-lead-heading" onClose={onClose}>
      <header>
        <h2 id="on-lead-heading">{lead.id}</h2>
        <button type="button" className="btn" onClick={onClose} aria-label="Close request details">
          ×
        </button>
      </header>
      <div className="on-lead-detail-grid">
        {info.map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{String(value ?? '')}</strong>
          </div>
        ))}
      </div>
      <h3>How can we help?</h3>
      <div className="on-lead-message">{lead.message}</div>
      <form onSubmit={submit} data-lead-form="update">
        <p className="on-lead-changed" role="status" hidden={!changed}>
          This request was updated elsewhere. Your draft has been preserved. Copy any notes before
          reopening the latest version.
        </p>
        <div className="on-lead-form-row">
          <label>
            Status
            <select name="status" defaultValue={String(lead.status)}>
              {LEAD_STATUSES.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          <label>
            Internal note <span>(optional)</span>
            <textarea
              name="note"
              rows={3}
              maxLength={2000}
              placeholder="Next step, assigned owner or follow-up context"
            />
          </label>
        </div>
        <p className="on-lead-form-error" role="alert" hidden={!error}>
          {error}
        </p>
        <button className="btn primary" type="submit" disabled={saving}>
          Save update
        </button>
      </form>
      <h3>Request history</h3>
      <ol className="on-lead-history">
        {(Array.isArray(lead.history) ? lead.history : []).map((item, i) => (
          <li key={i}>
            <strong>{item.status}</strong>
            <time>{leadTime(item.at)} UTC</time>
            {item.note ? <p>{item.note}</p> : null}
          </li>
        ))}
      </ol>
    </NativeDialog>
  );
}
