import type { SfxId } from './types.ts';

/** Static mixing/limiting data per sound effect. Pure: shared by the runtime and the unit tests. */
export interface SfxSpec {
  /** Nominal length in seconds at pitch 1. */
  dur: number;
  /** Base output gain. */
  gain: number;
  /** Minimum seconds between two starts of this id (rate limit for rapid fire). */
  minGap: number;
  /** Maximum simultaneous instances of this id; the oldest is stolen beyond it. */
  maxInst: number;
  /** Higher survives voice stealing longer. */
  prio: number;
  /** Reverb send 0..1. */
  wet: number;
}

export const MAX_SFX_VOICES = 24;

export const SFX_SPECS: Record<SfxId, SfxSpec> = {
  'ui-click': { dur: 0.06, gain: 0.35, minGap: 0.03, maxInst: 3, prio: 1, wet: 0 },
  'ui-confirm': { dur: 0.3, gain: 0.28, minGap: 0.05, maxInst: 2, prio: 1, wet: 0.1 },
  'ui-error': { dur: 0.3, gain: 0.35, minGap: 0.08, maxInst: 2, prio: 1, wet: 0 },
  laser: { dur: 0.2, gain: 0.53, minGap: 0.045, maxInst: 6, prio: 2, wet: 0.12 },
  'laser-mk2': { dur: 0.3, gain: 0.48, minGap: 0.05, maxInst: 5, prio: 2, wet: 0.15 },
  'laser-enemy': { dur: 0.26, gain: 0.32, minGap: 0.04, maxInst: 6, prio: 2, wet: 0.12 },
  'missile-launch': { dur: 1.2, gain: 0.55, minGap: 0.1, maxInst: 3, prio: 3, wet: 0.2 },
  'missile-lock': { dur: 0.5, gain: 0.54, minGap: 0.3, maxInst: 1, prio: 4, wet: 0 },
  'hit-shield': { dur: 0.4, gain: 0.8, minGap: 0.04, maxInst: 4, prio: 2, wet: 0.15 },
  'hit-hull': { dur: 0.35, gain: 0.45, minGap: 0.04, maxInst: 4, prio: 2, wet: 0.12 },
  'player-hit-shield': { dur: 0.6, gain: 0.6, minGap: 0.06, maxInst: 2, prio: 4, wet: 0.15 },
  'player-hit-hull': { dur: 0.7, gain: 0.65, minGap: 0.06, maxInst: 2, prio: 4, wet: 0.12 },
  'shield-down': { dur: 1.2, gain: 0.3, minGap: 0.5, maxInst: 1, prio: 5, wet: 0.1 },
  'explosion-small': { dur: 1, gain: 0.48, minGap: 0.03, maxInst: 4, prio: 3, wet: 0.3 },
  'explosion-large': { dur: 2.5, gain: 0.62, minGap: 0.08, maxInst: 2, prio: 4, wet: 0.35 },
  'boost-start': { dur: 0.8, gain: 0.45, minGap: 0.2, maxInst: 1, prio: 3, wet: 0.05 },
  'cruise-charge': { dur: 1.8, gain: 0.4, minGap: 0.3, maxInst: 1, prio: 3, wet: 0.1 },
  'cruise-engage': { dur: 0.9, gain: 0.45, minGap: 0.3, maxInst: 1, prio: 3, wet: 0.2 },
  'cruise-exit': { dur: 0.7, gain: 0.45, minGap: 0.3, maxInst: 1, prio: 3, wet: 0.15 },
  'lane-enter': { dur: 1.4, gain: 0.45, minGap: 0.4, maxInst: 1, prio: 3, wet: 0.3 },
  'lane-exit': { dur: 1.2, gain: 0.45, minGap: 0.4, maxInst: 1, prio: 3, wet: 0.3 },
  'dock-clamp': { dur: 1.3, gain: 0.5, minGap: 0.4, maxInst: 1, prio: 3, wet: 0.2 },
  undock: { dur: 1.3, gain: 0.5, minGap: 0.4, maxInst: 1, prio: 3, wet: 0.2 },
  'jump-charge': { dur: 2.5, gain: 0.45, minGap: 0.5, maxInst: 1, prio: 5, wet: 0.25 },
  'jump-exit': { dur: 1.8, gain: 0.55, minGap: 0.5, maxInst: 1, prio: 5, wet: 0.5 },
  pickup: { dur: 0.3, gain: 0.4, minGap: 0.05, maxInst: 3, prio: 2, wet: 0.15 },
  alert: { dur: 0.9, gain: 0.4, minGap: 0.5, maxInst: 1, prio: 5, wet: 0.05 },
  scan: { dur: 1, gain: 0.6, minGap: 0.3, maxInst: 1, prio: 2, wet: 0.3 },
  credits: { dur: 0.6, gain: 0.6, minGap: 0.06, maxInst: 2, prio: 2, wet: 0.2 },
  'mission-complete': { dur: 2, gain: 0.5, minGap: 1, maxInst: 1, prio: 5, wet: 0.35 },
  repair: { dur: 1.2, gain: 0.4, minGap: 0.3, maxInst: 1, prio: 2, wet: 0.1 },
  'target-lock': { dur: 0.35, gain: 0.55, minGap: 0.1, maxInst: 1, prio: 3, wet: 0.05 },
  'radio-blip': { dur: 0.35, gain: 0.42, minGap: 0.12, maxInst: 2, prio: 2, wet: 0.05 },
};

export const SFX_IDS = Object.keys(SFX_SPECS) as SfxId[];

export interface VoiceSlot {
  key: number;
  id: SfxId;
  start: number;
  end: number;
  prio: number;
}

export interface VoiceGrant {
  /** Handle for `release`. */
  key: number;
  /** Keys of voices the caller must fade out now. */
  steal: number[];
  /** Gain trim (<= 1) so dense repeats of one sound don't pile up into clipping. */
  gain: number;
}

/**
 * Voice bookkeeping for sound effects: a global cap that steals the oldest voice (never one of
 * higher priority), a per-id instance cap, and a minimum gap between identical sounds.
 */
export class VoiceLimiter {
  readonly max: number;
  private slots: VoiceSlot[] = [];
  private readonly lastStart = new Map<SfxId, number>();
  private nextKey = 1;

  constructor(max = MAX_SFX_VOICES) {
    this.max = max;
  }

  get count(): number {
    return this.slots.length;
  }

  active(now: number): number {
    this.prune(now);
    return this.slots.length;
  }

  request(id: SfxId, now: number, spec: SfxSpec, durScale = 1): VoiceGrant | null {
    this.prune(now);
    const last = this.lastStart.get(id);
    if (last !== undefined && now >= last && now - last < spec.minGap) return null;

    const steal: number[] = [];
    const same = this.slots.filter((s) => s.id === id);
    if (same.length >= spec.maxInst) steal.push(same[0].key);
    if (this.slots.length - steal.length >= this.max) {
      const victim = this.slots.find((s) => !steal.includes(s.key) && s.prio <= spec.prio);
      if (!victim) return null;
      steal.push(victim.key);
    }
    for (const key of steal) this.release(key);

    const recent = this.slots.filter((s) => s.id === id && now - s.start < 0.25).length;
    const key = this.nextKey++;
    this.slots.push({ key, id, start: now, end: now + spec.dur * durScale, prio: spec.prio });
    this.lastStart.set(id, now);
    return { key, steal, gain: 1 / (1 + 0.2 * recent) };
  }

  release(key: number): void {
    const i = this.slots.findIndex((s) => s.key === key);
    if (i >= 0) this.slots.splice(i, 1);
  }

  prune(now: number): void {
    if (this.slots.some((s) => s.end <= now)) this.slots = this.slots.filter((s) => s.end > now);
  }

  clear(): void {
    this.slots = [];
    this.lastStart.clear();
  }
}
