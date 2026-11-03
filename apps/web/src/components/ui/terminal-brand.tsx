import Image from 'next/image';

/** Original angular-N OpenNEXT lockup, shared by Terminal and authentication. */
export function TerminalBrand({ light = false }: { light?: boolean }) {
  return (
    <span className="onx-brand buyer-brand-lockup">
      <Image
        src={`/terminal-design/opennext-logo-${light ? 'white' : 'navy'}.svg`}
        alt="OpenNEXT"
        width={260}
        height={52}
        unoptimized
      />
    </span>
  );
}
