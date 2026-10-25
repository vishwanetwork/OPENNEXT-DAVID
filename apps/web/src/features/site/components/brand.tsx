'use client';

import { useApp } from '@/components/providers/app-context';

const MARK =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2042%2044%22%20fill%3D%22none%22%3E%3Cpath%20d%3D%22M2%203%2010%200v41H2V3Zm11%208%2020%2019v11L13%2022V11ZM34%2011l8%202v31h-8V11Z%22%20fill%3D%22%23111%22%2F%3E%3C%2Fsvg%3E%0A';

export function LogoMarkup() {
  return (
    <span className="on-brand">
      {/* eslint-disable-next-line @next/next/no-img-element -- inline data URI mark, no optimisation needed */}
      <img className="on-brand-mark" src={MARK} alt="" width={30} height={32} />
      <span>OpenNEXT</span>
    </span>
  );
}

/** Brand link: returns to the top of the public site. */
export function BrandLink() {
  const { crossHref } = useApp();
  return (
    <a
      className="on-brand-link"
      href={crossHref('site', '/')}
      data-public-action="home"
      aria-label="OpenNEXT"
      onClick={(event) => {
        if (window.location.pathname === '/' || window.location.pathname === '') {
          event.preventDefault();
          window.scrollTo(0, 0);
        }
      }}
    >
      <LogoMarkup />
    </a>
  );
}
