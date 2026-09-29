import { describe, expect, it } from 'vitest';
import { distance3 } from '../../src/data/coords.ts';
import { ASTROMETRY, SYSTEMS, getSystem } from '../../src/data/systems.ts';
import type { StarSystemRecord } from '../../src/data/types.ts';
import { GestureTracker, type GestureSink } from '../../src/galaxy/gestures.ts';
import { evaluateJump, type JumpInputs } from '../../src/galaxy/jumpRules.ts';
import { OrbitController } from '../../src/galaxy/mapCamera.ts';
import {
  MAP_LABELS,
  MAP_LINKS,
  MAP_STARS,
  fitProjection2D,
  formatHeightShort,
  formatLy,
  groupName,
  labelsOf,
  project2D,
  systemFocus,
} from '../../src/galaxy/mapData.ts';
import {
  ORBIT_LIMITS,
  approachOrbit,
  cameraRelative,
  createScreenPoint,
  equatorialToMap,
  fitOrbitDistance,
  mapToEquatorial,
  orbitBasis,
  orbitCameraPosition,
  panOrbit,
  projectPoint,
  rotateOrbit,
  shortestAngleDelta,
  smoothingFactor,
  spriteScaleForPixels,
  stageShift,
  zoomOrbit,
  type OrbitState,
  type Vec3,
} from '../../src/galaxy/mapMath.ts';
import { MAP_LEGEND_TEXT, formatDistanceWithError, roleNote } from '../../src/galaxy/mapText.ts';
import { findRoute } from '../../src/galaxy/routing.ts';
import { createLabelBox, layoutLabels, pickLabelAt, pickNearestPoint, type LabelBox } from '../../src/galaxy/screenLayout.ts';

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

describe('map axes', () => {
  it('maps equatorial x, y, z to three.js (x, z, -y) with the equator horizontal', () => {
    expect(equatorialToMap([1, 2, 3])).toEqual([1, 3, -2]);
    expect(mapToEquatorial(equatorialToMap([1.5, -2.25, 4]))).toEqual([1.5, -2.25, 4]);
    // North celestial pole is map "up".
    expect(equatorialToMap([0, 0, 1])).toEqual([0, 1, -0]);
  });

  it('is a proper rotation (keeps handedness and distances)', () => {
    const ex = equatorialToMap([1, 0, 0]);
    const ey = equatorialToMap([0, 1, 0]);
    const ez = equatorialToMap([0, 0, 1]);
    expect(cross(ex, ey).map((v) => v + 0)).toEqual(ez.map((v) => v + 0));
    const a = ASTROMETRY.stars[0]!.positionLy;
    const b = ASTROMETRY.stars[3]!.positionLy;
    expect(distance3(equatorialToMap(a), equatorialToMap(b))).toBeCloseTo(distance3(a, b), 12);
  });
});

describe('camera-relative rendering', () => {
  it('keeps small offsets exact far from the origin, where float32 world coordinates fail', () => {
    const world: Vec3 = [1e7 + 0.1234, -3e6 + 0.5, 42.25];
    const cam: Vec3 = [1e7, -3e6, 42];
    const rel = cameraRelative(world, cam, [0, 0, 0]);
    expect(rel[0]).toBeCloseTo(0.1234, 7);
    expect(rel[1]).toBeCloseTo(0.5, 7);
    expect(rel[2]).toBeCloseTo(0.25, 12);
    // What a GPU would see with float32 world positions: the offset is lost.
    expect(Math.abs(Math.fround(world[0]) - Math.fround(cam[0]) - 0.1234)).toBeGreaterThan(0.01);
  });
});

describe('orbit math', () => {
  const base = (): OrbitState => ({ target: [1, 2, 3], yaw: 0, pitch: 0, distance: 5 });

  it('places the camera from yaw, pitch and distance', () => {
    const p = orbitCameraPosition(base(), [0, 0, 0]);
    expect(p[0]).toBeCloseTo(1, 12);
    expect(p[1]).toBeCloseTo(2, 12);
    expect(p[2]).toBeCloseTo(8, 12);
    const above = orbitCameraPosition({ ...base(), pitch: Math.PI / 2 }, [0, 0, 0]);
    expect(above[1]).toBeCloseTo(7, 12);
  });

  it('clamps pitch and distance and wraps yaw', () => {
    const s = base();
    rotateOrbit(s, 7, 10);
    expect(s.pitch).toBe(ORBIT_LIMITS.maxPitch);
    expect(s.yaw).toBeCloseTo(7 - 2 * Math.PI, 12);
    zoomOrbit(s, 1000);
    expect(s.distance).toBe(ORBIT_LIMITS.maxDistance);
    zoomOrbit(s, 1e-9);
    expect(s.distance).toBe(ORBIT_LIMITS.minDistance);
    zoomOrbit(s, Number.NaN);
    expect(s.distance).toBe(ORBIT_LIMITS.minDistance);
  });

  it('builds an orthonormal screen basis', () => {
    const r: Vec3 = [0, 0, 0];
    const u: Vec3 = [0, 0, 0];
    orbitBasis(0.7, 0.4, r, u);
    expect(Math.hypot(...r)).toBeCloseTo(1, 12);
    expect(Math.hypot(...u)).toBeCloseTo(1, 12);
    expect(r[0] * u[0] + r[1] * u[1] + r[2] * u[2]).toBeCloseTo(0, 12);
  });

  it('pans so the scene follows the pointer', () => {
    const s = base();
    panOrbit(s, 100, 0, 1000, 50);
    // Camera looks down -Z with screen-right = +X: dragging right moves the target left.
    expect(s.target[0]).toBeLessThan(1);
    expect(s.target[1]).toBeCloseTo(2, 12);
    const t = base();
    panOrbit(t, 0, 100, 1000, 50);
    expect(t.target[1]).toBeGreaterThan(2);
  });

  it('eases toward a goal along the shorter arc and snaps at the end', () => {
    const cur: OrbitState = { target: [0, 0, 0], yaw: 3, pitch: 0, distance: 1 };
    const goal: OrbitState = { target: [4, 0, 0], yaw: -3, pitch: 0.5, distance: 16 };
    expect(shortestAngleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6, 12);
    expect(approachOrbit(cur, goal, 0.5)).toBe(true);
    expect(cur.distance).toBeCloseTo(4, 9); // halfway in log space
    expect(cur.target[0]).toBeCloseTo(2, 12);
    expect(Math.abs(cur.yaw)).toBeGreaterThan(3); // crossed the +/-PI seam, not the long way
    for (let i = 0; i < 60 && approachOrbit(cur, goal, 0.5); i++);
    expect(cur).toEqual(goal);
  });

  it('uses frame-rate independent smoothing', () => {
    expect(smoothingFactor(0.1, 0.1)).toBeCloseTo(0.5, 12);
    expect(smoothingFactor(0.2, 0.1)).toBeCloseTo(0.75, 12);
    expect(smoothingFactor(0.016, 0)).toBe(1);
  });
});

describe('orbit controller', () => {
  const start: OrbitState = { target: [0, 0, 0], yaw: 0, pitch: 0.3, distance: 10 };

  it('animates transitions and snaps them under reduced motion', () => {
    const c = new OrbitController(start);
    c.transitionTo({ distance: 2, target: [1, 0, 0] });
    expect(c.isAnimating).toBe(true);
    c.update(1 / 60);
    expect(c.current.distance).toBeLessThan(10);
    expect(c.current.distance).toBeGreaterThan(2);
    for (let i = 0; i < 600 && c.update(1 / 60); i++);
    expect(c.current.distance).toBeCloseTo(2, 9);
    const r = new OrbitController(start);
    r.reducedMotion = true;
    r.transitionTo({ distance: 2 });
    expect(r.isAnimating).toBe(false);
    expect(r.current.distance).toBe(2);
  });

  it('lets direct manipulation cancel a transition from the on-screen view', () => {
    const c = new OrbitController(start);
    c.transitionTo({ distance: 2 });
    c.update(1 / 60);
    const shown = c.current.distance;
    const v = c.version;
    c.rotate(0.5, 0);
    expect(c.isAnimating).toBe(false);
    expect(c.current.distance).toBeCloseTo(shown, 12);
    expect(c.goal).toEqual(c.current);
    expect(c.version).toBeGreaterThan(v);
  });
});

describe('projection helpers', () => {
  // 90° vertical fov, aspect 1, near 1, far 100; camera at the origin looking down -Z.
  const n = 1;
  const f = 100;
  const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -(f + n) / (f - n), -1, 0, 0, (-2 * f * n) / (f - n), 0];

  it('projects camera-relative points to CSS pixels and rejects points behind the camera', () => {
    const out = createScreenPoint();
    projectPoint(P, 0, 0, -5, 800, 600, out);
    expect(out.visible).toBe(true);
    expect(out.x).toBeCloseTo(400, 9);
    expect(out.y).toBeCloseTo(300, 9);
    projectPoint(P, 5, 5, -5, 800, 600, out);
    expect(out.x).toBeCloseTo(800, 9);
    expect(out.y).toBeCloseTo(0, 9);
    expect(projectPoint(P, 0, 0, 5, 800, 600, out).visible).toBe(false);
    expect(projectPoint(P, 0, 0, -500, 800, 600, out).visible).toBe(false);
  });

  it('sizes constant-pixel sprites and centres the stage', () => {
    const projYY = 1 / Math.tan((25 * Math.PI) / 180);
    const scale = spriteScaleForPixels(30, projYY, 900);
    // The sprite shader covers scale * projYY of NDC height (2 units = 900 px).
    expect((scale * projYY * 900) / 2).toBeCloseTo(30, 9);
    const shift = { x: 0, y: 0 };
    stageShift(1000, 800, { x: 200, y: 100, w: 400, h: 600 }, shift);
    expect(shift).toEqual({ x: -100, y: 0 });
  });

  it('fits every star inside the stage with the tightest distance', () => {
    const pts = MAP_STARS.map((s) => s.pos);
    const target: Vec3 = [1, -1, -1];
    const args = [target, 1.2, 0.5, 50, 600, 400, 800, 30] as const;
    const d = fitOrbitDistance(pts, ...args);
    expect(d).toBeGreaterThan(5);
    const inside = (dist: number) => {
      const s: OrbitState = { target: [...target], yaw: 1.2, pitch: 0.5, distance: dist };
      const cam = orbitCameraPosition(s, [0, 0, 0]);
      const r: Vec3 = [0, 0, 0];
      const u: Vec3 = [0, 0, 0];
      orbitBasis(1.2, 0.5, r, u);
      const fwd: Vec3 = cross(u, r);
      const k = 400 / Math.tan((25 * Math.PI) / 180);
      return pts.every((p) => {
        const rel = cameraRelative(p, cam, [0, 0, 0]);
        const depth = rel[0] * fwd[0] + rel[1] * fwd[1] + rel[2] * fwd[2];
        const sx = ((rel[0] * r[0] + rel[1] * r[1] + rel[2] * r[2]) / depth) * k;
        const sy = ((rel[0] * u[0] + rel[1] * u[1] + rel[2] * u[2]) / depth) * k;
        return depth > 0 && Math.abs(sx) <= 270 + 1e-6 && Math.abs(sy) <= 170 + 1e-6;
      });
    };
    expect(inside(d)).toBe(true);
    expect(inside(d * 0.97)).toBe(false);
  });
});

describe('label layout and picking', () => {
  const label = (x: number, y: number, priority: number, w = 80, h = 16): LabelBox => {
    const b = createLabelBox();
    Object.assign(b, { anchorX: x, anchorY: y, width: w, height: h, priority, active: true, gap: 8 });
    return b;
  };
  const overlap = (a: LabelBox, b: LabelBox) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const bounds = { x: 0, y: 0, w: 400, h: 300 };

  it('places crowded labels without overlap, inside bounds, highest priority first', () => {
    const labels = [label(200, 150, 10), label(205, 152, 50), label(210, 150, 30), label(390, 150, 5)];
    layoutLabels(labels, bounds, [], [], []);
    const shown = labels.filter((l) => l.visible);
    expect(labels[1]!.visible).toBe(true);
    for (const a of shown) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.width).toBeLessThanOrEqual(400);
      for (const b of shown) if (a !== b) expect(overlap(a, b)).toBe(false);
    }
    // The label near the right edge flips to the left of its anchor.
    expect(labels[3]!.x + labels[3]!.width).toBeLessThanOrEqual(390);
  });

  it('avoids obstacles, hides what cannot fit and keeps a stable slot', () => {
    const a = label(100, 100, 1);
    layoutLabels([a], bounds, [{ x: 100, y: 80, w: 200, h: 40 }], [], []);
    expect(a.visible).toBe(true);
    expect(a.x + a.width).toBeLessThanOrEqual(100);
    const slot = a.slot;
    a.anchorX += 3;
    layoutLabels([a], bounds, [{ x: 100, y: 80, w: 200, h: 40 }], [], []);
    expect(a.slot).toBe(slot);
    const blocked = label(100, 100, 1);
    layoutLabels([blocked], bounds, [{ x: 0, y: 0, w: 400, h: 300 }], [], []);
    expect(blocked.visible).toBe(false);
  });

  it('tries farther slots only for labels that allow it', () => {
    const obstacle = { x: 50, y: 50, w: 100, h: 100 };
    const near = label(100, 100, 1, 30, 12);
    layoutLabels([near], bounds, [obstacle], [], []);
    expect(near.visible).toBe(false);
    const far = label(100, 100, 1, 30, 12);
    far.gap = 25;
    far.far = true;
    layoutLabels([far], bounds, [obstacle], [], []);
    expect(far.visible).toBe(true);
  });

  it('picks the nearest visible point within the radius, then labels', () => {
    const pts = [
      { x: 100, y: 100, visible: true },
      { x: 120, y: 100, visible: true },
      { x: 112, y: 100, visible: false },
    ];
    expect(pickNearestPoint(pts, 113, 100, 28)).toBe(1);
    expect(pickNearestPoint(pts, 100, 140, 28)).toBe(-1);
    const l = label(0, 0, 1);
    Object.assign(l, { x: 50, y: 50, visible: true });
    expect(pickLabelAt([l], 60, 55)).toBe(0);
    expect(pickLabelAt([l], 10, 10)).toBe(-1);
  });
});

describe('gestures', () => {
  const recorder = () => {
    const log: string[] = [];
    const sink: GestureSink = {
      rotate: (dx, dy) => log.push(`rotate ${dx},${dy}`),
      pan: (dx, dy) => log.push(`pan ${dx},${dy}`),
      zoom: (f) => log.push(`zoom ${f.toFixed(2)}`),
      tap: (x, y, t) => log.push(`tap ${x},${y},${t}`),
      doubleTap: (x, y) => log.push(`double ${x},${y}`),
    };
    return { log, g: new GestureTracker(sink) };
  };

  it('treats small movement as a tap and larger movement as rotation', () => {
    const { log, g } = recorder();
    g.down(1, 10, 10, 0, 'touch');
    g.move(1, 15, 12); // inside the touch slop
    g.up(1, 15, 12, 100);
    expect(log).toEqual(['tap 15,12,touch']);
    log.length = 0;
    g.down(2, 10, 10, 1000, 'touch');
    g.move(2, 40, 10);
    g.move(2, 50, 20);
    g.up(2, 50, 20, 1200);
    expect(log).toEqual(['rotate 30,0', 'rotate 10,10']);
  });

  it('detects double taps, not slow or distant second taps', () => {
    const { log, g } = recorder();
    g.down(1, 10, 10, 0, 'touch');
    g.up(1, 10, 10, 50);
    g.down(2, 14, 12, 200, 'touch');
    g.up(2, 14, 12, 250);
    expect(log).toEqual(['tap 10,10,touch', 'double 14,12']);
    log.length = 0;
    g.down(3, 10, 10, 1000, 'touch');
    g.up(3, 10, 10, 1050);
    g.down(4, 10, 10, 1600, 'touch');
    g.up(4, 10, 10, 1650);
    expect(log).toEqual(['tap 10,10,touch', 'tap 10,10,touch']);
  });

  it('pinches to zoom and two-finger drags to pan, with no tap afterwards', () => {
    const { log, g } = recorder();
    g.down(1, 100, 100, 0, 'touch');
    g.down(2, 200, 100, 10, 'touch');
    g.move(2, 300, 100); // distance 100 -> 200: zoom in by half, midpoint moves 50 px right
    g.up(1, 100, 100, 100);
    g.up(2, 300, 100, 110);
    expect(log).toEqual(['zoom 0.50', 'pan 50,0']);
  });

  it('never taps after a cancel, ignores a third finger and honours pan mode', () => {
    const { log, g } = recorder();
    g.down(1, 10, 10, 0, 'touch');
    g.cancel(1);
    g.up(1, 10, 10, 20);
    expect(log).toEqual([]);
    expect(g.down(5, 0, 0, 0, 'touch')).toBe(true);
    expect(g.down(6, 50, 0, 0, 'touch')).toBe(true);
    expect(g.down(7, 90, 0, 0, 'touch')).toBe(false);
    g.reset();
    g.down(8, 0, 0, 0, 'mouse', true, false);
    g.move(8, 20, 0);
    g.up(8, 20, 0, 50);
    g.down(9, 0, 0, 100, 'mouse', true, false);
    g.up(9, 0, 0, 120);
    expect(log).toEqual(['pan 20,0']);
  });
});

describe('jump button rules', () => {
  const ready: JumpInputs = { currentSystemId: 'sol', credits: 1000, readiness: { canJump: true }, feeCoverage: null };

  it('enables a reachable jump with enough credits and charges the route fee', () => {
    const ev = evaluateJump(ready, 'epsilon-eridani');
    const route = findRoute(SYSTEMS, 'sol', 'epsilon-eridani')!;
    expect(ev.canJump).toBe(true);
    expect(ev.reasons).toEqual([]);
    expect(ev.route?.path).toEqual(['sol', 'sirius', 'epsilon-eridani']);
    expect(ev.fee).toBe(route.totalFee);
  });

  it('disables jumping to the current system', () => {
    const ev = evaluateJump(ready, 'sol');
    expect(ev.canJump).toBe(false);
    expect(ev.route).toBeNull();
    expect(ev.reasons[0]).toMatch(/already in Sol/);
  });

  it('shows the readiness reason and a credit shortfall together', () => {
    const ev = evaluateJump(
      { ...ready, credits: 5, readiness: { canJump: false, reason: 'Launch from the dock first' } },
      'sirius',
    );
    expect(ev.canJump).toBe(false);
    expect(ev.reasons).toHaveLength(2);
    expect(ev.reasons[0]).toBe('Launch from the dock first');
    expect(ev.reasons[1]).toMatch(/Not enough credits/);
    expect(evaluateJump({ ...ready, readiness: { canJump: false } }, 'sirius').reasons[0]).toMatch(/not ready/);
  });

  it('applies contract fee coverage only to its destination', () => {
    const covered = { ...ready, credits: 0, feeCoverage: { systemId: 'barnard' as const, note: 'Contract pays.' } };
    const ev = evaluateJump(covered, 'barnard');
    expect(ev.covered).toBe(true);
    expect(ev.fee).toBe(0);
    expect(ev.routeFee).toBeGreaterThan(0);
    expect(ev.canJump).toBe(true);
    expect(ev.coverageNote).toBe('Contract pays.');
    expect(evaluateJump(covered, 'sirius').canJump).toBe(false);
  });

  it('reports unreachable destinations', () => {
    const systems = structuredClone(SYSTEMS) as StarSystemRecord[];
    for (const s of systems) s.jumpLinks = s.jumpLinks.filter((l) => l !== 'epsilon-eridani');
    systems.find((s) => s.id === 'epsilon-eridani')!.jumpLinks = [];
    const ev = evaluateJump(ready, 'epsilon-eridani', systems);
    expect(ev.canJump).toBe(false);
    expect(ev.reasons[0]).toMatch(/No jump route/);
  });
});

describe('plotted neighborhood', () => {
  it('plots the Sun plus every catalog component at its own position', () => {
    expect(MAP_STARS).toHaveLength(ASTROMETRY.stars.length + 1);
    expect(MAP_STARS[0]!.pos).toEqual([0, 0, 0]);
    for (const c of ASTROMETRY.stars) {
      expect(MAP_STARS.find((s) => s.key === c.id)!.pos).toEqual(equatorialToMap(c.positionLy));
    }
  });

  it('labels Alpha Centauri A/B together and Proxima Centauri separately', () => {
    const ac = labelsOf('alpha-centauri');
    expect(ac.map((l) => l.name)).toEqual(['Alpha Centauri A/B', 'Proxima Centauri']);
    expect(ac[0]!.starKeys).toEqual(['alpha-centauri-a', 'alpha-centauri-b']);
    expect(ac[1]!.distanceLy).toBeLessThan(ac[0]!.distanceLy!);
    expect(labelsOf('sirius').map((l) => l.name)).toEqual(['Sirius']);
    expect(groupName(['Sirius A', 'Sirius B'])).toBe('Sirius A/B');
    expect(MAP_LABELS.find((l) => l.key === 'sirius')!.distanceLy).toBeCloseTo(getSystem('sirius').distanceLightYears, 12);
    expect(formatLy(8.600943)).toBe('8.60 ly');
    expect(formatHeightShort(-3.79)).toBe('3.79 ly below');
  });

  it('draws each fictional jump link once with its real length', () => {
    expect(MAP_LINKS).toHaveLength(5);
    const solSirius = MAP_LINKS.find((l) => l.a === 'sirius' && l.b === 'sol')!;
    expect(solSirius.distanceLy).toBeCloseTo(getSystem('sirius').distanceLightYears, 9);
  });

  it('focuses close enough on Alpha Centauri to separate Proxima', () => {
    const f = systemFocus('alpha-centauri');
    const sep = distance3(labelsOf('alpha-centauri')[0]!.pos, labelsOf('alpha-centauri')[1]!.pos);
    expect(f.distance).toBeLessThan(sep * 8);
    expect(systemFocus('barnard').target).toEqual(labelsOf('barnard')[0]!.pos);
  });

  it('fits the top-down 2D projection and rotates it for wide areas', () => {
    const wide = fitProjection2D(800, 400, true, 20, 20);
    const tall = fitProjection2D(400, 800, false, 20, 20);
    for (const p of [wide, tall]) {
      for (const s of MAP_STARS) {
        const [x, y] = project2D(p, s.eq, [0, 0]);
        expect(x).toBeGreaterThanOrEqual(20 - 1e-9);
        expect(x).toBeLessThanOrEqual((p === wide ? 800 : 400) - 20 + 1e-9);
        expect(y).toBeGreaterThanOrEqual(20 - 1e-9);
      }
    }
    // Rotated: RA 6h (+y) points right; unrotated: RA 0h (+x) points right, RA 6h up.
    const a = project2D(wide, [0, 1, 0], [0, 0]);
    const o = project2D(wide, [0, 0, 0], [0, 0]);
    expect(a[0]).toBeGreaterThan(o[0]);
    const b = project2D(tall, [0, 1, 0], [0, 0]);
    const o2 = project2D(tall, [0, 0, 0], [0, 0]);
    expect(b[1]).toBeLessThan(o2[1]);
  });
});

describe('science text', () => {
  const c = (id: string) => ASTROMETRY.stars.find((s) => s.id === id)!;

  it('describes each star’s role without merging Proxima into A/B', () => {
    expect(roleNote(c('proxima-centauri'))).toMatch(/^Distant red dwarf companion of the Alpha Centauri A\/B pair, about 0\.\d\d ly/);
    expect(roleNote(c('alpha-centauri-b'))).toBe('Close binary companion of Alpha Centauri A.');
    expect(roleNote(c('alpha-centauri-a'))).toMatch(/close pair with Alpha Centauri B/);
    expect(roleNote(c('sirius-b'))).toBe('White dwarf companion of Sirius A.');
    expect(roleNote(c('barnards-star'))).toBe('Single star (red dwarf).');
  });

  it('formats distances to the precision of their uncertainty', () => {
    expect(formatDistanceWithError(4.344060117962511, 0.002198615954536773)).toBe('4.344 ± 0.002 ly');
    expect(formatDistanceWithError(8.600943480307569, 0.03583631945066311)).toBe('8.60 ± 0.04 ly');
    expect(formatDistanceWithError(4.246460140062655, 0.00027588543568704847)).toBe('4.2465 ± 0.0003 ly');
  });

  it('keeps the required legend wording', () => {
    expect(MAP_LEGEND_TEXT).toBe(
      'Star positions and distances based on astronomical data; travel technology and local scale are fictional.',
    );
  });

  it('never lists a confirmed planet around Alpha Centauri A or B', () => {
    const hosts = getSystem('alpha-centauri').confirmedBodies.map((p) => p.hostId);
    expect(hosts.every((h) => h === 'proxima-centauri')).toBe(true);
  });
});
