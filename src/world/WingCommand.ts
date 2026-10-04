import * as THREE from 'three';
import { ORDER_LOCKS, ORDER_WORDS } from '../content/wing/lines.ts';
import { WING, WING_ORDERS, type WingOrder } from '../content/wing/rules.ts';
import type { ShipBody } from '../flight/ShipBody.ts';
import type { NpcShip } from './FlightSession.ts';

/**
 * The wing's orders in flight (docs/PROCGEN.md §34): which raider each wingman goes for under the
 * order given, where it keeps station when not fighting, when a guard or a hold ends, and the fights
 * each hired wingman earns beside the pilot. It draws no random numbers.
 */

/** What the wing needs to know of the flight each frame. */
export interface WingView {
  time: number;
  alive: boolean;
  busy: boolean;
  /** A duel is one on one: the wing holds its fire (docs/PROCGEN.md §28). */
  dueling: boolean;
  player: ShipBody;
  selectedId: string | null;
  npcs: readonly NpcShip[];
  /** A raider fair game for the wing (not one sparing the pilot, a duellist or a hunter). */
  fair: (n: NpcShip) => boolean;
}

export interface WingOption {
  order: WingOrder;
  label: string;
  effect: string;
  /** Why it cannot be given now, or null. */
  lock: string | null;
}

export type WingEvent = { kind: 'released'; why: 'ward' | 'far'; ward: string | null };

/** A hired wingman's fights and downs earned this flight, to write into the save. */
export interface WingCredit {
  crewId: string;
  fights: number;
  downs: number;
}

const flying = (n: NpcShip) => n.durability.hull > 0;
const packOf = (n: NpcShip) => n.den?.locationId ?? (n.pack !== undefined ? `pack.${n.pack}` : n.id);

export class WingCommand {
  order: WingOrder;
  /** The ship guarded under Defend (as selected) or Cover (re-picked each second). */
  private ward: NpcShip | null = null;
  private wardName: string | null = null;
  private hold: { at: THREE.Vector3; q: THREE.Quaternion } | null = null;
  private coverIn = 0;
  /** Each wingman's foe and when it is ready to take it on (its reaction). */
  private readonly ready = new Map<string, { foeId: string; at: number }>();
  /** The packs each hired wingman has taken on, and what it has earned, this flight. */
  private readonly engaged = new Map<string, Set<string>>();
  private readonly credited = new Map<string, Set<string>>();
  private readonly earned = new Map<string, { fights: number; downs: number }>();

  /** `carried`: the order from the last flight (a guard or a hold ends at a jump). */
  constructor(carried: WingOrder = 'free') {
    this.order = carried === 'defend' || carried === 'hold' || carried === 'cover' ? 'free' : carried;
  }

  /** Holding a point or guarding a ship: the wing does not catch up with the pilot. */
  get anchored(): boolean {
    return this.order === 'hold' || this.order === 'defend' || this.order === 'cover';
  }

  /** What the card offers, each with why not when it cannot be given. */
  options(view: WingView): WingOption[] {
    const sel = view.npcs.find((n) => n.target.id === view.selectedId && flying(n));
    return WING_ORDERS.map((order) => {
      let lock: string | null = null;
      if (order === 'defend') lock = !sel || sel.wingman ? ORDER_LOCKS.noWard : sel.target.hostile || sel.side === 'raider' ? ORDER_LOCKS.hostile : null;
      if (order === 'cover' && !this.coverWard(view)) lock = ORDER_LOCKS.noHauler;
      return { order, label: ORDER_WORDS[order].label, effect: ORDER_WORDS[order].effect, lock };
    });
  }

  /** Gives an order: the reply's words, or null if it cannot be given now. */
  give(order: WingOrder, view: WingView): string | null {
    const option = this.options(view).find((o) => o.order === order);
    if (!option || option.lock) return null;
    this.order = order;
    this.ward = null;
    this.wardName = null;
    this.hold = null;
    if (order === 'defend') this.ward = view.npcs.find((n) => n.target.id === view.selectedId) ?? null;
    if (order === 'cover') this.ward = this.coverWard(view);
    if (order === 'hold') this.hold = { at: view.player.position.clone(), q: view.player.quaternion.clone() };
    this.wardName = this.ward?.name ?? null;
    this.coverIn = 1;
    this.ready.clear();
    return ORDER_WORDS[order].ack.replace('{ward}', this.wardName ?? 'hauler');
  }

  /**
   * Whom Cover guards: the pilot's escorted ships first (each wingman its own, in turn), then their own
   * hauler, then a hauler sending a mayday nearby, then a stranded ship of a rescue.
   */
  private coverWard(view: WingView, index = 0): NpcShip | null {
    const live = view.npcs.filter(flying);
    const escorts = live.filter((n) => n.escort);
    if (escorts.length) return escorts[index % escorts.length]!;
    const own = live.find((n) => n.captain);
    if (own) return own;
    const mayday = live
      .filter((n) => n.haul && n.maydaySent && n.body.position.distanceTo(view.player.position) < WING.orders.mayday)
      .sort((a, b) => a.body.position.distanceTo(view.player.position) - b.body.position.distanceTo(view.player.position))[0];
    return mayday ?? live.find((n) => n.stranded) ?? null;
  }

  /** The ward for one wingman (Cover splits the wing over an escort's ships). */
  private wardFor(n: NpcShip, view: WingView): NpcShip | null {
    if (this.order === 'defend') return this.ward;
    if (this.order !== 'cover') return null;
    const wing = view.npcs.filter((x) => x.wingman && flying(x));
    return this.coverWard(view, Math.max(0, wing.indexOf(n))) ?? this.ward;
  }

  /** Once a frame: a guard ends with its ward gone, a guard or a hold when the pilot is far off. */
  update(view: WingView, dt: number): WingEvent[] {
    const out: WingEvent[] = [];
    const R = WING.orders.release;
    if (this.order === 'cover') {
      this.coverIn -= dt;
      if (this.coverIn <= 0) {
        this.coverIn = 1;
        this.ward = this.coverWard(view);
      }
    }
    if (this.order === 'defend' || this.order === 'cover') {
      const ward = this.ward;
      if (!ward || !flying(ward) || !view.npcs.includes(ward)) out.push(this.release('ward'));
      else if (ward.body.position.distanceTo(view.player.position) > R) out.push(this.release('far'));
    } else if (this.order === 'hold' && this.hold && this.hold.at.distanceTo(view.player.position) > R) out.push(this.release('far'));
    return out;
  }

  private release(why: 'ward' | 'far'): WingEvent {
    const ward = this.wardName;
    this.order = 'form';
    this.ward = null;
    this.hold = null;
    this.wardName = null;
    return { kind: 'released', why, ward };
  }

  /** Who a wingman goes for now, if anyone: by the order, once it has had time to react. */
  foeFor(n: NpcShip, view: WingView): NpcShip | null {
    const w = n.wingman!;
    if (!view.alive || view.busy || view.dueling || this.order === 'form' || w.hurt) return null;
    const near = (from: THREE.Vector3, range: number, match: (x: NpcShip) => boolean) => {
      let best: NpcShip | null = null;
      let bestD = range;
      for (const x of view.npcs) {
        if (!flying(x) || !match(x)) continue;
        const d = x.body.position.distanceTo(from);
        if (d < bestD) {
          best = x;
          bestD = d;
        }
      }
      return best;
    };
    let foe: NpcShip | null = null;
    if (this.order === 'free' || this.order === 'attack') {
      const ordered = this.order === 'attack' ? view.npcs.find((x) => x.target.id === view.selectedId && flying(x) && (view.fair(x) || x.foe === 'player')) : undefined;
      foe = ordered ?? near(view.player.position, WING.orders.free.range, view.fair);
    } else if (this.order === 'defend' || this.order === 'cover') {
      const ward = this.wardFor(n, view);
      if (!ward) return null;
      const W = WING.orders.ward;
      const keep = n.foe && n.foe !== 'player' && flying(n.foe) && n.foe.body.position.distanceTo(ward.body.position) < W.leash ? n.foe : null;
      foe = near(ward.body.position, W.prey, (x) => view.fair(x) && (x.prey === ward || x.foe === ward)) ?? keep ?? near(ward.body.position, W.range, view.fair);
    } else if (this.order === 'hold' && this.hold) {
      const H = WING.orders.hold;
      const at = this.hold.at;
      const keep = n.foe && n.foe !== 'player' && flying(n.foe) && n.foe.body.position.distanceTo(at) < H.leash ? n.foe : null;
      foe = keep ?? near(at, H.range, view.fair) ?? near(n.body.position, H.leash, (x) => x.side === 'raider' && x.foe === n);
    }
    if (!foe) {
      this.ready.delete(n.id);
      return null;
    }
    // A new foe: a moment to react, by grade.
    const r = this.ready.get(n.id);
    if (!r || r.foeId !== foe.id) {
      this.ready.set(n.id, { foeId: foe.id, at: view.time + (w.react ?? 0) });
      if ((w.react ?? 0) > 0) return null;
    } else if (view.time < r.at) return null;
    if (w.crewId) {
      const set = this.engaged.get(w.crewId) ?? new Set<string>();
      set.add(packOf(foe));
      this.engaged.set(w.crewId, set);
    }
    return foe;
  }

  /** Where a wingman keeps station when not fighting: off the pilot's wing, off the ward, or at the held point. */
  slotFor(n: NpcShip, view: WingView, out: THREE.Vector3): THREE.Vector3 {
    const w = n.wingman!;
    if (this.order === 'hold' && this.hold) return out.copy(w.offset).applyQuaternion(this.hold.q).add(this.hold.at);
    const ward = this.order === 'defend' || this.order === 'cover' ? this.wardFor(n, view) : null;
    if (ward) return out.copy(w.offset).normalize().multiplyScalar(WING.orders.ward.station).applyQuaternion(ward.body.quaternion).add(ward.body.position);
    return out.copy(w.offset).applyQuaternion(view.player.quaternion).add(view.player.position);
  }

  /** Breaking off and forming up: boost back when far out. */
  boostHome(n: NpcShip, slot: THREE.Vector3): boolean {
    return this.order === 'form' && n.body.position.distanceTo(slot) > WING.orders.form.boost;
  }

  /**
   * A raider went down: each hired wingman who took on its pack and was near it earns a fight (once a
   * pack), the one whose guns downed it a down; at most so many of each a flight.
   */
  credit(raider: NpcShip, killerId: string | undefined, view: WingView): WingCredit[] {
    const out: WingCredit[] = [];
    const pack = packOf(raider);
    const E = WING.earn;
    for (const n of view.npcs) {
      const id = n.wingman?.crewId;
      if (!id || !flying(n) || n.wingman!.hurt || n.wingman!.ally) continue;
      const got = this.earned.get(id) ?? { fights: 0, downs: 0 };
      const add = { fights: 0, downs: 0 };
      const done = this.credited.get(id) ?? new Set<string>();
      if (this.engaged.get(id)?.has(pack) && !done.has(pack) && n.body.position.distanceTo(raider.body.position) <= E.near && got.fights < E.fights) {
        done.add(pack);
        this.credited.set(id, done);
        add.fights = 1;
      }
      if (killerId === n.id && got.downs < E.downs) add.downs = 1;
      if (add.fights + add.downs) {
        got.fights += add.fights;
        got.downs += add.downs;
        this.earned.set(id, got);
        out.push({ crewId: id, ...add });
      }
    }
    return out;
  }

  /** The HUD's wing row and the touch chip. */
  hud(npcs: readonly NpcShip[]): { count: number; order: WingOrder; hurt: number } | null {
    const wing = npcs.filter((x) => x.wingman && flying(x));
    return wing.length ? { count: wing.length, order: this.order, hurt: wing.filter((x) => x.wingman!.hurt).length } : null;
  }

  /** What the wing has earned this flight (test hook). */
  earnings(): Record<string, { fights: number; downs: number }> {
    return Object.fromEntries(this.earned);
  }

  /** The ward's name, the held point (test hook). */
  status(): { order: WingOrder; ward: string | null; hold: [number, number, number] | null } {
    return { order: this.order, ward: this.wardName, hold: this.hold ? (this.hold.at.toArray() as [number, number, number]) : null };
  }
}
