const TONES: Record<string, string> = {
  Active: 'green', Completed: 'green', Approved: 'green', Verified: 'green', Delivered: 'green', Published: 'green', Accepted: 'green',
  Paused: 'orange', Pending: 'orange', 'In review': 'orange', 'Awaiting approval': 'orange', 'Awaiting funds': 'orange',
  Quoted: 'blue', Reserved: 'blue', Running: 'blue', New: 'blue', Open: 'blue',
  Rejected: 'red', Failed: 'red',
};

/** Status badge. The tone is derived from the label exactly like the legacy console/terminal helpers. */
export function Badge({ label, tone, className = '' }: { label: string; tone?: string; className?: string }) {
  const resolved = tone ?? TONES[label] ?? '';
  return <span className={['badge', resolved, className].filter(Boolean).join(' ')}>{label}</span>;
}
