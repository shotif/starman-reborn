import { describe, expect, it } from 'vitest';
import { AUTO_QUALITY, DYNAMIC, FrameGovernor, PRESETS } from '../../src/app/frameGovernor.ts';

/**
 * Frame rate and quality (docs/DESIGN.md, rendering and performance): dynamic resolution, half-rate
 * screens that are not slow, and Auto quality stepping down only on a device that cannot keep up.
 */

/** Feeds `seconds` of frames of `ms` each, drawn every `refreshes` refreshes; returns every change. */
function run(g: FrameGovernor, ms: number, seconds: number, refreshes = 1, deviceRatio = 3) {
  const changes: string[] = [];
  for (let t = 0; t < seconds; t += ms / 1000) {
    const c = g.record(ms / 1000, refreshes, deviceRatio);
    if (c) changes.push(c);
  }
  return changes;
}

describe('frame governor', () => {
  it('starts Auto at Medium, and counts frames as drawn', () => {
    expect(AUTO_QUALITY.start).toBe('medium');
    const g = new FrameGovernor('medium', true);
    run(g, 1000 / 60, 2);
    expect(g.fps).toBeCloseTo(60, 0);
    expect([g.quality, g.scale]).toEqual(['medium', 1]);
  });

  it('lowers the resolution when frames run over budget, down to its floor, and restores it with headroom', () => {
    const g = new FrameGovernor('medium');
    run(g, 30, 20);
    expect(g.scale).toBe(DYNAMIC.min);
    expect(g.quality).toBe('medium');
    run(g, 8, 60);
    expect(g.scale).toBe(1);
  });

  it('does not take half-rate docked and menu screens for slowness', () => {
    // 60 Hz display, drawing every other refresh: 33 ms between frames, 16.7 per refresh.
    const g = new FrameGovernor('high', true);
    expect(run(g, 1000 / 30, 30, 2)).toEqual([]);
    expect([g.quality, g.scale]).toEqual(['high', 1]);
    expect(g.fps).toBeCloseTo(30, 0);
    // The same frames at the full rate are slow.
    run(g, 1000 / 30, 30, 1);
    expect(g.scale).toBeLessThan(1);
  });

  it('under Auto, steps down a preset only once the resolution is at its floor and frames stay slow', () => {
    const g = new FrameGovernor('medium', true);
    const changes = run(g, 40, 30);
    expect(changes.filter((c) => c === 'quality')).toHaveLength(1);
    expect(g.quality).toBe('low');
    // The pixels drawn stay the same across the step: 1.5 × 0.55 at Medium is 0.825 at Low.
    expect(Math.min(3, PRESETS.low.dprCap) * g.scale).toBeCloseTo(1.5 * DYNAMIC.min, 5);
    // At 40 ms Low's 30 fps budget is met, so it stays at Low and never goes below.
    run(g, 40, 30);
    expect(g.quality).toBe('low');
  });

  it('never steps down a preset chosen in Settings, and never steps up', () => {
    const chosen = new FrameGovernor('high', false);
    run(chosen, 60, 60);
    expect([chosen.quality, chosen.scale]).toEqual(['high', DYNAMIC.min]);
    const auto = new FrameGovernor('low', true);
    run(auto, 5, 60);
    expect([auto.quality, auto.scale]).toEqual(['low', 1]);
  });

  it('forgets its history when Settings choose a preset again', () => {
    const g = new FrameGovernor('medium', true);
    run(g, 40, 30);
    g.reset('medium', true);
    expect([g.quality, g.scale]).toEqual(['medium', 1]);
    expect(run(g, 1000 / 60, 0.2)).toEqual([]);
  });
});
