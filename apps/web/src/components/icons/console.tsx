const PATHS: Record<string, string> = {
  leads: 'M3 5h18v14H3zM3 6l9 7 9-7',
  overview: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  market: 'M3 17l5-5 4 3 8-10M15 5h5v5',
  advisory: 'M12 3l9 9-9 9-9-9zM12 8v5M12 16h.01',
  orders: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h3',
  instances: 'M3 4h18v12H3zM8 20h8M12 16v4M7 8h.01M10 8h7M7 12h10',
  schedules: 'M12 3a9 9 0 1 1-7 3M3 3v5h5M12 7v5l3 2',
  agent: 'M8 8h8v8H8zM9 3v5M15 3v5M9 16v5M15 16v5M3 9h5M3 15h5M16 9h5M16 15h5',
  billing: 'M3 6h18v14H3zM3 10h18M7 15h3M5 3h14',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  audit: 'M9 3h9v18H6V6M9 3v4H5M9 11h6M9 15h6',
  chevron: 'm9 5 7 7-7 7',
  down: 'm6 9 6 6 6-6',
  close: 'm6 6 12 12M6 18 18 6',
  search: 'M21 21l-5-5M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 2M4 17l2 2a7 7 0 0 0 12-2',
  export: 'M12 3v12M7 10l5 5 5-5M4 15v6h16v-6',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  check: 'm5 12 4 4 10-10',
  key: 'M14 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12M9 13l-6 6v3h3v-3h3v-3M15 7h.01',
  shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  logout: 'M10 3H4v18h6M10 12h11M17 8l4 4-4 4',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v6M12 7h.01',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',
  arrow: 'M4 12h16M14 6l6 6-6 6',
  play: 'M8 4l12 8-12 8z',
  upload: 'M12 16V3M7 8l5-5 5 5M4 15v6h16v-6',
  database: 'M4 6a8 3 0 1 0 16 0 8 3 0 1 0-16 0M4 6v6c0 4 16 4 16 0V6M4 12v6c0 4 16 4 16 0v-6',
  terminal: 'm4 6 5 6-5 6M12 18h8',
  copy: 'M8 8h13v13H8zM16 8V3H3v13h5',
  external: 'M14 3h7v7M10 14 21 3M10 3H3v18h18v-7',
  file: 'M14 2H5v20h14V7l-5-5M14 2v6h5M8 12h8M8 16h5',
};

export type ConsoleIconName = keyof typeof PATHS | string;

/** Stroke icons from the legacy console (`.icon`). Unknown names fall back to the overview grid. */
export function ConsoleIcon({ name, className = 'icon' }: { name: ConsoleIconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name] || PATHS.overview} />
    </svg>
  );
}

export const CONSOLE_LOGO_PATH = 'M2 3 10 0v41H2V3Zm11 8 20 19v11L13 22V11ZM34 11l8 2v31h-8V11Z';
