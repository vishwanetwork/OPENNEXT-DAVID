import { useEffect, useSyncExternalStore } from 'react';
import { heroIsAnimated, heroTimeline } from '../lib/hero-timeline';
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const subscribeReduced = (notify: () => void) => {
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};
const getReduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const subscribeVisibility = (notify: () => void) => {
  document.addEventListener('visibilitychange', notify);
  return () => document.removeEventListener('visibilitychange', notify);
};
export function useReducedMotion() {
  return useSyncExternalStore(subscribeReduced, getReduced, () => false);
}
export function usePageActive() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => !document.hidden,
    () => true,
  );
}
export function useChoreography(
  setScrolled: (v: boolean) => void,
  setActiveProduct: (v: number) => void,
  setHeroCollapsed: (v: boolean) => void,
  setPartnersHidden: (v: boolean) => void,
) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.opennext-landing');
    const hero = root?.querySelector<HTMLElement>('.hero-scroll');
    const stage = root?.querySelector<HTMLElement>('.hero-stage');
    const partners = root?.querySelector<HTMLElement>('.hero-partners');
    const product = root?.querySelector<HTMLElement>('.product-story');
    const footer = root?.querySelector<HTMLElement>('.closing');
    if (!root || !hero || !product || !footer) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const update = () => {
      frame = 0;
      setScrolled(scrollY > 72);
      const rect = hero.getBoundingClientRect();
      const animated = heroIsAnimated(innerWidth, innerHeight, reduce.matches);
      const progress = animated
        ? clamp(-rect.top / Math.max(1, rect.height - (stage?.offsetHeight ?? innerHeight)))
        : 0;
      const timeline = heroTimeline(progress);
      setHeroCollapsed(animated && timeline.copyHidden);
      setPartnersHidden(animated && timeline.partnersHidden);
      hero.style.setProperty('--hero-progress', timeline.morph.toFixed(4));
      hero.style.setProperty('--hero-copy-opacity', String(timeline.copyOpacity));
      hero.style.setProperty('--hero-copy-y', `${timeline.copyY}px`);
      hero.style.setProperty('--morph-opacity', String(timeline.morphOpacity));
      hero.style.setProperty('--partners-progress', String(timeline.partners));
      hero.style.setProperty('--partners-visibility', timeline.partners > 0 ? 'visible' : 'hidden');
      hero.style.setProperty('--partners-height', `${partners?.offsetHeight ?? 0}px`);
      let closest = 0,
        distance = Infinity;
      root.querySelectorAll('[data-product-step]').forEach((el, index) => {
        const d = Math.abs(el.getBoundingClientRect().top - innerHeight * 0.35);
        if (d < distance) {
          closest = index;
          distance = d;
        }
      });
      const pr = product.getBoundingClientRect();
      if (pr.top < innerHeight * 0.7 && pr.bottom > innerHeight * 0.3 && innerWidth > 900)
        setActiveProduct(closest);
      const entry = clamp((innerHeight - pr.top) / innerHeight);
      product.style.setProperty('--product-rotate', `${reduce.matches ? 0 : (1 - entry) * 9}deg`);
      const fr = footer.getBoundingClientRect();
      footer.style.setProperty(
        '--closing-progress',
        String(reduce.matches ? 1 : clamp((innerHeight - fr.top) / (innerHeight * 0.8))),
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    reduce.addEventListener('change', schedule);
    const resizeObserver = new ResizeObserver(schedule);
    if (partners) resizeObserver.observe(partners);
    schedule();
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (entry.target instanceof HTMLElement) entry.target.dataset.revealed = 'true';
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.12 },
    );
    root.querySelectorAll('[data-reveal]').forEach((el) => observer.observe(el));
    return () => {
      removeEventListener('scroll', schedule);
      removeEventListener('resize', schedule);
      reduce.removeEventListener('change', schedule);
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver.disconnect();
    };
  }, [setScrolled, setActiveProduct, setHeroCollapsed, setPartnersHidden]);
}
