import type { SVGProps } from 'react';
type Props = SVGProps<SVGSVGElement> & { size?: number };
function Icon({ size = 24, children, ...props }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}
export function ArrowUpRightIcon(props: Props) {
  return (
    <Icon {...props}>
      <path d="M6 18 18 6M6 6h12v12" />
    </Icon>
  );
}
export function ArrowRightIcon(props: Props) {
  return (
    <Icon {...props}>
      <path d="M4 12h16m-6-6 6 6-6 6" />
    </Icon>
  );
}
export function CaretRightIcon(props: Props) {
  return (
    <Icon {...props}>
      <path d="m9 5 7 7-7 7" />
    </Icon>
  );
}
export function ListIcon(props: Props) {
  return (
    <Icon {...props}>
      <path d="M4 5h16M4 12h16M4 19h16" />
    </Icon>
  );
}
export function XIcon(props: Props) {
  return (
    <Icon {...props}>
      <path d="m5 5 14 14M5 19 19 5" />
    </Icon>
  );
}
export function ArrowsOutSimpleIcon(props: Props) {
  return (
    <Icon {...props}>
      <path d="M9 3H3v6m12-6h6v6M9 21H3v-6m12 6h6v-6M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6" />
    </Icon>
  );
}
export function MapPinIcon(props: Props) {
  return (
    <Icon {...props}>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </Icon>
  );
}
