import * as THREE from 'three';
import { COMMODITIES } from '../content/economy/goods.ts';
import { MINED_GOODS, MINING } from '../content/mining/rules.ts';
import { hashString } from '../content/random.ts';
import { findBelt } from '../data/systems.ts';
import type { BeltRecord } from '../data/types.ts';
import { rockSpec, sectorCount, type RockLeft, type RockSpec } from '../economy/mining.ts';
import { createMinableRock, type MinableRockArt, type RockLook } from './art/mining.ts';
import type { ArtContext } from './art/types.ts';
import type { SceneBeltDef } from './sceneTypes.ts';
import type { Target } from './targets.ts';

/**
 * The belts in flight (docs/PROCGEN.md §19): each ring a cited belt record draws is a target (at its
 * point nearest the player, scannable for its source), and a few larger rocks in the stretches of
 * ring nearest the player can be mined. Rocks come and go with the player; what is cut from them is
 * remembered in a ledger that outlives one flight (never the save), and a spent rock comes back
 * when its next growth turns over on the game clock.
 */

const KIND_LABEL: Record<BeltRecord['kind'], string> = { 'asteroid-belt': 'Asteroid belt', 'kuiper-belt': 'Kuiper belt', 'debris-disc': 'Debris disc' };

/** Rock units left, by rock and growth (`<rock>@<generation>`). */
export type MiningLedger = Map<string, number>;

export interface BeltRing {
  def: SceneBeltDef;
  belt: BeltRecord;
  /** Radius of the ring's middle, and half its width (metres). */
  mid: number;
  halfWidth: number;
  sectors: number;
  /** The belt as a target: its point nearest the player. */
  target: Target;
}

export interface MinableRock {
  spec: RockSpec;
  ring: BeltRing;
  position: THREE.Vector3;
  left: RockLeft;
  scanned: boolean;
  art: MinableRockArt;
  target: Target;
}

/** A rock's tint: rust for ore, pale blue ice, grey-green for volatiles. */
function lookOf(spec: RockSpec): RockLook {
  const c = spec.composition;
  const ice = (c.water ?? 0) + (c.gases ?? 0);
  const color = new THREE.Color('#7d6250').lerp(new THREE.Color('#9fb2bf'), Math.min(1, (c.water ?? 0) * 1.2)).lerp(new THREE.Color('#8f9c86'), (c.gases ?? 0) * 0.8);
  return { color, ice: Math.min(0.45, ice * 0.5) };
}

const key = (spec: RockSpec) => `${spec.id}@${spec.generation}`;

export class MiningField {
  readonly rings: BeltRing[] = [];
  private readonly rocks = new Map<string, MinableRock>();
  private readonly scene: THREE.Scene;
  private readonly ctx: ArtContext;
  private readonly ledger: MiningLedger;
  private readonly scanned = new Set<string>();
  private refreshIn = 0;
  private time = 0;

  constructor(scene: THREE.Scene, belts: readonly SceneBeltDef[], ctx: ArtContext, ledger: MiningLedger = new Map()) {
    this.scene = scene;
    this.ctx = ctx;
    this.ledger = ledger;
    const seen = new Map<string, number>();
    for (const def of belts) {
      const belt = findBelt(def.beltId);
      if (!belt) continue;
      const n = (seen.get(belt.id) ?? 0) + 1;
      seen.set(belt.id, n);
      const mid = (def.innerRadius + def.outerRadius) / 2;
      const halfWidth = (def.outerRadius - def.innerRadius) / 2;
      this.rings.push({
        def,
        belt,
        mid,
        halfWidth,
        sectors: sectorCount(mid),
        target: {
          id: n === 1 ? `belt:${belt.id}` : `belt:${belt.id}#${n}`,
          name: `${belt.name}${def.label ? ` (${def.label})` : ''}`,
          kind: 'belt',
          position: def.center.clone(),
          radius: halfWidth,
          subtitle: `${KIND_LABEL[belt.kind]} · real, placed schematically · scan it for its sources`,
          dataClass: 'observed',
          bodyId: belt.id,
          alive: true,
          cycle: true,
        },
      });
    }
  }

  /** Belt targets, then the rocks near the player. */
  targets(): Target[] {
    return [...this.rings.map((r) => r.target), ...[...this.rocks.values()].map((r) => r.target)];
  }

  /** A live belt or rock target by id. */
  find(id: string): Target | null {
    const t = this.rocks.get(id)?.target ?? this.rings.find((r) => r.target.id === id)?.target;
    return t?.alive ? t : null;
  }

  rock(targetId: string | null): MinableRock | undefined {
    return targetId ? this.rocks.get(targetId) : undefined;
  }

  /** Rocks within `radius` of a point (collisions). */
  *rocksNear(point: THREE.Vector3, radius: number): Iterable<MinableRock> {
    for (const r of this.rocks.values()) if (r.position.distanceTo(point) < radius + r.spec.radius) yield r;
  }

  /** How far the player is from a ring's band of rock (0 inside it). */
  distanceToBand(ring: BeltRing, p: THREE.Vector3): number {
    const c = ring.def.center;
    const r = Math.hypot(p.x - c.x, p.z - c.z);
    const across = Math.max(0, Math.abs(r - ring.mid) - ring.halfWidth);
    const up = Math.max(0, Math.abs(p.y - c.y) - ring.def.thickness / 2);
    return Math.hypot(across, up);
  }

  /**
   * Moves each belt target to the ring's point nearest the player, and (twice a second) brings in
   * the rocks of the stretches nearest the player, lets go of those left behind (never `keep`, the
   * rock being mined) and regrows spent rocks whose time has come.
   */
  update(dt: number, player: THREE.Vector3, clock: number, camera: THREE.Camera, keep: string | null = null): void {
    this.time += dt;
    for (const ring of this.rings) {
      const c = ring.def.center;
      const a = Math.atan2(player.z - c.z, player.x - c.x);
      ring.target.position.set(c.x + Math.cos(a) * ring.mid, c.y, c.z + Math.sin(a) * ring.mid);
    }
    for (const r of this.rocks.values()) r.art.update?.(dt, this.time, camera);
    this.refreshIn -= dt;
    if (this.refreshIn > 0) return;
    this.refreshIn = 0.5;
    const wanted = new Set<string>();
    for (const ring of this.rings) {
      if (this.distanceToBand(ring, player) > MINING.rocks.spawnReach) continue;
      const c = ring.def.center;
      const turn = (Math.atan2(player.z - c.z, player.x - c.x) / (2 * Math.PI) + 1) % 1;
      const s = turn * ring.sectors;
      const here = Math.floor(s) % ring.sectors;
      const next = s - Math.floor(s) < 0.5 ? (here - 1 + ring.sectors) % ring.sectors : (here + 1) % ring.sectors;
      for (const sector of [here, next]) {
        for (let i = 0; i < MINING.rocks.perSector; i++) {
          const spec = rockSpec(ring.def.id, ring.belt, sector, i, clock);
          const id = `rock:${spec.id}`;
          wanted.add(id);
          const live = this.rocks.get(id);
          if (!live) this.spawn(ring, spec);
          else if (live.spec.generation !== spec.generation) this.regrow(live, spec);
        }
      }
    }
    for (const [id, r] of this.rocks) if (!wanted.has(id) && id !== keep) this.despawn(r);
  }

  /** Reads a rock: its contents show in its subtitle from now on. */
  scan(rock: MinableRock): void {
    rock.scanned = true;
    this.scanned.add(key(rock.spec));
    this.describe(rock);
  }

  /** After the beam has cut: remembers what is left, and marks the rock spent when it is. */
  recordCut(rock: MinableRock): void {
    this.ledger.set(key(rock.spec), Math.round(rock.left.left * 1000) / 1000);
    if (rock.left.left <= 0 && rock.target.alive) {
      rock.target.alive = false;
      rock.art.setSpent(true);
    }
    this.describe(rock);
  }

  /** "Metal ore 68% · water ice 32%" for a scanned rock. */
  contents(rock: MinableRock): string {
    return MINED_GOODS.filter((g) => (rock.spec.composition[g] ?? 0) > 0)
      .map((g) => `${COMMODITIES[g].name} ${Math.round(rock.spec.composition[g]! * 100)}%`)
      .join(' · ');
  }

  /** The belt ring a rock or belt target belongs to. */
  ringOf(targetId: string): BeltRing | undefined {
    return this.rocks.get(targetId)?.ring ?? this.rings.find((r) => r.target.id === targetId);
  }

  private spawn(ring: BeltRing, spec: RockSpec): void {
    const c = ring.def.center;
    const angle = ((spec.sector + spec.u) / ring.sectors) * Math.PI * 2;
    const r = ring.mid + spec.radial * ring.halfWidth;
    const position = new THREE.Vector3(c.x + Math.cos(angle) * r, c.y + (spec.height * ring.def.thickness) / 2, c.z + Math.sin(angle) * r);
    const art = createMinableRock(hashString(spec.id), spec.radius, lookOf(spec), this.ctx);
    art.object.position.copy(position);
    this.scene.add(art.object);
    const left = this.ledger.get(key(spec)) ?? spec.amount;
    // Only this growth of the rock matters now.
    for (const k of this.ledger.keys()) if (k.startsWith(`${spec.id}@`) && k !== key(spec)) this.ledger.delete(k);
    const rock: MinableRock = {
      spec,
      ring,
      position,
      left: { left, acc: {} },
      scanned: this.scanned.has(key(spec)),
      art,
      target: {
        id: `rock:${spec.id}`,
        name: `Rock ${spec.sector + 1}.${spec.index + 1}`,
        kind: 'rock',
        position,
        radius: spec.radius,
        subtitle: '',
        dataClass: 'fictional',
        alive: left > 0,
        cycle: true,
      },
    };
    art.setSpent(left <= 0);
    this.describe(rock);
    this.rocks.set(rock.target.id, rock);
  }

  private regrow(rock: MinableRock, spec: RockSpec): void {
    this.despawn(rock);
    this.spawn(rock.ring, spec);
  }

  private despawn(rock: MinableRock): void {
    rock.target.alive = false;
    this.scene.remove(rock.art.object);
    rock.art.dispose();
    this.rocks.delete(rock.target.id);
  }

  private describe(rock: MinableRock): void {
    const t = rock.target;
    if (rock.left.left <= 0) t.subtitle = 'Spent · it grows back in time';
    else if (!rock.scanned) t.subtitle = `Unscanned rock · ${KIND_LABEL[rock.ring.belt.kind].toLowerCase()} · scan it to read it`;
    else t.subtitle = `${this.contents(rock)} · ${Math.ceil(rock.left.left)} of ${rock.spec.amount} units of rock left`;
  }

  dispose(): void {
    for (const r of [...this.rocks.values()]) this.despawn(r);
  }
}
