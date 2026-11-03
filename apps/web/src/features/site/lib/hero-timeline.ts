const clamp = (value: number) => Math.min(1, Math.max(0, value));
const ease = (value: number) => {
  const progress = clamp(value);
  return progress * progress * (3 - 2 * progress);
};

export function heroIsAnimated(width: number, height: number, reducedMotion: boolean) {
  return width > 900 && height >= 650 && !reducedMotion;
}

/** Reveal endorsements near the end of the image morph; reverse scroll restores the hero. */
export function heroTimeline(progress: number) {
  const position = clamp(progress);
  const morph = ease(position);
  const partners = ease((position - 0.7) / 0.25);
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
