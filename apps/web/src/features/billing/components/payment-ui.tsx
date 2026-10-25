'use client';

export const Btn = ({
  act,
  primary = false,
  children,
  onClick,
  id,
  type = 'button',
}: {
  act?: string;
  primary?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  id?: string;
  type?: 'button' | 'submit';
}) => (
  <button
    type={type === 'submit' ? 'submit' : 'button'}
    className={`btn ${primary ? '' : 'secondary'}`}
    data-act={act}
    data-id={id}
    onClick={onClick}
  >
    {children}
  </button>
);
