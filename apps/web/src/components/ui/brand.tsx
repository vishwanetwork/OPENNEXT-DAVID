export const BRAND_PATH = 'M2 3 10 0v41H2V3Zm11 8 20 19v11L13 22V11ZM34 11l8 2v31h-8V11Z';

/** OpenNEXT word-mark (`.onx-brand`). */
export function Brand({ light = false, className = '' }: { light?: boolean; className?: string }) {
  return (
    <span className={['onx-brand', light ? 'onx-brand-light' : '', className].filter(Boolean).join(' ')}>
      <svg viewBox="0 0 42 44" role="img" aria-label="OpenNEXT mark">
        <path d={BRAND_PATH} />
      </svg>
      <span>OpenNEXT</span>
    </span>
  );
}
