import {
  LeadsResponse,
  LeadUpdateResponse,
  type ContactLead,
  type LeadStatus,
} from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

export const LEAD_STATUSES: LeadStatus[] = ['New', 'Contacted', 'Qualified', 'Closed'];
export const POLL_MS = 15000;

export const leadTime = (value: unknown): string => {
  const date = new Date(String(value));
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'UTC',
      })
    : '—';
};

export function filterLeads(leads: ContactLead[], query: string, filter: string): ContactLead[] {
  const q = query.toLowerCase();
  return leads.filter(
    (lead) =>
      (filter === 'All requests' || lead.status === filter) &&
      [lead.id, lead.name, lead.company, lead.title, lead.email, lead.message]
        .join(' ')
        .toLowerCase()
        .includes(q),
  );
}

export const leadsApi = {
  list: async (api: ApiClient, signal?: AbortSignal) => {
    const data = await api.get('/api/admin/contacts', { signal });
    const parsed = LeadsResponse.safeParse(data);
    if (!parsed.success)
      throw new Error('The server returned an invalid contact request list. Please refresh.');
    return parsed.data.leads;
  },
  update: async (
    api: ApiClient,
    id: string,
    body: { status: string; note: string; updatedAt: string },
  ) =>
    LeadUpdateResponse.parse(
      await api.patch('/api/admin/contacts/' + encodeURIComponent(id), body),
    ),
};
