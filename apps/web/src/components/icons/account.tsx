import type { ReactNode } from 'react';

const Svg = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const AccountIcons = {
  user: () => (
    <Svg>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
    </Svg>
  ),
  key: () => (
    <Svg>
      <circle cx="8" cy="8" r="4.5" />
      <path d="m11.3 11.3 9 9m-4-4 2-2m-.5 4.5 2-2" />
    </Svg>
  ),
  shield: () => (
    <Svg>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
      <path d="m8.5 12 2.3 2.3 4.7-4.8" />
    </Svg>
  ),
  copy: () => (
    <Svg>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V4H4v12h4" />
    </Svg>
  ),
  settings: () => (
    <Svg>
      <path d="m10 3-.5 2-2 .9-1.8-.7-2 3.5 1.5 1.3v2l-1.5 1.3 2 3.5 1.8-.7 2 .9.5 2h4l.5-2 2-.9 1.8.7 2-3.5-1.5-1.3v-2l1.5-1.3-2-3.5-1.8.7-2-.9L14 3Z" />
      <circle cx="12" cy="11" r="3" />
    </Svg>
  ),
};
