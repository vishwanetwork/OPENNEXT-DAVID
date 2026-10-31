import type { RefObject } from 'react';
import { ArrowRightIcon, ListIcon, XIcon } from './cinematic-icons';
import { Brand, LinkButton } from './cinematic-elements';
import { navigation } from '../lib/cinematic-data';
export function CinematicHeader({
  scrolled,
  menuOpen,
  setMenuOpen,
  menuTrigger,
  buyerHref,
}: {
  scrolled: boolean;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  menuTrigger: RefObject<HTMLButtonElement | null>;
  buyerHref: string;
}) {
  return (
    <header
      className={`header ${scrolled ? 'header-scrolled' : ''} ${menuOpen ? 'menu-open' : ''}`}
    >
      <div className="header-inner">
        <Brand light />
        <nav aria-label="Main navigation">
          {navigation.map(([label, id]) => (
            <a href={`#${id}`} key={id}>
              {label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <LinkButton href={buyerHref} kind="white" className="header-cta" arrow={false}>
            Open Terminal
          </LinkButton>
          <button
            type="button"
            ref={menuTrigger}
            className="icon-button menu-toggle"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <XIcon size={24} /> : <ListIcon size={24} />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav id="mobile-menu" className="mobile-nav" aria-label="Mobile navigation">
          {navigation.map(([label, id]) => (
            <a href={`#${id}`} key={id} onClick={() => setMenuOpen(false)}>
              {label}
              <ArrowRightIcon size={19} />
            </a>
          ))}
          <LinkButton href={buyerHref} kind="white">
            Open Terminal
          </LinkButton>
        </nav>
      )}
    </header>
  );
}
