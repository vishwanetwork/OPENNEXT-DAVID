import { describe, expect, it } from 'vitest';
import { heroIsAnimated, heroTimeline } from './hero-timeline';

describe('hero scroll choreography', () => {
  it('uses normal document flow on small screens and for reduced motion', () => {
    expect(heroIsAnimated(901, 650, false)).toBe(true);
    expect(heroIsAnimated(900, 900, false)).toBe(false);
    expect(heroIsAnimated(1440, 649, false)).toBe(false);
    expect(heroIsAnimated(1440, 900, true)).toBe(false);
  });
  it('starts with a full hero and no endorsements', () => {
    expect(heroTimeline(0)).toMatchObject({
      morph: 0,
      partners: 0,
      copyOpacity: 1,
      partnersHidden: true,
      copyHidden: false,
    });
  });

  it('reveals and holds endorsements before starting the image morph', () => {
    expect(heroTimeline(0.12).partners).toBeCloseTo(0.5);
    for (const progress of [0.24, 0.3, 0.34]) {
      expect(heroTimeline(progress)).toMatchObject({
        morph: 0,
        partners: 1,
        partnersHidden: false,
        copyOpacity: 1,
      });
    }
  });

  it('finishes the original morph without invisible links in the tab order', () => {
    expect(heroTimeline(1)).toMatchObject({
      morph: 1,
      partners: 0,
      copyOpacity: 0,
      morphOpacity: 1,
      copyHidden: true,
      partnersHidden: true,
    });
  });

  it('is continuous across phases and deterministic when scrolling backwards', () => {
    for (const boundary of [0.24, 0.34, 0.5, 0.7]) {
      const before = heroTimeline(boundary - 0.0001);
      const after = heroTimeline(boundary + 0.0001);
      expect(Math.abs(before.morph - after.morph)).toBeLessThan(0.002);
      expect(Math.abs(before.partners - after.partners)).toBeLessThan(0.004);
    }
    expect(heroTimeline(-1)).toEqual(heroTimeline(0));
    expect(heroTimeline(2)).toEqual(heroTimeline(1));
  });
});
