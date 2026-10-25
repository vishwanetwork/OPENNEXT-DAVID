import type { ContactLead, LeadStatus } from '@opennext/contracts';

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
