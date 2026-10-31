import Image from 'next/image';
import type { RefObject } from 'react';
import { CaretRightIcon } from './cinematic-icons';
import { WordReveal } from './cinematic-elements';
import { RoutingNetwork } from './routing-network';
import { agentSteps } from '../lib/cinematic-data';
export function CinematicAgents({
  agentsRef,
  activeAgent,
  agentVisible,
  pageActive,
  reduced,
  agentAuto,
  selectAgent,
}: {
  agentsRef: RefObject<HTMLElement | null>;
  activeAgent: number;
  agentVisible: boolean;
  pageActive: boolean;
  reduced: boolean;
  agentAuto: boolean;
  selectAgent: (index: number) => void;
}) {
  return (
    <section id="agents" className="agents-section" ref={agentsRef} aria-labelledby="agents-title">
      <div className="container">
        <div className="agents-heading" data-reveal>
          <h2 id="agents-title">
            <WordReveal>Compute sourcing.</WordReveal>
            <br />
            <WordReveal>On autopilot, 24/7.</WordReveal>
          </h2>
          <p>
            OpenNEXT agents continuously discover GPU capacity, compare availability and terms, and
            route your request to matching resources.
          </p>
        </div>
        <div
          className="agent-experience"
          data-agent-state={activeAgent}
          data-network-playing={agentVisible && pageActive && !reduced}
          data-reveal
        >
          <div
            className="agent-visual"
            role="img"
            aria-label="An animated resource network continuously discovers, compares and routes compute requests around a GPU."
          >
            <Image
              unoptimized
              className="compute-image"
              src="/landing-design/agent-compute.webp"
              alt=""
              width="1448"
              height="1086"
              loading="lazy"
            />
            <RoutingNetwork
              phase={activeAgent}
              running={agentVisible && pageActive}
              reduced={reduced}
            />
          </div>
          <div className="agent-narrative">
            <div className="agent-copy-stack" aria-live={agentAuto ? 'off' : 'polite'}>
              {agentSteps.map((step, index) => (
                <div
                  id={`agent-copy-${index}`}
                  key={step.label}
                  className={`agent-slide ${activeAgent === index ? 'agent-slide-active' : ''}`}
                  aria-hidden={activeAgent !== index}
                >
                  <h3>{step.title}</h3>
                  <p>{step.copy}</p>
                </div>
              ))}
            </div>
            <div className="agent-tabs" role="group" aria-label="Agent routing stages">
              {agentSteps.map((step, index) => (
                <button
                  type="button"
                  key={step.label}
                  aria-pressed={activeAgent === index}
                  aria-controls={`agent-copy-${index}`}
                  onClick={() => selectAgent(index)}
                >
                  <span>{step.label}</span>
                  <CaretRightIcon size={20} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
