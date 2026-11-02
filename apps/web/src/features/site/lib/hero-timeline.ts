const clamp = (value: number) => Math.min(1, Math.max(0, value));
const ease = (value: number) => {
  const progress = clamp(value);
  return progress * progress * (3 - 2 * progress);
};

export function heroIsAnimated(width: number, height: number, reducedMotion: boolean) {
  return width > 900 && height >= 650 && !reducedMotion;
}

/** Reveal the endorsements before continuing the existing image-morph sequence. */
export function heroTimeline(progress: number) {
  const position = clamp(progress);
  const reveal = ease(position / 0.24);
  const morph = ease((position - 0.34) / 0.66);
  const partners = reveal * (1 - ease(morph / 0.42));
  const copyOpacity = 1 - clamp(morph / 0.36);
  return {
    morph,
    partners,
    copyOpacity,
    copyY: morph * -70,
    morphOpacity: clamp((morph - 0.4) / 0.35),
    copyHidden: copyOpacity < 0.05,
    partnersHidden: partners < 0.1,
  };
}
