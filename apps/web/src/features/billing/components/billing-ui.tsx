'use client';

export const Btn = ({
  act,
  primary = false,
  children,
  onClick,
  value,
  id,
  pressed,
}: {
  act: string;
  primary?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  value?: string;
  id?: string;
  pressed?: boolean;
}) => (
  <button
    type="button"
    className={`btn ${primary ? '' : 'secondary'} small`}
    data-act={act}
    data-value={value}
    data-id={id}
    aria-pressed={pressed}
    onClick={onClick}
  >
    {children}
  </button>
);

export const Detail = ({ label, value }: { label: string; value: unknown }) => (
  <div>
    <small>{label}</small>
    <strong>{value == null || value === '' ? 'Not recorded' : String(value)}</strong>
  </div>
);
