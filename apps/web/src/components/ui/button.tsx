import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'small'
  | 'secondary small'
  | 'ghost small';

/** Terminal button. Class names match the legacy stylesheet (`btn`, `secondary`, `ghost`, `small`). */
export function Button({
  variant = 'secondary',
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; children: ReactNode }) {
  const classes = ['btn', variant === 'primary' ? '' : variant, className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
