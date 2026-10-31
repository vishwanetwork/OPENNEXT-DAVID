import Image from 'next/image';

/** Selected OpenNEXT E lockup, scoped to the Buyer terminal and authentication. */
export function TerminalBrand({ light = false }: { light?: boolean }) {
  return (
    <span className="onx-brand buyer-brand-lockup">
      <Image
        src={`/terminal-design/opennext-logo-${light ? 'white' : 'navy'}.svg`}
        alt="OpenNEXT"
        width={369}
        height={63}
        unoptimized
      />
    </span>
  );
}
