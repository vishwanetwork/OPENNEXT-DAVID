'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/providers/app-context';
import { workspacePath } from '../lib/workspace-links';
import { CinematicHeader } from './cinematic-header';
import { CinematicIntro } from './cinematic-intro';
import { CinematicTerminal } from './cinematic-terminal';
import { CinematicAgents } from './cinematic-agents';
import { CinematicClosing, CinematicFooter } from './cinematic-closing';
import { PreviewDialog } from './cinematic-elements';
import { useChoreography, usePageActive, useReducedMotion } from './use-cinematic-motion';
import '../styles/cinematic-landing.css';
import '../styles/cinematic-agent.css';
import '../styles/cinematic-capacity.css';

export function CinematicLandingPage() {
  const { crossHref } = useApp();
  const buyerHref = crossHref('terminal', workspacePath({ route: 'market', role: 'buyer' }));
  const supplierHref = crossHref('terminal', workspacePath({ route: 'supply', role: 'seller' }));
  const [scrolled, setScrolled] = useState(false),
    [heroCollapsed, setHeroCollapsed] = useState(false),
    [menuOpen, setMenuOpen] = useState(false),
    [activeProduct, setActiveProduct] = useState(0),
    [activeAgent, setActiveAgent] = useState(0),
    [agentAuto, setAgentAuto] = useState(true),
    [agentVisible, setAgentVisible] = useState(false),
    [modal, setModal] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null),
    agentsRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotion(),
    pageActive = usePageActive();
  useChoreography(setScrolled, setActiveProduct, setHeroCollapsed);
  useEffect(() => {
    const node = agentsRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setAgentVisible(Boolean(entry?.isIntersecting)),
      { threshold: 0.16 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (reduced || !agentAuto || !agentVisible || !pageActive) return;
    const timer = setInterval(() => setActiveAgent((value) => (value + 1) % 3), 4000);
    return () => clearInterval(timer);
  }, [reduced, agentAuto, agentVisible, pageActive]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menuOpen) {
        setMenuOpen(false);
        menuTrigger.current?.focus();
      }
    };
    addEventListener('keydown', escape);
    return () => removeEventListener('keydown', escape);
  }, [menuOpen]);
  const closePreview = useCallback(() => setModal(false), []);
  const chooseStep = (index: number) => {
    setActiveProduct(index);
    document
      .getElementById(`product-step-${index}`)
      ?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'center' });
  };
  const selectAgent = (index: number) => {
    setActiveAgent(index);
    setAgentAuto(false);
  };
  return (
    <div className="opennext-landing" data-motion={reduced ? 'paused' : 'playing'}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <CinematicHeader {...{ scrolled, menuOpen, setMenuOpen, menuTrigger, buyerHref }} />
      <main id="main">
        <CinematicIntro {...{ heroCollapsed, buyerHref, supplierHref }} />
        <CinematicTerminal
          {...{ activeProduct, chooseStep, buyerHref }}
          openPreview={() => setModal(true)}
        />
        <CinematicAgents
          {...{ agentsRef, activeAgent, agentVisible, pageActive, reduced, agentAuto, selectAgent }}
        />
        <CinematicClosing {...{ reduced, buyerHref, supplierHref }} />
      </main>
      <CinematicFooter />
      {modal && <PreviewDialog buyerHref={buyerHref} onClose={closePreview} />}
    </div>
  );
}
