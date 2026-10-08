import { AIM_REACH } from '../../flight/input/types.ts';

/**
 * The clear centre (docs/PROCGEN.md §52). On a touch screen the middle of the view belongs to the
 * flying: the reticle rests at its centre and swings about it with the aim stick, and whatever you
 * fly at is drawn there. Nothing that stays on screen (a panel, a button, the throttle, a chip, a
 * stick's hint) may reach into this box about the view's centre: what you need to know keeps to the
 * band along the top, and the controls to the band along the bottom, under the thumbs. Only the
 * markers, the reticle and the ship are drawn in it, and messages that come and go (the radio, a hail,
 * a warning) may cross its top edge while they show.
 */
export interface ClearCentreRule {
  /** Shares of the view's width and height, about its centre, by the view's shape. */
  portrait: { width: number; height: number };
  landscape: { width: number; height: number };
  /** The guardrails' bounds (`validateClearCentre`). */
  guard: {
    /** The box always holds the reticle swung this share of its reach, in every direction. */
    reticleReach: number;
    /** The bands left above and below it, as shares of the height, at the least. */
    band: number;
  };
}

export const CLEAR_CENTRE: ClearCentreRule = {
  portrait: { width: 0.6, height: 0.34 },
  landscape: { width: 0.5, height: 0.4 },
  guard: { reticleReach: 0.5, band: 0.25 },
};

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The clear centre of a view this size, in CSS pixels. */
export function clearCentre(width: number, height: number): Box {
  const share = height > width ? CLEAR_CENTRE.portrait : CLEAR_CENTRE.landscape;
  const halfW = (width * share.width) / 2;
  const halfH = (height * share.height) / 2;
  return { left: width / 2 - halfW, top: height / 2 - halfH, right: width / 2 + halfW, bottom: height / 2 + halfH };
}

/** What of a layout reaches into the box: by more than a pixel (rounding), in either direction. */
export function intrusions(box: Box, items: readonly { name: string; box: Box }[]): string[] {
  const into = (b: Box) => Math.min(b.right, box.right) - Math.max(b.left, box.left) > 1 && Math.min(b.bottom, box.bottom) - Math.max(b.top, box.top) > 1;
  return items.filter((item) => into(item.box)).map((item) => item.name);
}

/**
 * Guardrails for the rule: the box holds the reticle at half its reach (the aim stick half pushed,
 * in any direction), and leaves bands at the top and bottom wide enough for the panels and the
 * thumbs' controls.
 */
export function validateClearCentre(rule: ClearCentreRule = CLEAR_CENTRE): string[] {
  const issues: string[] = [];
  for (const shape of ['portrait', 'landscape'] as const) {
    const s = rule[shape];
    // The reticle sits at aim × half the view from the centre (src/world/FlightSession.ts).
    if (s.width < AIM_REACH.x * rule.guard.reticleReach) issues.push(`${shape}: ${s.width} of the width is narrower than the reticle at half reach (${AIM_REACH.x * rule.guard.reticleReach})`);
    if (s.height < AIM_REACH.y * rule.guard.reticleReach) issues.push(`${shape}: ${s.height} of the height is shorter than the reticle at half reach (${AIM_REACH.y * rule.guard.reticleReach})`);
    if ((1 - s.height) / 2 < rule.guard.band) issues.push(`${shape}: the bands above and below are ${((1 - s.height) / 2).toFixed(2)} of the height, under ${rule.guard.band}`);
    if (s.width >= 1 || s.height >= 1) issues.push(`${shape}: the box fills the view`);
  }
  return issues;
}
