import * as THREE from 'three';
import { Kit } from '../kit.ts';
import type { PartOptions, V3 } from '../kit.ts';
import { createLightPoints } from '../lights.ts';
import type { LightPoints, LightSpec } from '../lights.ts';
import { standardSet } from '../materials.ts';
import { rngFor } from '../shipgen/palette.ts';
import type { Rng } from '../shipgen/palette.ts';
import type { ArtContext, QualityLevel } from '../types.ts';
import { byQuality } from '../util.ts';
import type { WindowScale } from './geom.ts';
import { stationPalette, weathered } from './palette.ts';
import type { StationPalette } from './palette.ts';
import type { StationLook } from './types.ts';

/**
 * Working state while one station exterior is generated: one geometry kit and light list per
 * rigid part (the static body, a spinning ring, a turning dish), instanced movers for repeated
 * moving pieces (turrets, cranes, buckets), seeded streams, paint and the docking bay. Kits count
 * the triangles they receive so optional detail can stop at the quality's budget.
 */

/** Hard triangle budgets per quality (whole station, instanced pieces included). */
export const STATION_TRIANGLE_BUDGET: Readonly<Record<QualityLevel, number>> = { low: 15_000, medium: 30_000, high: 50_000 };

/** Most meshes (draw calls, light points excluded) one station may use. */
export const MAX_STATION_MESHES = 12;

/** The approach corridor every station keeps clear: straight out of the bay from `dockPoint`. */
export const DOCK_CORRIDOR: Readonly<{ length: number; radius: number }> = { length: 600, radius: 14 };

function triangleCount(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.attributes.position!.count) / 3;
}

/** Geometry kit that keeps a running triangle count. */
export class CountingKit extends Kit {
  triangles = 0;

  override add(key: string, geometry: THREE.BufferGeometry, opts: PartOptions = {}): this {
    this.triangles += triangleCount(geometry);
    return super.add(key, geometry, opts);
  }
}

export interface GenPart {
  readonly name: string;
  readonly group: THREE.Group;
  readonly kit: CountingKit;
  readonly lights: LightSpec[];
  /** Turns about its group origin: bounds are taken over every orientation. */
  readonly moving: boolean;
}

export interface Mover {
  readonly mesh: THREE.InstancedMesh;
  /** Largest distance from the station origin any vertex can reach while animating. */
  readonly reach: number;
  update(time: number): void;
}

export interface DockInfo {
  /** Station-local point just outside the bay mouth. */
  point: THREE.Vector3;
  /** Unit vector out of the bay. */
  approach: THREE.Vector3;
  /** Centre of the bay mouth. */
  mouth: THREE.Vector3;
  width: number;
  height: number;
  depth: number;
}

export interface LightOptions {
  /** Never dropped or flickered by wear (bay lights, main beacons). */
  essential?: boolean;
}

const PLACEHOLDER = new THREE.MeshBasicMaterial();

export class StationGen {
  readonly look: StationLook;
  readonly ctx: ArtContext;
  readonly quality: QualityLevel;
  readonly pal: StationPalette;
  /** Target bounding radius in metres (the layout unit). */
  readonly R: number;
  readonly size: number;
  readonly wear: number;
  /** Radial segments: modules and tanks, small rods, big rings and lathes. */
  readonly seg: number;
  readonly segSmall: number;
  readonly segRing: number;
  /** Share of optional greebles kept at this quality (0.45 / 0.75 / 1). */
  readonly detail: number;
  /** Window cell size for this station's scale. */
  readonly win: WindowScale;
  readonly root = new THREE.Group();
  readonly parts: GenPart[] = [];
  readonly movers: Mover[] = [];
  readonly ticks: ((time: number) => void)[] = [];
  readonly lightSets: LightPoints[] = [];
  /** The static body every station has. */
  readonly body: GenPart;
  dock: DockInfo | null = null;
  private readonly id: string;
  private readonly paintRng: Rng;
  private readonly lightRng: Rng;
  private readonly softBudget: number;
  private moverTriangles = 0;

  constructor(look: StationLook, ctx: ArtContext, radius: number) {
    this.look = look;
    this.ctx = ctx;
    this.quality = ctx.quality;
    this.id = `${look.type}|${look.owner}|${look.seed >>> 0}`;
    this.size = clamp01(look.size);
    this.wear = clamp01(look.wear);
    this.R = radius;
    this.pal = stationPalette(look.owner, this.rng('palette'), look.starColor);
    this.seg = byQuality(ctx.quality, 10, 14, 20);
    this.segSmall = byQuality(ctx.quality, 6, 8, 10);
    this.segRing = byQuality(ctx.quality, 40, 64, 88);
    this.detail = byQuality(ctx.quality, 0.45, 0.75, 1);
    this.win = { row: 2.6 + radius / 160, col: 1.8 + radius / 220 };
    this.softBudget = STATION_TRIANGLE_BUDGET[ctx.quality] * 0.9;
    this.paintRng = this.rng('paint');
    this.lightRng = this.rng('light-wear');
    this.root.name = `station-${look.type}`;
    this.body = this.part('body');
  }

  /** Independent seeded stream for one aspect of this station. */
  rng(aspect: string): Rng {
    return rngFor(this.id, aspect);
  }

  /** New rigid part (its own kit and lights). */
  part(name: string, parent: THREE.Object3D = this.root, moving = false, uv = 16): GenPart {
    const group = new THREE.Group();
    group.name = name;
    parent.add(group);
    const p: GenPart = { name, group, kit: new CountingKit(uv), lights: [], moving };
    this.parts.push(p);
    return p;
  }

  /** Triangles added so far (instanced pieces count once per instance). */
  get triangles(): number {
    let n = this.moverTriangles;
    for (const p of this.parts) n += p.kit.triangles;
    return n;
  }

  /** True while optional detail of about `extra` triangles still fits the quality's budget. */
  room(extra = 0): boolean {
    return this.triangles + extra <= this.softBudget;
  }

  /** Paint for one piece: slight shade variation plus grime with wear. */
  paint(color: THREE.Color, variation = 0.06): THREE.Color {
    return weathered(color, this.paintRng, this.wear, variation);
  }

  /** Adds a light; with wear, non-essential lights may be dark or flicker. */
  light(p: GenPart, spec: LightSpec, opts: LightOptions = {}): void {
    const r = this.lightRng;
    // Always draw the same numbers so one light's fate never shifts the next one's.
    const dead = r.next();
    const flick = r.next();
    const rate = r.range(2.2, 7.5);
    const duty = r.range(0.55, 0.9);
    const phase = r.next();
    if (!opts.essential && this.wear > 0) {
      if (dead < this.wear * 0.28) return;
      if (flick < this.wear * 0.4) {
        p.lights.push({ ...spec, blink: rate, duty, min: 0.08 + 0.3 * duty * (1 - this.wear), phase });
        return;
      }
    }
    p.lights.push(spec);
  }

  /**
   * Geometry for an instanced mover, built with a throwaway kit into a single merged,
   * vertex-coloured geometry (so the mover is one draw call with one material).
   */
  moverGeometry(fill: (kit: Kit, key: string) => void, uv = 8): THREE.BufferGeometry {
    const kit = new Kit(uv);
    fill(kit, 'mover');
    const [mesh] = kit.build(new THREE.Group(), { mover: PLACEHOLDER });
    if (!mesh) throw new Error('stationgen: empty mover geometry');
    return mesh.geometry;
  }

  /**
   * Instanced moving pieces: `pose(i, time, out)` writes instance i's station-local matrix. The
   * callback runs every frame, so it must not allocate.
   */
  mover(
    name: string,
    key: string,
    geometry: THREE.BufferGeometry,
    count: number,
    reach: number,
    pose: (i: number, time: number, out: THREE.Matrix4) => void,
  ): Mover {
    const material = standardSet(this.quality)[key];
    if (!material) throw new Error(`stationgen: no material ${key}`);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    const m = new THREE.Matrix4();
    const mv: Mover = {
      mesh,
      reach,
      update(time) {
        for (let i = 0; i < count; i++) {
          pose(i, time, m);
          mesh.setMatrixAt(i, m);
        }
        mesh.instanceMatrix.needsUpdate = true;
      },
    };
    mv.update(0);
    this.movers.push(mv);
    this.moverTriangles += triangleCount(geometry) * count;
    return mv;
  }

  /**
   * Reach of instanced pieces that only turn about their own origins at `points`: each can sweep
   * its whole geometry radius round its origin.
   */
  spinReach(points: readonly V3[], geometry: THREE.BufferGeometry): number {
    const pos = geometry.attributes.position!;
    let gr = 0;
    for (let i = 0; i < pos.count; i++) gr = Math.max(gr, Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)));
    let pr = 0;
    for (const p of points) pr = Math.max(pr, Math.hypot(p[0], p[1], p[2]));
    return pr + gr;
  }

  /** True if a sphere (centre, radius) stays out of the bay mouth and the approach corridor. */
  clearOfCorridor(center: V3, radius: number): boolean {
    const d = this.dock;
    if (!d) return true;
    const px = center[0] - d.point.x;
    const py = center[1] - d.point.y;
    const pz = center[2] - d.point.z;
    const s = px * d.approach.x + py * d.approach.y + pz * d.approach.z;
    const back = d.point.distanceTo(d.mouth) + 2;
    if (s < -back - radius || s > DOCK_CORRIDOR.length + 60 + radius) return true;
    const lx = px - s * d.approach.x;
    const ly = py - s * d.approach.y;
    const lz = pz - s * d.approach.z;
    return Math.hypot(lx, ly, lz) > DOCK_CORRIDOR.radius + 4 + radius;
  }

  /** Builds every kit into merged meshes (one per material per part) and the light points. */
  finish(): void {
    const mats = standardSet(this.quality);
    for (const p of this.parts) {
      p.kit.build(p.group, mats);
      if (p.lights.length) {
        const lp = createLightPoints(p.lights, this.ctx, 2.5);
        lp.points.name = `${p.name}-lights`;
        p.group.add(lp.points);
        this.lightSets.push(lp);
      }
    }
    this.root.updateMatrixWorld(true);
  }

  /**
   * Bounding radius about the station origin over every pose: static parts as built, moving
   * parts over every orientation about their pivots, movers by their declared reach. Lights count.
   */
  measureRadius(): number {
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const pivot = new THREE.Vector3();
    let r = 0;
    for (const p of this.parts) {
      pivot.setFromMatrixPosition(m.multiplyMatrices(inv, p.group.matrixWorld));
      const pl = pivot.length();
      for (const child of p.group.children) {
        const mesh = child as THREE.Mesh | THREE.Points;
        if (!(mesh as THREE.Mesh).isMesh && !(mesh as THREE.Points).isPoints) continue;
        if ((mesh as THREE.InstancedMesh).isInstancedMesh) continue;
        m.multiplyMatrices(inv, mesh.matrixWorld);
        const pos = mesh.geometry.attributes.position!;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          r = Math.max(r, p.moving ? pl + v.distanceTo(pivot) : v.length());
        }
      }
    }
    for (const mv of this.movers) r = Math.max(r, mv.reach);
    return r;
  }

  tick(time: number): void {
    for (const l of this.lightSets) l.uniforms.uTime.value = time;
    for (const t of this.ticks) t(time);
    for (const mv of this.movers) mv.update(time);
  }
}

export function clamp01(v: number): number {
  return Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0;
}
