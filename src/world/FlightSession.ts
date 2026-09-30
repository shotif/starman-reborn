import * as THREE from 'three';
import type { AudioEngine } from '../audio/AudioEngine.ts';
import type { EngineSoundState, SfxId } from '../audio/types.ts';
import type { AimAssist, Settings } from '../app/settings.ts';
import { DIFFICULTY } from '../app/settings.ts';
import type { CommodityId, GameState } from '../app/state.ts';
import { applyDamage, regenerate, type Durability } from '../combat/damage.ts';
import { leadPoint } from '../combat/lead.ts';
import { MISSILE_LOCK_CONE, MISSILE_LOCK_RANGE, updateMissile, type Missile, type MissileTarget } from '../combat/missiles.ts';
import { PirateBrain } from '../combat/PirateAI.ts';
import { PatrolBrain, TraderBrain } from '../combat/TrafficAI.ts';
import { Gun, ProjectileSystem, segmentHitsSphere, withinArc } from '../combat/weapons.ts';
import { EXOPLANETS } from '../data/systems.ts';
import type { FactionId } from '../data/types.ts';
import type { DamageType } from '../content/types.ts';
import type { ShipPerformance } from '../content/loadout.ts';
import { FACTIONS } from '../economy/factions.ts';
import { REPAIR_KIT } from '../economy/equipment.ts';
import { shipModel } from '../content/catalog.ts';
import { CONTRACTS } from '../content/contracts/rules.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { hashString } from '../content/random.ts';
import { activeLauncher, fittedGuns, gunSummary, performanceOf, roundsLabel } from '../economy/loadout.ts';
import { aimErrors, avoidObstacles, flyTo, steerToward, type Obstacle } from '../flight/autopilot.ts';
import { ChaseCamera } from '../flight/ChaseCamera.ts';
import type { FlightAction, FlightInput } from '../flight/input/types.ts';
import { lookRotation, neutralControls, RAIDER_SHIP, ShipBody, stepBounded, type ShipControls } from '../flight/ShipBody.ts';
import { emptyHudModel, type HudContextAction, type HudMarker, type HudModel } from '../ui/hud/hudModel.ts';
import type { AsteroidHit } from './art/asteroids.ts';
import {
  createCargoPod,
  createExplosion,
  createImpactSpark,
  createMissileArt,
  createProjectileRenderer,
  createSpeedStreaks,
  type ProjectileKind,
  type ProjectileRenderer,
  type SpeedStreaksArt,
  type TransientEffect,
} from './art/effects.ts';
import { clearShipArtCache, createCatalogShipArt } from './art/shipgen/index.ts';
import type { ShipArt } from './art/ships.ts';
import { bountyFor, FLEETS, RAIDERS, TRAFFIC, type TrafficPlan } from './traffic/plan.ts';
import type { StationOwner } from '../content/world/types.ts';
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
  /** Loot collected: credits, and cargo when the pod held some (an ace's hold). */
  onLoot(credits: number, cargo?: { commodity: CommodityId; qty: number }): void;
  /** The player destroyed a raider from a pack (the opening raid reports through onEncounterEnd). */
  onBounty(credits: number, name: string): void;
  /** A raider of a bounty contract's pack was destroyed. */
  onContractKill(jobId: string): void;
  /** A trader docked at `to`, coming from the station `from` (null: through the jump beacon). */
  onTraderArrived?(from: string | null, to: string, shipId: string): void;
  /** The ship of an escort contract docked at its destination. */
  onEscortArrived?(jobId: string): void;
  /** The ship of an escort contract was destroyed. */
  onEscortLost?(jobId: string): void;
  /** The item of a recovery contract was tractored aboard. */
  onRecovered?(jobId: string): void;
  onMessage(text: string, tone: 'good' | 'bad' | 'info'): void;
}

export type SpawnSpec =
  | { kind: 'undock'; locationId: string }
  | { kind: 'arrival' }
  | { kind: 'restore'; position: THREE.Vector3; quaternion: THREE.Quaternion };

type NpcRole = 'raider' | 'trader' | 'patrol';

interface NpcShip {
  id: string;
  name: string;
  faction: FactionId | 'independent';
  role: NpcRole;
  /** Raiders fight everyone else; lawful ships (and the player) fight raiders. */
  side: 'lawful' | 'raider';
  body: ShipBody;
  art: ShipArt;
  durability: Durability;
  guns: Gun[];
  /** Combat behaviour (raiders, and patrols when they engage). */
  brain: PirateBrain;
  trader?: TraderBrain;
  /** Traders: the station it launched from (null: it came through the jump beacon). */
  origin?: string | null;
  patrol?: { brain: PatrolBrain; offset: THREE.Vector3 };
  controls: ShipControls;
  target: Target;
  /** The scripted encounter this raider belongs to (the opening raid). */
  encounter?: EncounterDef;
  /** Raider pack number. */
  pack?: number;
  /** Bounty contract this raider belongs to (its pack guards a marked spot and is never replaced). */
  contract?: string;
  /** Guards an ace or a wreck: holds its spot until it has someone to fight, and never leaves. */
  guard?: boolean;
  /** A named ace: tougher, deadlier, and it drops what it carried. */
  ace?: boolean;
  /** Ambushers go for this ship (the one the player escorts) rather than the player. */
  prey?: NpcShip;
  /** The ship of an escort contract: where it set off and when the ambush comes. */
  escort?: { jobId: string; start: THREE.Vector3; ambushAt: number; ambushed: boolean; level: 1 | 2 | 3; waiting?: boolean };
  /** Who it is fighting. */
  foe: NpcShip | 'player' | null;
  /** Bounty paid when the player destroys it. */
  bounty: number;
  /** Session time the player last hit it. */
  playerHitAt: number;
  /** Seconds a raider has had nothing to hunt. */
  idle: number;
  maydaySent: boolean;
}

/** What the traffic system needs to know about the current system (Game builds it from the world). */
export interface TrafficSetup {
  plan: TrafficPlan;
  owner: StationOwner | null;
  /** Packs to spawn for the player's bounty contracts in this system: raiders left, threat level and where they lurk (or an ace). */
  contractPacks?: readonly { jobId: string; locationId: string; count: number; level: 1 | 2 | 3; ace?: { name: string; model: string } }[];
  /** Ships the player escorts in this system: they set off alongside the player. */
  escorts?: readonly { jobId: string; from: string; to: string; model: string; name: string; level: 1 | 2 | 3 }[];
  /** Wrecks the player's recovery contracts send them to in this system. */
  wrecks?: readonly { jobId: string; locationId: string; item: string; guard: 1 | 2 | 3 | null }[];
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
  /** Cargo in the pod (an ace's hold). */
  cargo?: { commodity: CommodityId; qty: number };
  /** The item of a recovery contract (its job id). */
  recover?: string;
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
/** Clearance the autopilot keeps from planets, stars and stations it flies around. */
const AVOID_MARGIN = 700;
const DEFAULT_SCAN_RANGE = 9_000;
const HOSTILE_RADIUS = 3_500;
/** An escorted ship holds position while the player is further away than this. */
const ESCORT_WAIT = 2_500;
const CONVERGENCE = 700;
const EXOPLANET_IDS = new Set(EXOPLANETS.planets.map((p) => p.id));
/** Hollow Wake raiders fly Wake Salvage light fighters. */
const RAIDER_MODEL_ID = 'ship.light-fighter.1.wake';
/** Nose-to-tail length the chase camera offset was tuned for. */
const CHASE_REFERENCE_LENGTH = 14;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** Bolt look for a player gun: pulse cannons brighten from class 3 up. */
function boltKind(type: DamageType, tier: number): ProjectileKind {
  if (type === 'kinetic') return 'player-kinetic';
  if (type === 'plasma') return 'player-plasma';
  if (type === 'ion') return 'player-ion';
  return tier >= 3 ? 'player-pulse-mk2' : 'player-pulse';
}

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
  /** The fitted ship: flight, hold, scanner and tractor stats. */
  private readonly perf: ShipPerformance;
  /** One gun per fitted gun mount, each firing from its own muzzle. */
  private readonly guns: Gun[] = [];
  private readonly gunMuzzles: THREE.Vector3[][] = [];
  /** Bolt speed used for lead indicators (the first gun's), and the longest gun range. */
  private readonly leadSpeed: number;
  private readonly gunRange: number;
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
  private objective: { locationId: string | null; bodyId: string | null; targetId: string | null } = { locationId: null, bodyId: null, targetId: null };
  /** Hulls of wrecks (recovery contracts), scenery that drifts and turns. */
  private readonly wreckHulls: { art: ShipArt; spin: THREE.Vector3 }[] = [];
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
  private readonly wayPoint = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly asteroidHits: AsteroidHit[] = [];
  private readonly missileTargetCache = new Map<string, MissileTarget>();
  private readonly npcShots = new Map<string, number>();
  private readonly traffic: TrafficSetup | null;
  private trafficTimers = { trader: 3, pack: 0, patrolsLaunched: false, populated: false, contractsSpawned: false, serial: 0 };

  constructor(opts: {
    system: SystemScene;
    camera: THREE.PerspectiveCamera;
    state: GameState;
    settings: Settings;
    ctx: ArtContext;
    audio: AudioEngine;
    callbacks: FlightCallbacks;
    traffic?: TrafficSetup | null;
  }) {
    this.system = opts.system;
    this.camera = opts.camera;
    this.state = opts.state;
    this.settings = opts.settings;
    this.ctx = opts.ctx;
    this.audio = opts.audio;
    this.callbacks = opts.callbacks;
    this.traffic = opts.traffic ?? null;
    this.trafficTimers.pack = this.traffic?.plan.packs?.firstDelay ?? 0;
    this.rand = seededRandom((opts.state.seed ^ (opts.state.stats.jumps * 7919) ^ Math.floor(opts.state.clock)) >>> 0);
    this.chase = new ChaseCamera(opts.camera);
    this.applyCameraSettings();

    this.perf = performanceOf(opts.state.ship);
    this.player = new ShipBody(this.perf.flight);
    const art = createCatalogShipArt(shipModel(opts.state.ship.model), opts.ctx);
    this.playerArt = art;
    this.system.scene.add(art.object);
    // Frame bigger hulls from further back.
    this.chase.offset.multiplyScalar(THREE.MathUtils.clamp(art.length / CHASE_REFERENCE_LENGTH, 0.85, 1.9));
    const shield = this.perf.shield;
    this.playerDurability = {
      hull: Math.min(opts.state.ship.hull, this.perf.hullMax),
      hullMax: this.perf.hullMax,
      shield: Math.min(opts.state.ship.shield, shield?.capacity ?? 0),
      shieldMax: shield?.capacity ?? 0,
      shieldRegen: shield?.regenPerSecond ?? 0,
      shieldDelay: shield?.regenDelay ?? 3,
      shieldType: shield?.shieldType ?? 'balanced',
      sinceHit: 99,
    };
    const fitted = fittedGuns(opts.state.ship);
    const muzzles = this.playerArt.muzzles;
    fitted.forEach((g, i) => {
      const gun = new Gun({
        damage: g.stats.damage,
        shotsPerSecond: g.stats.shotsPerSecond,
        projectileSpeed: g.stats.projectileSpeed,
        range: g.stats.range,
        energyPerShot: g.stats.energyPerShot,
        kind: boltKind(g.stats.damageType, g.item.tier),
        damageType: g.stats.damageType,
      });
      // Spread the first shots so the mounts fire in turn.
      gun.stagger(i / (fitted.length * g.stats.shotsPerSecond));
      this.guns.push(gun);
      this.gunMuzzles.push(muzzles.length ? [muzzles[i % muzzles.length]!] : []);
    });
    this.leadSpeed = fitted[0]?.stats.projectileSpeed ?? 800;
    this.gunRange = fitted.reduce((max, g) => Math.max(max, g.stats.range), 0);
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

  setObjective(locationId: string | null, bodyId: string | null, targetId: string | null = null): void {
    const prevId = this.objectiveTargetId();
    this.objective = { locationId, bodyId, targetId };
    const nextId = this.objectiveTargetId();
    // Keep guiding: if the player had the old objective selected, select the new one.
    if (prevId !== nextId && (this.selectedId === null || this.selectedId === prevId) && nextId && this.findTarget(nextId)) {
      this.selectedId = nextId;
    }
  }

  private objectiveTargetId(): string | null {
    if (this.objective.targetId && this.loot.some((l) => l.target.id === this.objective.targetId)) return this.objective.targetId;
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
    return this.npcs.some((n) => n.side === 'raider' && n.durability.hull > 0 && n.body.position.distanceTo(this.player.position) < radius && n.brain.state !== 'escaped');
  }

  get encounterActive(): boolean {
    return this.activeEncounter !== null || this.packEngaged();
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
    const dock = this.system.docks
      .filter((d) => d.dockable)
      .reduce((best, d) => (d.def.position.distanceTo(enc.def.center) < best.def.position.distanceTo(enc.def.center) ? d : best));
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
        this.cancelAutopilot('Autopilot off: free flight');
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
      if (!site.dockable) continue;
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
      if (site?.dockable && site.def.position.distanceTo(this.player.position) < DOCK_RANGE) return site;
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
    if (!this.alive) return null;
    const mode = this.autopilot.mode;
    // Docking or riding a lane: the action button offers to stop and fly yourself.
    if (mode === 'dock' || mode === 'lane') return { label: 'Stop', action: 'cancel-autopilot', icon: 'close' };
    if (this.busy) return null;
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
    const scanner = this.perf.scanRange;
    if (t.kind === 'planet') {
      const def = this.system.planets.find((p) => p.def.id === t.bodyId)?.def;
      return (def?.scanRange ?? DEFAULT_SCAN_RANGE) * scanner;
    }
    if (t.kind === 'star') return Math.max(20_000, t.radius * 6) * scanner;
    return DEFAULT_SCAN_RANGE * scanner;
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
    const launcher = activeLauncher(this.state.ship);
    if (!launcher) {
      this.callbacks.onMessage('No launcher fitted.', 'bad');
      return;
    }
    const rounds = roundsLabel(launcher.stats.kind).toLowerCase();
    if (launcher.ammo <= 0) {
      this.callbacks.onMessage(`No ${rounds} left.`, 'bad');
      return;
    }
    const guided = launcher.stats.turnRate > 0;
    const npc = t ? this.npcs.find((n) => n.target.id === t.id) : undefined;
    if (guided && (!t || !t.hostile || !npc || this.missileLockTime < launcher.stats.lockTime)) {
      this.callbacks.onMessage(`No lock for ${rounds}: target a hostile ahead of you.`, 'bad');
      this.sfx('ui-error');
      return;
    }
    this.state.ship.ammo[launcher.slot.id] = launcher.ammo - 1;
    const art = createMissileArt(this.ctx);
    this.system.scene.add(art.object);
    const dir = this.player.forward(new THREE.Vector3());
    const pos = this.player.position.clone().addScaledVector(this.player.up(this.tmp), -1.5).addScaledVector(dir, 6);
    // Rockets fly straight at the aim point; guided rounds leave along the nose and steer.
    if (!guided) dir.copy(this.aimPoint).sub(pos).normalize();
    this.missiles.push({
      art,
      position: pos,
      direction: dir,
      speed: Math.max(60, this.player.forwardSpeed),
      target: npc && t?.hostile ? this.missileTargetFor(npc) : null,
      ownerId: PLAYER_ID,
      damage: launcher.stats.damage,
      life: launcher.stats.lifetime,
      alive: true,
      maxSpeed: launcher.stats.speed,
      turnRate: launcher.stats.turnRate,
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
    for (const gun of this.guns) gun.tick(dt);
    this.updateProjectiles(dt);
    this.updateMissiles(dt);
    this.updateLoot(dt);
    this.updateDrones(dt);
    if (this.alive) this.collide(this.player, this.playerDurability, true);
    for (const n of this.npcs) this.collide(n.body, n.durability, false);
    regenerate(this.playerDurability, dt);
    for (const n of this.npcs) regenerate(n.durability, dt);
    this.updateEncounters(dt);
    this.updateTraffic(dt);
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
    this.audio.setCombatIntensity(this.activeEncounter || this.packEngaged() ? 1 : 0);
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

  /**
   * Hands control back to the pilot from any autopilot: go to, docking (approach or final glide),
   * trade lane (aligning or travelling) or the launch sequence.
   */
  private cancelAutopilot(message: string): void {
    const ap = this.autopilot;
    const p = this.player;
    if (ap.mode === 'none') return;
    if (ap.mode === 'undock') {
      // Still in the bay: finish clearing the station, then hand over at the exit point.
      p.position.copy(ap.to);
      p.velocity.copy(ap.site.approach).multiplyScalar(45);
    } else if (ap.mode === 'dock') {
      p.requestCruise(false);
      if (ap.phase === 'final') {
        // The glide was scripted: keep the pose, stop, and back off the berth under your control.
        p.velocity.set(0, 0, 0);
        p.angularVelocity.set(0, 0, 0);
      }
    } else if (ap.mode === 'lane' && ap.phase === 'travel') {
      this.system.setLaneActive(ap.lane.def.id, false);
      this.sfx('lane-exit');
      // Drop out of lane speed to cruise speed; the flight model settles from there.
      p.velocity.clampLength(0, p.params.cruiseSpeed);
    }
    this.autopilot = { mode: 'none' };
    this.callbacks.onMessage(message, 'info');
  }

  private updatePlayerControls(dt: number, input: FlightInput): void {
    const c = this.controls;
    // Taking over the controls always wins over any autopilot.
    if (input.manualOverride && this.autopilot.mode !== 'none') this.cancelAutopilot('Autopilot off: manual control');
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
      const way = avoidObstacles(this.player.position, entry, this.system.obstacles(null), AVOID_MARGIN, this.wayPoint);
      const st = flyTo(this.player, way.point, { arriveDistance: way.detour ? 0 : 60, allowCruise: true }, this.controls);
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
    // Stop short of stations and ships, but fly right up to loot so the tractor beam reaches it.
    const standoff = target.kind === 'station' ? target.radius + 450 : target.kind === 'loot' ? 40 : target.radius + 600;
    // Round any planet, star or station in the way; the target itself is where we stop.
    const way = avoidObstacles(this.player.position, target.position, this.system.obstacles(target.id), AVOID_MARGIN, this.wayPoint);
    const st = flyTo(this.player, way.point, { arriveDistance: way.detour ? 0 : standoff, allowCruise: true }, this.controls);
    this.player.requestCruise(st.wantsCruise);
    void dt;
    if (!way.detour && (st.arrived || st.distance < 80)) {
      const dockId = ap.dockAtEnd;
      this.autopilot = { mode: 'none' };
      this.throttle = 0;
      if (dockId) {
        const site = this.system.dock(dockId);
        if (site?.dockable) this.beginDock(site);
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
      leadPoint(this.player.position, this.player.velocity, t.position, t.velocity, this.leadSpeed, this.tmp);
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
    let fired: DamageType | null = null;
    for (let i = 0; i < this.guns.length; i++) {
      const gun = this.guns[i]!;
      if (gun.fire(this.player, this.gunMuzzles[i]!, this.aimPoint, this.projectiles, PLAYER_ID).fired) fired ??= gun.profile.damageType;
    }
    if (fired) {
      this.sfx(fired === 'kinetic' || fired === 'plasma' ? 'laser-mk2' : 'laser', 0.55);
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
    const need = this.lockTimeNeeded();
    if (need > 0 && before < need && this.missileLockTime >= need) this.sfx('missile-lock', 0.6);
  }

  /** Seconds on target the active launcher needs (0 = unguided or none). */
  private lockTimeNeeded(): number {
    const l = activeLauncher(this.state.ship);
    return l && l.stats.turnRate > 0 ? l.stats.lockTime : 0;
  }

  // ---------------------------------------------------------------- projectiles, missiles, loot

  private updateProjectiles(dt: number): void {
    this.projectiles.update(dt, (p, from, to) => {
      const byPlayer = p.ownerId === PLAYER_ID;
      const side = byPlayer ? 'lawful' : (this.npcs.find((n) => n.id === p.ownerId)?.side ?? 'raider');
      // Bolts hit ships of the other side only: no friendly fire among lawful ships or among raiders.
      for (const n of this.npcs) {
        if (n.durability.hull <= 0 || n.side === side) continue;
        if (segmentHitsSphere(from, to, n.body.position, n.art.radius)) {
          this.damageNpc(n, p.damage, to, p.damageType, byPlayer);
          return true;
        }
      }
      if (byPlayer) {
        for (const d of this.drones) {
          if (d.target.alive && segmentHitsSphere(from, to, d.position, d.target.radius)) {
            this.hitDrone(d, p.damage, to);
            return true;
          }
        }
      } else if (side === 'raider' && this.alive && segmentHitsSphere(from, to, this.player.position, this.playerArt.radius)) {
        this.damagePlayer(p.damage, to, p.damageType);
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
      let result = updateMissile(m, dt, m.maxSpeed, m.turnRate);
      // Unguided rounds hit whatever they fly into.
      let struck = m.target ? this.npcs.find((n) => n.id === m.target!.id) : undefined;
      if (!result && !m.target) {
        struck = this.npcs.find((n) => n.side === 'raider' && n.durability.hull > 0 && n.body.position.distanceTo(m.position) < n.art.radius + 5);
        if (struck) result = 'hit';
      }
      if (!result) continue;
      if (result === 'hit' && struck) this.damageNpc(struck, m.damage, m.position, undefined, true);
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
      const reach = Math.max(350, this.perf.tractorRange);
      if (this.alive && d < reach) {
        // Tractor beam pulls nearby loot in (fitted beams reach further).
        l.velocity.lerp(toPlayer.normalize().multiplyScalar(Math.min(160, 40 + (reach - d))), 1 - Math.exp(-3 * dt));
      } else {
        l.velocity.multiplyScalar(Math.exp(-0.3 * dt));
      }
      l.position.addScaledVector(l.velocity, dt);
      l.art.object.position.copy(l.position);
      if (this.alive && d < 30) {
        if (l.recover) this.callbacks.onRecovered?.(l.recover);
        else this.callbacks.onLoot(l.value, l.cargo);
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

  private spawnLoot(position: THREE.Vector3, value: number, extra: { cargo?: { commodity: CommodityId; qty: number }; recover?: { jobId: string; item: string } } = {}): void {
    const art = createCargoPod(this.ctx);
    const pos = position.clone();
    art.object.position.copy(pos);
    this.system.scene.add(art.object);
    const id = extra.recover ? `wreck:${extra.recover.jobId}` : `loot:${Math.floor(this.time * 1000)}-${this.loot.length}`;
    const cargo = extra.cargo;
    this.loot.push({
      art,
      position: pos,
      velocity: extra.recover ? new THREE.Vector3() : new THREE.Vector3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(20),
      value,
      ...(cargo ? { cargo } : {}),
      ...(extra.recover ? { recover: extra.recover.jobId } : {}),
      life: extra.recover ? Infinity : 240,
      target: {
        id,
        name: extra.recover ? `${extra.recover.item.charAt(0).toUpperCase()}${extra.recover.item.slice(1)}` : cargo ? 'Cargo pod' : 'Salvage pod',
        kind: 'loot',
        position: pos,
        radius: 4,
        subtitle: extra.recover ? 'In the wreckage · fly close to tractor it in' : cargo ? `${cargo.qty} × ${COMMODITIES[cargo.commodity].name.toLowerCase()} · fly close to collect` : 'Salvaged components · fly close to collect',
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

  private damagePlayer(amount: number, at: THREE.Vector3, type?: DamageType): void {
    if (!this.alive) return;
    const r = applyDamage(this.playerDurability, amount, type);
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

  private damageNpc(n: NpcShip, amount: number, at: THREE.Vector3, type?: DamageType, byPlayer = false): void {
    if (byPlayer) n.playerHitAt = this.time;
    const r = applyDamage(n.durability, amount, type);
    const shieldHit = r.absorbedByShield > 0;
    n.art.flashShield(shieldHit ? 0.8 : 0.2);
    // Fights between other ships far away stay quiet and cheap.
    const near = byPlayer || at.distanceTo(this.player.position) < 2_500;
    if (near || at.distanceTo(this.player.position) < 8_000) this.spawnEffect(createImpactSpark(at.clone(), shieldHit ? '#7fd8ff' : '#ffb070', this.ctx));
    if (near) this.sfx(shieldHit ? 'hit-shield' : 'hit-hull', 0.55);
    if (r.destroyed) this.destroyNpc(n);
  }

  private destroyNpc(n: NpcShip): void {
    n.target.alive = false;
    const cached = this.missileTargetCache.get(n.id);
    if (cached) cached.alive = false;
    const near = n.body.position.distanceTo(this.player.position) < 6_000;
    this.spawnEffect(createExplosion(n.body.position.clone(), 8, this.ctx));
    if (near) this.sfx('explosion-large', 0.8);
    // Raiders leave salvage; a lost freighter spills part of its cargo; an ace drops its hold.
    this.spawnLoot(n.body.position, n.role === 'trader' ? 90 + Math.round(this.rand() * 160) : n.role === 'raider' ? 60 + Math.round(n.bounty * 0.25) : 40);
    if (n.ace) {
      const [lo, hi] = CONTRACTS.ace.loot;
      this.spawnLoot(n.body.position.clone().add(this.tmp.set(20, 8, -12)), Math.round(lo + this.rand() * (hi - lo)));
      const goods: CommodityId[] = ['luxuries', 'electronics', 'weapons', 'ship-parts'];
      this.spawnLoot(n.body.position.clone().add(this.tmp.set(-18, -6, 14)), 0, { cargo: { commodity: goods[Math.floor(this.rand() * goods.length)]!, qty: 3 + Math.floor(this.rand() * 4) } });
    }
    if (n.escort) this.callbacks.onEscortLost?.(n.escort.jobId);
    else if (n.role === 'trader') this.callbacks.onMessage(`${n.name} was destroyed.`, 'bad');
    const byPlayer = this.time - n.playerHitAt < 30;
    if (n.contract) this.callbacks.onContractKill(n.contract);
    else if (n.side === 'raider' && !n.encounter && byPlayer) this.callbacks.onBounty(n.bounty, n.name);
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
    for (const x of this.npcs) if (x.foe === n) x.foe = null;
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
        projectileSpeed: npc.guns[0]!.profile.projectileSpeed,
        gunRange: npc.guns[0]!.profile.range,
      };
      for (const g of npc.guns) g.tick(dt);
      const out = npc.brain.update(dt, npc.body, npc.durability, this.player, tuning, npc.controls);
      if (out.fire && this.alive && !enc.bypassed && withinArc(npc.body, out.aimPoint)) {
        const fired = npc.guns[0]!.fire(npc.body, npc.art.muzzles, out.aimPoint, this.projectiles, npc.id, DIFFICULTY[this.settings.difficulty].enemyDamage);
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
    const art = createCatalogShipArt(shipModel(RAIDER_MODEL_ID), this.ctx);
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
      // Wake Salvage kit: a deflector shield and plasma guns.
      durability: { hull: hullMax, hullMax, shield: 60, shieldMax: 60, shieldRegen: 6, shieldDelay: 3, shieldType: 'deflector', sinceHit: 99 },
      guns: [new Gun({ damage: 4, shotsPerSecond: 3.2, projectileSpeed: 760, range: 900, energyPerShot: 3, kind: 'enemy-pulse', damageType: 'plasma' })],
      brain: new PirateBrain(this.rand),
      role: 'raider',
      side: 'raider',
      foe: 'player',
      bounty: 0,
      playerHitAt: -Infinity,
      idle: 0,
      maydaySent: false,
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

  // ---------------------------------------------------------------- traffic (docs/PROCGEN.md §9)

  private readonly packHome = new Map<number, THREE.Vector3>();
  private readonly packAlerted = new Set<number>();
  private packSerial = 0;
  private frameObstacles: Obstacle[] = [];

  /** A raider pack is fighting the player. */
  private packEngaged(): boolean {
    return this.npcs.some((n) => n.pack !== undefined && n.foe === 'player' && n.durability.hull > 0 && n.brain.state !== 'flee' && n.brain.state !== 'escaped');
  }

  private updateTraffic(dt: number): void {
    const t = this.traffic;
    if (!t) return;
    const { plan } = t;
    const timers = this.trafficTimers;
    if (!timers.populated) {
      timers.populated = true;
      for (let i = 0; i < Math.ceil(plan.traders / 2); i++) this.spawnTrader(t, true);
    }
    timers.trader -= dt;
    if (timers.trader <= 0 && this.npcs.filter((n) => n.role === 'trader').length < plan.traders) {
      this.spawnTrader(t);
      timers.trader = THREE.MathUtils.lerp(plan.traderInterval[0], plan.traderInterval[1], this.rand());
    }
    if (!timers.contractsSpawned && this.time > 2) {
      timers.contractsSpawned = true;
      for (const c of t.contractPacks ?? []) this.spawnContractPack(c);
      for (const e of t.escorts ?? []) this.spawnEscort(e);
      for (const w of t.wrecks ?? []) this.spawnWreck(w);
    }
    // Escorted ships: the ambush comes part-way along the route.
    for (const n of this.npcs) {
      const e = n.escort;
      if (!e || e.ambushed || !n.trader || n.durability.hull <= 0) continue;
      const total = Math.max(1, e.start.distanceTo(n.trader.destination.point));
      if (1 - n.body.position.distanceTo(n.trader.destination.point) / total >= e.ambushAt) {
        e.ambushed = true;
        this.spawnAmbush(n, e.level);
      }
    }
    for (const w of this.wreckHulls) w.art.object.rotation.x += w.spin.x * dt;
    if (!timers.patrolsLaunched && plan.patrolWings > 0 && this.time > 2) {
      timers.patrolsLaunched = true;
      for (let w = 0; w < plan.patrolWings; w++) this.spawnPatrolWing(t, w);
    }
    if (plan.packs) {
      timers.pack -= dt;
      const packs = new Set(this.npcs.flatMap((n) => (n.pack === undefined || n.contract ? [] : [n.pack]))).size;
      if (timers.pack <= 0 && packs < plan.packs.max && this.alive && !this.busy && this.autopilot.mode !== 'lane') {
        this.spawnPack(plan.packs);
        timers.pack = THREE.MathUtils.lerp(plan.packs.interval[0], plan.packs.interval[1], this.rand());
      }
    }
    this.frameObstacles = this.system.obstacles(null);
    for (const n of [...this.npcs]) {
      if (n.encounter || n.durability.hull <= 0) continue;
      if (n.role === 'trader') this.flyTrader(n);
      else if (n.role === 'patrol') this.flyPatrol(n, dt);
      else this.flyRaider(n, dt);
    }
  }

  /** A traffic ship from the catalogue, flying its stock loadout (NPC guns are scaled down in fights). */
  private makeNpc(modelId: string, role: NpcRole, faction: FactionId | 'independent', position: THREE.Vector3, forward: THREE.Vector3, subtitle: string): NpcShip {
    const model = shipModel(modelId);
    const perf = performanceOf({ model: modelId, fittings: model.stock });
    const body = new ShipBody(perf.flight);
    body.position.copy(position);
    body.lookAlong(forward);
    body.velocity.copy(forward).multiplyScalar(80);
    const art = createCatalogShipArt(model, this.ctx);
    art.object.position.copy(position);
    this.system.scene.add(art.object);
    const side = role === 'raider' ? 'raider' : 'lawful';
    const health = side === 'raider' ? DIFFICULTY[this.settings.difficulty].enemyHealth : 1;
    const id = `${role}-${++this.trafficTimers.serial}`;
    const name = model.name;
    const lawfulFaction = faction !== 'independent' ? faction : undefined;
    const npc: NpcShip = {
      id,
      name,
      faction,
      role,
      side,
      body,
      art,
      durability: {
        hull: perf.hullMax * health,
        hullMax: perf.hullMax * health,
        shield: perf.shield?.capacity ?? 0,
        shieldMax: perf.shield?.capacity ?? 0,
        shieldRegen: perf.shield?.regenPerSecond ?? 0,
        shieldDelay: perf.shield?.regenDelay ?? 3,
        shieldType: perf.shield?.shieldType ?? 'balanced',
        sinceHit: 99,
      },
      guns: perf.guns.map(
        (g, i) =>
          new Gun({
            damage: g.damage,
            shotsPerSecond: g.shotsPerSecond,
            projectileSpeed: g.projectileSpeed,
            range: g.range,
            energyPerShot: g.energyPerShot,
            kind: side === 'raider' ? 'enemy-pulse' : boltKind(g.damageType, 1 + (i % 2)),
            damageType: g.damageType,
          }),
      ),
      brain: new PirateBrain(this.rand),
      controls: neutralControls(),
      target: {
        id: `ship:${id}`,
        name,
        kind: 'ship',
        position: body.position,
        velocity: body.velocity,
        radius: art.radius,
        subtitle,
        dataClass: 'fictional',
        ...(lawfulFaction ? { faction: lawfulFaction } : {}),
        hostile: side === 'raider',
        alive: true,
        cycle: side === 'raider',
      },
      foe: null,
      bounty: 0,
      playerHitAt: -Infinity,
      idle: 0,
      maydaySent: false,
    };
    this.npcs.push(npc);
    return npc;
  }

  private openDocks(): DockSite[] {
    return this.system.docks.filter((d) => d.dockable);
  }

  private jumpPoint(): THREE.Vector3 {
    return (this.system.def.beacons.find((b) => b.kind === 'jump') ?? { position: this.system.def.arrival.position }).position;
  }

  private spawnTrader(t: TrafficSetup, midRoute = false): void {
    const docks = this.openDocks();
    if (!docks.length) return;
    const owner: StationOwner = t.owner ?? 'independent';
    const fleet = FLEETS[owner].traders.length ? FLEETS[owner].traders : FLEETS.independent.traders;
    const model = fleet[Math.floor(this.rand() * fleet.length)]!;
    // Some arrive through the jump beacon, the rest launch from a station.
    const fromBeacon = docks.length < 2 || this.rand() < 0.4;
    const from = fromBeacon ? null : docks[Math.floor(this.rand() * docks.length)]!;
    const choices = docks.filter((d) => d !== from);
    const dest = choices[Math.floor(this.rand() * choices.length)]!;
    let position = from
      ? from.dockPoint.clone().addScaledVector(from.approach, 320)
      : this.jumpPoint().clone().add(this.tmp.set(this.rand() - 0.5, (this.rand() - 0.5) * 0.3, this.rand() - 0.5).multiplyScalar(1_400));
    // The traffic already under way when the player arrives: somewhere along its route.
    if (midRoute) position = position.lerp(dest.dockPoint, 0.15 + this.rand() * 0.6).add(this.tmp.set(0, (this.rand() - 0.5) * 800, 0));
    // Never pop in right next to the player.
    if (position.distanceTo(this.player.position) < 1_200) return;
    const forward = from && !midRoute ? from.approach.clone() : dest.dockPoint.clone().sub(position).normalize();
    const faction = owner === 'hollow-wake' ? 'independent' : owner;
    const npc = this.makeNpc(model, 'trader', faction, position, forward, `${faction === 'independent' ? 'Independent' : FACTIONS[faction].shortName} hauler · bound for ${dest.name}`);
    npc.trader = new TraderBrain({ id: dest.def.locationId, point: dest.dockPoint }, npc.durability);
    npc.origin = from ? from.def.locationId : null;
  }

  private spawnPatrolWing(t: TrafficSetup, wing: number): void {
    const owner = t.owner;
    if (!owner || owner === 'independent' || owner === 'hollow-wake') return;
    const models = FLEETS[owner].patrols;
    const points = [...this.openDocks().map((d) => d.dockPoint.clone().addScaledVector(d.approach, 1_600)), this.jumpPoint().clone()];
    if (!models.length || points.length < 2) return;
    const start = (wing * 2) % points.length;
    for (let i = 0; i < t.plan.wingSize; i++) {
      const model = models[(wing + i) % models.length]!;
      const offset = new THREE.Vector3((i - 0.5) * 180, i * 50, i * 90);
      const position = points[start]!.clone().add(offset);
      if (position.distanceTo(this.player.position) < 600) position.add(this.tmp.set(0, 700, 0));
      const forward = points[(start + 1) % points.length]!.clone().sub(position).normalize();
      const npc = this.makeNpc(model, 'patrol', owner, position, forward, `${FACTIONS[owner].shortName} patrol`);
      npc.patrol = { brain: new PatrolBrain(points, start + 1), offset };
    }
  }

  private spawnPack(spec: NonNullable<TrafficPlan['packs']>): void {
    const pack = ++this.packSerial;
    const den = this.system.docks.find((d) => !d.dockable);
    let home: THREE.Vector3;
    const fromDen = !!den && this.rand() < 0.6;
    if (fromDen) {
      home = den!.def.position.clone().addScaledVector(den!.approach, den!.radius + 1_200);
    } else {
      // Out of the dark, a few kilometres from the player.
      const a = this.rand() * Math.PI * 2;
      home = this.player.position.clone().add(this.tmp.set(Math.cos(a), (this.rand() - 0.5) * 0.4, Math.sin(a)).normalize().multiplyScalar(6_000 + this.rand() * 2_500));
    }
    this.packHome.set(pack, home);
    // They prowl the approaches: off a few stations, the jump beacon, and back home.
    const approaches = this.openDocks()
      .map((d) => d.dockPoint.clone().addScaledVector(d.approach, 2_500 + this.rand() * 2_000).add(this.tmp.set(0, (this.rand() - 0.5) * 1_200, 0)))
      .sort(() => this.rand() - 0.5)
      .slice(0, 3);
    // A pack out of the dark first sweeps toward where the player was seen.
    const route = [...(fromDen ? [] : [this.player.position.clone()]), ...approaches, this.jumpPoint().clone().add(this.tmp.set(1_500, 400, -1_200)), home.clone()];
    const size = spec.size[0] + Math.floor(this.rand() * (spec.size[1] - spec.size[0] + 1));
    const pool = RAIDERS[spec.level];
    for (let i = 0; i < size; i++) {
      const model = pool[Math.floor(this.rand() * pool.length)]!;
      const position = home.clone().add(this.tmp.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(500));
      const forward = this.player.position.clone().sub(position).normalize();
      const bounty = bountyFor(model);
      const npc = this.makeNpc(model, 'raider', 'hollow-wake', position, forward, `${FACTIONS['hollow-wake'].name} raider · hostile · bounty ${bounty} cr`);
      npc.pack = pack;
      npc.bounty = bounty;
      npc.patrol = { brain: new PatrolBrain(route, 0), offset: new THREE.Vector3((i - size / 2) * 140, (i % 2) * 60, (i % 3) * 90) };
    }
  }

  /** A bounty contract's pack: it lurks at its marked spot until the player comes for it. */
  private spawnContractPack(c: NonNullable<TrafficSetup['contractPacks']>[number]): void {
    const site = this.system.dock(c.locationId);
    if (!site || c.count <= 0) return;
    const home = site.dockable
      ? site.dockPoint.clone().addScaledVector(site.approach, 2_600).add(this.tmp.set(0, 500, 0))
      : site.def.position.clone().addScaledVector(site.approach, site.radius + 1_400);
    const pack = ++this.packSerial;
    this.packHome.set(pack, home);
    const pool = RAIDERS[c.level];
    const around = () => home.clone().add(this.tmp.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(600));
    const heading = () => this.tmp.set(this.rand() - 0.5, 0, this.rand() - 0.5).normalize().clone();
    if (c.ace) {
      // A named ace in a better ship, tougher than its hull suggests, with guards.
      const ace = this.makeNpc(c.ace.model, 'raider', 'hollow-wake', around(), heading(), `${FACTIONS['hollow-wake'].name} ace · contract target`);
      ace.name = c.ace.name;
      ace.target.name = c.ace.name;
      ace.pack = pack;
      ace.contract = c.jobId;
      ace.ace = true;
      const d = ace.durability;
      d.hull = d.hullMax = d.hullMax * CONTRACTS.ace.toughness;
      d.shield = d.shieldMax = d.shieldMax * CONTRACTS.ace.toughness;
      for (let i = 0; i < CONTRACTS.ace.guards; i++) this.spawnGuard(pool[i % pool.length]!, pack, around());
      return;
    }
    for (let i = 0; i < c.count; i++) {
      const model = pool[i % pool.length]!;
      const npc = this.makeNpc(model, 'raider', 'hollow-wake', around(), heading(), `${FACTIONS['hollow-wake'].name} raider · contract target`);
      npc.pack = pack;
      npc.contract = c.jobId;
    }
  }

  /** A raider guarding a spot (an ace or a wreck): the usual bounty, and it never wanders off. */
  private spawnGuard(model: string, pack: number, position: THREE.Vector3): NpcShip {
    const bounty = bountyFor(model);
    const forward = this.tmp.set(this.rand() - 0.5, 0, this.rand() - 0.5).normalize().clone();
    const npc = this.makeNpc(model, 'raider', 'hollow-wake', position, forward, `${FACTIONS['hollow-wake'].name} raider · hostile · bounty ${bounty} cr`);
    npc.pack = pack;
    npc.bounty = bounty;
    npc.guard = true;
    return npc;
  }

  /** The ship of an escort contract: it sets off alongside the player toward its destination. */
  private spawnEscort(e: NonNullable<TrafficSetup['escorts']>[number]): void {
    const dest = this.system.dock(e.to);
    if (!dest) return;
    const forward = this.player.forward(new THREE.Vector3());
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.player.quaternion);
    const position = this.player.position.clone().addScaledVector(forward, 220).addScaledVector(side, 180);
    const heading = dest.dockPoint.clone().sub(position).normalize();
    const owner = this.traffic?.owner;
    const faction = owner === 'sta' || owner === 'frontier' ? owner : 'independent';
    const npc = this.makeNpc(e.model, 'trader', faction, position, heading, `Your escort · bound for ${dest.name}`);
    npc.name = e.name;
    npc.target.name = `${e.name} (escort)`;
    npc.trader = new TraderBrain({ id: e.to, point: dest.dockPoint }, npc.durability);
    npc.origin = null;
    const [a, b] = CONTRACTS.escort.ambushAt;
    npc.escort = { jobId: e.jobId, start: position.clone(), ambushAt: a + this.rand() * (b - a), ambushed: false, level: e.level };
    this.callbacks.onMessage(`The ${e.name} is setting off for ${dest.name}. Stay close.`, 'info');
  }

  /** Raiders jump the escorted ship: they come from ahead of it and go for it first. */
  private spawnAmbush(target: NpcShip, level: 1 | 2 | 3): void {
    const pack = ++this.packSerial;
    const ahead = target.trader!.destination.point.clone().sub(target.body.position).normalize();
    const side = new THREE.Vector3().crossVectors(ahead, new THREE.Vector3(0, 1, 0)).normalize();
    const home = target.body.position.clone().addScaledVector(ahead, 1_600).addScaledVector(side, (this.rand() - 0.5) * 1_200);
    this.packHome.set(pack, home);
    const pool = RAIDERS[level];
    const count = level + 1;
    for (let i = 0; i < count; i++) {
      const model = pool[i % pool.length]!;
      const bounty = bountyFor(model);
      const position = home.clone().add(this.tmp.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(500));
      const npc = this.makeNpc(model, 'raider', 'hollow-wake', position, target.body.position.clone().sub(position).normalize(), `${FACTIONS['hollow-wake'].name} raider · hostile · bounty ${bounty} cr`);
      npc.pack = pack;
      npc.bounty = bounty;
      // Half go for the escorted ship, half for its guard.
      if (i % 2 === 0) npc.prey = target;
    }
    this.sfx('alert');
    this.callbacks.onMessage(`Ambush! Raiders are closing on the ${target.name}.`, 'bad');
  }

  /** A recovery contract's wreck: a dead hull a few kilometres off a station, and the item to tractor in. */
  private spawnWreck(w: NonNullable<TrafficSetup['wrecks']>[number]): void {
    const site = this.system.dock(w.locationId);
    if (!site) return;
    const r = seededRandom(hashString(w.jobId));
    const dir = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.3, r() - 0.5).normalize();
    const base = site.dockable ? site.dockPoint : site.def.position;
    const at = base.clone().addScaledVector(dir, site.radius + 4_500 + r() * 2_000);
    const fleet = FLEETS.independent.traders;
    const hull = createCatalogShipArt(shipModel(fleet[Math.floor(r() * fleet.length)]!), this.ctx);
    hull.object.position.copy(at);
    hull.object.rotation.set(r() * Math.PI, r() * Math.PI, r() * Math.PI);
    this.system.scene.add(hull.object);
    this.wreckHulls.push({ art: hull, spin: new THREE.Vector3(0.02 + r() * 0.03, 0, 0) });
    this.spawnLoot(at.clone().add(new THREE.Vector3(80, 20, -60)), 0, { recover: { jobId: w.jobId, item: w.item } });
    if (w.guard) {
      const pack = ++this.packSerial;
      const home = at.clone().add(new THREE.Vector3(0, 300, 0));
      this.packHome.set(pack, home);
      const pool = RAIDERS[w.guard];
      for (let i = 0; i < w.guard; i++) this.spawnGuard(pool[i % pool.length]!, pack, home.clone().add(this.tmp.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(500)));
    }
  }

  private flyTrader(n: NpcShip): void {
    const brain = n.trader!;
    const cruise = brain.update(n.body, n.durability, n.controls, this.frameObstacles, () => {
      // An escorted ship keeps to its course; others run for the nearest dock.
      if (n.escort) return brain.destination;
      let best: DockSite | null = null;
      for (const d of this.openDocks()) if (!best || d.dockPoint.distanceTo(n.body.position) < best.dockPoint.distanceTo(n.body.position)) best = d;
      return best ? { id: best.def.locationId, point: best.dockPoint } : null;
    });
    if (n.escort) {
      // An escorted ship keeps to sublight speed, and waits for its guard when left behind.
      n.body.requestCruise(false);
      const far = n.body.position.distanceTo(this.player.position) > ESCORT_WAIT;
      if (far && brain.state === 'travel') {
        n.controls.throttle = 0;
        if (!n.escort.waiting) this.callbacks.onMessage(`The ${n.name} is holding position until you catch up.`, 'info');
      }
      n.escort.waiting = far;
    } else n.body.requestCruise(cruise);
    if (brain.attacked && !n.maydaySent) {
      n.maydaySent = true;
      if (n.body.position.distanceTo(this.player.position) < 15_000) this.callbacks.onMessage(`Mayday from the ${n.name}: raiders attacking!`, 'bad');
    }
    // Docked at its destination: it unloads (the markets feel it) and leaves the scene.
    if (brain.state === 'arrived') {
      if (n.escort) this.callbacks.onEscortArrived?.(n.escort.jobId);
      else this.callbacks.onTraderArrived?.(n.origin ?? null, brain.destination.id, n.id);
      this.removeNpc(n);
    }
  }

  private flyPatrol(n: NpcShip, dt: number): void {
    // The opening raid and bounty-contract packs are the player's fights; patrols leave them alone.
    const foe = this.nearestShip(n.body.position, 4_000, (x) => x.side === 'raider' && !x.encounter && !x.contract);
    n.foe = foe;
    if (foe) {
      this.fightNpc(n, foe.body, dt, TRAFFIC.npcDamage);
    } else {
      for (const g of n.guns) g.tick(dt);
      n.body.requestCruise(n.patrol!.brain.update(n.body, n.controls, this.frameObstacles, n.patrol!.offset));
    }
    // A badly damaged patrol breaks off and heads home.
    if (n.brain.state === 'escaped') this.removeNpc(n);
  }

  private flyRaider(n: NpcShip, dt: number): void {
    const pack = this.npcs.filter((x) => x.pack === n.pack && x.durability.hull > 0);
    const sees = (x: NpcShip) => x.body.position.distanceTo(this.player.position) < TRAFFIC.detectRange;
    const playerFair = this.alive && !this.busy && this.autopilot.mode !== 'lane';
    if (n.prey && n.prey.durability.hull > 0 && this.time - n.playerHitAt > 6) {
      // Ambushers go for the escorted ship until the player makes them turn.
      n.foe = n.prey;
    } else if (playerFair && (n.foe === 'player' || pack.some(sees))) {
      n.foe = 'player';
    } else {
      const prey = n.foe && n.foe !== 'player' && n.foe.durability.hull > 0 ? n.foe : this.nearestShip(n.body.position, TRAFFIC.huntRange, (x) => x.side === 'lawful');
      n.foe = prey;
    }
    // Raiders give up on a player who is out of reach.
    if (n.foe === 'player' && n.body.position.distanceTo(this.player.position) > TRAFFIC.huntRange) n.foe = null;
    if (n.foe) {
      n.idle = 0;
      const toPlayer = n.foe === 'player';
      if (toPlayer && n.pack !== undefined && !this.packAlerted.has(n.pack)) {
        this.packAlerted.add(n.pack);
        this.sfx('alert');
        this.callbacks.onMessage(pack.length > 1 ? `${pack.length} Hollow Wake raiders closing in!` : 'A Hollow Wake raider is closing in!', 'bad');
        if (this.autopilot.mode === 'goto') this.autopilot = { mode: 'none' };
        this.player.requestCruise(false);
      }
      const scale = TRAFFIC.npcDamage * (toPlayer ? DIFFICULTY[this.settings.difficulty].enemyDamage : 1) * (n.ace ? CONTRACTS.ace.damage : 1);
      this.fightNpc(n, toPlayer ? this.player : (n.foe as NpcShip).body, dt, scale);
    } else {
      n.idle += dt;
      for (const g of n.guns) g.tick(dt);
      if (n.contract || n.guard) {
        // A contract pack (or an ace's or a wreck's guards) holds its spot until someone comes for it.
        flyTo(n.body, this.packHome.get(n.pack ?? -1) ?? n.body.position, { arriveDistance: 500, allowCruise: false, maxThrottle: 0.35 }, n.controls);
        n.body.requestCruise(false);
        return;
      }
      if (n.patrol) {
        n.body.requestCruise(n.patrol.brain.update(n.body, n.controls, this.frameObstacles, n.patrol.offset));
      } else {
        flyTo(n.body, this.packHome.get(n.pack ?? -1) ?? n.body.position, { arriveDistance: 400, allowCruise: false, maxThrottle: 0.5 }, n.controls);
        n.body.requestCruise(false);
      }
      if (n.idle > TRAFFIC.packIdle) this.removeNpc(n);
    }
    if (n.brain.state === 'escaped' && n.body.position.distanceTo(this.player.position) > 3_200) this.removeNpc(n);
  }

  /** Runs a ship's combat brain against a target and fires its guns. */
  private fightNpc(n: NpcShip, foe: ShipBody, dt: number, damageScale: number): void {
    const g0 = n.guns[0];
    for (const g of n.guns) g.tick(dt);
    // Close long distances in cruise, then drop out to fight.
    n.body.requestCruise(n.brain.state === 'approach' && n.body.position.distanceTo(foe.position) > 3_500 && aimErrors(n.body, foe.position).angle < 0.3);
    const tuning = {
      accuracy: n.side === 'raider' ? DIFFICULTY[this.settings.difficulty].enemyAccuracy : 0.6,
      projectileSpeed: g0?.profile.projectileSpeed ?? 800,
      gunRange: g0?.profile.range ?? 900,
    };
    const out = n.brain.update(dt, n.body, n.durability, foe, tuning, n.controls);
    if (!g0 || !out.fire || !withinArc(n.body, out.aimPoint)) return;
    const muzzles = n.art.muzzles;
    let fired = false;
    n.guns.forEach((g, i) => {
      if (g.fire(n.body, muzzles.length ? [muzzles[i % muzzles.length]!] : [], out.aimPoint, this.projectiles, n.id, damageScale).fired) fired = true;
    });
    if (fired) {
      this.npcShots.set(n.id, (this.npcShots.get(n.id) ?? 0) + 1);
      if (n.body.position.distanceTo(this.player.position) < 2_500) this.sfx(n.side === 'raider' ? 'laser-enemy' : 'laser', 0.3);
    }
  }

  private nearestShip(from: THREE.Vector3, range: number, match: (n: NpcShip) => boolean): NpcShip | null {
    let best: NpcShip | null = null;
    let bestD = range;
    for (const x of this.npcs) {
      if (x.durability.hull <= 0 || !match(x)) continue;
      const d = x.body.position.distanceTo(from);
      if (d < bestD) {
        best = x;
        bestD = d;
      }
    }
    return best;
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
    const launcher = activeLauncher(this.state.ship);
    hud.missiles = launcher?.ammo ?? 0;
    hud.launcher = launcher ? roundsLabel(launcher.stats.kind) : null;
    hud.repairKits = this.state.ship.repairKits;
    hud.inLane = this.autopilot.mode === 'lane' && this.autopilot.phase === 'travel';
    hud.encounterActive = (this.activeEncounter !== null && !this.activeEncounter.bypassed) || this.packEngaged();
    const ap = this.autopilot;
    hud.autopilotMode = ap.mode;
    hud.weapon = gunSummary(this.state.ship);
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
    const need = this.lockTimeNeeded();
    hud.missileLock = need <= 0 ? 'none' : this.missileLockTime >= need ? 'locked' : this.missileLockTime > 0 ? 'locking' : 'none';

    // Target panel.
    const sel = this.selectedTarget;
    if (sel) {
      const npc = this.npcs.find((n) => n.target.id === sel.id);
      let lead: { x: number; y: number } | null = null;
      if (sel.velocity && (sel.hostile || sel.kind === 'drone')) {
        leadPoint(p.position, p.velocity, sel.position, sel.velocity, this.leadSpeed, this.tmp2);
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
        inGunRange: dist < this.gunRange,
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
  debugNpcs(): { id: string; role: NpcRole; state: string; hull: number; shield: number; energy: number; distance: number; shotsFired: number }[] {
    return this.npcs.map((n) => ({
      id: n.id,
      role: n.role,
      state: n.trader?.state ?? (n.patrol && n.foe === null ? n.patrol.brain.state : n.brain.state),
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
    for (const w of this.wreckHulls) {
      this.system.scene.remove(w.art.object);
      w.art.dispose();
    }
    this.wreckHulls.length = 0;
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
    // Ship models no ship uses any more (the next dock or launch rebuilds what it needs).
    clearShipArtCache();
    this.projectiles.clear();
  }
}
