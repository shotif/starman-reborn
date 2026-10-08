import { describe, expect, it } from 'vitest';
import { AIM_REACH } from '../../src/flight/input/types.ts';
import { CLEAR_CENTRE, clearCentre, intrusions, validateClearCentre } from '../../src/ui/touch/clearCentre.ts';

/**
 * The clear centre (docs/PROCGEN.md §52): on a touch screen the middle of the view is kept for
 * flying and aiming. The browser tests measure the real layout against it at every phone and tablet
 * size (tests/e2e/platform.spec.ts and the screenshot audits); these check the rule itself.
 */

/** The phones and tablets the layout is measured at (tests/e2e/screenshots.spec.ts). */
const VIEWS: readonly [number, number][] = [
  [360, 640],
  [640, 360],
  [390, 844],
  [844, 390],
  [768, 1024],
  [1024, 768],
  [411, 741],
  [316, 570],
];

describe('the clear centre', () => {
  it('passes its guardrails', () => {
    expect(validateClearCentre()).toEqual([]);
  });

  it('is a box about the view’s centre, by the view’s shape', () => {
    expect(clearCentre(360, 640)).toEqual({ left: 72, top: 211.2, right: 288, bottom: 428.8 });
    expect(clearCentre(640, 360)).toEqual({ left: 160, top: 108, right: 480, bottom: 252 });
    for (const [w, h] of VIEWS) {
      const b = clearCentre(w, h);
      expect((b.left + b.right) / 2).toBeCloseTo(w / 2);
      expect((b.top + b.bottom) / 2).toBeCloseTo(h / 2);
    }
  });

  it('holds the reticle wherever the aim stick half pushed puts it', () => {
    for (const [w, h] of VIEWS) {
      const b = clearCentre(w, h);
      for (let turn = 0; turn < 16; turn++) {
        const a = (turn / 16) * 2 * Math.PI;
        // Where the HUD draws the reticle for an aim (src/world/FlightSession.ts).
        const x = ((AIM_REACH.x * CLEAR_CENTRE.guard.reticleReach * Math.cos(a) + 1) / 2) * w;
        const y = ((1 - AIM_REACH.y * CLEAR_CENTRE.guard.reticleReach * Math.sin(a)) / 2) * h;
        expect(x).toBeGreaterThan(b.left);
        expect(x).toBeLessThan(b.right);
        expect(y).toBeGreaterThan(b.top);
        expect(y).toBeLessThan(b.bottom);
      }
    }
  });

  it('names what reaches into it by more than a pixel', () => {
    const box = { left: 100, top: 100, right: 200, bottom: 200 };
    const found = intrusions(box, [
      { name: 'beside it', box: { left: 200, top: 120, right: 260, bottom: 160 } },
      { name: 'a pixel in, rounding', box: { left: 199, top: 120, right: 260, bottom: 160 } },
      { name: 'over its top edge', box: { left: 150, top: 80, right: 170, bottom: 110 } },
      { name: 'below it', box: { left: 0, top: 201, right: 400, bottom: 260 } },
      { name: 'across it', box: { left: 0, top: 150, right: 400, bottom: 160 } },
    ]);
    expect(found).toEqual(['over its top edge', 'across it']);
  });

  it('fails its guardrails for a box that would not hold the reticle, or leaves no room above and below', () => {
    const narrow = validateClearCentre({ ...CLEAR_CENTRE, portrait: { width: 0.2, height: 0.2 } });
    expect(narrow.join('\n')).toMatch(/portrait: 0\.2 of the width is narrower than the reticle at half reach/);
    expect(narrow.join('\n')).toMatch(/portrait: 0\.2 of the height is shorter than the reticle at half reach/);
    const tall = validateClearCentre({ ...CLEAR_CENTRE, landscape: { width: 0.5, height: 0.6 } });
    expect(tall).toEqual(['landscape: the bands above and below are 0.20 of the height, under 0.25']);
  });
});
