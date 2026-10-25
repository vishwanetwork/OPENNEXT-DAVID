/** Workspace export (legacy `download()`): CSV for one collection, JSON for the whole workspace. */

export function csvFrom(rows: Record<string, unknown>[]): string {
  const cols = [...new Set(rows.flatMap(Object.keys))].filter((k) => !['quotes', 'accepted', 'review'].includes(k));
  return (
    cols.join(',') +
    '\n' +
    rows
      .map((r) =>
        cols
          .map(
            (c) =>
              '"' +
              String(typeof r[c] === 'object' && r[c] !== null ? JSON.stringify(r[c]) : (r[c] ?? ''))
                .replace(/^[=+@\t\r-]/, (m) => "'" + m)
                .replace(/"/g, '""') +
              '"',
          )
          .join(','),
      )
      .join('\n')
  );
}

export function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadWorkspace(type: string, data: unknown) {
  const json = type === 'workspace';
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const text = json ? JSON.stringify(data, null, 2) : csvFrom(rows);
  downloadText('OpenNEXT-' + type + (json ? '.json' : '.csv'), text, json ? 'application/json' : 'text/csv');
}
