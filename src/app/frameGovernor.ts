import type { QualityLevel } from '../world/art/types.ts';

/**
 * How the game keeps its frame rate (docs/DESIGN.md, rendering and performance): the quality
 * presets, dynamic resolution, and Auto quality stepping down a preset on a device that cannot
 * keep up. A pure function of the frames it is given, so it is unit-tested without a GPU.
 */

export interface Preset {
  /** Highest device pixel ratio drawn at. */
  dprCap: number;
  /** Frame time aimed for, at the display's own rate. */
  frameBudgetMs: number;
  bloom: boolean;
}

export const PRESETS: Record<QualityLevel, Preset> = {
  low: { dprCap: 1, frameBudgetMs: 1000 / 30, bloom: false },
  medium: { dprCap: 1.5, frameBudgetMs: 1000 / 60, bloom: false },
  high: { dprCap: 2, frameBudgetMs: 1000 / 60, bloom: true },
};

/**
 * Auto quality. Every device starts at Medium: the first real phone tried (a recent Android, 2026)
 * ran High at 99 fps, so the old Low for every touch screen threw most phones' graphics away. A
 * device that stays over budget with the resolution already at its floor steps down a preset, once
 * per step, for the rest of the session. Auto never steps up: High stays a choice in Settings.
 */
export const AUTO_QUALITY = {
  start: 'medium' as QualityLevel,
  /** Seconds over budget at the resolution floor before stepping down. */
  stepDownAfter: 4,
};

/** Dynamic resolution: a scale on the preset's pixel ratio, lowered when slow and restored with headroom. */
export const DYNAMIC = {
  min: 0.55,
  down: 0.1,
  up: 0.05,
  /** Slow above this share of the budget, with headroom below that one. */
  slowAbove: 1.2,
  fastBelow: 0.75,
  /** Seconds slow before lowering the scale, and with headroom before raising it. */
  slowFor: 1.5,
  fastFor: 4,
  /** Frames averaged, and how many before judging. */
  window: 30,
  settle: 20,
};

const LOWER: Partial<Record<QualityLevel, QualityLevel>> = { high: 'medium', medium: 'low' };

export type GovernorChange = 'scale' | 'quality' | null;

export class FrameGovernor {
  /** Frames drawn per second, as drawn. */
  fps = 0;
  /** Multiplier on the preset's pixel ratio (DYNAMIC.min..1). */
  scale = 1;
  quality: QualityLevel;
  /** Whether Auto may step the preset down. */
  autoSteps: boolean;
  /** Frame times per display refresh (a frame drawn every other refresh counts half). */
  private times: number[] = [];
  private raw: number[] = [];
  private slowFor = 0;
  private fastFor = 0;

  constructor(quality: QualityLevel, autoSteps = false) {
    this.quality = quality;
    this.autoSteps = autoSteps;
  }

  /** A new preset (from Settings): full resolution, and the frame history forgotten. */
  reset(quality: QualityLevel, autoSteps = false): void {
    this.quality = quality;
    this.autoSteps = autoSteps;
    this.scale = 1;
    this.times = [];
    this.raw = [];
    this.slowFor = 0;
    this.fastFor = 0;
  }

  /**
   * One frame: `dt` seconds since the last, drawn every `refreshes` display refreshes (2 on the
   * docked and menu screens, which save battery at half rate), on a display of `deviceRatio`
   * pixels per CSS pixel. Says what changed, for the renderer to resize.
   */
  record(dt: number, refreshes = 1, deviceRatio = 1): GovernorChange {
    const ms = dt * 1000;
    this.raw.push(ms);
    this.times.push(ms / Math.max(1, refreshes));
    if (this.raw.length > DYNAMIC.window) this.raw.shift();
    if (this.times.length > DYNAMIC.window) this.times.shift();
    const rawAvg = this.raw.reduce((a, b) => a + b, 0) / this.raw.length;
    this.fps = rawAvg > 0 ? 1000 / rawAvg : 0;
    if (this.times.length < DYNAMIC.settle) return null;
    const avg = this.times.reduce((a, b) => a + b, 0) / this.times.length;
    const budget = PRESETS[this.quality].frameBudgetMs;
    if (avg > budget * DYNAMIC.slowAbove) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (avg < budget * DYNAMIC.fastBelow) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
    const lower = LOWER[this.quality];
    if (this.slowFor > DYNAMIC.slowFor && this.scale > DYNAMIC.min) {
      this.scale = Math.max(DYNAMIC.min, this.scale - DYNAMIC.down);
      this.slowFor = 0;
      this.times = [];
      return 'scale';
    }
    if (this.autoSteps && lower && this.scale <= DYNAMIC.min && this.slowFor > AUTO_QUALITY.stepDownAfter) {
      // Keep the pixels drawn the same across the step; the lower preset's own budget takes over.
      const drawn = Math.min(deviceRatio, PRESETS[this.quality].dprCap) * this.scale;
      this.quality = lower;
      this.scale = Math.min(1, Math.max(DYNAMIC.min, drawn / Math.min(deviceRatio, PRESETS[lower].dprCap)));
      this.slowFor = 0;
      this.fastFor = 0;
      this.times = [];
      return 'quality';
    }
    if (this.fastFor > DYNAMIC.fastFor && this.scale < 1) {
      this.scale = Math.min(1, this.scale + DYNAMIC.up);
      this.fastFor = 0;
      return 'scale';
    }
    return null;
  }
}
