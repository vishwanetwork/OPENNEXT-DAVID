const PATHS = {
  left: <path d="m14 6-6 6 6 6" />,
  right: <path d="m10 6 6 6-6 6" />,
  pause: <path d="M9 6v12M15 6v12" />,
  play: <path d="m9 5 10 7-10 7V5Z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" />
    </>
  ),
} as const;

export type ListingIconName = keyof typeof PATHS;

/** Stroke icons used by the listing carousel (legacy `icon()` in home-listings.js). */
export function ListingIcon({ name }: { name: ListingIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

export const Arrow = () => <span aria-hidden="true">→</span>;
