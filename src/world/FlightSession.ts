import * as THREE from 'three';
import type { AudioEngine } from '../audio/AudioEngine.ts';
import type { EngineSoundState, SfxId } from '../audio/types.ts';
import type { AimAssist, Settings } from '../app/settings.ts';
import { DIFFICULTY } from '../app/settings.ts';
import type { GameState } from '../app/state.ts';
import { applyDamage, regenerate, type Durability } from '../combat/damage.ts';
import { leadPoint } from '../combat/lead.ts';
import { MISSILE_LOCK_CONE, MISSILE_LOCK_RANGE, updateMissile, type Missile, type MissileTarget } from '../combat/missiles.ts';
import { PirateBrain } from '../combat/PirateAI.ts';
import { Gun, ProjectileSystem, segmentHitsSphere, withinArc } from '../combat/weapons.ts';
import { EXOPLANETS } from '../data/systems.ts';
import type { FactionId } from '../data/types.ts';
import { FACTIONS } from '../economy/factions.ts';
import { GUNS, HULL_MAX, MISSILE, REPAIR_KIT, SHIELDS } from '../economy/equipment.ts';
import { aimErrors, flyTo, steerToward } from '../flight/autopilot.ts';
import { ChaseCamera } from '../flight/ChaseCamera.ts';
import type { FlightAction, FlightInput } from '../flight/input/types.ts';
import { lookRotation, neutralControls, PLAYER_SHIP, RAIDER_SHIP, ShipBody, stepBounded, type ShipControls } from '../flight/ShipBody.ts';
import { emptyHudModel, type HudContextAction, type HudMarker, type HudModel } from '../ui/hud/hudModel.ts';
import type { AsteroidHit } from './art/asteroids.ts';
import {
  createCargoPod,
  createExplosion,
  createImpactSpark,
  createMissileArt,
  createProjectileRenderer,
  createSpeedStreaks,
  type ProjectileRenderer,
  type SpeedStreaksArt,
  type TransientEffect,
} from './art/effects.ts';
import { createPirateShip, createPlayerShip, type ShipArt } from './art/ships.ts';
import type { ArtContext, ArtObject } from './art/types.ts';
import { seededRandom } from './art/util.ts';
import type { EncounterDef } from './sceneTypes.ts';
import type { DockSite, LaneRuntime, SystemScene } from './SystemScene.ts';
import type { Target } from './targets.ts';

export type EncounterOutcome = 'destroyed' | 'bypassed' | 'escaped';

export interface FlightCallbacks {
  onDocked(locationId: string): void;
  onPlayerDestroyed(): void;
  /** First time the player comes within scan range of a catalogued body. */
  onDiscovery(bodyId: string): void;
  /** Player asked for a science card on a real body (manual scan). */
  onScanInfo(target: Target): void;
  onEncounterStart(def: EncounterDef): void;
  onEncounterEnd(def: EncounterDef, outcome: EncounterOutcome): void;
  onLoot(credits: number): void;
  onMessage(text: string, tone: 'good' | 'bad' | 'info'): void;
}

export type SpawnSpec =
  | { kind: 'undock'; locationId: string }
  | { kind: 'arrival' }
  | { kind: 'restore'; position: THREE.Vector3; quaternion: THREE.Quaternion };

interface NpcShip {
  id: string;
  name: string;
  faction: FactionId;
  body: ShipBody;
  art: ShipArt;
  durability: Durability;
  gun: Gun;
  brain: PirateBrain;
  controls: ShipControls;
  target: Target;
  encounter: EncounterDef;
}

interface Drone {
  id: string;
  art: ArtObject<THREE.Group>;
  center: THREE.Vector3;
  phase: number;
  radius: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  hull: number;
  respawnIn: number;
  target: Target;
}

interface LootPod {
  art: ArtObject<THREE.Group>;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  value: number;
  life: number;
  target: Target;
}

type Leg = { kind: 'point'; targetId: string } | { kind: 'lane'; laneId: string; reverse: boolean };

type Autopilot =
  | { mode: 'none' }
  | { mode: 'goto'; legs: Leg[]; label: string; dockAtEnd: string | null }
  | { mode: 'dock'; site: DockSite; phase: 'approach' | 'final'; t: number; from: THREE.Vector3; fromQ: THREE.Quaternion }
  | { mode: 'undock'; site: DockSite; t: number; from: THREE.Vector3; to: THREE.Vector3 }
  | {
      mode: 'lane';
      lane: LaneRuntime;
      reverse: boolean;
      phase: 'align' | 'travel';
      t: number;
      s: number;
      speed: number;
      next: Autopilot | null;
    };

const PLAYER_ID = 'player';
const DOCK_RANGE = 3_200;
const LANE_ENTER_RANGE = 450;
const DEFAULT_SCAN_RANGE = 9_000;
const HOSTILE_RADIUS = 3_500;
const CONVERGENCE = 700;
const EXOPLANET_IDS = new Set(EXOPLANETS.planets.map((p) => p.id));
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * The live in-flight world for one loaded system: player ship, raiders, bolts, missiles, loot,
 * autopilot, docking, lanes, collisions, encounters, scanning, camera and the HUD view model.
 */
export class FlightSession {
  readonly system: SystemScene;
  readonly camera: THREE.PerspectiveCamera;
  readonly chase: ChaseCamera;
  readonly player: ShipBody;
  readonly playerArt: ShipArt;
  readonly playerDurability: Durability;
  readonly hud: HudModel = emptyHudModel();
  alive = true;

  private readonly state: GameState;
  private settings: Settings;
  private readonly ctx: ArtContext;
  private readonly callbacks: FlightCallbacks;
  private readonly audio: AudioEngine;
  private readonly rand: () => number;
  private readonly gun: Gun;
  private readonly projectiles = new ProjectileSystem(320);
  private readonly projectileRenderer: ProjectileRenderer;
  private readonly streaks: SpeedStreaksArt;
  private readonly npcs: NpcShip[] = [];
  private readonly missiles: Missile[] = [];
  private readonly loot: LootPod[] = [];
  private readonly drones: Drone[] = [];
  private readonly effects: TransientEffect[] = [];
  private readonly controls = neutralControls();
  private autopilot: Autopilot = { mode: 'none' };
  private launchedFrom: string | null = null;
  private launchTime = 0;
  private throttle = 0;
  private drift = false;
  private selectedId: string | null = null;
  private objective: { locationId: string | null; bodyId: string | null } = { locationId: null, bodyId: null };
  private readonly aim = new THREE.Vector2();
  private aimAssisted = false;
  private missileLockTime = 0;
  private time = 0;
  private scanTimer = 0;
  private readonly triggered = new Set<string>();
  private activeEncounter: { def: EncounterDef; npcId: string; farTime: number; bypassed: boolean } | null = null;
  private deathTimer = -1;
  private viewport = { width: 1, height: 1 };
  private readonly raycaster = new THREE.Raycaster();
  private readonly aimPoint = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly asteroidHits: AsteroidHit[] = [];
  private readonly missileTargetCache = new Map<string, MissileTarget>();
  private readonly npcShots = new Map<string, number>();

  constructor(opts: {
    system: SystemScene;
    camera: THREE.PerspectiveCamera;
    state: GameState;
    settings: Settings;
    ctx: ArtContext;
    audio: AudioEngine;
    callbacks: FlightCallbacks;
  }) {
    this.system = opts.system;
    this.camera = opts.camera;
    this.state = opts.state;
    this.settings = opts.settings;
    this.ctx = opts.ctx;
    this.audio = opts.audio;
    this.callbacks = opts.callbacks;
    this.rand = seededRandom((opts.state.seed ^ (opts.state.stats.jumps * 7919) ^ Math.floor(opts.state.clock)) >>> 0);
    this.chase = new ChaseCamera(opts.camera);
    this.applyCameraSettings();

    this.player = new ShipBody(PLAYER_SHIP);
    this.playerArt = createPlayerShip(opts.ctx);
    this.system.scene.add(this.playerArt.object);
    const shield = SHIELDS[opts.state.ship.shieldGenerator];
    this.playerDurability = {
      hull: opts.state.ship.hull,
      hullMax: HULL_MAX,
      shield: Math.min(opts.state.ship.shield, shield.capacity),
      shieldMax: shield.capacity,
      shieldRegen: shield.regenPerSecond,
      shieldDelay: shield.regenDelay,
      sinceHit: 99,
    };
    const gunSpec = GUNS[opts.state.ship.gun];
    this.gun = new Gun({
      damage: gunSpec.damage,
      shotsPerSecond: gunSpec.shotsPerSecond,
      projectileSpeed: gunSpec.projectileSpeed,
      range: gunSpec.range,
      energyPerShot: gunSpec.energyPerShot,
      kind: opts.state.ship.gun === 'pulse-mk2' ? 'player-pulse-mk2' : 'player-pulse',
    });
    this.projectileRenderer = createProjectileRenderer(320, opts.ctx);
    this.system.scene.add(this.projectileRenderer.object);
    this.streaks = createSpeedStreaks(opts.ctx);
    this.camera.add(this.streaks.object);
    if (!this.camera.parent) this.system.scene.add(this.camera);
    else if (this.camera.parent !== this.system.scene) this.system.scene.add(this.camera);
  }

  // ---------------------------------------------------------------- setup

  start(spawn: SpawnSpec): void {
    const p = this.player;
    p.velocity.set(0, 0, 0);
    p.angularVelocity.set(0, 0, 0);
    if (spawn.kind === 'undock') {
      const site = this.system.dock(spawn.locationId);
      if (!site) throw new Error(`No dock ${spawn.locationId} in scene`);
      p.position.copy(site.dockPoint);
      p.lookAlong(site.approach);
      const to = site.dockPoint.clone().addScaledVector(site.approach, 260);
      this.autopilot = { mode: 'undock', site, t: 0, from: site.dockPoint.clone(), to };
      this.launchedFrom = spawn.locationId;
      this.launchTime = this.time;
      this.throttle = 0.35;
      this.sfx('undock');
    } else if (spawn.kind === 'arrival') {
      const a = this.system.def.arrival;
      p.position.copy(a.position);
      p.lookAlong(this.tmp.copy(a.lookAt).sub(a.position).normalize());
      p.velocity.copy(p.forward(this.tmp)).multiplyScalar(160);
      this.throttle = 0.4;
      this.sfx('jump-exit');
    } else {
      p.position.copy(spawn.position);
      p.quaternion.copy(spawn.quaternion);
      this.throttle = 0;
    }
    this.spawnPracticeDrones();
    this.syncPlayerArt(0);
    this.chase.snap(p);
    // Encounters already resolved in this save never retrigger.
    if (this.state.pirateOutcome !== 'none') for (const e of this.system.def.encounters) this.triggered.add(e.id);
  }

  setViewport(width: number, height: number): void {
    this.viewport = { width: Math.max(1, width), height: Math.max(1, height) };
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
    this.applyCameraSettings();
  }

  private applyCameraSettings(): void {
    this.chase.shakeEnabled = this.settings.cameraShake;
    this.chase.reducedMotion = this.settings.reducedMotion;
  }

  setObjective(locationId: string | null, bodyId: string | null): void {
    const prevId = this.objectiveTargetId();
    this.objective = { locationId, bodyId };
    const nextId = this.objectiveTargetId();
    // Keep guiding: if the player had the old objective selected, select the new one.
    if (prevId !== nextId && (this.selectedId === null || this.selectedId === prevId) && nextId && this.findTarget(nextId)) {
      this.selectedId = nextId;
    }
  }

  private objectiveTargetId(): string | null {
    if (this.objective.locationId) return `station:${this.objective.locationId}`;
    if (this.objective.bodyId) return `planet:${this.objective.bodyId}`;
    return null;
  }

  // ---------------------------------------------------------------- queries

  get busy(): boolean {
    const m = this.autopilot.mode;
    return m === 'lane' || m === 'dock' || m === 'undock';
  }

  get autopilotMode(): Autopilot['mode'] {
    return this.autopilot.mode;
  }

  hostilesNearby(radius = HOSTILE_RADIUS): boolean {
    return this.npcs.some((n) => n.durability.hull > 0 && n.body.position.distanceTo(this.player.position) < radius && n.brain.state !== 'escaped');
  }

  get encounterActive(): boolean {
    return this.activeEncounter !== null;
  }

  /** Current pose for mid-flight saves. */
  pose(): { position: [number, number, number]; quaternion: [number, number, number, number] } {
    const p = this.player.position;
    const q = this.player.quaternion;
    return { position: [p.x, p.y, p.z], quaternion: [q.x, q.y, q.z, q.w] };
  }

  /** Writes hull/shield/ammo back into the save state. */
  writeBack(state: GameState): void {
    state.ship.hull = Math.max(0, Math.round(this.playerDurability.hull * 10) / 10);
    state.ship.shield = Math.round(this.playerDurability.shield * 10) / 10;
  }

  allTargets(): Target[] {
    const list: Target[] = [];
    for (const t of this.system.targets) if (t.alive) list.push(t);
    for (const n of this.npcs) if (n.target.alive) list.push(n.target);
    for (const l of this.loot) if (l.target.alive) list.push(l.target);
    for (const d of this.drones) if (d.target.alive) list.push(d.target);
    return list;
  }

  // ---------------------------------------------------------------- practice drones

  private spawnPracticeDrones(): void {
    const range = this.system.def.practice;
    if (!range || this.drones.length) return;
    for (let i = 0; i < range.count; i++) {
      const art = createCargoPod(this.ctx);
      art.object.scale.setScalar(2.2);
      this.system.scene.add(art.object);
      const position = new THREE.Vector3();
      const velocity = new THREE.Vector3();
      const center = range.center.clone().add(new THREE.Vector3((i - 1) * 420, (i % 2) * 120, (i - 1) * -180));
      const drone: Drone = {
        id: `drone-${i}`,
        art,
        center,
        phase: (i * Math.PI * 2) / range.count,
        radius: range.radius,
        position,
        velocity,
        hull: 27,
        respawnIn: 0,
        target: {
          id: `drone:${i}`,
          name: `Practice drone ${i + 1}`,
          kind: 'drone',
          position,
          velocity,
          radius: 7,
          subtitle: 'Training target · aim practice, no reward',
          dataClass: 'fictional',
          hostile: false,
          alive: true,
          cycle: true,
        },
      };
      this.placeDrone(drone, 0);
      this.drones.push(drone);
    }
  }

  private placeDrone(d: Drone, dt: number): void {
    d.phase += dt * 0.35;
    const prev = this.tmp2.copy(d.position);
    d.position.set(
      d.center.x + Math.cos(d.phase) * d.radius,
      d.center.y + Math.sin(d.phase * 1.7) * d.radius * 0.35,
      d.center.z + Math.sin(d.phase) * d.radius,
    );
    if (dt > 0) d.velocity.copy(d.position).sub(prev).divideScalar(dt);
    d.art.object.position.copy(d.position);
  }

  private updateDrones(dt: number): void {
    for (const d of this.drones) {
      if (!d.target.alive) {
        d.respawnIn -= dt;
        if (d.respawnIn <= 0) {
          d.hull = 27;
          d.target.alive = true;
          d.art.object.visible = true;
        }
        continue;
      }
      this.placeDrone(d, dt);
      d.art.update?.(dt, this.time, this.camera);
    }
  }

  private hitDrone(d: Drone, damage: number, at: THREE.Vector3): void {
    d.hull -= damage;
    this.spawnEffect(createImpactSpark(at.clone(), '#ffb070', this.ctx));
    this.sfx('hit-hull', 0.4);
    this.dronesHit++;
    if (d.hull <= 0) {
      d.target.alive = false;
      d.art.object.visible = false;
      d.respawnIn = 12;
      if (this.selectedId === d.target.id) this.selectedId = null;
      this.spawnEffect(createExplosion(d.position.clone(), 4, this.ctx));
      this.sfx('explosion-small', 0.6);
      this.callbacks.onMessage('Practice drone down. It will respawn shortly.', 'good');
    }
  }

  /** Number of practice-drone hits (for tests and the tutorial). */
  dronesHit = 0;

  findTarget(id: string | null): Target | null {
    if (!id) return null;
    for (const t of this.system.targets) if (t.id === id && t.alive) return t;
    for (const n of this.npcs) if (n.target.id === id && n.target.alive) return n.target;
    for (const l of this.loot) if (l.target.id === id && l.target.alive) return l.target;
    for (const d of this.drones) if (d.target.id === id && d.target.alive) return d.target;
    return null;
  }

  selectTarget(id: string | null): void {
    this.selectedId = id;
    if (id) this.sfx('target-lock', 0.5);
  }

  get selectedTarget(): Target | null {
    return this.findTarget(this.selectedId);
  }

  // ---------------------------------------------------------------- actions

  /** One-click "avoid combat": the Transit Authority escort sees you in and the raider breaks off. */
  avoidCombat(): void {
    const enc = this.activeEncounter;
    if (!enc || enc.bypassed) return;
    enc.bypassed = true;
    for (const n of this.npcs) if (n.encounter === enc.def) n.brain.state = 'escaped';
    this.callbacks.onMessage('Transit Authority patrol escort inbound — the raider is breaking off.', 'info');
    const dock = this.system.docks.reduce((best, d) =>
      d.def.position.distanceTo(enc.def.center) < best.def.position.distanceTo(enc.def.center) ? d : best,
    );
    this.beginGoTo(`station:${dock.def.locationId}`, true);
  }

  private handleAction(action: FlightAction): void {
    switch (action) {
      case 'cruise':
        if (this.busy) return;
        if (this.autopilot.mode === 'goto') this.autopilot = { mode: 'none' };
        if (this.player.cruise === 'off') {
          this.player.requestCruise(true);
          this.drift = false;
          this.sfx('cruise-charge');
        } else {
          this.player.requestCruise(false);
          this.sfx('cruise-exit');
        }
        break;
      case 'target-next':
        this.cycleTarget(false);
        break;
      case 'target-hostile':
        this.cycleTarget(true);
        break;
      case 'interact': {
        const ctx = this.contextAction();
        if (ctx && ctx.action !== 'interact') this.handleAction(ctx.action);
        else this.interact();
        break;
      }
      case 'goto': {
        const t = this.selectedTarget ?? this.objectiveTarget();
        if (t) this.beginGoTo(t.id, t.kind === 'station');
        break;
      }
      case 'scan':
        this.manualScan();
        break;
      case 'missile':
        this.fireMissile();
        break;
      case 'repair':
        this.useRepairKit();
        break;
      case 'engine-kill':
        if (this.busy) return;
        this.drift = !this.drift;
        if (this.drift) this.player.requestCruise(false);
        this.callbacks.onMessage(this.drift ? 'Engines off: drifting' : 'Engines on', 'info');
        break;
      case 'cancel-autopilot':
        if (this.autopilot.mode === 'goto') {
          this.autopilot = { mode: 'none' };
          this.callbacks.onMessage('Autopilot off', 'info');
        }
        break;
      default:
        break;
    }
  }

  private cycleTarget(hostileOnly: boolean): void {
    const candidates = this.allTargets()
      .filter((t) => (hostileOnly ? t.hostile : t.cycle || t.hostile || t.kind === 'loot'))
      .sort((a, b) => a.position.distanceTo(this.player.position) - b.position.distanceTo(this.player.position));
    if (!candidates.length) {
      if (hostileOnly) this.callbacks.onMessage('No hostiles in range', 'info');
      return;
    }
    if (hostileOnly) {
      this.selectTarget(candidates[0]!.id);
      return;
    }
    const idx = candidates.findIndex((t) => t.id === this.selectedId);
    this.selectTarget(candidates[(idx + 1) % candidates.length]!.id);
  }

  private objectiveTarget(): Target | null {
    const { locationId, bodyId } = this.objective;
    if (locationId) return this.findTarget(`station:${locationId}`);
    if (bodyId) return this.findTarget(`planet:${bodyId}`);
    return null;
  }

  private nearestDock(): { site: DockSite; distance: number } | null {
    let best: { site: DockSite; distance: number } | null = null;
    for (const site of this.system.docks) {
      const d = site.def.position.distanceTo(this.player.position);
      if (!best || d < best.distance) best = { site, distance: d };
    }
    return best;
  }

  private nearestLaneEntrance(): { lane: LaneRuntime; reverse: boolean; distance: number } | null {
    let best: { lane: LaneRuntime; reverse: boolean; distance: number } | null = null;
    for (const lane of this.system.lanes) {
      for (const reverse of [false, true]) {
        const entry = reverse ? lane.def.to : lane.def.from;
        const d = entry.distanceTo(this.player.position);
        if (!best || d < best.distance) best = { lane, reverse, distance: d };
      }
    }
    return best;
  }

  /** The dock the context action would use: the selected station if in range, else the nearest. */
  private dockCandidate(): DockSite | null {
    const sel = this.selectedTarget;
    if (sel?.kind === 'station' && sel.locationId) {
      const site = this.system.dock(sel.locationId);
      if (site && site.def.position.distanceTo(this.player.position) < DOCK_RANGE) return site;
      return null;
    }
    const dock = this.nearestDock();
    if (!dock || dock.distance >= DOCK_RANGE) return null;
    // Don't offer to re-dock where the player just launched from.
    if (dock.site.def.locationId === this.launchedFrom && this.time - this.launchTime < 25) return null;
    return dock.site;
  }

  /** The context-sensitive action offered by the E key / touch action button. */
  contextAction(): HudContextAction | null {
    if (!this.alive || this.busy) return null;
    const sel = this.selectedTarget;
    if (this.dockCandidate() && !this.hostilesNearby(2_200)) {
      return { label: 'Dock', action: 'interact', icon: 'dock' };
    }
    const lane = this.nearestLaneEntrance();
    if (lane && lane.distance < LANE_ENTER_RANGE) return { label: 'Enter lane', action: 'interact', icon: 'cruise' };
    if (sel && (sel.kind === 'planet' || sel.kind === 'star') && sel.position.distanceTo(this.player.position) < this.scanRangeFor(sel) * 3) {
      return { label: 'Scan', action: 'scan', icon: 'scan' };
    }
    const goal = sel ?? this.objectiveTarget();
    const headingTo = this.autopilotTargetId();
    if (goal && goal.position.distanceTo(this.player.position) > 1_500 && goal.id !== headingTo) {
      return { label: sel ? 'Go to' : 'Go to goal', action: 'goto', icon: 'goto' };
    }
    if (this.autopilot.mode === 'goto') return { label: 'Stop', action: 'cancel-autopilot', icon: 'close' };
    return null;
  }

  /** Final destination of the running Go To, if any. */
  private autopilotTargetId(): string | null {
    const ap = this.autopilot;
    if (ap.mode === 'lane' && ap.next?.mode === 'goto') {
      const last = ap.next.legs[ap.next.legs.length - 1];
      return last?.kind === 'point' ? last.targetId : null;
    }
    if (ap.mode !== 'goto') return null;
    const last = ap.legs[ap.legs.length - 1];
    return last?.kind === 'point' ? last.targetId : null;
  }

  private interact(): void {
    const site = this.dockCandidate();
    if (site) {
      this.beginDock(site);
      return;
    }
    const lane = this.nearestLaneEntrance();
    if (lane && lane.distance < LANE_ENTER_RANGE) {
      this.beginLane(lane.lane, lane.reverse, null);
      return;
    }
    const sel = this.selectedTarget;
    if (sel) this.beginGoTo(sel.id, sel.kind === 'station');
  }

  private beginDock(site: DockSite): void {
    if (this.hostilesNearby(2_200)) {
      this.callbacks.onMessage('Docking refused: hostile contact nearby.', 'bad');
      this.sfx('ui-error');
      return;
    }
    this.player.requestCruise(false);
    this.drift = false;
    this.autopilot = { mode: 'dock', site, phase: 'approach', t: 0, from: new THREE.Vector3(), fromQ: new THREE.Quaternion() };
    this.callbacks.onMessage(`Docking with ${site.name}…`, 'info');
  }

  private beginLane(lane: LaneRuntime, reverse: boolean, next: Autopilot | null): void {
    this.player.requestCruise(false);
    this.drift = false;
    this.autopilot = { mode: 'lane', lane, reverse, phase: 'align', t: 0, s: 0, speed: 0, next };
  }

  /** Plans a route to a target, using a trade lane when it saves time, then flies it. */
  beginGoTo(targetId: string, dockAtEnd: boolean): void {
    const target = this.findTarget(targetId);
    if (!target) return;
    const legs: Leg[] = [];
    const from = this.player.position;
    const dest = target.position;
    const cruise = this.player.params.cruiseSpeed;
    let bestTime = from.distanceTo(dest) / cruise;
    let bestLane: { lane: LaneRuntime; reverse: boolean } | null = null;
    for (const lane of this.system.lanes) {
      for (const reverse of [false, true]) {
        const entry = reverse ? lane.def.to : lane.def.from;
        const exit = reverse ? lane.def.from : lane.def.to;
        const time = from.distanceTo(entry) / cruise + lane.length / lane.def.speed + 3 + exit.distanceTo(dest) / cruise;
        if (time < bestTime * 0.8) {
          bestTime = time;
          bestLane = { lane, reverse };
        }
      }
    }
    if (bestLane && target.kind !== 'lane') legs.push({ kind: 'lane', laneId: bestLane.lane.def.id, reverse: bestLane.reverse });
    if (target.kind === 'lane' && target.laneId) legs.push({ kind: 'lane', laneId: target.laneId, reverse: !!target.laneReverse });
    else legs.push({ kind: 'point', targetId });
    this.drift = false;
    this.selectedId = targetId;
    this.autopilot = {
      mode: 'goto',
      legs,
      label: `Autopilot: ${target.name}`,
      dockAtEnd: dockAtEnd && target.locationId ? target.locationId : null,
    };
    this.callbacks.onMessage(`Autopilot engaged: ${target.name}${bestLane ? ' via trade lane' : ''}`, 'info');
  }

  private scanRangeFor(t: Target): number {
    if (t.kind === 'planet') {
      const def = this.system.planets.find((p) => p.def.id === t.bodyId)?.def;
      return def?.scanRange ?? DEFAULT_SCAN_RANGE;
    }
    if (t.kind === 'star') return Math.max(20_000, t.radius * 6);
    return DEFAULT_SCAN_RANGE;
  }

  private manualScan(): void {
    const t = this.selectedTarget;
    if (!t || (t.kind !== 'planet' && t.kind !== 'star')) {
      this.callbacks.onMessage('Select a planet or star to scan.', 'info');
      return;
    }
    const d = t.position.distanceTo(this.player.position);
    if (d > this.scanRangeFor(t) * 3) {
      this.callbacks.onMessage('Out of scan range — fly closer.', 'bad');
      return;
    }
    this.sfx('scan');
    if (t.bodyId && EXOPLANET_IDS.has(t.bodyId) && !this.state.discoveredBodies.includes(t.bodyId)) {
      this.callbacks.onDiscovery(t.bodyId);
    } else {
      this.callbacks.onScanInfo(t);
    }
  }

  private fireMissile(): void {
    const t = this.selectedTarget;
    if (this.state.ship.missiles <= 0) {
      this.callbacks.onMessage('No missiles left.', 'bad');
      return;
    }
    if (!t || !t.hostile || this.hud.missileLock !== 'locked') {
      this.callbacks.onMessage('No missile lock: target a hostile ahead of you.', 'bad');
      this.sfx('ui-error');
      return;
    }
    const npc = this.npcs.find((n) => n.target.id === t.id);
    if (!npc) return;
    this.state.ship.missiles -= 1;
    const art = createMissileArt(this.ctx);
    this.system.scene.add(art.object);
    const dir = this.player.forward(new THREE.Vector3());
    const pos = this.player.position.clone().addScaledVector(this.player.up(this.tmp), -1.5).addScaledVector(dir, 6);
    this.missiles.push({
      art,
      position: pos,
      direction: dir,
      speed: Math.max(60, this.player.forwardSpeed),
      target: this.missileTargetFor(npc),
      ownerId: PLAYER_ID,
      damage: MISSILE.damage,
      life: MISSILE.lifetime,
      alive: true,
    });
    this.sfx('missile-launch');
    this.player.requestCruise(false);
  }

  private missileTargetFor(npc: NpcShip): MissileTarget {
    let t = this.missileTargetCache.get(npc.id);
    if (!t) {
      t = { id: npc.id, position: npc.body.position, velocity: npc.body.velocity, radius: npc.art.radius, alive: true };
      this.missileTargetCache.set(npc.id, t);
    }
    return t;
  }

  private useRepairKit(): void {
    const d = this.playerDurability;
    if (this.state.ship.repairKits <= 0) {
      this.callbacks.onMessage('No repair kits left.', 'bad');
      return;
    }
    if (d.hull >= d.hullMax) {
      this.callbacks.onMessage('Hull is already intact.', 'info');
      return;
    }
    this.state.ship.repairKits -= 1;
    d.hull = Math.min(d.hullMax, d.hull + REPAIR_KIT.restore);
    this.sfx('repair');
    this.callbacks.onMessage(`Repair kit used: +${REPAIR_KIT.restore} hull`, 'good');
  }

  // ---------------------------------------------------------------- update

  update(dt: number, input: FlightInput): void {
    this.time += dt;
    for (const a of input.actions) this.handleAction(a);
    if (input.selectAt) this.pickAt(input.selectAt.x, input.selectAt.y);

    if (this.alive) this.updatePlayerControls(dt, input);
    stepBounded(dt, 1 / 60, (h) => {
      if (this.alive) this.stepPlayer(h);
      for (const n of this.npcs) this.stepNpc(n, h);
    });
    if (this.alive) {
      this.updateAim(dt, input);
      if (input.fire && !this.busy) this.firePlayerGuns();
    }
    this.gun.tick(dt);
    this.updateProjectiles(dt);
    this.updateMissiles(dt);
    this.updateLoot(dt);
    this.updateDrones(dt);
    if (this.alive) this.collide(this.player, this.playerDurability, true);
    for (const n of this.npcs) this.collide(n.body, n.durability, false);
    regenerate(this.playerDurability, dt);
    for (const n of this.npcs) regenerate(n.durability, dt);
    this.updateEncounters(dt);
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.5;
      this.autoScan();
    }
    this.updateMissileLock(dt);
    if (this.deathTimer >= 0) {
      this.deathTimer += dt;
      if (this.deathTimer > 2.2) {
        this.deathTimer = -1;
        this.callbacks.onPlayerDestroyed();
      }
    }

    // Visuals.
    this.syncPlayerArt(dt);
    for (const n of this.npcs) this.syncNpcArt(n);
    const speedFrac = this.player.speed / this.player.params.cruiseSpeed;
    this.chase.update(this.player, dt, this.autopilot.mode === 'lane' ? 1 : speedFrac);
    const streak =
      this.autopilot.mode === 'lane' && this.autopilot.phase === 'travel'
        ? 1
        : this.player.cruise === 'on'
          ? 0.35
          : 0;
    this.streaks.setIntensity(this.settings.reducedMotion ? streak * 0.4 : streak);
    this.streaks.update?.(dt, this.time, this.camera);
    this.projectileRenderer.render(this.projectiles.list);
    for (const m of this.missiles) m.art.update?.(dt, this.time, this.camera);
    for (const l of this.loot) l.art.update?.(dt, this.time, this.camera);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]!;
      e.update?.(dt, this.time, this.camera);
      if (e.finished) {
        this.system.scene.remove(e.object);
        e.dispose();
        this.effects.splice(i, 1);
      }
    }
    this.camera.updateMatrixWorld();
    this.system.update(dt, this.camera, this.player.position);
    this.audio.setEngine(this.engineSound());
    this.audio.setCombatIntensity(this.activeEncounter ? 1 : 0);
    this.buildHud();
  }

  private engineSound(): EngineSoundState | null {
    if (!this.alive) return null;
    return {
      throttle: Math.max(0, this.player.throttle),
      speed: Math.min(1, this.player.speed / this.player.params.cruiseSpeed),
      boost: this.player.boosting,
      cruise: this.player.cruise === 'on',
      lane: this.autopilot.mode === 'lane' && this.autopilot.phase === 'travel',
    };
  }

  private updatePlayerControls(dt: number, input: FlightInput): void {
    const c = this.controls;
    if (input.manualOverride && this.autopilot.mode === 'goto') {
      this.autopilot = { mode: 'none' };
      this.callbacks.onMessage('Autopilot off: manual control', 'info');
    }
    if (input.throttleTarget !== null) this.throttle = input.throttleTarget;
    this.throttle = Math.max(-1, Math.min(1, this.throttle + input.throttleDelta));
    if (this.autopilot.mode === 'none') {
      c.steerX = input.steerX;
      c.steerY = input.steerY;
      c.throttle = this.throttle;
      c.strafeX = input.strafeX;
      c.strafeY = input.strafeY;
      c.boost = input.boost;
      c.engineKill = this.drift;
      if (input.boost && this.player.cruise !== 'off') this.player.requestCruise(false);
    } else if (this.autopilot.mode === 'goto') {
      this.runGoTo(dt);
    }
    if (this.player.boostStarted) this.sfx('boost-start', 0.7);
  }

  private runGoTo(dt: number): void {
    const ap = this.autopilot;
    if (ap.mode !== 'goto') return;
    const leg = ap.legs[0];
    if (!leg) {
      this.autopilot = { mode: 'none' };
      return;
    }
    if (leg.kind === 'lane') {
      const lane = this.system.lanes.find((l) => l.def.id === leg.laneId);
      if (!lane) {
        ap.legs.shift();
        return;
      }
      const entry = leg.reverse ? lane.def.to : lane.def.from;
      const st = flyTo(this.player, entry, { arriveDistance: 60, allowCruise: true }, this.controls);
      this.controls.boost = false;
      this.player.requestCruise(st.wantsCruise);
      if (entry.distanceTo(this.player.position) < LANE_ENTER_RANGE * 0.8) {
        ap.legs.shift();
        const rest: Autopilot = ap.legs.length ? { ...ap } : { mode: 'none' };
        this.beginLane(lane, leg.reverse, rest);
      }
      return;
    }
    const target = this.findTarget(leg.targetId);
    if (!target) {
      this.autopilot = { mode: 'none' };
      return;
    }
    const standoff = target.kind === 'station' ? target.radius + 450 : target.radius + 600;
    const st = flyTo(this.player, target.position, { arriveDistance: standoff, allowCruise: true }, this.controls);
    this.player.requestCruise(st.wantsCruise);
    void dt;
    if (st.arrived || st.distance < 80) {
      const dockId = ap.dockAtEnd;
      this.autopilot = { mode: 'none' };
      this.throttle = 0;
      if (dockId) {
        const site = this.system.dock(dockId);
        if (site) this.beginDock(site);
      } else {
        this.callbacks.onMessage(`Arrived: ${target.name}`, 'info');
      }
    }
  }

  private stepPlayer(h: number): void {
    const ap = this.autopilot;
    const p = this.player;
    if (ap.mode === 'undock') {
      ap.t += h;
      const k = Math.min(1, ap.t / 2.4);
      p.position.lerpVectors(ap.from, ap.to, easeInOut(k));
      p.velocity.copy(ap.to).sub(ap.from).multiplyScalar(k < 1 ? 1 / 2.4 : 0);
      if (k >= 1) {
        p.velocity.copy(ap.site.approach).multiplyScalar(45);
        this.autopilot = { mode: 'none' };
      }
      return;
    }
    if (ap.mode === 'dock') {
      this.stepDock(ap, h);
      return;
    }
    if (ap.mode === 'lane') {
      this.stepLane(ap, h);
      return;
    }
    const wasCruise = p.cruise;
    p.step(this.controls, h);
    if (wasCruise === 'charging' && p.cruise === 'on') this.sfx('cruise-engage');
  }

  private stepDock(ap: Extract<Autopilot, { mode: 'dock' }>, h: number): void {
    const p = this.player;
    const approachPoint = this.tmp2.copy(ap.site.dockPoint).addScaledVector(ap.site.approach, 260);
    if (ap.phase === 'approach') {
      const st = flyTo(p, approachPoint, { arriveDistance: 20, allowCruise: true, maxThrottle: 1 }, this.controls);
      p.requestCruise(st.wantsCruise);
      p.step(this.controls, h);
      if (p.position.distanceTo(approachPoint) < 90) {
        ap.phase = 'final';
        ap.t = 0;
        ap.from.copy(p.position);
        ap.fromQ.copy(p.quaternion);
        p.requestCruise(false);
      }
      return;
    }
    ap.t += h;
    const k = Math.min(1, ap.t / 3.2);
    p.position.lerpVectors(ap.from, ap.site.dockPoint, easeInOut(k));
    // Nose into the bay: facing against the approach vector.
    const targetQ = lookRotation(this.tmp.copy(ap.site.approach).negate(), this.tmpQ);
    p.quaternion.slerpQuaternions(ap.fromQ, targetQ, easeInOut(Math.min(1, k * 1.4)));
    p.velocity.set(0, 0, 0);
    if (k >= 1) {
      this.autopilot = { mode: 'none' };
      this.sfx('dock-clamp');
      this.callbacks.onDocked(ap.site.def.locationId);
    }
  }

  private stepLane(ap: Extract<Autopilot, { mode: 'lane' }>, h: number): void {
    const p = this.player;
    const lane = ap.lane;
    const from = ap.reverse ? lane.def.to : lane.def.from;
    const to = ap.reverse ? lane.def.from : lane.def.to;
    const dir = this.tmp.copy(to).sub(from).normalize();
    ap.t += h;
    if (ap.phase === 'align') {
      const entry = this.tmp2.copy(from).addScaledVector(dir, -30);
      const st = flyTo(p, entry, { arriveDistance: 0, allowCruise: false, maxThrottle: 0.8 }, this.controls);
      p.step(this.controls, h);
      const aligned = aimErrors(p, this.tmp2.copy(from).addScaledVector(dir, 2000)).angle < 0.2;
      if ((st.distance < 60 && aligned) || ap.t > 3.5) {
        ap.phase = 'travel';
        ap.t = 0;
        ap.s = Math.max(0, this.tmp2.copy(p.position).sub(from).dot(dir));
        ap.speed = Math.max(80, p.forwardSpeed);
        this.system.setLaneActive(lane.def.id, true);
        this.sfx('lane-enter');
        this.callbacks.onMessage(`Entering ${lane.def.name}`, 'info');
      } else {
        steerToward(p, this.tmp2.copy(from).addScaledVector(dir, 2000), this.controls);
      }
      return;
    }
    const accel = lane.def.speed * 0.7;
    const remaining = lane.length - ap.s;
    const brakeDist = (ap.speed * ap.speed) / (2 * accel);
    if (remaining <= brakeDist + 10) ap.speed = Math.max(120, ap.speed - accel * h);
    else ap.speed = Math.min(lane.def.speed, ap.speed + accel * h);
    ap.s = Math.min(lane.length, ap.s + ap.speed * h);
    const lateral = this.tmp2.copy(p.position).sub(from);
    lateral.addScaledVector(dir, -lateral.dot(dir));
    lateral.multiplyScalar(Math.exp(-3 * h));
    p.position.copy(from).addScaledVector(dir, ap.s).add(lateral);
    p.velocity.copy(dir).multiplyScalar(ap.speed);
    const q = this.tmpQ.setFromUnitVectors(Z_AXIS, dir.clone().negate());
    p.quaternion.slerp(q, 1 - Math.exp(-4 * h));
    p.angularVelocity.set(0, 0, 0);
    if (ap.s >= lane.length - 1) {
      this.system.setLaneActive(lane.def.id, false);
      this.sfx('lane-exit');
      p.velocity.copy(dir).multiplyScalar(120);
      this.throttle = 0.6;
      this.autopilot = ap.next ?? { mode: 'none' };
      if (!ap.next) this.callbacks.onMessage('Lane exit', 'info');
    }
  }

  private stepNpc(n: NpcShip, h: number): void {
    if (n.durability.hull <= 0) return;
    n.body.step(n.controls, h);
  }

  // ---------------------------------------------------------------- aiming and firing

  private updateAim(dt: number, input: FlightInput): void {
    if (input.aimActive) this.aim.set(input.aimX, input.aimY);
    else this.aim.multiplyScalar(Math.exp(-6 * dt));
    this.aimAssisted = false;
    const assist = this.assistStrength(this.settings.aimAssist);
    const t = this.selectedTarget;
    if (assist > 0 && t && (t.hostile || t.kind === 'drone') && t.velocity) {
      leadPoint(this.player.position, this.player.velocity, t.position, t.velocity, this.gun.profile.projectileSpeed, this.tmp);
      this.tmp.project(this.camera);
      if (this.tmp.z < 1) {
        const dx = this.tmp.x - this.aim.x;
        const dy = this.tmp.y - this.aim.y;
        const radius = assist * 0.18;
        if (Math.hypot(dx, dy) < radius) {
          this.aim.x += dx * assist;
          this.aim.y += dy * assist;
          this.aimAssisted = true;
        }
      }
    }
    this.computeAimPoint(this.aim.x, this.aim.y, this.aimPoint);
  }

  private assistStrength(level: AimAssist): number {
    return level === 'medium' ? 0.65 : level === 'low' ? 0.35 : 0;
  }

  /**
   * The 3D point under the reticle: along the camera ray through the reticle, at the selected
   * target's range when the ray passes near it, else at gun convergence distance.
   */
  private computeAimPoint(ndcX: number, ndcY: number, out: THREE.Vector3): void {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const ray = this.raycaster.ray;
    let distance = CONVERGENCE;
    let best = Infinity;
    for (const n of this.npcs) {
      if (n.durability.hull <= 0) continue;
      const d = this.tmp2.copy(n.body.position).sub(ray.origin);
      const along = d.dot(ray.direction);
      if (along <= 0) continue;
      const off = Math.sqrt(Math.max(0, d.lengthSq() - along * along));
      const angle = off / along;
      if (angle < 0.08 && angle < best) {
        best = angle;
        distance = along;
      }
    }
    const t = this.selectedTarget;
    if (best === Infinity && t && t.hostile) {
      const along = this.tmp2.copy(t.position).sub(ray.origin).dot(ray.direction);
      if (along > 50 && along < 2_000) distance = along;
    }
    out.copy(ray.origin).addScaledVector(ray.direction, distance);
  }

  private firePlayerGuns(): void {
    const res = this.gun.fire(this.player, this.playerArt.muzzles, this.aimPoint, this.projectiles, PLAYER_ID);
    if (res.fired) {
      this.sfx(this.state.ship.gun === 'pulse-mk2' ? 'laser-mk2' : 'laser', 0.55);
      if (this.player.cruise !== 'off') {
        this.player.requestCruise(false);
        this.callbacks.onMessage('Cruise disengaged: weapons fired', 'info');
      }
    }
  }

  private updateMissileLock(dt: number): void {
    const t = this.selectedTarget;
    let lockable = false;
    if (t && t.hostile && this.alive) {
      const e = aimErrors(this.player, t.position);
      lockable = e.distance < MISSILE_LOCK_RANGE && e.angle < MISSILE_LOCK_CONE;
    }
    const before = this.missileLockTime;
    this.missileLockTime = lockable ? this.missileLockTime + dt : 0;
    if (before < 0.8 && this.missileLockTime >= 0.8) this.sfx('missile-lock', 0.6);
  }

  // ---------------------------------------------------------------- projectiles, missiles, loot

  private updateProjectiles(dt: number): void {
    this.projectiles.update(dt, (p, from, to) => {
      if (p.ownerId === PLAYER_ID) {
        for (const n of this.npcs) {
          if (n.durability.hull <= 0) continue;
          if (segmentHitsSphere(from, to, n.body.position, n.art.radius)) {
            this.damageNpc(n, p.damage, to);
            return true;
          }
        }
        for (const d of this.drones) {
          if (d.target.alive && segmentHitsSphere(from, to, d.position, d.target.radius)) {
            this.hitDrone(d, p.damage, to);
            return true;
          }
        }
      } else if (this.alive && segmentHitsSphere(from, to, this.player.position, this.playerArt.radius)) {
        this.damagePlayer(p.damage, to);
        return true;
      }
      for (const d of this.system.docks) {
        if (segmentHitsSphere(from, to, d.def.position, d.radius * 0.7)) return true;
      }
      return false;
    });
  }

  private updateMissiles(dt: number): void {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i]!;
      if (m.target) m.target.alive = this.npcs.some((n) => n.id === m.target!.id && n.durability.hull > 0);
      const result = updateMissile(m, dt, MISSILE.speed, MISSILE.turnRate);
      if (!result) continue;
      if (result === 'hit' && m.target) {
        const npc = this.npcs.find((n) => n.id === m.target!.id);
        if (npc) this.damageNpc(npc, m.damage, m.position);
      }
      this.spawnEffect(createExplosion(m.position.clone(), result === 'hit' ? 5 : 3, this.ctx));
      this.sfx('explosion-small', 0.6);
      this.system.scene.remove(m.art.object);
      m.art.dispose();
      this.missiles.splice(i, 1);
    }
  }

  private updateLoot(dt: number): void {
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i]!;
      l.life -= dt;
      const toPlayer = this.tmp.copy(this.player.position).sub(l.position);
      const d = toPlayer.length();
      if (this.alive && d < 350) {
        // Tractor beam pulls nearby loot in.
        l.velocity.lerp(toPlayer.normalize().multiplyScalar(Math.min(160, 40 + (350 - d))), 1 - Math.exp(-3 * dt));
      } else {
        l.velocity.multiplyScalar(Math.exp(-0.3 * dt));
      }
      l.position.addScaledVector(l.velocity, dt);
      l.art.object.position.copy(l.position);
      if (this.alive && d < 30) {
        this.callbacks.onLoot(l.value);
        this.sfx('pickup');
        this.removeLoot(i);
      } else if (l.life <= 0) {
        this.removeLoot(i);
      }
    }
  }

  private removeLoot(i: number): void {
    const l = this.loot[i]!;
    l.target.alive = false;
    if (this.selectedId === l.target.id) this.selectedId = null;
    this.system.scene.remove(l.art.object);
    l.art.dispose();
    this.loot.splice(i, 1);
  }

  private spawnLoot(position: THREE.Vector3, value: number): void {
    const art = createCargoPod(this.ctx);
    const pos = position.clone();
    art.object.position.copy(pos);
    this.system.scene.add(art.object);
    const id = `loot:${Math.floor(this.time * 1000)}`;
    this.loot.push({
      art,
      position: pos,
      velocity: new THREE.Vector3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(20),
      value,
      life: 240,
      target: {
        id,
        name: 'Salvage pod',
        kind: 'loot',
        position: pos,
        radius: 4,
        subtitle: 'Salvaged components · fly close to collect',
        dataClass: 'fictional',
        alive: true,
        cycle: true,
      },
    });
  }

  private spawnEffect(e: TransientEffect): void {
    this.system.scene.add(e.object);
    this.effects.push(e);
  }

  // ---------------------------------------------------------------- damage

  private damagePlayer(amount: number, at: THREE.Vector3): void {
    if (!this.alive) return;
    const r = applyDamage(this.playerDurability, amount);
    const shieldHit = r.absorbedByShield > 0;
    this.playerArt.flashShield(shieldHit ? 0.8 : 0.2);
    this.spawnEffect(createImpactSpark(at.clone(), shieldHit ? '#7fd8ff' : '#ffb070', this.ctx));
    this.sfx(shieldHit ? 'player-hit-shield' : 'player-hit-hull', 0.8);
    this.chase.addShake(shieldHit ? 0.25 : 0.6);
    if (r.shieldBroke) {
      this.sfx('shield-down');
      this.callbacks.onMessage('Shields down!', 'bad');
    }
    if (this.player.cruise !== 'off') this.player.requestCruise(false);
    if (r.destroyed) this.destroyPlayer();
  }

  private destroyPlayer(): void {
    this.alive = false;
    this.autopilot = { mode: 'none' };
    this.playerArt.object.visible = false;
    this.spawnEffect(createExplosion(this.player.position.clone(), 10, this.ctx));
    this.sfx('explosion-large');
    this.chase.addShake(1.2);
    this.player.velocity.multiplyScalar(0.2);
    this.deathTimer = 0;
  }

  private damageNpc(n: NpcShip, amount: number, at: THREE.Vector3): void {
    const r = applyDamage(n.durability, amount);
    const shieldHit = r.absorbedByShield > 0;
    n.art.flashShield(shieldHit ? 0.8 : 0.2);
    this.spawnEffect(createImpactSpark(at.clone(), shieldHit ? '#7fd8ff' : '#ffb070', this.ctx));
    this.sfx(shieldHit ? 'hit-shield' : 'hit-hull', 0.55);
    if (r.destroyed) this.destroyNpc(n);
  }

  private destroyNpc(n: NpcShip): void {
    n.target.alive = false;
    const cached = this.missileTargetCache.get(n.id);
    if (cached) cached.alive = false;
    this.spawnEffect(createExplosion(n.body.position.clone(), 8, this.ctx));
    this.sfx('explosion-large', 0.8);
    this.spawnLoot(n.body.position, 120);
    this.removeNpc(n);
    if (this.activeEncounter && this.activeEncounter.npcId === n.id) {
      const def = this.activeEncounter.def;
      this.activeEncounter = null;
      this.callbacks.onEncounterEnd(def, 'destroyed');
    }
  }

  private removeNpc(n: NpcShip): void {
    const i = this.npcs.indexOf(n);
    if (i >= 0) this.npcs.splice(i, 1);
    if (this.selectedId === n.target.id) this.selectedId = null;
    n.target.alive = false;
    this.system.scene.remove(n.art.object);
    n.art.dispose();
  }

  // ---------------------------------------------------------------- collisions

  private collide(body: ShipBody, durability: Durability, isPlayer: boolean): void {
    if (isPlayer && (this.autopilot.mode === 'dock' || this.autopilot.mode === 'undock' || this.autopilot.mode === 'lane')) return;
    const r = body.params.radius;
    const bump = (center: THREE.Vector3, radius: number, hard: boolean) => {
      const n = this.tmp.copy(body.position).sub(center);
      const dist = n.length();
      const min = radius + r;
      if (dist >= min || dist === 0) return;
      n.divideScalar(dist);
      body.position.copy(center).addScaledVector(n, min);
      const into = body.velocity.dot(n);
      if (into < 0) {
        body.velocity.addScaledVector(n, -into * 1.35);
        const impact = -into;
        if (impact > 45 && hard) {
          const dmg = (impact - 45) * 0.35;
          if (isPlayer) {
            this.damagePlayer(dmg, body.position);
            this.callbacks.onMessage('Collision!', 'bad');
          } else {
            applyDamage(durability, dmg);
          }
        }
      }
    };
    for (const d of this.system.docks) bump(d.def.position, d.radius * 0.72, true);
    for (const p of this.system.planets) bump(p.def.position, p.def.radius * 1.01, true);
    for (const s of this.system.stars) bump(s.def.position, s.def.radius * 1.05, true);
    const hits = this.system.asteroidsNear(body.position, 260, this.asteroidHits);
    for (let i = 0; i < hits; i++) {
      const a = this.asteroidHits[i]!;
      bump(a.position, a.radius, true);
    }
    if (isPlayer) for (const n of this.npcs) bump(n.body.position, n.art.radius * 0.6, false);
  }

  // ---------------------------------------------------------------- encounters and scanning

  private updateEncounters(dt: number): void {
    const enc = this.activeEncounter;
    if (enc) {
      const npc = this.npcs.find((n) => n.id === enc.npcId);
      if (!npc) {
        this.activeEncounter = null;
        return;
      }
      const tuning = {
        accuracy: DIFFICULTY[this.settings.difficulty].enemyAccuracy,
        projectileSpeed: npc.gun.profile.projectileSpeed,
        gunRange: npc.gun.profile.range,
      };
      npc.gun.tick(dt);
      const out = npc.brain.update(dt, npc.body, npc.durability, this.player, tuning, npc.controls);
      if (out.fire && this.alive && !enc.bypassed && withinArc(npc.body, out.aimPoint)) {
        const fired = npc.gun.fire(npc.body, npc.art.muzzles, out.aimPoint, this.projectiles, npc.id, DIFFICULTY[this.settings.difficulty].enemyDamage);
        if (fired.fired) {
          this.sfx('laser-enemy', 0.35);
          this.npcShots.set(npc.id, (this.npcShots.get(npc.id) ?? 0) + 1);
        }
      }
      const dist = npc.body.position.distanceTo(this.player.position);
      if (npc.brain.state === 'escaped' && dist > (enc.bypassed ? 1_800 : 3_000)) {
        this.removeNpc(npc);
        this.activeEncounter = null;
        this.callbacks.onEncounterEnd(enc.def, enc.bypassed ? 'bypassed' : 'escaped');
        return;
      }
      // The player outran the raider: it loses interest.
      enc.farTime = dist > 5_500 ? enc.farTime + dt : 0;
      if (enc.farTime > 4) {
        this.removeNpc(npc);
        this.activeEncounter = null;
        this.callbacks.onEncounterEnd(enc.def, 'bypassed');
      }
      return;
    }
    if (!this.alive || this.busy || this.state.location.dockedAt) return;
    for (const def of this.system.def.encounters) {
      if (this.triggered.has(def.id)) continue;
      if (!this.encounterEligible(def)) continue;
      if (this.player.position.distanceTo(def.center) > def.radius) continue;
      this.triggered.add(def.id);
      this.spawnRaider(def);
    }
  }

  private encounterEligible(def: EncounterDef): boolean {
    if (def.id === 'mars-raider') {
      return this.state.jobs.lifeline?.status === 'active' && this.state.pirateOutcome === 'none';
    }
    return false;
  }

  private spawnRaider(def: EncounterDef): void {
    const diff = DIFFICULTY[this.settings.difficulty];
    const body = new ShipBody(RAIDER_SHIP);
    const fwd = this.player.forward(new THREE.Vector3());
    const up = this.player.up(new THREE.Vector3());
    const right = this.player.right(new THREE.Vector3());
    body.position
      .copy(this.player.position)
      .addScaledVector(fwd, def.spawnAhead)
      .addScaledVector(up, 120 + this.rand() * 160)
      .addScaledVector(right, (this.rand() - 0.5) * 500);
    body.lookAlong(this.tmp.copy(this.player.position).sub(body.position).normalize());
    body.velocity.copy(body.forward(this.tmp)).multiplyScalar(60);
    const art = createPirateShip(this.ctx);
    this.system.scene.add(art.object);
    const id = `raider-${def.id}`;
    const faction: FactionId = 'hollow-wake';
    const hullMax = 140 * diff.enemyHealth;
    const npc: NpcShip = {
      id,
      name: 'Hollow Wake raider',
      faction,
      body,
      art,
      durability: { hull: hullMax, hullMax, shield: 60, shieldMax: 60, shieldRegen: 6, shieldDelay: 3, sinceHit: 99 },
      gun: new Gun({ damage: 4, shotsPerSecond: 3.2, projectileSpeed: 760, range: 900, energyPerShot: 3, kind: 'enemy-pulse' }),
      brain: new PirateBrain(this.rand),
      controls: neutralControls(),
      target: {
        id: `ship:${id}`,
        name: 'Hollow Wake raider',
        kind: 'ship',
        position: body.position,
        velocity: body.velocity,
        radius: art.radius,
        subtitle: `${FACTIONS[faction].name} · hostile`,
        dataClass: 'fictional',
        faction,
        hostile: true,
        alive: true,
        cycle: true,
      },
      encounter: def,
    };
    this.npcs.push(npc);
    this.activeEncounter = { def, npcId: id, farTime: 0, bypassed: false };
    this.player.requestCruise(false);
    this.selectedId = npc.target.id;
    if (this.autopilot.mode === 'goto') this.autopilot = { mode: 'none' };
    this.sfx('alert');
    this.callbacks.onEncounterStart(def);
  }

  private autoScan(): void {
    const pos = this.player.position;
    for (const p of this.system.planets) {
      const id = p.def.id;
      if (!EXOPLANET_IDS.has(id) || this.state.discoveredBodies.includes(id)) continue;
      if (pos.distanceTo(p.def.position) < (p.def.scanRange ?? DEFAULT_SCAN_RANGE)) {
        this.sfx('scan');
        this.callbacks.onDiscovery(id);
      }
    }
    for (const z of this.system.def.scanZones) {
      if (this.state.discoveredBodies.includes(z.bodyId)) continue;
      if (pos.distanceTo(z.center) < z.range) this.callbacks.onDiscovery(z.bodyId);
    }
  }

  // ---------------------------------------------------------------- selection and HUD

  private pickAt(x: number, y: number): void {
    let best: { id: string; d: number } | null = null;
    for (const t of this.allTargets()) {
      if (t.kind === 'lane' && t.position.distanceTo(this.player.position) > 40_000) continue;
      this.tmp.copy(t.position).project(this.camera);
      if (this.tmp.z > 1) continue;
      const sx = ((this.tmp.x + 1) / 2) * this.viewport.width;
      const sy = ((1 - this.tmp.y) / 2) * this.viewport.height;
      const d = Math.hypot(sx - x, sy - y) - (t.kind === 'ship' ? 12 : 0);
      if (d < 44 && (!best || d < best.d)) best = { id: t.id, d };
    }
    if (best) this.selectTarget(best.id);
  }

  private project(p: THREE.Vector3): { x: number; y: number; onScreen: boolean; angle: number } {
    const w = this.viewport.width;
    const h = this.viewport.height;
    const v = this.tmp.copy(p).applyMatrix4(this.camera.matrixWorldInverse);
    const behind = v.z > 0;
    this.tmp.copy(p).project(this.camera);
    let nx = this.tmp.x;
    let ny = this.tmp.y;
    if (behind) {
      nx = -nx;
      ny = -ny;
    }
    const onScreen = !behind && Math.abs(nx) <= 1 && Math.abs(ny) <= 1;
    let x = ((nx + 1) / 2) * w;
    let y = ((1 - ny) / 2) * h;
    const cx = w / 2;
    const cy = h / 2;
    const angle = Math.atan2(y - cy, x - cx);
    if (!onScreen) {
      // Clamp to an inset ellipse so edge arrows stay visible and clear of the corners.
      const mx = w / 2 - 34;
      const my = h / 2 - 34;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const s = 1 / Math.max(Math.abs(dx) / mx, Math.abs(dy) / my);
      x = cx + dx * s;
      y = cy + dy * s;
    }
    return { x, y, onScreen, angle };
  }

  private buildHud(): void {
    const hud = this.hud;
    const p = this.player;
    const d = this.playerDurability;
    hud.speed = p.speed;
    hud.throttle = this.throttle;
    hud.cruise = p.cruise;
    hud.cruiseCharge = p.cruise === 'charging' ? Math.min(1, p.cruiseCharge / p.params.cruiseChargeTime) : p.cruise === 'on' ? 1 : 0;
    hud.boosting = p.boosting;
    hud.drift = this.drift;
    hud.energy = p.energy / p.params.energyMax;
    hud.shield = d.shieldMax > 0 ? d.shield / d.shieldMax : 0;
    hud.hull = d.hull / d.hullMax;
    hud.shieldValue = d.shield;
    hud.hullValue = d.hull;
    hud.missiles = this.state.ship.missiles;
    hud.repairKits = this.state.ship.repairKits;
    hud.inLane = this.autopilot.mode === 'lane' && this.autopilot.phase === 'travel';
    hud.encounterActive = this.activeEncounter !== null && !this.activeEncounter.bypassed;
    const ap = this.autopilot;
    hud.autopilotMode = ap.mode;
    hud.weapon = GUNS[this.state.ship.gun].name;
    hud.autopilot =
      ap.mode === 'goto'
        ? ap.label
        : ap.mode === 'lane'
          ? `Trade lane: ${ap.lane.def.name}`
          : ap.mode === 'dock'
            ? `Docking: ${ap.site.name}`
            : ap.mode === 'undock'
              ? 'Launching…'
              : null;

    // Reticle.
    const w = this.viewport.width;
    const h = this.viewport.height;
    hud.reticle.x = ((this.aim.x + 1) / 2) * w;
    hud.reticle.y = ((1 - this.aim.y) / 2) * h;
    hud.reticle.inArc = withinArc(p, this.aimPoint);
    hud.reticle.assisted = this.aimAssisted;
    hud.missileLock = this.missileLockTime >= 0.8 ? 'locked' : this.missileLockTime > 0 ? 'locking' : 'none';

    // Target panel.
    const sel = this.selectedTarget;
    if (sel) {
      const npc = this.npcs.find((n) => n.target.id === sel.id);
      let lead: { x: number; y: number } | null = null;
      if (sel.velocity && (sel.hostile || sel.kind === 'drone')) {
        leadPoint(p.position, p.velocity, sel.position, sel.velocity, this.gun.profile.projectileSpeed, this.tmp2);
        const pr = this.project(this.tmp2);
        if (pr.onScreen) lead = { x: pr.x, y: pr.y };
      }
      const dist = sel.position.distanceTo(p.position);
      hud.target = {
        id: sel.id,
        name: sel.name,
        kind: sel.kind,
        subtitle: sel.subtitle,
        distance: Math.max(0, dist - (sel.kind === 'planet' || sel.kind === 'star' ? sel.radius : 0)),
        hostile: !!sel.hostile,
        ...(sel.faction ? { faction: sel.faction } : {}),
        dataClass: sel.dataClass,
        ...(npc ? { shield: npc.durability.shield / npc.durability.shieldMax, hull: npc.durability.hull / npc.durability.hullMax } : {}),
        lead,
        inGunRange: dist < this.gun.profile.range,
      };
    } else {
      hud.target = null;
    }

    // Markers.
    const markers: HudMarker[] = [];
    const objId = this.objective.locationId
      ? `station:${this.objective.locationId}`
      : this.objective.bodyId
        ? `planet:${this.objective.bodyId}`
        : null;
    for (const t of this.allTargets()) {
      const dist = t.position.distanceTo(p.position);
      const selected = t.id === this.selectedId;
      const objective = t.id === objId;
      const important = selected || objective || t.hostile;
      if (!important) {
        if (t.kind === 'lane' && dist > 25_000) continue;
        if (t.kind === 'loot' && dist > 3_000) continue;
        if (t.kind === 'drone' && dist > 4_000) continue;
        if (t.kind === 'beacon' && dist > 20_000) continue;
      }
      const pr = this.project(t.position);
      if (!pr.onScreen && !important) continue;
      markers.push({
        id: t.id,
        name: t.name,
        kind: t.kind,
        x: pr.x,
        y: pr.y,
        onScreen: pr.onScreen,
        edgeAngle: pr.angle,
        distance: Math.max(0, dist - (t.kind === 'planet' || t.kind === 'star' ? t.radius : 0)),
        hostile: !!t.hostile,
        ...(t.faction ? { faction: t.faction } : {}),
        selected,
        objective,
        dataClass: t.dataClass,
      });
    }
    hud.markers = markers;
    hud.context = this.contextAction();
    const near = this.nearestDock();
    hud.nearestDock = near ? { name: near.site.name, distance: Math.max(0, near.distance - near.site.radius) } : null;

    const warnings: string[] = [];
    if (d.hull / d.hullMax < 0.3 && this.alive) warnings.push('Hull critical');
    if (this.drift) warnings.push('Engines off (drift)');
    if (hud.encounterActive) warnings.push('Hostile contact');
    hud.warnings = warnings;
  }

  /** Debug snapshot of NPC state for automated tests. */
  debugNpcs(): { id: string; state: string; hull: number; shield: number; energy: number; distance: number; shotsFired: number }[] {
    return this.npcs.map((n) => ({
      id: n.id,
      state: n.brain.state,
      hull: n.durability.hull,
      shield: n.durability.shield,
      energy: n.body.energy,
      distance: n.body.position.distanceTo(this.player.position),
      shotsFired: this.npcShots.get(n.id) ?? 0,
    }));
  }

  // ---------------------------------------------------------------- visuals

  private syncPlayerArt(dt: number): void {
    const art = this.playerArt;
    const p = this.player;
    art.object.position.copy(p.position);
    // Cosmetic bank into turns (physics orientation stays level).
    const bank = THREE.MathUtils.clamp(-p.angularVelocity.y * 0.45, -0.6, 0.6);
    this.tmpQ.setFromAxisAngle(Z_AXIS, bank);
    art.object.quaternion.copy(p.quaternion).multiply(this.tmpQ);
    art.setThrottle(this.drift ? 0 : Math.max(0.08, Math.abs(p.throttle)));
    art.setBoost(p.boosting);
    art.setCruise(p.cruise === 'on' || (this.autopilot.mode === 'lane' && this.autopilot.phase === 'travel'));
    art.update?.(dt, this.time, this.camera);
  }

  private syncNpcArt(n: NpcShip): void {
    n.art.object.position.copy(n.body.position);
    const bank = THREE.MathUtils.clamp(-n.body.angularVelocity.y * 0.5, -0.7, 0.7);
    this.tmpQ.setFromAxisAngle(Z_AXIS, bank);
    n.art.object.quaternion.copy(n.body.quaternion).multiply(this.tmpQ);
    n.art.setThrottle(Math.max(0.2, n.controls.throttle));
    n.art.setBoost(n.body.boosting);
    n.art.update?.(0, this.time, this.camera);
  }

  private sfx(id: SfxId, volume = 1): void {
    this.audio.play(id, { volume });
  }

  dispose(): void {
    this.audio.setEngine(null);
    this.audio.setCombatIntensity(0);
    for (const n of [...this.npcs]) this.removeNpc(n);
    for (const m of this.missiles) {
      this.system.scene.remove(m.art.object);
      m.art.dispose();
    }
    this.missiles.length = 0;
    while (this.loot.length) this.removeLoot(this.loot.length - 1);
    for (const d of this.drones) {
      this.system.scene.remove(d.art.object);
      d.art.dispose();
    }
    this.drones.length = 0;
    for (const e of this.effects) {
      this.system.scene.remove(e.object);
      e.dispose();
    }
    this.effects.length = 0;
    this.camera.remove(this.streaks.object);
    this.streaks.dispose();
    this.system.scene.remove(this.projectileRenderer.object);
    this.projectileRenderer.dispose();
    this.system.scene.remove(this.playerArt.object);
    this.playerArt.dispose();
    this.projectiles.clear();
  }
}
