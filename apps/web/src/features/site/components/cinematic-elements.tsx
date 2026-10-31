import Image from 'next/image';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { NativeDialog } from '@/components/ui/dialog';
import { ArrowUpRightIcon, XIcon } from './cinematic-icons';

export function Brand({ light = false }) {
  return (
    <a className={`brand ${light ? 'brand-light' : ''}`} href="#top" aria-label="OpenNEXT home">
      <Image
        unoptimized
        loading={light ? 'eager' : 'lazy'}
        src={`/landing-design/opennext-logo-${light ? 'white' : 'navy'}.svg`}
        width="369"
        height="63"
        alt="OpenNext"
      />
    </a>
  );
}
export function LinkButton({
  href,
  children,
  kind = 'dark',
  className = '',
  arrow = true,
}: {
  href: string;
  children: ReactNode;
  kind?: string;
  className?: string;
  arrow?: boolean;
}) {
  return (
    <a className={`button button-${kind} ${className}`} href={href}>
      <span>{children}</span>
      {arrow && (
        <span className="button-arrow">
          <ArrowUpRightIcon size={18} aria-hidden="true" />
        </span>
      )}
    </a>
  );
}
export function PreviewDialog({ buyerHref, onClose }: { buyerHref: string; onClose: () => void }) {
  return (
    <NativeDialog
      className="dialog"
      labelledBy="landing-preview-title"
      onClose={onClose}
      lockScroll
    >
      <div className="dialog-heading">
        <h2 id="landing-preview-title">GPU Market</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
          <XIcon size={24} />
        </button>
      </div>
      <div className="dialog-image">
        <Image
          unoptimized
          src="/landing-design/terminal-market-v6.png"
          alt="OpenNEXT Buyer GPU Market"
          width="1280"
          height="720"
        />
      </div>
      <div className="dialog-bottom">
        <p>Explore the workspace, then continue in OpenNEXT Terminal.</p>
        <LinkButton href={buyerHref}>Open Terminal</LinkButton>
      </div>
    </NativeDialog>
  );
}
export function WordReveal({ children, className = '' }: { children: string; className?: string }) {
  return (
    <span className={`word-reveal ${className}`} aria-label={children}>
      {children.split(' ').map((word, index) => (
        <span className="word-mask" aria-hidden="true" key={`${word}-${index}`}>
          <span style={{ '--delay': `${index * 45}ms` } as CSSProperties}>{word}&nbsp;</span>
        </span>
      ))}
    </span>
  );
}
export function RollingNumber({
  value,
  label,
  prefix = '',
  suffix = '',
  paused,
}: {
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
  paused: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setEntered(true);
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`rolling-number ${entered ? 'number-entered' : ''} ${paused ? 'number-static' : ''}`}
      role="img"
      aria-label={label}
    >
      <span aria-hidden="true">{prefix}</span>
      {String(value)
        .split('')
        .map((digit, index) => (
          <span className="digit-window" key={index} aria-hidden="true">
            <span
              className="digit-track"
              style={
                {
                  '--end': Number(digit) + 20,
                  '--digit-delay': `${index * 110}ms`,
                } as CSSProperties
              }
            >
              {Array.from({ length: 30 }, (_, i) => (
                <span key={i}>{i % 10}</span>
              ))}
            </span>
          </span>
        ))}
      <span className="number-suffix" aria-hidden="true">
        {suffix}
      </span>
    </div>
  );
}
