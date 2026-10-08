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
import { EXOPLANETS, FAR_STARS, getLocation, getSystem, isInventedSystem, PYRE_ID, PYRE_SYSTEM } from '../data/systems.ts';
import type { FactionId } from '../data/types.ts';
import type { DamageType } from '../content/types.ts';
import type { ShipPerformance } from '../content/loadout.ts';
import { FACTIONS } from '../economy/factions.ts';
import { REPAIR_KIT } from '../economy/equipment.ts';
import { shipModel } from '../content/catalog.ts';
import { CONTRACTS } from '../content/contracts/rules.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { hashString } from '../content/random.ts';
import { LAW } from '../content/law/rules.ts';
import { duelTargetId, lifeboatTargetId, standTargetId, strandedTargetId, type EscortSetup, type LifeboatSetup, type StandSetup } from '../economy/jobs.ts';
import { STAND, STAND_LINES } from '../content/story/stand.ts';
import { EMBERS, LIFEBOAT_LINES } from '../content/story/embers.ts';
import { DOOMED } from '../content/stellar/doomed.ts';
import { polar } from './systems/helpers.ts';
import type { Lingering } from '../app/state.ts';
import { DENS } from '../content/dens/rules.ts';
import { MINED_GOODS, MINING } from '../content/mining/rules.ts';
import { cutRock, minerHunt, securityOf, stowUnit } from '../economy/mining.ts';
import { itemsThatFit } from '../economy/cargo.ts';
import { COMBAT } from '../content/combat/rules.ts';
import { CHATTER, type ChatterKind } from '../content/combat/chatter.ts';
import { getCatalog } from '../content/catalog.ts';
import { createReactorArt, createTurretArt } from './art/denDefences.ts';
import { contrabandIn, huntedBy, huntersIn, patrolsScanIn, wakeFriendly } from '../economy/law.ts';
import { activeLauncher, fittedGuns, gunSummary, performanceOf, roundsLabel } from '../economy/loadout.ts';
import { aimErrors, avoidObstacles, flyTo, steerToward, type Obstacle } from '../flight/autopilot.ts';
import { ChaseCamera } from '../flight/ChaseCamera.ts';
import type { FlightAction, FlightInput } from '../flight/input/types.ts';
import { lookRotation, neutralControls, RAIDER_SHIP, ShipBody, stepBounded, type ShipControls, type ShipParams } from '../flight/ShipBody.ts';
import { emptyHudModel, type HudContextAction, type HudMarker, type HudMining, type HudModel, type WingOrder } from '../ui/hud/hudModel.ts';
import { ORDER_LOCKS, WING_RADIO } from '../content/wing/lines.ts';
import { WING } from '../content/wing/rules.ts';
import { WingCommand, type WingCredit, type WingOption, type WingView } from './WingCommand.ts';
import { BorderBattle, type BattleEvent, type BattleMark } from './BorderBattle.ts';
import { battleSite } from './battleSite.ts';
import { BATTLES, type BattleSide } from '../content/border/battles.ts';
import type { BattlePlan } from '../economy/battles.ts';
import { getFront } from '../economy/border.ts';
import { wingSkill } from '../economy/wing.ts';
import { createMinableRock, createMiningBeam, type MinableRockArt, type MiningBeamArt } from './art/mining.ts';
import { minersIn, miningSpot } from '../economy/fleetWork.ts';
import { isOutpostId, siteOfStation } from '../content/outposts/sites.ts';
import { MiningField, type MinableRock, type MiningLedger } from './MiningField.ts';

import type { AsteroidHit } from './art/asteroids.ts';
import {
  createCargoPod,
  createExplosion,
  createFlareArt,
  createMineArt,
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
import { HAULS } from '../content/economy/hauls.ts';
import { sightInView } from './sightseeing.ts';
import { createFarStars, type FarStarsArt } from './art/farStars.ts';
import { STELLAR } from '../content/stellar/rules.ts';
import { farStarLook, magnitudeText, observationsWanted, skyDirection, skyDirectionTo, skyPhase } from '../economy/stellar.ts';
import { fillFlare, flareAt, flareComm, flareEffects, flareStar, flareSubtitle, starGlow, type Flare } from '../economy/flares.ts';
import { FLARE_HUD } from '../content/stellar/flareLines.ts';
import { fallbackGlow, lightArrives, lyFromPyre, pyreDockRefusal, pyreLook, pyreStage, tidalStrain } from '../economy/doomed.ts';
import { LANES } from '../content/lanes/rules.ts';
import { laneOfferFor, laneWords, stageLane, type LaneOffer, type LaneOutcome } from '../economy/lanes.ts';
import { activeEdge } from '../economy/events.ts';
import { haulsIn, type Haul, type HaulHere, type HaulLeg } from '../economy/hauls.ts';
import { FLEET } from '../content/fleet/rules.ts';
import { captainsIn, runDoing, type CaptainHere, type RunRaid } from '../economy/fleet.ts';
import { RIVALS } from '../content/rivals/rules.ts';
import { RIVAL_STORY } from '../content/rivals/stories.ts';
import { RAID_GUARD } from '../content/outposts/raidLines.ts';
import { OUTPOST_RAIDS } from '../content/outposts/raids.ts';
import { rivalById, rivalName, rivalsIn, rivalSubtitle, type RivalLeg, type RivalRun } from '../economy/rivals.ts';
import { crewEffects, hurtCrew, isHurt, type CrewEffects } from '../economy/crew.ts';
import { CREW, type CrewRole } from '../content/crew/rules.ts';
import { CREW_NOTES, CREW_RADIO } from '../content/crew/lines.ts';
import { WRECKS } from '../content/wrecks/rules.ts';
import { POD_NAMES, POD_SUBTITLE, SITE_NAMES, SITE_NOTES, SITE_SUBTITLES } from '../content/wrecks/lines.ts';
import type { SiteSetup } from '../economy/wrecks.ts';
import { placeSite, podOffset } from './sites.ts';
import { coveredAt, coverLine } from '../economy/ranks.ts';
import { RACE_LINES } from '../content/racing/lines.ts';
import { courseById } from '../economy/racing.ts';
import { bodyPosition, placedLine } from './courses.ts';
import { RaceRun, type RaceEvent, type RaceSetup } from './RaceRun.ts';
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
  /** Loot collected: credits, cargo when the pod held some, or a piece of salvaged equipment (a catalogue gear id). */
  onLoot(credits: number, cargo?: { commodity: CommodityId; qty: number }, gear?: string): void;
  /** The player destroyed a raider from a pack (the opening raid reports through onEncounterEnd). */
  onBounty(credits: number, name: string): void;
  /** A raider of a bounty contract's pack was destroyed. */
  onContractKill(jobId: string): void;
  /**
   * A scheduled hauler (docs/PROCGEN.md §21) left the scene: docked or out through the jump beacon
   * (`safe` through this system), or destroyed (`lost`, by the player or by raiders).
   */
  onHaul?(id: string, fate: 'safe' | 'lost', by?: 'player' | 'raiders'): void;
  /** A hauler the player kept alive through a raiders' attack got away: it sends thanks. */
  onHaulThanks?(haul: Haul): void;
  /**
   * One of the player's own haulers (docs/PROCGEN.md §18.6): seen safely past its raid here
   * (`safe`: guarded through the ambush, or to its dock or the jump beacon), or destroyed (`lost`).
   */
  onCaptain?(shipId: string, fate: 'safe' | 'lost', by?: 'player' | 'raiders'): void;
  /**
   * A rival pilot (docs/PROCGEN.md §24): met here (in the scene, `hostile` when it is out for the
   * player), shot at by the player, or its ship destroyed (by the player, or by raiders).
   */
  onRival?(rivalId: string, what: 'met' | 'shot' | 'destroyed', detail?: { hostile?: boolean; by?: 'player' | 'raiders' }): void;
  /** A rival's feud (docs/PROCGEN.md §28): the hired guns they sent struck the player here. */
  onRivalAmbush?(rivalId: string): void;
  /**
   * A rival's duel (§28): it started, the rival yielded (`won`), the player yielded (`lost`) or left
   * it (`forfeit`), or the player came to it with too little hull (`unfit`).
   */
  onDuel?(jobId: string, rivalId: string, what: 'started' | 'won' | 'lost' | 'forfeit' | 'unfit'): void;
  /**
   * The raid on the player's outpost (docs/PROCGEN.md §29): it struck here, or how it went: held
   * (every raider down or gone), lost (its stores broken open), or undecided after the time it is
   * given; with the raiders downed.
   */
  onOutpostRaid?(window: number, what: 'struck' | 'held' | 'lost' | 'timeout', downed: number): void;
  /** The player observed a far star (docs/PROCGEN.md §25), its target selected: the game records it for the contracts that want it. */
  onObserve?(starId: string): void;
  /** Pyre exploded with the player still in its system (docs/PROCGEN.md §26): the game carries the ship out. */
  onPyreBreakout?(): void;
  /**
   * A hail on the lanes (docs/PROCGEN.md §27): one began (already written into the save), the pilot
   * answered it (the game shows its card), or it lapsed unanswered.
   */
  onHail?(offer: LaneOffer): void;
  onAnswerHail?(offer: LaneOffer): void;
  onHailLapsed?(offer: LaneOffer): void;
  /**
   * A site marked in flight (docs/PROCGEN.md §31): the pilot came near it, tractored in one of its
   * pods, scanned it (`revealed`: raiders lying dark sprung by the scan), reached a ship in distress,
   * boarded a derelict; raiders lying dark by it sprang (`friend`: the Wake waves a pilot it trusts
   * by); its guards are all down; or the ship in distress was destroyed before it was reached.
   */
  onSite?(siteId: string, what: 'near' | 'pod' | 'scanned' | 'reached' | 'boarded' | 'sprung' | 'cleared' | 'lost', detail?: { index?: number; how?: 'near' | 'scan'; friend?: boolean; revealed?: boolean }): void;
  /** A race (docs/PROCGEN.md §33): the countdown, the start, a gate, the finish, a retire or a loss; the heat closing before a start. */
  onRace?(event: RaceEvent): void;
  /** A manual scan of a planet, star or belt (docs/PROCGEN.md §31.3): it may pick up a faint return. */
  onBodyScan?(): void;
  /** The ship of an escort contract docked at its destination. */
  onEscortArrived?(jobId: string): void;
  /** The ship of an escort contract was destroyed. */
  onEscortLost?(jobId: string): void;
  /** The item of a recovery contract was tractored aboard. */
  onRecovered?(jobId: string): void;
  /**
   * The player came alongside a stranded ship with a rescue under way: hand the goods over if they
   * are aboard. Returns how many are still missing (0: handed over).
   */
  onHandOver?(jobId: string): number;
  /** The stranded ship of a rescue was destroyed. */
  onRescueLost?(jobId: string): void;
  /** A stand in a belt (docs/PROCGEN.md §40.3) was won (the waves downed) or lost (too few cutters left). */
  onStand?(jobId: string, outcome: 'won' | 'lost'): void;
  /** One of Pyre's lifeboats taken aboard (docs/PROCGEN.md §42.4): how many are aboard now. */
  onLifeboat?(jobId: string): number;
  /** The player fired on (`attack`, once per ship) or destroyed a lawful ship. */
  onCrime?(kind: 'attack' | 'destroy', faction: FactionId | 'independent', name: string, role: 'trader' | 'patrol'): void;
  /** A patrol's cargo scan finished (`complete`) or the player flew off before it did (`evaded`). */
  onScan?(result: 'complete' | 'evaded', faction: FactionId): void;
  /** The player destroyed a bounty hunter (nobody pays for that). */
  onHunterDown?(): void;
  /** A den's reactor went down: the den assault `jobId` is done (null: the player knocked it out on their own). */
  onDenDestroyed?(locationId: string, jobId: string | null): void;
  /** A hired wingman's ship was destroyed (they eject and are picked up, rejoining at the next dock: docs/PROCGEN.md §34). */
  onWingmanLost?(crewId: string): void;
  /** Wing command (§34): the pilot asked for the order card; a hired wingman badly hit; fights and downs earned beside the pilot. */
  onWingOrders?(): void;
  onWingHurt?(crewId: string): void;
  onWingFought?(credits: readonly WingCredit[]): void;
  /** A border battle opened, or ended as the pilot saw it (docs/PROCGEN.md §35). */
  onBattle?(e: BattleEvent): void;
  /** Radio chatter: who speaks, and the line. */
  onComm?(speaker: string, text: string): void;
  /** Sightseers have had their good look at their sight (docs/PROCGEN.md §23). */
  onSight?(jobId: string): void;
  /** The player's hull took a hit: this share of its maximum (passengers aboard take fright, §23). */
  onHullHit?(share: number): void;
  /** The mining laser cut a whole unit from a rock of belt `beltId`: into the hold, or out in a cargo pod (docs/PROCGEN.md §19). */
  onMined?(beltId: string, commodity: CommodityId, into: 'hold' | 'pod'): void;
  onMessage(text: string, tone: 'good' | 'bad' | 'info'): void;
}

export type SpawnSpec =
  | { kind: 'undock'; locationId: string }
  | { kind: 'arrival' }
  | { kind: 'restore'; position: THREE.Vector3; quaternion: THREE.Quaternion };

type NpcRole = 'raider' | 'trader' | 'patrol';

export interface NpcShip {
  id: string;
  /** Catalogue ship model (den parts: their own kind). */
  modelId: string;
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
  /** A scheduled hauler (docs/PROCGEN.md §21): its haul, the leg it flies here, and the raiders the player had downed when it called for help. */
  haul?: { haul: Haul; leg: HaulLeg; downedAtMayday?: number };
  /**
   * One of the player's own haulers (docs/PROCGEN.md §18.6): the owned ship, its captain, the leg it
   * flies here, what it carries, the run's raid when it is due here, the pack of that ambush once it
   * comes, and whether the raid is settled (seen safely past).
   */
  captain?: { shipId: string; key: string; name: string; leg?: HaulLeg; way: 'out' | 'back' | 'work'; qty: number; raid: RunRaid | null; ambush?: number; settled?: boolean; safe?: true };
  /** A mining captain of the pilot's at work (docs/PROCGEN.md §37.4): its phase, and while cutting its rock and beam. */
  miner?: { phase: 'to-rocks' | 'cutting' | 'to-dock'; rock?: MinableRockArt; beam?: MiningBeamArt; rockAt?: THREE.Vector3 };
  /** A rival pilot (docs/PROCGEN.md §24): who, and the run it flies here (none for an ally, a duel or hired guns, §28). */
  rival?: { id: string; run?: RivalRun; leg?: RivalLeg };
  /** Hired by a rival to find the player (docs/PROCGEN.md §28): they want the player only, and pay no bounty. */
  hired?: string;
  /** A belt crew's cutter in a stand (docs/PROCGEN.md §40.3): which stand it works for. */
  cutter?: { jobId: string };
  /** One of Pyre Observatory's lifeboats (docs/PROCGEN.md §42.4): its job, and which of them. */
  lifeboat?: { jobId: string; i: number };
  /** A claim-jumper of a stand's waves (§40.3): which stand it came for. */
  jumper?: { jobId: string };
  /** The player's outpost's own (docs/PROCGEN.md §29): a turret, its stores, or a guard flying its loop round the outpost. */
  own?: { kind: 'turret' | 'stores' | 'guard'; centre: THREE.Vector3; angle: number };
  /** A raider of the raid on the player's outpost (its window). */
  outpostRaid?: number;
  /** A rival waiting for a duel off the beacon, fighting it, or done with it (§28): `yielded` (the player won), `won` (the rival did). */
  duel?: { jobId: string; spot: THREE.Vector3; state: 'waiting' | 'on' | 'yielded' | 'won'; told?: boolean };
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
  /** A lawful ship the player has fired on (the crime is reported once). */
  crimeReported?: boolean;
  /** A bounty hunter after the player's fines: it fights only the player and never gives up. */
  hunter?: boolean;
  /** Part of a raider den under assault: a gun turret, or the reactor. Den parts never move. */
  den?: { locationId: string; part: 'turret' | 'reactor' };
  /** In a border battle (docs/PROCGEN.md §35): which, its side, where it holds, and once it is over. */
  battle?: BattleMark;
  /** Flies with the player: a den assault's lawful wing, or a hired wingman (`crewId`), and where it keeps station. */
  wingman?: {
    offset: THREE.Vector3;
    crewId?: string;
    damage?: number;
    hurtAt?: number;
    /** By grade (docs/PROCGEN.md §34): aim, the chance to jink, seconds to react to a new foe. */
    accuracy?: number;
    evade?: number;
    react?: number;
    /** Badly hit: holding back from fights. */
    hurt?: boolean;
    /** A rival flying as an ally (§28): takes orders, earns nothing. */
    ally?: boolean;
  };
  /** Seconds until this raider can fire its next seeker at the player (seeker carriers only). */
  seekerIn?: number;
  /** A raider breaking off has had its chance to drop a mine. */
  mineRolled?: boolean;
  /** The ship whose fire last hit this one (for who gets the credit). */
  lastHitBy?: string;
  /** Seconds until a badly damaged ship next throws sparks. */
  sparkIn?: number;
  /** A ship of the sweep coming for a den (a den defence): it fights the player and the den's crews. */
  sweep?: { locationId: string };
  /** This patrol has decided whether to scan the player. */
  scanRolled?: boolean;
  /**
   * The ship of an escort contract: where it set off and when the ambush comes (a convoy's ambushes
   * come for the convoy). On its way to another system, it keeps station off the player (`follow`).
   */
  escort?: { jobId: string; start: THREE.Vector3; ambushAt: number; ambushed: boolean; level: 1 | 2 | 3; waiting?: boolean; convoy?: boolean; follow?: { offset: THREE.Vector3 } };
  /** A ship stranded by a drive failure (a rescue): adrift until the player hands over the parts. */
  stranded?: { jobId: string; handed: boolean; told: boolean; restartAt?: number };
  /** A site marked in flight it belongs to (docs/PROCGEN.md §31): its ship in distress, a guard, or a raider that lay dark by it. */
  site?: string;
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
  /** Ships the player escorts in this system: they set off alongside the player (a convoy, several). */
  escorts?: readonly EscortSetup[];
  /** Wrecks the player's recovery contracts send them to in this system. */
  wrecks?: readonly { jobId: string; locationId: string; item: string; guard: 1 | 2 | 3 | null }[];
  /** Ships stranded far from any dock that the player's rescues send them to here. */
  rescues?: readonly { jobId: string; name: string; model: string; commodity: CommodityId; qty: number; guard: 1 | 2 | 3 | null; beltId?: string }[];
  /** Stands in a belt the player's jobs want here (docs/PROCGEN.md §40.3). */
  stands?: readonly StandSetup[];
  /** Pyre's lifeboats, once Pyre has warned (docs/PROCGEN.md §42.4). */
  lifeboats?: readonly LifeboatSetup[];
  /** Den assaults under way here: the den, its turrets still standing, and whose wing flies with the player. */
  assaults?: readonly { jobId: string; locationId: string; turretsLeft: number; wing?: FactionId | null }[];
  /** Wingmen on the player's pay: they fly alongside wherever the player goes. */
  crew?: readonly { id: string; name: string; model: string; skill: 'steady' | 'sharp'; ally?: string; grade?: 1 | 2 | 3 | 4; hurt?: boolean }[];
  /** The wing's order carried from the last flight (docs/PROCGEN.md §34). */
  wingOrder?: WingOrder;
  /** Border battles due here while the pilot is in this system (docs/PROCGEN.md §35). */
  battles?: readonly BattlePlan[];
  /** What the player left here last time (docs/PROCGEN.md §17): packs still hunting, pods adrift. */
  lingering?: Pick<Lingering, 'packs' | 'pods'>;
  /** Den defences under way here: the den, the sweep ships still to destroy, and whose sweep it is (the Authority's unless said). */
  defences?: readonly { jobId: string; locationId: string; count: number; faction?: 'sta' | 'frontier' }[];
  /** Raider dens here that are knocked out (wrecked, silent and closed). */
  downDens?: readonly string[];
  /** Sights the player's sightseers want to see here (docs/PROCGEN.md §23): the tour, and the sight's target in the scene. */
  sights?: readonly { jobId: string; targetId: string }[];
  /** A rival's feud (docs/PROCGEN.md §28): customs tipped off here, so a patrol in range scans the player for sure. */
  tipped?: boolean;
  /** Hired guns a rival sends for the player here (§28): when they strike, how many, and whether the rival (a bounty hunter) flies with them. */
  rivalAmbush?: { rivalId: string; delay: number; guns: number; withRival: boolean; level: 1 | 2 | 3 };
  /** A rival waiting off the jump beacon for a duel (§28), and whether it has started. */
  duel?: { jobId: string; rivalId: string; started: boolean };
  /** The player's outpost here (docs/PROCGEN.md §29): its stage, its turrets up, its guards on post, and a raid due. */
  outpost?: { locationId: string; stage: number; turrets: number; guards: readonly OutpostGuardSetup[]; raid?: OutpostRaidSetup };
  /** Sites the pilot has marked here (docs/PROCGEN.md §31): wrecks, derelicts, ships and pods to fly to. */
  sites?: readonly SiteSetup[];
  /** A race the pilot has entered here (docs/PROCGEN.md §33): its course, heat and field. */
  race?: RaceSetup;
}

/** A guard hired for the player's outpost (docs/PROCGEN.md §29): on post from `from` until `until` (the game clock). */
export interface OutpostGuardSetup {
  id: string;
  name: string;
  model: string;
  skill: 'steady' | 'sharp';
  from: number;
  until: number;
}

/** A raid due on the player's outpost (docs/PROCGEN.md §29): its window, when it strikes, its threat and ships. */
export interface OutpostRaidSetup {
  window: number;
  at: number;
  threat: 1 | 2 | 3;
  ships: number;
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
  /** Salvaged equipment in a crate (a catalogue gear id). */
  gear?: string;
  /** The item of a recovery contract (its job id). */
  recover?: string;
  /** One of a marked site's pods (docs/PROCGEN.md §31): its site and index. */
  site?: { id: string; index: number };
  life: number;
  target: Target;
}

/** A site marked in flight (docs/PROCGEN.md §31) as this scene has it. */
interface SiteHere {
  setup: SiteSetup;
  centre: THREE.Vector3;
  /** The hull drawn (a wreck, a derelict, a decoy); a ship in distress is an NPC and pods have none. */
  hull: ShipArt | null;
  spin: THREE.Vector3;
  /** Its marker: the hull's, the ship's, or the spot its pods drift round. */
  target: Target;
  /** Its guards' pack. */
  guardPack: number | null;
  /** Its radio heard; scanned this flight; finished with. */
  near: boolean;
  scanned: boolean;
  ended: boolean;
}

/** A proximity mine (docs/PROCGEN.md §15). */
interface Mine {
  art: ReturnType<typeof createMineArt>;
  position: THREE.Vector3;
  armIn: number;
  life: number;
  hull: number;
  target: Target;
}

/** A decoy flare burning behind the player: seekers it fools chase it instead. */
interface Decoy {
  art: ReturnType<typeof createFlareArt>;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  target: MissileTarget;
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
/** Far stars' targets sit this far from the camera, in their direction (docs/PROCGEN.md §25). */
const SKY_TARGET_DISTANCE = 800_000;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const HOSTILE_RADIUS = 3_500;
/** An escorted ship holds position while the player is further away than this, and jumps with them only within it. */
const ESCORT_WAIT = CONTRACTS.escort.keepUpM;
/** A wingman or an escorted ship left this far behind (a lane, a long cruise) catches up. */
const CATCH_UP = WING.catchUp;
/** Coming this close to a stranded ship hands the parts over. */
const RESCUE_RANGE = 400;
/** Patrols go after a pilot their faction hunts within this range. */
const PATROL_HUNT = 6_000;
const CONVERGENCE = 700;
const EXOPLANET_IDS = new Set(EXOPLANETS.planets.map((p) => p.id));
/** Hollow Wake raiders fly Wake Salvage light fighters. */
const RAIDER_MODEL_ID = 'ship.light-fighter.1.wake';
/** Nose-to-tail length the chase camera offset was tuned for. */
const CHASE_REFERENCE_LENGTH = 14;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Whether a bolt may hit a ship: ships of the other side only (no friendly fire among lawful ships
 * or among raiders), and the player's bolts hit a lawful ship only when it is the selected target
 * or it is attacking the player, so attacking one is always a choice (docs/PROCGEN.md §12).
 */
export function boltMayHit(shooter: 'player' | 'lawful' | 'raider', target: 'lawful' | 'raider', selected: boolean, attackingPlayer = false): boolean {
  if (shooter === 'player') return target === 'raider' || selected || attackingPlayer;
  return target !== shooter;
}

/** Bolt look for a player gun: pulse cannons brighten from class 3 up. */
function boltKind(type: DamageType, tier: number): ProjectileKind {
  if (type === 'kinetic') return 'player-kinetic';
  if (type === 'plasma') return 'player-plasma';
  if (type === 'ion') return 'player-ion';
  return tier >= 3 ? 'player-pulse-mk2' : 'player-pulse';
}

/** Targets whose distance is shown to their surface rather than their centre (a belt's is to its band of rock). */
function surfaced(kind: Target['kind']): boolean {
  return kind === 'planet' || kind === 'star' || kind === 'rock' || kind === 'hole' || kind === 'wreck' || kind === 'comet' || kind === 'asteroid' || kind === 'craft';
}

/** A site's words with its ship and body filled in. */
function fillSite(text: string, s: SiteSetup): string {
  return text.replace('{ship}', s.ship).replace('{body}', s.bodyName ?? '');
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
  /** The far stars in this system's sky (docs/PROCGEN.md §25), and their targets once their death is under way or wanted. */
  private readonly farSky: FarStarsArt;
  private readonly skyStars: { id: string; dir: THREE.Vector3; base: string; target: Target }[] = [];
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
  private trafficTimers = { haulCheck: 0, pack: 0, patrolsLaunched: false, populated: false, contractsSpawned: false, huntersSpawned: false, serial: 0 };
  /** Hauls of the timetable already brought into this scene (or gone from it). */
  private readonly haulsHere = new Set<string>();
  /** The player's own haulers' legs already brought into this scene (or gone from it). */
  private readonly captainsHere = new Set<string>();
  /** Raiders the player has destroyed in this scene (a hauler that called for help counts the ones after its call). */
  private raidersDowned = 0;
  /** The raider dens take this pilot in (the Wake trusts them), checked live. */
  private get denOpen(): boolean {
    return wakeFriendly(this.state);
  }
  /** Station targets of raider dens, shown friendly or hostile as the Wake's trust changes. */
  private readonly denTargets: Target[] = [];
  private reactorWarned = -99;
  /** Screen-edge flashes after hits (0–1, fading). */
  private hullFlash = 0;
  /** In the black hole's tidal zone (docs/PROCGEN.md §26), warned once on the way in. */
  private inTides = false;
  /** Caught by Pyre's explosion: the game has been told. */
  private pyreCaught = false;
  /** A hail on the lanes waiting for an answer (docs/PROCGEN.md §27): its words, and seconds left. */
  private hail: { offer: LaneOffer; left: number; held: boolean; from: string; text: string } | null = null;
  /** The Wake's toll is paid here: its packs let the ship be until it docks, jumps or fires on them. */
  private tollPaid = false;
  /** How this flight began: a hail waits a little longer after a launch than after an arrival. */
  private spawnKind: SpawnSpec['kind'] = 'arrival';
  /** Whether lane encounters hail in this flight. */
  private lanesOn: boolean;
  private shieldFlash = 0;
  /** Mines drifting in the system, and decoy flares burning behind the player. */
  private readonly mines: Mine[] = [];
  private readonly decoys: Decoy[] = [];
  private decoyCooldown = 0;
  /** The player as a seeker's target (live position and velocity). */
  private readonly playerMissileTarget: MissileTarget;
  /** The ship's flight, gun rates and shield as fitted, before damage to its systems. */
  private readonly baseFlight: ShipParams;
  private readonly baseGunRates: number[] = [];
  private readonly baseGunDamage: number[] = [];
  private readonly baseShield: { regen: number; capacity: number };
  /** What the crew aboard do for the ship now (docs/PROCGEN.md §30.2), the luck of their hurts, and the engineer at work. */
  private crewNow: CrewEffects;
  private readonly crewRand: () => number;
  private crewTick = 0;
  private crewMending = false;
  /** A flare in this system (docs/PROCGEN.md §43.3): the one under way (undefined before the first look), what it does, and when to look again. */
  private flare: Flare | null | undefined = undefined;
  private flareFx: { shields: number; scanner: number } = { shields: 1, scanner: 1 };
  private flareTick = 0;
  /** Session time of the last chatter line (rate limit), and dens whose defences are awake. */
  private chatterAt = -99;
  /** The wing's standing order (docs/PROCGEN.md §16). */
  /** The wing's orders (docs/PROCGEN.md §34). */
  private readonly wing: WingCommand;
  private readonly borderBattle: BorderBattle;
  private readonly denAlerted = new Set<string>();
  private lootSerial = 0;
  /** Raider dens knocked out (before this flight or during it): wrecked, silent, closed. */
  private readonly downDens = new Set<string>();
  /** Den defences under way: the sweep ships still to come, wave by wave. */
  private readonly sweeps: { jobId: string; locationId: string; waves: number[]; next: number; t: number; faction: 'sta' | 'frontier' }[] = [];
  /** Convoys under way: when each ambush comes (fractions of the route) and how many have come. */
  private readonly convoys = new Map<string, { waves: number[]; next: number; level: 1 | 2 | 3; name: string }>();
  /** The player came through the jump beacon (not out of a dock): raiders may be waiting there for an escort. */
  private arrived = false;
  /** Ambushes waiting at the beacon for escorted ships that came through it, and when they strike. */
  private readonly beaconAmbushes: { jobId: string; level: 1 | 2 | 3; name: string; at: number }[] = [];
  /** A patrol's cargo scan under way, and whether one has run this session. */
  private scan: { npc: NpcShip; t: number } | null = null;
  private scanned = false;
  /** The belts and their minable rocks (docs/PROCGEN.md §19), the mining beam, and the pack hunting the miner. */
  private readonly mining: MiningField;
  private readonly beamArt: MiningBeamArt;
  private beam: { rockId: string; cut: number; pods: number; soundIn: number; sparkIn: number; huntIn: number } | null = null;
  /** Sites marked in flight (docs/PROCGEN.md §31), and a derelict being boarded (seconds left). */
  private readonly sites: SiteHere[] = [];
  private sitesSpawned = false;
  private boarding: { id: string; left: number } | null = null;
  private minerPack: number | null = null;
  private holdFullSaid = false;
  /** A race the pilot has entered here (docs/PROCGEN.md §33), and when a sealed control was last said. */
  private race: RaceRun | null = null;
  private readonly sealedAt = new Map<string, number>();
  private readonly raceFrom = new THREE.Vector3();

  constructor(opts: {
    system: SystemScene;
    camera: THREE.PerspectiveCamera;
    state: GameState;
    settings: Settings;
    ctx: ArtContext;
    audio: AudioEngine;
    callbacks: FlightCallbacks;
    traffic?: TrafficSetup | null;
    /** What has been cut from rocks, kept between flights (never saved). */
    minedRocks?: MiningLedger;
    /** Whether lane encounters hail (docs/PROCGEN.md §27); browser tests turn them on only when they want them. */
    lanes?: boolean;
  }) {
    this.lanesOn = opts.lanes ?? true;
    this.wing = new WingCommand(opts.traffic?.wingOrder);
    this.borderBattle = new BorderBattle(opts.traffic?.battles ?? [], opts.state.clock);
    this.system = opts.system;
    this.camera = opts.camera;
    this.state = opts.state;
    this.settings = opts.settings;
    this.ctx = opts.ctx;
    this.audio = opts.audio;
    this.callbacks = opts.callbacks;
    this.traffic = opts.traffic ?? null;
    this.trafficTimers.pack = this.traffic?.plan.packs?.firstDelay ?? 0;
    // Dens show as friendly places to a pilot the Wake trusts.
    for (const id of this.traffic?.downDens ?? []) this.downDens.add(id);
    for (const t of this.system.targets) {
      if (t.kind === 'station' && t.locationId && getLocation(t.locationId).stationType === 'pirate-den') this.denTargets.push(t);
    }
    this.refreshDenTargets();
    // The far stars, in their true direction from this system (fiction: how they die).
    // Pyre, the invented star, is in every sky but its own (docs/PROCGEN.md §26).
    const pyreInSky = !isInventedSystem(opts.state.location.systemId);
    this.farSky = createFarStars(FAR_STARS.stars.length + (pyreInSky ? 1 : 0), opts.ctx);
    this.system.scene.add(this.farSky.object);
    for (const f of FAR_STARS.stars) {
      const dir = new THREE.Vector3(...skyDirection(opts.state.location.systemId, f.id));
      const base = `${f.spectralType} · ${Math.round(f.distanceLightYears).toLocaleString('en-GB')} ly`;
      this.skyStars.push({
        id: f.id,
        dir,
        base,
        target: {
          id: `sky:${f.id}`,
          name: f.name,
          kind: 'sky',
          position: new THREE.Vector3(),
          radius: 0,
          subtitle: base,
          dataClass: 'observed',
          distanceLabel: `${Math.round(f.distanceLightYears).toLocaleString('en-GB')} ly`,
          alive: false,
          cycle: false,
        },
      });
    }
    if (pyreInSky) {
      const ly = `${Math.round(lyFromPyre(opts.state.location.systemId)).toLocaleString('en-GB')} ly`;
      const base = `Invented red supergiant · ${ly}`;
      this.skyStars.push({
        id: PYRE_ID,
        dir: new THREE.Vector3(...skyDirectionTo(opts.state.location.systemId, PYRE_SYSTEM.positionLy)),
        base,
        target: { id: `sky:${PYRE_ID}`, name: PYRE_SYSTEM.displayName, kind: 'sky', position: new THREE.Vector3(), radius: 0, subtitle: base, dataClass: 'fictional', distanceLabel: ly, alive: false, cycle: false },
      });
    }
    this.updateSky();
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
    // Damage to the ship's systems scales these (docs/PROCGEN.md §15).
    this.baseFlight = { ...this.player.params };
    for (const g of this.guns) this.baseGunRates.push(g.profile.shotsPerSecond);
    for (const g of this.guns) this.baseGunDamage.push(g.profile.damage);
    this.baseShield = { regen: this.playerDurability.shieldRegen, capacity: this.playerDurability.shieldMax };
    // The crew's own luck, so a flight without them draws as it always did.
    this.crewNow = crewEffects(opts.state);
    this.crewRand = seededRandom(hashString(`crew-hurt|${opts.state.seed}|${Math.floor(opts.state.clock)}|${opts.state.stats.jumps}`));
    this.playerMissileTarget = { id: PLAYER_ID, position: this.player.position, velocity: this.player.velocity, radius: Math.max(6, art.radius), alive: true };
    this.applySystems();
    this.projectileRenderer = createProjectileRenderer(320, opts.ctx);
    this.system.scene.add(this.projectileRenderer.object);
    // Rocks keep clear of stations (the Eridani Mining Hub sits in its belt), planets and stars.
    const clear = MINING.rocks.clearance;
    this.mining = new MiningField(this.system.scene, this.system.def.belts, opts.ctx, opts.minedRocks, [
      ...this.system.docks.map((d) => ({ center: d.def.position, radius: d.radius + clear })),
      ...this.system.planets.map((p) => ({ center: p.def.position, radius: p.def.radius + clear })),
      ...this.system.stars.map((s) => ({ center: s.def.position, radius: s.def.radius * 1.3 + clear })),
    ]);
    this.beamArt = createMiningBeam(opts.ctx);
    this.system.scene.add(this.beamArt.object);
    this.streaks = createSpeedStreaks(opts.ctx);
    this.camera.add(this.streaks.object);
    if (!this.camera.parent) this.system.scene.add(this.camera);
    else if (this.camera.parent !== this.system.scene) this.system.scene.add(this.camera);
    this.stageRace(this.traffic?.race ?? null);
  }

  /** A race entered here: its gates and racers in the scene, round its body where the scene has it. */
  private stageRace(setup: RaceSetup | null): void {
    const line = setup ? courseById(setup.courseId)?.line : undefined;
    const origin = line ? bodyPosition(this.system.def, line.bodyId) : null;
    if (!setup || !line || !origin) return;
    const bodies = [
      ...this.system.def.planets.map((p) => ({ centre: p.position, radius: p.radius })),
      ...this.system.def.stars.map((st) => ({ centre: st.position, radius: st.radius * 1.3 })),
    ];
    this.race = new RaceRun(setup, placedLine(this.system.def, line), origin.clone(), this.system.scene, this.ctx, bodies);
  }

  /** Under way: what a race seals, said at most every few seconds. */
  private sealed(text: string): void {
    if (this.time - (this.sealedAt.get(text) ?? -99) < 3) return;
    this.sealedAt.set(text, this.time);
    this.callbacks.onMessage(text, 'info');
    this.sfx('ui-error');
  }

  // ---------------------------------------------------------------- setup

  start(spawn: SpawnSpec): void {
    this.spawnKind = spawn.kind;
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
      this.arrived = true;
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
    // The belts' nearest points, and any rocks already near the player (the Eridani hub is in its belt).
    this.mining.update(0, p.position, this.state.clock, this.camera);
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
    const race = this.race?.objectiveId();
    if (race) return race;
    const id = this.objective.targetId;
    // Pyre's lifeboats (docs/PROCGEN.md §42.4): the nearest still out.
    if (id?.startsWith('lifeboat:')) {
      const near = this.nearestLifeboat(id);
      if (near) return near.target.id;
    }
    if (id && (this.loot.some((l) => l.target.id === id) || this.mining.find(id) || this.npcs.some((n) => n.target.id === id && n.target.alive) || ((id.startsWith('star:') || id.startsWith('sky:') || id.startsWith('site:')) && this.findTarget(id)))) return id;
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

  /**
   * Raiders hostile to the player nearby (they block docking and jumping). Raiders that spare a
   * pilot the Wake trusts do not count, and nor do lawful patrols hunting the player: a hunted
   * pilot can always dock at one of their stations to give themselves up and pay.
   */
  hostilesNearby(radius = HOSTILE_RADIUS): boolean {
    return this.npcs.some(
      (n) => n.side === 'raider' && n.durability.hull > 0 && !this.raiderSparesPlayer(n) && n.body.position.distanceTo(this.player.position) < radius && n.brain.state !== 'escaped',
    );
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
    for (const m of this.mines) if (m.target.alive) list.push(m.target);
    for (const t of this.mining.targets()) if (t.alive) list.push(t);
    for (const s of this.skyStars) if (s.target.alive) list.push(s.target);
    for (const s of this.sites) if (s.target.alive && !this.npcs.some((n) => n.target === s.target)) list.push(s.target);
    if (this.race) for (const t of this.race.targets(this.viewport.width < 600, this.player.position)) if (t.alive) list.push(t);
    for (const t of this.borderBattle.targets()) list.push(t);
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
    for (const s of this.skyStars) if (s.target.id === id && s.target.alive) return s.target;
    for (const l of this.loot) if (l.target.id === id && l.target.alive) return l.target;
    for (const d of this.drones) if (d.target.id === id && d.target.alive) return d.target;
    for (const s of this.sites) if (s.target.id === id && s.target.alive) return s.target;
    if (this.race) for (const t of this.race.allTargets()) if (t.id === id && t.alive) return t;
    for (const t of this.borderBattle.targets()) if (t.id === id) return t;
    return this.mining.find(id);
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
        if (this.race?.sealedCruise && this.player.cruise === 'off') {
          this.sealed(RACE_LINES.sealedCruise);
          return;
        }
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
        if (t?.kind === 'sky') this.callbacks.onMessage(`${t.name} is ${t.distanceLabel ?? 'light-years'} away: observe it from where you are.`, 'info');
        else if (t) this.beginGoTo(t.id, t.kind === 'station');
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
      case 'decoy':
        this.launchDecoy();
        break;
      case 'mine':
        this.toggleMining();
        break;
      case 'wing-order':
        // The order card (docs/PROCGEN.md §34): the game opens it, paused.
        if (this.npcs.some((x) => x.wingman && x.durability.hull > 0)) this.callbacks.onWingOrders?.();
        else this.callbacks.onMessage(ORDER_LOCKS.nobody, 'info');
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
      case 'answer':
        this.answerHail();
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
    const race = this.race?.objectiveId();
    if (race) return this.findTarget(race);
    const { locationId, bodyId, targetId } = this.objective;
    if (locationId) return this.findTarget(`station:${locationId}`);
    if (bodyId) return this.findTarget(`planet:${bodyId}`);
    // A claim sends the player to a belt; a rescue to a stranded ship; a tour to a dwarf star (docs/PROCGEN.md §23).
    if (targetId?.startsWith('star:') || targetId?.startsWith('site:')) return this.findTarget(targetId);
    return targetId ? (this.mining.find(targetId) ?? this.npcs.find((n) => n.target.id === targetId && n.target.alive)?.target ?? null) : null;
  }

  private nearestDock(): { site: DockSite; distance: number } | null {
    let best: { site: DockSite; distance: number } | null = null;
    for (const site of this.system.docks) {
      if (!this.canDock(site)) continue;
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
    if (this.race?.closed) return null;
    const sel = this.selectedTarget;
    if (sel?.kind === 'station' && sel.locationId) {
      const site = this.system.dock(sel.locationId);
      if (site && this.canDock(site) && site.def.position.distanceTo(this.player.position) < DOCK_RANGE) return site;
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
    // A race (docs/PROCGEN.md §33.4): Start in the box; under way, only Retire when held still.
    if (this.race?.canStart()) return { label: RACE_LINES.start, action: 'interact', icon: 'play' };
    if (this.race?.closed) return this.race.canRetire() ? { label: RACE_LINES.retire, action: 'interact', icon: 'close' } : null;
    const sel = this.selectedTarget;
    // The selected rock in the beam's reach: mining comes first (docs/PROCGEN.md §19).
    if (this.beam) return { label: 'Stop mining', action: 'mine', icon: 'mine' };
    if (this.miningReady()) return { label: 'Mine', action: 'mine', icon: 'mine' };
    // Alongside a derelict, slow, nobody hostile near: board it; while boarding, stop (docs/PROCGEN.md §31.4).
    if (this.boarding) return { label: 'Stop', action: 'cancel-autopilot', icon: 'close' };
    if (this.boardable()) return { label: 'Board', action: 'interact', icon: 'dock' };
    // A ranked pilot is cleared in at their faction's own docks even with raiders near (docs/PROCGEN.md §32.3).
    const dock = this.dockCandidate();
    if (dock && (!this.hostilesNearby(2_200) || coveredAt(this.state, dock.def.locationId))) {
      return { label: 'Dock', action: 'interact', icon: 'dock' };
    }
    const lane = this.nearestLaneEntrance();
    if (lane && lane.distance < LANE_ENTER_RANGE) return { label: 'Enter lane', action: 'interact', icon: 'cruise' };
    // A hail on the lanes (docs/PROCGEN.md §27) waits for an answer.
    if (this.hail && !this.hail.held) return { label: 'Answer', action: 'answer', icon: 'info' };
    // A far star is observed from wherever the ship is, when a contract wants it now; it is never flown to.
    if (sel?.kind === 'sky') return observationsWanted(this.state, sel.id.slice('sky:'.length)).length ? { label: 'Observe', action: 'scan', icon: 'scan' } : null;
    if (sel && (sel.kind === 'planet' || sel.kind === 'star' || sel.kind === 'hole' || sel.kind === 'comet' || sel.kind === 'asteroid' || sel.kind === 'craft') && sel.position.distanceTo(this.player.position) < this.scanRangeFor(sel) * 3) {
      return { label: 'Scan', action: 'scan', icon: 'scan' };
    }
    // A site in scan range not yet scanned this flight, or a wreck whose log is unread.
    const site = sel ? this.siteOf(sel.id) : null;
    if (site && (!site.scanned || (site.setup.kind === 'wreck' && !site.setup.read)) && this.siteDistance(site) <= WRECKS.scanRange * this.scanner()) return { label: 'Scan', action: 'scan', icon: 'scan' };
    // A rock in scan range that has not been read; a belt once the ship is at it (Go to comes first).
    if (sel && this.canScanMining(sel) && (sel.kind === 'rock' || this.surfaceDistance(sel) < 1_500)) return { label: 'Scan', action: 'scan', icon: 'scan' };
    const goal = sel ?? this.objectiveTarget();
    const headingTo = this.autopilotTargetId();
    const far = !goal ? false : goal.kind === 'rock' ? this.surfaceDistance(goal) > MINING.range : goal.kind === 'belt' ? this.surfaceDistance(goal) > 1_500 : goal.position.distanceTo(this.player.position) > 1_500;
    if (goal && goal.kind !== 'sky' && far && goal.id !== headingTo) {
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
    if (this.race?.canStart()) {
      this.race.start();
      this.callbacks.onRace?.({ kind: 'count', n: 3 });
      return;
    }
    if (this.race?.canRetire()) {
      this.race.phase = 'done';
      this.callbacks.onRace?.({ kind: 'retired', field: this.race.field() });
      return;
    }
    if (this.race?.closed) return;
    const derelict = this.boardable();
    if (derelict) {
      this.startBoarding(derelict);
      return;
    }
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
    if (sel && sel.kind !== 'sky') this.beginGoTo(sel.id, sel.kind === 'station');
  }

  private beginDock(site: DockSite): void {
    if (this.race?.closed) {
      this.sealed(RACE_LINES.noDock);
      return;
    }
    if (this.hostilesNearby(2_200)) {
      // Their own ranks are cleared in under fire (docs/PROCGEN.md §32.3).
      const cover = coverLine(this.state, site.def.locationId);
      if (!cover) {
        this.callbacks.onMessage('Docking refused: hostile contact nearby.', 'bad');
        this.sfx('ui-error');
        return;
      }
      this.callbacks.onComm?.(cover.speaker, cover.text);
    }
    // Pyre's observatory is evacuated at its collapse; its remnant station opens late (docs/PROCGEN.md §26).
    const shut = pyreDockRefusal(site.def.locationId, this.state.clock);
    if (shut) {
      this.callbacks.onMessage(`Docking refused: ${shut}`, 'bad');
      this.sfx('ui-error');
      return;
    }
    this.player.requestCruise(false);
    this.drift = false;
    this.autopilot = { mode: 'dock', site, phase: 'approach', t: 0, from: new THREE.Vector3(), fromQ: new THREE.Quaternion() };
    this.callbacks.onMessage(`Docking with ${site.name}…`, 'info');
  }

  private beginLane(lane: LaneRuntime, reverse: boolean, next: Autopilot | null): void {
    if (this.race?.closed) {
      this.sealed(RACE_LINES.ownWay);
      return;
    }
    this.player.requestCruise(false);
    this.drift = false;
    this.autopilot = { mode: 'lane', lane, reverse, phase: 'align', t: 0, s: 0, speed: 0, next };
  }

  /** Plans a route to a target, using a trade lane when it saves time, then flies it. */
  beginGoTo(targetId: string, dockAtEnd: boolean): void {
    if (this.race?.closed) {
      this.sealed(RACE_LINES.ownWay);
      return;
    }
    const target = this.findTarget(targetId);
    // A far star is light-years off: it is observed, never flown to.
    if (!target || target.kind === 'sky') return;
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
    const scanner = this.scanner();
    if (t.kind === 'planet') {
      const def = this.system.planets.find((p) => p.def.id === t.bodyId)?.def;
      return (def?.scanRange ?? DEFAULT_SCAN_RANGE) * scanner;
    }
    if (t.kind === 'star') return Math.max(20_000, t.radius * 6) * scanner;
    // A comet (docs/PROCGEN.md §45.3).
    if (t.kind === 'comet') return (this.system.comets.find((c) => c.id === t.bodyId)?.scanRange ?? DEFAULT_SCAN_RANGE) * scanner;
    // A named asteroid (§47.3).
    if (t.kind === 'asteroid') return (this.system.asteroids.find((a) => a.id === t.bodyId)?.scanRange ?? DEFAULT_SCAN_RANGE) * scanner;
    // A spacecraft (§49.3).
    if (t.kind === 'craft') return (this.system.craft.find((c) => c.id === t.bodyId)?.scanRange ?? DEFAULT_SCAN_RANGE) * scanner;
    // A black hole is read from outside its tides (docs/PROCGEN.md §26).
    if (t.kind === 'hole') return ((this.system.blackHole?.def.tidalRadius ?? 0) + 10_000) * scanner;
    return DEFAULT_SCAN_RANGE * scanner;
  }

  private manualScan(): void {
    const t = this.selectedTarget;
    if (t?.kind === 'sky') {
      this.sfx('scan');
      this.callbacks.onObserve?.(t.id.slice('sky:'.length));
      return;
    }
    if (t && (t.kind === 'belt' || t.kind === 'rock')) {
      this.scanMining(t);
      return;
    }
    const site = t ? this.siteOf(t.id) : null;
    if (site) {
      this.scanSite(site);
      return;
    }
    if (!t || (t.kind !== 'planet' && t.kind !== 'star' && t.kind !== 'hole' && t.kind !== 'comet' && t.kind !== 'asteroid' && t.kind !== 'craft')) {
      this.callbacks.onMessage('Select a planet, star, comet, asteroid, spacecraft, belt, rock or wreck to scan.', 'info');
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
    // A scan of a planet or star may pick up a faint return (docs/PROCGEN.md §31.3).
    if (t.kind !== 'hole' && t.kind !== 'comet' && t.kind !== 'asteroid' && t.kind !== 'craft') this.callbacks.onBodyScan?.();
  }

  private fireMissile(): void {
    if (this.race?.closed) {
      this.sealed(RACE_LINES.sealedGuns);
      return;
    }
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
    if (guided && (!t || !t.hostile || !npc || this.missileLockTime < this.lockTimeNeeded())) {
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
    const sys = this.state.ship.systems;
    const damaged = sys.engines + sys.guns + sys.shields > 0;
    if (d.hull >= d.hullMax && !damaged) {
      this.callbacks.onMessage('Hull and systems are already intact.', 'info');
      return;
    }
    this.state.ship.repairKits -= 1;
    d.hull = Math.min(d.hullMax, d.hull + REPAIR_KIT.restore);
    // A kit also patches up damaged systems.
    sys.engines = sys.guns = sys.shields = 0;
    this.applySystems();
    this.sfx('repair');
    this.callbacks.onMessage(`Repair kit used: +${REPAIR_KIT.restore} hull${damaged ? ', systems patched up' : ''}`, 'good');
  }

  // ---------------------------------------------------------------- update

  update(dt: number, input: FlightInput): void {
    this.time += dt;
    for (const a of input.actions) this.handleAction(a);
    if (input.selectAt) this.pickAt(input.selectAt.x, input.selectAt.y);

    if (this.alive) this.updatePlayerControls(dt, input);
    this.raceFrom.copy(this.player.position);
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
    this.updateDecoys(dt);
    this.updateMines(dt);
    this.updateLoot(dt);
    this.updateDrones(dt);
    this.mining.update(dt, this.player.position, this.state.clock, this.camera, this.beam?.rockId ?? null);
    if (this.alive) this.collide(this.player, this.playerDurability, true);
    if (this.race) for (const e of this.race.update(dt, this.raceFrom, this.player.position, this.player.speed, this.state.clock, this.camera, this.time)) this.callbacks.onRace?.(e);
    this.updateHole(dt);
    this.tickHail(dt);
    for (const n of this.npcs) if (!n.den) this.collide(n.body, n.durability, false);
    this.updateFlare(dt);
    regenerate(this.playerDurability, dt, this.flareFx.shields);
    for (const n of this.npcs) regenerate(n.durability, dt, this.flareFx.shields);
    this.updateCrew(dt);
    this.updateEncounters(dt);
    this.updateTraffic(dt);
    this.updateWing(dt);
    this.updateBattle();
    this.updateSites(dt);
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.5;
      this.autoScan();
      this.watchSights();
      this.updateSky();
      this.watchPyre();
      this.watchLanes();
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
    this.updateMining(dt);
    for (const n of this.npcs) {
      this.syncNpcArt(n);
      this.hurtSparks(n, dt);
    }
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
    this.camera.getWorldPosition(this.tmp2);
    for (const s of this.skyStars) s.target.position.copy(this.tmp2).addScaledVector(s.dir, SKY_TARGET_DISTANCE);
    this.farSky.update?.(dt, 0, this.camera);
    this.audio.setEngine(this.engineSound());
    this.audio.setCombatIntensity(this.activeEncounter || this.packEngaged() ? 1 : 0);
    // Hit flashes fade in under half a second.
    this.hullFlash = Math.max(0, this.hullFlash - dt * 2.5);
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3);
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
    if (this.boarding) this.breakBoarding('stopped');
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
    // The autopilot holds for a patrol's cargo scan: it never runs from one on the pilot's behalf.
    if (this.scan) {
      Object.assign(this.controls, neutralControls());
      this.player.requestCruise(false);
      return;
    }
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
    // Stop short of stations and ships, but fly right up to loot so the tractor beam reaches it,
    // within the mining beam's reach of a rock, and well inside a belt's band of rock.
    const standoff =
      target.kind === 'station'
        ? target.radius + 450
        : target.kind === 'loot'
          ? 40
          : target.id.startsWith('site:')
            ? target.radius + 120
          : target.kind === 'rock'
            ? target.radius + MINING.range * 0.4
            : target.kind === 'belt'
              ? target.radius * 0.5
              : target.kind === 'hole'
                ? (this.system.blackHole?.def.tidalRadius ?? target.radius) + 600
                : target.radius + 600;
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
        if (site && this.canDock(site)) this.beginDock(site);
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
    if (n.durability.hull <= 0 || n.den) return;
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
    if (this.race?.closed) {
      this.sealed(RACE_LINES.sealedGuns);
      return;
    }
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
    // The gunner locks on sooner (docs/PROCGEN.md §30.2).
    return l && l.stats.turnRate > 0 ? l.stats.lockTime * (1 - this.crewNow.lock) : 0;
  }

  // ---------------------------------------------------------------- projectiles, missiles, loot

  private updateProjectiles(dt: number): void {
    this.projectiles.update(dt, (p, from, to) => {
      const byPlayer = p.ownerId === PLAYER_ID;
      const owner = byPlayer ? null : this.npcs.find((n) => n.id === p.ownerId);
      const side = byPlayer ? 'lawful' : (owner?.side ?? 'raider');
      // Bolts hit ships of the other side only: no friendly fire among lawful ships or among raiders.
      // The player's bolts hit a lawful ship only when it is the selected target: attacking one is a choice.
      for (const n of this.npcs) {
        if (n.durability.hull <= 0 || !boltMayHit(byPlayer ? 'player' : side, n.side, n.target.id === this.selectedId, n.foe === 'player')) continue;
        // The player's own outpost's turrets, stores and guards are never in the line of fire (docs/PROCGEN.md §29).
        if (byPlayer && n.own) continue;
        if (segmentHitsSphere(from, to, n.body.position, n.art.radius)) {
          if (owner) n.lastHitBy = owner.id;
          this.damageNpc(n, p.damage, to, p.damageType, byPlayer);
          return true;
        }
      }
      // Bolts set mines off (anyone's but the raiders').
      if (side !== 'raider') {
        for (let i = 0; i < this.mines.length; i++) {
          const mine = this.mines[i]!;
          if (!segmentHitsSphere(from, to, mine.position, 8)) continue;
          mine.hull -= p.damage;
          if (mine.hull <= 0) this.detonateMine(i);
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
      } else if ((side === 'raider' || owner?.foe === 'player') && this.alive && segmentHitsSphere(from, to, this.player.position, this.playerArt.radius)) {
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
      const onPlayer = m.target === this.playerMissileTarget;
      if (onPlayer) m.target!.alive = this.alive;
      else if (m.target && !m.target.id.startsWith('decoy:')) m.target.alive = this.npcs.some((n) => n.id === m.target!.id && n.durability.hull > 0);
      let result = updateMissile(m, dt, m.maxSpeed, m.turnRate);
      // Unguided rounds hit whatever they fly into.
      let struck = m.target ? this.npcs.find((n) => n.id === m.target!.id) : undefined;
      if (!result && !m.target) {
        struck = this.npcs.find((n) => n.side === 'raider' && n.durability.hull > 0 && n.body.position.distanceTo(m.position) < n.art.radius + 5);
        if (struck) result = 'hit';
      }
      if (!result) continue;
      if (result === 'hit' && onPlayer) this.damagePlayer(m.damage, m.position.clone(), 'kinetic');
      else if (result === 'hit' && struck) this.damageNpc(struck, m.damage, m.position, undefined, m.ownerId === PLAYER_ID);
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
      // A pod of cargo that does not fit the hold stays adrift until there is room for it.
      const room = !l.cargo || itemsThatFit(this.state.ship.cargo, l.cargo.commodity, this.perf.cargo) > 0;
      if (this.alive && d < reach && room) {
        // Tractor beam pulls nearby loot in (fitted beams reach further).
        l.velocity.lerp(toPlayer.normalize().multiplyScalar(Math.min(160, 40 + (reach - d))), 1 - Math.exp(-3 * dt));
      } else {
        l.velocity.multiplyScalar(Math.exp(-0.3 * dt));
      }
      l.position.addScaledVector(l.velocity, dt);
      l.art.object.position.copy(l.position);
      if (this.alive && d < 30 && room) {
        if (l.site) this.callbacks.onSite?.(l.site.id, 'pod', { index: l.site.index });
        else if (l.recover) this.callbacks.onRecovered?.(l.recover);
        else this.callbacks.onLoot(l.value, l.cargo, l.gear);
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

  private spawnLoot(
    position: THREE.Vector3,
    value: number,
    extra: { cargo?: { commodity: CommodityId; qty: number }; recover?: { jobId: string; item: string }; gear?: string; site?: { id: string; index: number; name: string; subtitle: string } } = {},
  ): void {
    const art = createCargoPod(this.ctx);
    const pos = position.clone();
    art.object.position.copy(pos);
    this.system.scene.add(art.object);
    const id = extra.site ? `site:${extra.site.id}:${extra.site.index}` : extra.recover ? `wreck:${extra.recover.jobId}` : `loot:${Math.floor(this.time * 1000)}-${this.loot.length}`;
    const cargo = extra.cargo;
    // A recovery's item and a site's pods wait where they are, for as long as it takes.
    const still = !!extra.recover || !!extra.site;
    this.loot.push({
      art,
      position: pos,
      velocity: still ? new THREE.Vector3() : new THREE.Vector3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(20),
      value,
      ...(cargo ? { cargo } : {}),
      ...(extra.gear ? { gear: extra.gear } : {}),
      ...(extra.recover ? { recover: extra.recover.jobId } : {}),
      ...(extra.site ? { site: { id: extra.site.id, index: extra.site.index } } : {}),
      life: still ? Infinity : 240,
      target: {
        id,
        name: extra.site ? extra.site.name : extra.recover ? `${extra.recover.item.charAt(0).toUpperCase()}${extra.recover.item.slice(1)}` : extra.gear ? 'Equipment crate' : cargo ? 'Cargo pod' : 'Salvage pod',
        kind: 'loot',
        position: pos,
        radius: 4,
        subtitle: extra.site
          ? extra.site.subtitle
          : extra.recover
          ? 'In the wreckage · fly close to tractor it in'
          : extra.gear
            ? `${getCatalog().gearById.get(extra.gear)?.name ?? 'Salvaged equipment'} · fly close to collect`
            : cargo
              ? `${cargo.qty} × ${COMMODITIES[cargo.commodity].name.toLowerCase()} · fly close to collect`
              : 'Salvaged components · fly close to collect',
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
    // Hull hits flash the screen's edges, and may damage a system.
    if (r.hullDamage > 0) {
      this.callbacks.onHullHit?.(r.hullDamage / Math.max(1, this.playerDurability.hullMax));
      this.hullFlash = Math.min(1, this.hullFlash + 0.35 + r.hullDamage / 40);
      if (!r.destroyed) this.maybeHitSystem(r.hullDamage);
      if (!r.destroyed && r.hullDamage >= this.playerDurability.hullMax * CREW.hurt.navigatorHit) this.maybeHurtCrew('navigator');
    } else this.shieldFlash = Math.min(1, this.shieldFlash + 0.3);
    this.spawnEffect(createImpactSpark(at.clone(), shieldHit ? '#7fd8ff' : '#ffb070', this.ctx));
    this.sfx(shieldHit ? 'player-hit-shield' : 'player-hit-hull', 0.8);
    this.chase.addShake(shieldHit ? 0.25 : 0.6);
    if (r.shieldBroke) {
      this.sfx('shield-down');
      this.callbacks.onMessage('Shields down!', 'bad');
    }
    if (this.player.cruise !== 'off') this.player.requestCruise(false);
    // In a duel the player yields before the ship is lost (docs/PROCGEN.md §28).
    const duel = this.duelist;
    if (duel?.duel?.state === 'on' && this.playerDurability.hull <= this.playerDurability.hullMax * RIVAL_STORY.enemy.duel.yieldAt) {
      this.playerDurability.hull = Math.max(1, this.playerDurability.hull);
      this.endDuel(duel, 'lost');
      return;
    }
    if (r.destroyed) this.destroyPlayer();
  }

  /**
   * Pyre's black hole (docs/PROCGEN.md §26): the gas falling into it fades with the clock; inside
   * the zone drawn for its tides they strain the hull, more the nearer the ship goes (as 1/r³), and
   * its shadow takes a ship whole. Shields are no help against tides.
   */
  private updateHole(dt: number): void {
    const b = this.system.blackHole;
    if (!b) return;
    b.glow = fallbackGlow(this.state.clock);
    if (!this.alive) return;
    const d = this.player.position.distanceTo(b.def.position);
    const strain = tidalStrain(d, b.def.tidalRadius);
    if (strain <= 0) {
      this.inTides = false;
      return;
    }
    if (!this.inTides) {
      this.inTides = true;
      this.callbacks.onMessage('Tidal zone: the black hole’s tides are straining the hull. Turn back.', 'bad');
      this.sfx('ui-error');
    }
    const loss = d <= b.def.shadow + this.player.params.radius ? Infinity : strain * dt;
    const hull = this.playerDurability;
    hull.hull = Math.max(0, hull.hull - loss);
    this.hullFlash = Math.min(1, this.hullFlash + Math.min(1, loss / 25));
    this.chase.addShake(Math.min(0.4, loss / 12));
    if (hull.hull <= 0) this.destroyPlayer();
  }

  // ---------------------------------------------------------------- lane encounters (docs/PROCGEN.md §27)

  /**
   * A hail on the lanes: met when flying quietly (not just launched or arrived, no hostiles near,
   * clear of the docks, no autopilot docking or lane, no scan), written into the save as it begins;
   * it waits for an answer while no hostiles are near, and lapses when its time runs out.
   */
  private watchLanes(): void {
    if (!this.lanesOn || this.hail) return;
    // A race is quiet: no hails while it waits or runs (docs/PROCGEN.md §33.4).
    if (this.race && this.race.phase !== 'done') return;
    if (!this.alive || this.busy || this.deathTimer >= 0 || this.scanStatus) return;
    if (this.time < (this.spawnKind === 'arrival' ? LANES.grace.afterArrival : LANES.grace.afterLaunch)) return;
    if (this.hostilesNearby(LANES.quiet.hostileRange)) return;
    if (this.system.docks.some((d) => d.def.position.distanceTo(this.player.position) < LANES.quiet.dockClear + d.radius)) return;
    const offer = laneOfferFor(this.state, this.state.location.systemId);
    if (!offer) return;
    stageLane(this.state, offer);
    const words = laneWords(this.state, offer);
    this.hail = { offer, left: LANES.hailSeconds, held: false, from: words.speaker, text: words.hail };
    this.sfx('alert');
    this.callbacks.onHail?.(offer);
  }

  /** A waiting hail's time runs while no hostiles are near; when it runs out, it lapses. */
  private tickHail(dt: number): void {
    const h = this.hail;
    if (!h) return;
    h.held = this.hostilesNearby(LANES.quiet.hostileRange);
    if (h.held) return;
    h.left -= dt;
    if (h.left > 0) return;
    this.hail = null;
    this.callbacks.onHailLapsed?.(h.offer);
  }

  /** The pilot answers the hail: the game shows its card. Not with hostiles near. */
  answerHail(): void {
    const h = this.hail;
    if (!h) return;
    if (h.held) {
      this.callbacks.onMessage('Not now: hostile contact.', 'bad');
      return;
    }
    this.callbacks.onAnswerHail?.(h.offer);
  }

  /** What came of a hail's answer, in the flight: it is over, raiders drop out of the dark, or the Wake lets the ship be. */
  laneOutcome(offerId: string, out: LaneOutcome | null): void {
    if (!out) return;
    if (this.hail?.offer.id === offerId) this.hail = null;
    if (out.ambush) this.spawnPack({ max: 1, level: out.ambush, size: [2, 3], firstDelay: 0, interval: [0, 0] }, true);
    if (out.pass) this.tollPaid = true;
  }

  /** Test-only: turns lane encounters on or off for this flight. */
  setLanes(on: boolean): void {
    this.lanesOn = on;
  }

  /** Test-only: the hail waiting, if any. */
  get hailState(): { id: string; kind: string; left: number; held: boolean } | null {
    const h = this.hail;
    return h ? { id: h.offer.id, kind: h.offer.kind, left: h.left, held: h.held } : null;
  }

  /** A ship still in Pyre's system when its light leaves (docs/PROCGEN.md §26) is carried out by the game, once. */
  private watchPyre(): void {
    if (this.pyreCaught || this.system.def.blackHole || this.system.def.systemId !== PYRE_ID) return;
    if (pyreStage(this.state.clock) !== 'gone') return;
    this.pyreCaught = true;
    this.autopilot = { mode: 'none' };
    this.callbacks.onPyreBreakout?.();
  }

  private destroyPlayer(): void {
    this.alive = false;
    if (this.race?.closed) {
      this.race.phase = 'done';
      this.callbacks.onRace?.({ kind: 'lost', field: this.race.field() });
    }
    this.autopilot = { mode: 'none' };
    this.playerArt.object.visible = false;
    this.spawnEffect(createExplosion(this.player.position.clone(), 10, this.ctx));
    this.sfx('explosion-large');
    this.chase.addShake(1.2);
    this.player.velocity.multiplyScalar(0.2);
    this.deathTimer = 0;
  }

  private damageNpc(n: NpcShip, amount: number, at: THREE.Vector3, type?: DamageType, byPlayer = false): void {
    // The pilot's supply and mining captains are safe from everyone's guns but the pilot's (docs/PROCGEN.md §37.3).
    if (n.captain?.safe && !byPlayer) return;
    if (byPlayer) n.playerHitAt = this.time;
    // A battle ship the pilot fires on treats them as an enemy for the rest of the battle (docs/PROCGEN.md §35.3).
    if (byPlayer && n.battle && !n.battle.over) n.battle.turned = true;
    // Firing on the Wake ends the toll's pass (docs/PROCGEN.md §27).
    if (byPlayer && n.side === 'raider') this.tollPaid = false;
    if (n.den?.part === 'reactor' && this.turretsStanding(n.den.locationId)) {
      // The reactor's shield holds while any turret stands.
      n.art.flashShield(1);
      if (byPlayer && this.time - this.reactorWarned > 6) {
        this.reactorWarned = this.time;
        this.callbacks.onMessage('The reactor is shielded while the den’s turrets stand. Take them out first.', 'info');
      }
      return;
    }
    // Firing back at a lawful ship that is attacking you is self-defence; destroying it is still a crime.
    if (byPlayer && n.side === 'lawful' && !n.crimeReported && n.role !== 'raider' && n.foe !== 'player' && !n.captain) {
      n.crimeReported = true;
      // A patrol fired on fights back at once; the law hears of it either way.
      if (n.role === 'patrol') n.foe = 'player';
      this.callbacks.onCrime?.('attack', n.faction, n.name, n.role);
    }
    // Fired on while waiting for the duel, it starts; in the duel, shots are fair (docs/PROCGEN.md §28).
    if (byPlayer && n.duel?.state === 'waiting') this.startDuel(n);
    if (byPlayer && n.rival && n.duel?.state !== 'on') this.callbacks.onRival?.(n.rival.id, 'shot');
    const r = applyDamage(n.durability, amount, type);
    const shieldHit = r.absorbedByShield > 0;
    n.art.flashShield(shieldHit ? 0.8 : 0.2);
    // Fights between other ships far away stay quiet and cheap.
    const near = byPlayer || at.distanceTo(this.player.position) < 2_500;
    if (near || at.distanceTo(this.player.position) < 8_000) this.spawnEffect(createImpactSpark(at.clone(), shieldHit ? '#7fd8ff' : '#ffb070', this.ctx));
    if (near) this.sfx(shieldHit ? 'hit-shield' : 'hit-hull', 0.55);
    // A duelist yields before its ship is lost.
    if (n.duel?.state === 'on' && n.durability.hull <= n.durability.hullMax * RIVAL_STORY.enemy.duel.yieldAt) {
      n.durability.hull = Math.max(1, n.durability.hull);
      this.endDuel(n, 'won');
      return;
    }
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
    if (n.stranded && !n.stranded.handed) this.callbacks.onRescueLost?.(n.stranded.jobId);
    else if (n.site && n.role === 'trader' && !this.sites.find((s) => s.setup.id === n.site)?.setup.reached) this.callbacks.onSite?.(n.site, 'lost');
    else if (n.haul) this.callbacks.onMessage(`The ${n.haul.haul.name} was destroyed, with ${n.haul.haul.qty} ${COMMODITIES[n.haul.haul.commodity].name.toLowerCase()} aboard.`, 'bad');
    else if (n.role === 'trader' && !n.captain && !n.rival) this.callbacks.onMessage(`${n.name} was destroyed.`, 'bad');
    if (n.side === 'raider' && !n.den && !n.hunter && !n.encounter && !n.rival && !n.hired) this.dropLoot(n);
    if (n.wingman?.crewId) {
      // Nobody on the wing is lost for good (docs/PROCGEN.md §34): an ally ejects home; a hired wingman is picked up.
      this.callbacks.onMessage(n.wingman.ally ? `${n.name}’s ship is gone; ${n.name} ejected.` : WING_RADIO.picked.replace('{name}', n.name), 'bad');
      this.callbacks.onWingmanLost?.(n.wingman.crewId);
    }
    if (n.side === 'raider') {
      const credits = this.wing.credit(n, n.lastHitBy, this.wingView());
      if (credits.length) this.callbacks.onWingFought?.(credits);
    }
    const killer = n.lastHitBy ? this.npcs.find((x) => x.id === n.lastHitBy) : undefined;
    // A battle ship down: the pilot's part if they or their wing downed one of the other side's (docs/PROCGEN.md §35).
    if (n.battle) this.borderBattle.downed(n, this.time - n.playerHitAt < 30 || !!killer?.wingman);
    if (killer?.wingman?.crewId && n.side === 'raider') this.chatter('wing-kill', killer.name);
    else if (n.side === 'raider' && !n.den && this.inRadioRange(n) && this.rand() < 0.35) this.chatter('raider-down', 'Wake raider');
    const byPlayer = this.time - n.playerHitAt < 30;
    if (n.side === 'raider' && byPlayer && !n.rival && !n.hired) this.raidersDowned++;
    // A scheduled hauler's hold spills a share of its real cargo (docs/PROCGEN.md §21), whoever destroyed
    // it; so does one of the player's own (§18.6), whose loss the game reckons first.
    const spill = n.haul ? { commodity: n.haul.haul.commodity, qty: n.haul.haul.qty } : n.captain ? { commodity: this.captainGood(n), qty: this.captainCargo(n) } : n.rival ? this.rivalSpill(n) : null;
    if (n.haul) this.callbacks.onHaul?.(n.haul.haul.id, 'lost', byPlayer ? 'player' : 'raiders');
    // An ally lost on the wing is told of as a wingman (docs/PROCGEN.md §28), unless the player shot them down.
    if (n.rival && (!n.wingman || byPlayer)) this.callbacks.onRival?.(n.rival.id, 'destroyed', { by: byPlayer ? 'player' : 'raiders' });
    if (n.captain) this.callbacks.onCaptain?.(n.captain.shipId, 'lost', byPlayer ? 'player' : 'raiders');
    if (spill) {
      const { share, pod } = HAULS.spill;
      let left = Math.round(spill.qty * share);
      while (left > 0) {
        const qty = Math.min(left, pod[0] + Math.floor(this.rand() * (pod[1] - pod[0] + 1)));
        left -= qty;
        this.spawnLoot(n.body.position.clone().add(this.tmp.set((this.rand() - 0.5) * 40, (this.rand() - 0.5) * 20, (this.rand() - 0.5) * 40)), 0, { cargo: { commodity: spill.commodity, qty } });
      }
    }
    if (byPlayer && n.side === 'lawful' && n.role !== 'raider' && !n.captain) {
      // Piracy: a hauler's hold spills a pod or two of its cargo (a scheduled hauler's, or a rival's, did above).
      if (n.role === 'trader' && !n.haul && !n.rival) {
        const goods: CommodityId[] = ['consumer-goods', 'electronics', 'machinery', 'medical', 'food', 'metals', 'polymers', 'luxuries'];
        for (let i = 0; i < 1 + Math.floor(this.rand() * 2); i++) {
          this.spawnLoot(n.body.position.clone().add(this.tmp.set((this.rand() - 0.5) * 40, (this.rand() - 0.5) * 20, (this.rand() - 0.5) * 40)), 0, {
            cargo: { commodity: goods[Math.floor(this.rand() * goods.length)]!, qty: 3 + Math.floor(this.rand() * 6) },
          });
        }
      }
      this.callbacks.onCrime?.('destroy', n.faction, n.name, n.role === 'patrol' ? 'patrol' : 'trader');
    }
    // The raid on the player's outpost (docs/PROCGEN.md §29): its raiders downed, its stores broken open.
    const raid = this.outpostRaid;
    if (raid?.state === 'on' && n.outpostRaid === raid.setup.window) raid.downed++;
    if (raid?.state === 'on' && n.own?.kind === 'stores') this.endOutpostRaid('lost');
    if (n.den?.part === 'reactor') this.knockOutDen(n);
    else if (n.contract) this.callbacks.onContractKill(n.contract);
    else if (n.hunter) {
      if (byPlayer) this.callbacks.onHunterDown?.();
    } else if (n.side === 'raider' && !n.encounter && !n.rival && !n.hired && byPlayer) this.callbacks.onBounty(n.bounty, n.name);
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
    for (const x of this.npcs) {
      if (x.foe === n) x.foe = null;
      // A ship that docked or jumped out is no one's prey any more.
      if (x.prey === n) delete x.prey;
    }
    if (this.selectedId === n.target.id) this.selectedId = null;
    n.target.alive = false;
    this.system.scene.remove(n.art.object);
    n.art.dispose();
    // A mining captain's rock and beam go with its ship (docs/PROCGEN.md §37.4).
    for (const art of [n.miner?.rock, n.miner?.beam]) {
      if (!art) continue;
      this.system.scene.remove(art.object);
      art.dispose();
    }
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
    for (const rock of this.mining.rocksNear(body.position, 260)) bump(rock.position, rock.spec.radius * 0.95, true);
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
      modelId: RAIDER_MODEL_ID,
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
    // The timetable's haulers: those flying here now when the scene starts, then each as its leg here begins.
    timers.haulCheck -= dt;
    if (timers.haulCheck <= 0) {
      timers.haulCheck = 2;
      this.updateHauls(plan.traders, !timers.populated);
      this.updateCaptains(!timers.populated);
      this.updateMiners(!timers.populated);
      this.updateRivals(!timers.populated);
      timers.populated = true;
    }
    if (!timers.contractsSpawned && this.time > 2) {
      timers.contractsSpawned = true;
      for (const c of t.contractPacks ?? []) this.spawnContractPack(c);
      for (const e of t.escorts ?? []) this.spawnEscort(e);
      for (const w of t.wrecks ?? []) this.spawnWreck(w);
      for (const rescue of t.rescues ?? []) this.spawnStranded(rescue);
      for (const p of t.lingering?.packs ?? []) this.spawnLingeringPack(p);
      for (const pod of t.lingering?.pods ?? []) this.spawnLoot(new THREE.Vector3(...pod.position), pod.value, { ...(pod.cargo ? { cargo: pod.cargo } : {}), ...(pod.gear ? { gear: pod.gear } : {}) });
      if (t.lingering?.packs.length) this.callbacks.onMessage('Raiders who saw you last time are still hunting here.', 'bad');
      for (const a of t.assaults ?? []) this.spawnAssault(a);
      for (const d of t.defences ?? []) this.startSweep(d);
      this.spawnCrew(t.crew ?? []);
      if (t.duel) this.spawnDuelist(t.duel);
      if (t.outpost) this.spawnOutpostDefences(t.outpost);
      for (const st of t.stands ?? []) this.startStand(st);
      const boats = t.lifeboats?.[0];
      if (boats) this.lifeboats = { setup: boats, spawned: false, aboard: boats.gathered };
    }
    this.updateOutpostGuards();
    this.updateOutpostRaid();
    this.updateStand(dt);
    this.updateLifeboats();
    // A rival's hired guns strike a little way into the flight (docs/PROCGEN.md §28).
    const hired = t.rivalAmbush;
    if (hired && !this.ambushSprung && this.time >= hired.delay && this.alive && !this.busy) {
      this.ambushSprung = true;
      this.spawnHiredGuns(hired);
    }
    // Escorted ships: the ambush comes part-way along the route.
    const along = (n: NpcShip) => 1 - n.body.position.distanceTo(n.trader!.destination.point) / Math.max(1, n.escort!.start.distanceTo(n.trader!.destination.point));
    for (const n of this.npcs) {
      const e = n.escort;
      if (!e || e.convoy || e.ambushed || !n.trader || n.durability.hull <= 0) continue;
      if (along(n) >= e.ambushAt) {
        e.ambushed = true;
        this.spawnAmbush(n, e.level);
      }
    }
    // Raiders waiting at the beacon strike a few seconds after escorted ships come through it.
    for (const b of [...this.beaconAmbushes]) {
      if (this.time < b.at) continue;
      this.beaconAmbushes.splice(this.beaconAmbushes.indexOf(b), 1);
      const ships = this.npcs.filter((n) => n.escort?.jobId === b.jobId && n.durability.hull > 0);
      if (ships.length) this.spawnAmbush(ships[Math.floor(this.rand() * ships.length)]!, b.level, b.name, 'beacon');
    }
    // Convoys: each wave comes when the leading ship reaches its mark, for one of the ships still flying.
    for (const [jobId, c] of this.convoys) {
      const ships = this.npcs.filter((n) => n.escort?.jobId === jobId && n.trader && n.durability.hull > 0);
      if (!ships.length || c.next >= c.waves.length) continue;
      const lead = Math.max(...ships.map(along));
      if (lead >= c.waves[c.next]!) {
        c.next += 1;
        this.spawnAmbush(ships[Math.floor(this.rand() * ships.length)]!, c.level, c.name);
      }
    }
    for (const w of this.wreckHulls) w.art.object.rotation.x += w.spin.x * dt;
    if (!timers.patrolsLaunched && plan.patrolWings > 0 && this.time > 2) {
      timers.patrolsLaunched = true;
      for (let w = 0; w < plan.patrolWings; w++) this.spawnPatrolWing(t, w);
    }
    // No raiders come where a rival waits for a duel: it is one on one.
    if (plan.packs && !this.traffic?.duel && !this.duelist && !(this.race && this.race.phase !== 'done')) {
      timers.pack -= dt;
      const packs = new Set(this.npcs.flatMap((n) => (n.pack === undefined || n.contract ? [] : [n.pack]))).size;
      if (timers.pack <= 0 && packs < plan.packs.max && this.alive && !this.busy && this.autopilot.mode !== 'lane') {
        this.spawnPack(plan.packs);
        timers.pack = THREE.MathUtils.lerp(plan.packs.interval[0], plan.packs.interval[1], this.rand());
      }
    }
    this.refreshDenTargets();
    this.updateSweeps(dt);
    this.watchDens();
    if (!timers.huntersSpawned && this.time > LAW.hunters.delay && this.alive && huntersIn(this.state, this.state.location.systemId)) {
      timers.huntersSpawned = true;
      this.spawnHunters();
    }
    this.updateScan(dt);
    this.frameObstacles = this.system.obstacles(null);
    for (const n of [...this.npcs]) {
      if (n.encounter || n.durability.hull <= 0) continue;
      // Who shows as hostile: raiders (unless the Wake trusts you), hunters, and lawful ships after you.
      n.target.hostile = n.battle ? this.borderBattle.enemyOfPilot(n) : n.side === 'raider' ? !this.raiderSparesPlayer(n) : n.foe === 'player' || !!n.sweep;
      if (n.own) this.flyOwn(n, dt);
      else if (n.den) this.flyDenPart(n, dt);
      else if (n.battle) this.flyBattleShip(n, dt);
      else if (n.wingman) this.flyWingman(n, dt);
      else if (n.sweep) this.flySweep(n, dt);
      else if (n.escort?.follow) this.flyEscortFollowing(n, dt);
      else if (n.lifeboat) n.controls.throttle = 0;
      else if (n.stranded && !n.trader) this.flyStranded(n, dt);
      else if (n.site && n.role === 'trader') this.flySiteShip(n, dt);
      else if (n.duel) this.flyDuelist(n, dt);
      else if (n.miner?.phase === 'cutting') this.flyMinerCutting(n, dt);
      else if (n.jumper) this.flyJumper(n, dt);
      else if (n.role === 'trader') this.flyTrader(n);
      else if (n.role === 'patrol') this.flyPatrol(n, dt);
      else this.flyRaider(n, dt);
    }
  }

  /** A traffic ship from the catalogue, flying its stock loadout (NPC guns are scaled down in fights). */
  private makeNpc(modelId: string, role: NpcRole, faction: FactionId | 'independent', position: THREE.Vector3, forward: THREE.Vector3, subtitle: string, fittings?: Record<string, string>): NpcShip {
    const model = shipModel(modelId);
    const perf = performanceOf({ model: modelId, fittings: fittings ?? model.stock });
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
      modelId,
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
    // Heavy raiders carry seekers (docs/PROCGEN.md §15).
    if (side === 'raider' && COMBAT.seekers.classes.includes(model.class)) npc.seekerIn = this.seekerDelay();
    this.npcs.push(npc);
    return npc;
  }

  private seekerDelay(): number {
    const [a, b] = COMBAT.seekers.first;
    return a + this.rand() * (b - a);
  }

  private openDocks(): DockSite[] {
    return this.system.docks.filter((d) => d.dockable);
  }

  private jumpPoint(): THREE.Vector3 {
    return (this.system.def.beacons.find((b) => b.kind === 'jump') ?? { position: this.system.def.arrival.position }).position;
  }

  /**
   * Brings the timetable's hauls flying here now into the scene (docs/PROCGEN.md §21), as many as
   * the traffic plan shows at once: at the scene's start wherever they are along their leg, later as
   * each leg begins (out of a dock, or out of the jump), or once there is room, if well clear of the
   * player.
   */
  private updateHauls(cap: number, first: boolean): void {
    const here = haulsIn(this.state.location.systemId, this.state.clock);
    // The pilot's own outposts' haulers always fly in (docs/PROCGEN.md §38.1); the rest only while the plan has room.
    const own = (h: Haul) => isOutpostId(h.from) || isOutpostId(h.to);
    for (const h of here) {
      if (this.haulsHere.has(h.haul.id)) continue;
      if (!own(h.haul) && this.npcs.filter((n) => n.haul && !own(n.haul.haul)).length >= cap) continue;
      if (this.spawnHaul(h, first)) this.haulsHere.add(h.haul.id);
    }
  }

  private dockOf(locationId: string): DockSite | undefined {
    return this.openDocks().find((d) => d.def.locationId === locationId);
  }

  /**
   * Where a ship flying a leg here is now (`progress` along it, 0–1): from its dock or the arrival
   * point, toward its dock or the jump beacon. Null when it would appear too close to the player (it
   * is tried again later).
   */
  private placeOnLeg(key: string, leg: HaulLeg, from: string, to: string, progress: number, first: boolean): { position: THREE.Vector3; forward: THREE.Vector3; end: THREE.Vector3; toDock: boolean } | null {
    const fromDock = leg.kind === 'out' || leg.kind === 'local' ? this.dockOf(from) : undefined;
    const toDock = leg.kind === 'in' || leg.kind === 'local' ? this.dockOf(to) : undefined;
    const r = hashString(key);
    const scatter = this.tmp.set(((r % 97) / 97 - 0.5) * 1_200, (((r >> 7) % 89) / 89 - 0.5) * 300, (((r >> 14) % 83) / 83 - 0.5) * 1_200);
    const start = fromDock ? fromDock.dockPoint.clone().addScaledVector(fromDock.approach, 320) : this.system.def.arrival.position.clone().add(scatter);
    const end = toDock ? toDock.dockPoint.clone() : this.jumpPoint().clone();
    const position = start.clone().lerp(end, Math.min(0.9, progress));
    // Never pop in right next to the player, unless out of a dock at the scene's start.
    if (progress > 0.02 && position.distanceTo(this.player.position) < 1_200 && !first) return null;
    if (position.distanceTo(this.player.position) < 600) return null;
    const forward = fromDock && progress < 0.02 ? fromDock.approach.clone() : end.clone().sub(position).normalize();
    return { position, forward, end, toDock: !!toDock };
  }

  /** A station's name, with its system's when it is elsewhere. */
  private whereIs(locationId: string): string {
    const loc = getLocation(locationId);
    return loc.systemId === this.state.location.systemId ? loc.name : `${loc.name} (${getSystem(loc.systemId).displayName})`;
  }

  /** One haul into the scene, along its leg here; false when it would appear too close to the player (it is tried again later). */
  private spawnHaul(h: HaulHere, first: boolean): boolean {
    const { haul, leg } = h;
    const at = this.placeOnLeg(haul.id, leg, haul.from, haul.to, h.progress, first);
    if (!at) return false;
    const owner = haul.faction === 'independent' ? 'Independent' : FACTIONS[haul.faction].shortName;
    const npc = this.makeNpc(haul.model, 'trader', haul.faction, at.position, at.forward, `The ${haul.name} · ${owner} · ${haul.qty} ${COMMODITIES[haul.commodity].name.toLowerCase()} for ${this.whereIs(haul.to)}`);
    // Its own name ("the Bramble" in messages, which put the article in), and on the HUD with it.
    npc.name = haul.name;
    npc.target.name = `The ${haul.name}`;
    npc.trader = new TraderBrain({ id: at.toDock ? haul.to : 'jump', point: at.end }, npc.durability);
    npc.haul = { haul, leg };
    return true;
  }

  // ---------------------------------------------------------------- rival pilots (docs/PROCGEN.md §24)

  /** Legs of rivals' runs already brought into this scene (each flies once a flight). */
  private readonly rivalLegs = new Set<string>();
  /** A rival's hired guns have struck in this flight (docs/PROCGEN.md §28). */
  private ambushSprung = false;
  /** A rival waiting here for a duel, or fighting it (§28). */
  private duelist: NpcShip | null = null;
  /** The raid on the player's outpost here (docs/PROCGEN.md §29): due, under way, or how it went. */
  private outpostRaid: { setup: OutpostRaidSetup; state: 'pending' | 'on' | 'held' | 'lost' | 'timeout'; since: number; downed: number; stores: NpcShip | null } | null = null;

  /** Brings rival pilots flying a leg here into the scene: named, with what they carry, out for the player when hostile in lawless space. */
  private updateRivals(first: boolean): void {
    for (const c of rivalsIn(this.state, this.state.location.systemId, this.state.clock)) {
      const key = `${c.run.id}|${c.leg.start}`;
      if (this.rivalLegs.has(key) || this.npcs.some((n) => n.rival?.id === c.rival.id)) continue;
      const at = this.placeOnLeg(key, c.leg, c.leg.from, c.leg.to, c.progress, first);
      if (!at) continue;
      this.rivalLegs.add(key);
      const name = rivalName(c.rival);
      const subtitle = rivalSubtitle(c.run, (id) => this.whereIs(id));
      const npc = c.hostile
        ? this.makeNpc(c.rival.ship, 'raider', 'independent', at.position, at.forward, `${subtitle} · out for you`)
        : this.makeNpc(c.rival.ship, 'trader', 'independent', at.position, at.forward, subtitle);
      npc.name = name;
      npc.target.name = name;
      npc.target.cycle = true;
      if (!c.hostile) npc.trader = new TraderBrain({ id: at.toDock ? c.leg.to : 'jump', point: at.end }, npc.durability);
      else npc.foe = 'player';
      npc.rival = { id: c.rival.id, run: c.run, leg: c.leg };
      this.callbacks.onRival?.(c.rival.id, 'met', { hostile: c.hostile });
    }
  }

  /** The cargo a rival's hold spills when its ship is destroyed. */
  private rivalSpill(n: NpcShip): { commodity: CommodityId; qty: number } | null {
    const run = n.rival?.run;
    if (!run?.commodity || !run.qty || (run.kind === 'race' && this.state.clock < run.loaded)) return null;
    return { commodity: run.commodity, qty: Math.max(1, Math.round(run.qty * RIVALS.spill.share)) };
  }

  // ---------------------------------------------------------------- rival stories (docs/PROCGEN.md §28)

  /** A rival's hired guns, out of the dark at the player (a bounty hunter flies with them): no bounty, no salvage. */
  private spawnHiredGuns(a: NonNullable<TrafficSetup['rivalAmbush']>): void {
    const r = rivalById(a.rivalId);
    if (!r) return;
    const angle = this.rand() * Math.PI * 2;
    const home = this.player.position.clone().add(this.tmp.set(Math.cos(angle), 0.1, Math.sin(angle)).normalize().multiplyScalar(3_500));
    const pool = RAIDERS[a.level];
    const count = a.guns + (a.withRival ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const position = home.clone().add(new THREE.Vector3(i * 180, i * 40, i * 110));
      const own = a.withRival && i === 0;
      const heading = this.player.position.clone().sub(position).normalize();
      const npc = this.makeNpc(own ? r.ship : pool[i % pool.length]!, 'raider', 'independent', position, heading, own ? `Rival · the ${r.shipName} · out for you` : `Hired gun · paid by ${rivalName(r)}`);
      npc.hired = r.id;
      npc.foe = 'player';
      npc.name = own ? rivalName(r) : 'Hired gun';
      npc.target.name = npc.name;
      if (own) {
        npc.rival = { id: r.id };
        npc.target.cycle = true;
      }
    }
    this.sfx('alert');
    if (this.autopilot.mode === 'goto') this.autopilot = { mode: 'none' };
    this.player.requestCruise(false);
    this.callbacks.onRivalAmbush?.(r.id);
  }

  /** Where a rival waits for a duel: off the jump beacon, clear of what is there, the same spot for the same duel. */
  duelSpot(jobId: string): THREE.Vector3 {
    const r = seededRandom(hashString(`duel|${jobId}`));
    const beacon = this.jumpPoint();
    const off = RIVAL_STORY.enemy.duel.offBeacon;
    const clear = (p: THREE.Vector3) => this.system.obstacles(null).every((o) => o.center.distanceTo(p) > o.radius + 1_500) && this.system.docks.every((d) => d.dockPoint.distanceTo(p) > 3_000);
    for (let i = 0; i < 24; i++) {
      const p = beacon.clone().addScaledVector(new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.2, r() - 0.5).normalize(), off);
      if (clear(p)) return p;
    }
    return beacon.clone().add(new THREE.Vector3(0, 800, off));
  }

  /** A rival waiting off the beacon for a duel, in their own ship as it is fitted. */
  private spawnDuelist(d: NonNullable<TrafficSetup['duel']>): void {
    const r = rivalById(d.rivalId);
    if (!r) return;
    const spot = this.duelSpot(d.jobId);
    const npc = this.makeNpc(r.ship, 'raider', 'independent', spot.clone(), this.jumpPoint().clone().sub(spot).normalize(), `Rival · the ${r.shipName} · waiting for you: a duel`);
    npc.name = rivalName(r);
    npc.target.name = npc.name;
    npc.target.id = duelTargetId(d.jobId);
    npc.target.cycle = true;
    npc.rival = { id: r.id };
    npc.duel = { jobId: d.jobId, spot, state: d.started ? 'on' : 'waiting' };
    npc.body.velocity.set(0, 0, 0);
    this.duelist = npc;
  }

  /**
   * A duelist waits at its spot; once the player comes within reach with a sound hull, it fights them
   * one on one, guns and seekers as its ship is fitted; once it is over it holds its fire.
   */
  private flyDuelist(n: NpcShip, dt: number): void {
    const d = n.duel!;
    const D = RIVAL_STORY.enemy.duel;
    const far = n.body.position.distanceTo(this.player.position);
    if (d.state === 'on' && this.alive) {
      if (far > D.forfeitRange) {
        this.endDuel(n, 'forfeit');
        return;
      }
      n.foe = 'player';
      this.fightNpc(n, this.player, dt, TRAFFIC.npcDamage * DIFFICULTY[this.settings.difficulty].enemyDamage);
      this.tickSeeker(n, dt);
      return;
    }
    n.foe = null;
    for (const g of n.guns) g.tick(dt);
    flyTo(n.body, d.spot, { arriveDistance: 300, allowCruise: false, maxThrottle: 0.35 }, n.controls);
    n.body.requestCruise(false);
    if (d.state !== 'waiting' || !this.alive || this.busy || far > D.startWithin) return;
    if (this.playerDurability.hull < this.playerDurability.hullMax * D.minHull) {
      if (!d.told) {
        d.told = true;
        this.callbacks.onDuel?.(d.jobId, n.rival!.id, 'unfit');
      }
      return;
    }
    this.startDuel(n);
  }

  private startDuel(n: NpcShip): void {
    n.duel!.state = 'on';
    n.foe = 'player';
    this.sfx('alert');
    if (this.autopilot.mode === 'goto') this.autopilot = { mode: 'none' };
    this.player.requestCruise(false);
    this.callbacks.onDuel?.(n.duel!.jobId, n.rival!.id, 'started');
  }

  /** The duel is over: the rival yielded (`won`), the player yielded (`lost`), or left it (`forfeit`). Its seekers in flight fall away. */
  private endDuel(n: NpcShip, how: 'won' | 'lost' | 'forfeit'): void {
    n.duel!.state = how === 'won' ? 'yielded' : 'won';
    n.foe = null;
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i]!;
      if (m.ownerId !== n.id) continue;
      this.system.scene.remove(m.art.object);
      m.art.dispose();
      this.missiles.splice(i, 1);
    }
    this.callbacks.onDuel?.(n.duel!.jobId, n.rival!.id, how);
  }

  /**
   * A rival's story posted a job in this system mid-flight (docs/PROCGEN.md §28): its ship comes into
   * the scene now, a rival adrift or one waiting off the beacon for a duel, rather than on the next visit.
   */
  addStoryShip(ship: { rescue?: NonNullable<TrafficSetup['rescues']>[number]; duel?: NonNullable<TrafficSetup['duel']> }): void {
    if (ship.rescue && !this.npcs.some((n) => n.stranded?.jobId === ship.rescue!.jobId)) this.spawnStranded(ship.rescue);
    if (ship.duel && !this.duelist) this.spawnDuelist(ship.duel);
  }

  // ---------------------------------------------------------------- the player's outpost under raid (docs/PROCGEN.md §29)

  /** Its turrets on a ring round it and its guards on their loop; a raid due, armed. */
  private spawnOutpostDefences(o: NonNullable<TrafficSetup['outpost']>): void {
    const site = this.system.dock(o.locationId);
    if (!site) return;
    const centre = site.def.position.clone();
    const F = OUTPOST_RAIDS.fight;
    for (let i = 0; i < o.turrets; i++) {
      const a = 0.6 + (i / Math.max(1, o.turrets)) * Math.PI * 2;
      const r = site.radius + F.ring;
      const position = centre.clone().add(new THREE.Vector3(Math.cos(a) * r, 30, Math.sin(a) * r));
      this.makeOwnTurret(position, position.clone().sub(centre).normalize(), centre, a);
    }
    // Guards on post now stand by it; those hired for later come on post in the flight, at their time.
    const clock = this.state.clock;
    this.outpostGuards = { centre, due: o.guards.filter((g) => g.from > clock && g.until > clock), slot: 0 };
    for (const g of o.guards) if (g.from <= clock && clock < g.until) this.spawnOutpostGuard(g);
    if (o.raid) this.armOutpostRaid(o.raid);
  }

  /** Test hook: the haulers flying to or from a station in this flight (docs/PROCGEN.md §38), with how far each is from its dock. */
  haulersAt(locationId: string): { id: string; name: string; state: string; distance: number }[] {
    const dock = this.system.dock(locationId);
    return this.npcs
      .filter((n) => n.haul && (n.haul.haul.from === locationId || n.haul.haul.to === locationId) && n.durability.hull > 0)
      .map((n) => ({ id: n.haul!.haul.id, name: n.name, state: n.trader?.state ?? '', distance: dock ? Math.round(n.body.position.distanceTo(dock.dockPoint)) : -1 }));
  }

  /** The outpost's centre and its guards still to come on post in this flight. */
  private outpostGuards: { centre: THREE.Vector3; due: OutpostGuardSetup[]; slot: number } | null = null;

  /** A guard on their loop round the outpost: each the other side of it from the last. */
  private spawnOutpostGuard(g: OutpostGuardSetup): NpcShip | null {
    const og = this.outpostGuards;
    if (!og) return null;
    const F = OUTPOST_RAIDS.fight;
    const a = og.slot++ * Math.PI;
    const position = og.centre.clone().add(new THREE.Vector3(Math.cos(a) * F.guardLoop, 60, Math.sin(a) * F.guardLoop));
    const npc = this.makeNpc(g.model, 'patrol', 'independent', position, new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), 'Guarding your outpost');
    npc.name = g.name;
    npc.target.name = g.name;
    npc.target.hostile = false;
    npc.own = { kind: 'guard', centre: og.centre, angle: a };
    npc.wingman = undefined;
    return npc;
  }

  /** A guard hired for later comes on post at their time, in the flight too, and says so over the radio. */
  private updateOutpostGuards(): void {
    const og = this.outpostGuards;
    if (!og?.due.length) return;
    const clock = this.state.clock;
    const now = og.due.filter((g) => g.from <= clock);
    if (!now.length) return;
    og.due = og.due.filter((g) => g.from > clock);
    for (const g of now) {
      if (clock >= g.until || !this.spawnOutpostGuard(g)) continue;
      this.callbacks.onComm?.(g.name, RAID_GUARD.onPost[hashString(g.id) % RAID_GUARD.onPost.length]!);
    }
  }

  /** A raid due on the outpost (from the scene's start, or warned of in flight): it strikes at its time. */
  armOutpostRaid(setup: OutpostRaidSetup): void {
    if (this.outpostRaid && (this.outpostRaid.setup.window === setup.window || this.outpostRaid.state === 'on')) return;
    this.outpostRaid = { setup, state: 'pending', since: 0, downed: 0, stores: null };
  }

  /** One of the outpost's turrets: it never moves, and turns its guns on raiders in range (never the player). */
  private makeOwnTurret(position: THREE.Vector3, facing: THREE.Vector3, centre: THREE.Vector3, angle: number): NpcShip {
    const art = createTurretArt(this.ctx, 'own');
    this.system.scene.add(art.object);
    const body = new ShipBody({ ...RAIDER_SHIP, maxSpeed: 0, boostSpeed: 0, strafeSpeed: 0, reverseSpeed: 0, cruiseSpeed: 0, radius: art.radius });
    body.position.copy(position);
    body.lookAlong(facing);
    art.object.position.copy(position);
    art.object.quaternion.copy(body.quaternion);
    const T = DENS.turret;
    const F = OUTPOST_RAIDS.fight.turret;
    const id = `own-turret-${++this.trafficTimers.serial}`;
    const npc: NpcShip = {
      id,
      modelId: 'outpost.turret',
      name: 'Your turret',
      faction: 'independent',
      role: 'patrol',
      side: 'lawful',
      body,
      art,
      durability: { hull: F.hull, hullMax: F.hull, shield: F.shield, shieldMax: F.shield, shieldRegen: 5, shieldDelay: 4, shieldType: 'deflector', sinceHit: 99 },
      guns: [new Gun({ damage: T.damage, shotsPerSecond: T.shotsPerSecond, projectileSpeed: T.projectileSpeed, range: F.range, energyPerShot: 0, kind: boltKind('plasma', 1), damageType: 'plasma' })],
      brain: new PirateBrain(this.rand),
      controls: neutralControls(),
      target: { id: `ship:${id}`, name: 'Your turret', kind: 'ship', position: body.position, velocity: body.velocity, radius: art.radius, subtitle: 'Your outpost’s defence', dataClass: 'fictional', hostile: false, alive: true, cycle: true },
      foe: null,
      bounty: 0,
      playerHitAt: -Infinity,
      idle: 0,
      maydaySent: false,
      own: { kind: 'turret', centre, angle },
    };
    this.npcs.push(npc);
    return npc;
  }

  /** The outpost's own: turrets fire on raiders in range; the stores sit still; guards fly their loop and go for raiders near the outpost. */
  private flyOwn(n: NpcShip, dt: number): void {
    const own = n.own!;
    const F = OUTPOST_RAIDS.fight;
    const raider = (x: NpcShip) => x.side === 'raider' && !x.duel && x.durability.hull > 0;
    if (own.kind === 'stores') {
      for (const g of n.guns) g.tick(dt);
      n.body.velocity.set(0, 0, 0);
      return;
    }
    if (own.kind === 'turret') {
      const gun = n.guns[0]!;
      gun.tick(dt);
      n.body.energy = n.body.params.energyMax;
      const foe = this.nearestShip(n.body.position, F.turret.range, raider);
      n.foe = foe;
      if (!foe) return;
      leadPoint(n.body.position, n.body.velocity, foe.body.position, foe.body.velocity, DENS.turret.projectileSpeed, this.aimPoint);
      this.tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.tmp.copy(this.aimPoint).sub(n.body.position).normalize());
      n.body.quaternion.rotateTowards(this.tmpQ, 1.2 * dt);
      if (!withinArc(n.body, this.aimPoint)) return;
      if (gun.fire(n.body, n.art.muzzles, this.aimPoint, this.projectiles, n.id, 1).fired) this.npcShots.set(n.id, (this.npcShots.get(n.id) ?? 0) + 1);
      return;
    }
    // A guard: raiders near the outpost first; otherwise round its loop.
    const foe = this.nearestShip(own.centre, F.guardLoop + 1_500, raider);
    n.foe = foe;
    if (foe) {
      this.fightNpc(n, foe.body, dt, TRAFFIC.npcDamage);
      return;
    }
    for (const g of n.guns) g.tick(dt);
    own.angle += dt * 0.05;
    const slot = this.tmp2.set(Math.cos(own.angle) * F.guardLoop, 60, Math.sin(own.angle) * F.guardLoop).add(own.centre);
    flyTo(n.body, slot, { arriveDistance: 200, allowCruise: false, maxThrottle: 0.6 }, n.controls);
    n.body.requestCruise(false);
  }

  /** The raid strikes at its time: its stores barge by the outpost, and the raiders out of the dark toward it. */
  private updateOutpostRaid(): void {
    const raid = this.outpostRaid;
    if (!raid) return;
    if (raid.state === 'pending' && this.state.clock >= raid.setup.at && this.alive && !this.busy) {
      this.strikeOutpost(raid);
      return;
    }
    if (raid.state !== 'on') return;
    const left = this.npcs.some((n) => n.outpostRaid === raid.setup.window && n.durability.hull > 0 && n.brain.state !== 'escaped');
    if (!left) this.endOutpostRaid('held');
    else if (this.time - raid.since > OUTPOST_RAIDS.fight.cap) this.endOutpostRaid('timeout');
  }

  private strikeOutpost(raid: NonNullable<FlightSession['outpostRaid']>): void {
    const o = this.traffic?.outpost;
    const site = o ? this.system.dock(o.locationId) : undefined;
    if (!o || !site) {
      raid.state = 'timeout';
      return;
    }
    const centre = site.def.position.clone();
    // The stores: a barge moored by the outpost, what the raiders want.
    const moor = centre.clone().add(new THREE.Vector3(site.radius + 120, -20, site.radius * 0.5));
    const stores = this.makeNpc('ship.freighter.3.eridani', 'trader', 'independent', moor, new THREE.Vector3(1, 0, 0), 'Your outpost’s stores');
    stores.name = 'Stores';
    stores.target.name = 'Stores';
    stores.target.hostile = false;
    const hull = OUTPOST_RAIDS.fight.stores[Math.min(o.stage, OUTPOST_RAIDS.fight.stores.length) - 1] ?? 600;
    stores.durability = { ...stores.durability, hull, hullMax: hull, shield: 0, shieldMax: 0, shieldRegen: 0 };
    stores.own = { kind: 'stores', centre, angle: 0 };
    stores.body.velocity.set(0, 0, 0);
    raid.stores = stores;
    // The raiders come from the system's den if it has one, else from the jump beacon's side.
    const den = this.system.docks.find((d) => getLocation(d.def.locationId).stationType === 'pirate-den');
    const from = den ? den.def.position : this.jumpPoint();
    const dir = from.clone().sub(centre).normalize();
    const home = centre.clone().addScaledVector(dir, OUTPOST_RAIDS.fight.from);
    const pack = ++this.packSerial;
    this.packHome.set(pack, centre.clone());
    const pool = RAIDERS[raid.setup.threat];
    for (let i = 0; i < raid.setup.ships; i++) {
      const model = pool[i % pool.length]!;
      const bounty = bountyFor(model);
      const position = home.clone().add(this.tmp.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(600));
      const npc = this.makeNpc(model, 'raider', 'hollow-wake', position, centre.clone().sub(position).normalize(), `${FACTIONS['hollow-wake'].name} raider · hostile · bounty ${bounty} cr`);
      npc.pack = pack;
      npc.bounty = bounty;
      npc.outpostRaid = raid.setup.window;
      // Half go for the stores, the rest for whoever defends them.
      if (i % 2 === 0) npc.prey = stores;
    }
    raid.state = 'on';
    raid.since = this.time;
    this.sfx('alert');
    this.callbacks.onOutpostRaid?.(raid.setup.window, 'struck', 0);
  }

  /** The raid is over: held, lost (the raiders make off), or left to the clock. */
  private endOutpostRaid(how: 'held' | 'lost' | 'timeout'): void {
    const raid = this.outpostRaid;
    if (!raid || raid.state !== 'on') return;
    raid.state = how;
    if (how !== 'held') for (const n of this.npcs) if (n.outpostRaid === raid.setup.window && n.durability.hull > 0) n.brain.state = 'flee';
    this.callbacks.onOutpostRaid?.(raid.setup.window, how, raid.downed);
  }

  /** The raid on the outpost here (by its station), if one is due or under way (leaving one under way leaves it to the clock). */
  outpostRaidStatus(): { window: number; state: 'pending' | 'on' | 'held' | 'lost' | 'timeout'; downed: number; setup: OutpostRaidSetup; locationId: string | null } | null {
    const r = this.outpostRaid;
    return r ? { window: r.setup.window, state: r.state, downed: r.downed, setup: r.setup, locationId: this.traffic?.outpost?.locationId ?? null } : null;
  }

  /** The duel here, if a rival waits for one or is fighting it (the game counts leaving a duel under way as forfeit). */
  duelStatus(): { jobId: string; rivalId: string; state: 'waiting' | 'on' | 'yielded' | 'won' } | null {
    const n = this.duelist;
    return n?.duel && n.rival ? { jobId: n.duel.jobId, rivalId: n.rival.id, state: n.duel.state } : null;
  }

  // ---------------------------------------------------------------- your captains on the lanes (docs/PROCGEN.md §18.6)

  /**
   * Brings the player's own haulers flying here into the scene, as the timetable's are (always,
   * whatever the plan's cap); flies the run's raid when it is due here (an ambush on the captain);
   * and tells the game when one is seen safely past it.
   */
  private updateCaptains(first: boolean): void {
    for (const c of captainsIn(this.state, this.state.location.systemId, this.state.clock)) {
      const key = `${c.ship.id}.${c.hauler.hired}.${c.hauler.runs}.${c.way}`;
      // One ship in the scene at a time: one still flying behind its run's schedule comes in first.
      if (this.captainsHere.has(key) || this.npcs.some((n) => n.captain?.shipId === c.ship.id)) continue;
      if (this.spawnCaptain(c, key, first)) this.captainsHere.add(key);
    }
    for (const n of this.npcs) {
      const c = n.captain;
      if (!c?.raid || c.settled || n.durability.hull <= 0) continue;
      if (c.ambush === undefined) {
        if (this.state.clock >= c.raid.at) c.ambush = this.spawnAmbush(n, FLEET.lanes.ambush[c.raid.level]);
        continue;
      }
      // Beaten off: every raider of the ambush destroyed, fleeing or gone.
      const fighting = this.npcs.some((x) => x.pack === c.ambush && x.durability.hull > 0 && x.brain.state !== 'flee' && x.brain.state !== 'escaped');
      if (!fighting) this.captainSafe(n, `They’re gone. ${c.qty > 0 ? 'The cargo is safe. ' : ''}Thanks for the cover.`);
    }
  }

  private captainGood(n: NpcShip): CommodityId {
    return this.state.fleet.ships.find((o) => o.id === n.captain!.shipId)?.hauler?.route.commodity ?? 'food';
  }

  /** What the owned ship carries now (the save's word: a run sold or robbed out of sight carries none). */
  private captainCargo(n: NpcShip): number {
    const o = this.state.fleet.ships.find((x) => x.id === n.captain!.shipId);
    return o?.hauler ? (o.ship.cargo[o.hauler.route.commodity] ?? 0) : 0;
  }

  /** Seen safely past its raid here: the raid does not strike (said over the radio when the ambush came). */
  private captainSafe(n: NpcShip, line: string): void {
    const c = n.captain!;
    if (!c.raid || c.settled) return;
    c.settled = true;
    this.callbacks.onCaptain?.(c.shipId, 'safe');
    if (c.ambush !== undefined) this.callbacks.onComm?.(c.name, line);
  }

  /** One of the player's haulers into the scene, along its leg here: named as theirs, with its captain and cargo. */
  private spawnCaptain(c: CaptainHere, key: string, first: boolean): boolean {
    const { hauler: h, leg, way } = c;
    const [from, to] = way === 'out' ? [h.route.from, h.route.to] : [h.route.to, h.route.from];
    const at = this.placeOnLeg(key, leg, from, to, c.progress, first);
    if (!at) return false;
    const model = shipModel(c.ship.ship.model);
    const doing = runDoing(c.ship, way, (id) => this.whereIs(id));
    const npc = this.makeNpc(model.id, 'trader', 'independent', at.position, at.forward, `Captain ${h.captain} · ${doing}`, c.ship.ship.fittings);
    // "your Petrel" in messages; on the HUD, marked as the player's and in the target cycle.
    npc.name = model.name;
    npc.target.name = `Your ${model.name}`;
    npc.target.own = true;
    npc.target.cycle = true;
    npc.trader = new TraderBrain({ id: at.toDock ? to : 'jump', point: at.end }, npc.durability);
    npc.captain = { shipId: c.ship.id, key, name: h.captain, leg, way, qty: c.qty, raid: c.raid, ...(h.work ? { safe: true as const } : {}) };
    return true;
  }

  /** Ships of the pilot's mining captains in this scene, by owned ship: seen once, they come and go without the pop-in rule. */
  private readonly minersSeen = new Set<string>();

  /**
   * The pilot's mining captains at work here (docs/PROCGEN.md §37.4): flying out from the refinery
   * to their spot in the ring, cutting there with the beam on their rock, or bringing the load in. A
   * ship appears with each phase, where the clock says it is, never popping in near the pilot.
   */
  private updateMiners(first: boolean): void {
    for (const m of minersIn(this.state, this.state.location.systemId, this.state.clock)) {
      const key = `mine.${m.ship.id}.${m.hauler.since}.${m.phase}`;
      const existing = this.npcs.find((n) => n.miner && n.captain?.shipId === m.ship.id && n.durability.hull > 0);
      if (existing?.captain?.key === key || m.phase === 'handing') continue;
      const site = siteOfStation(m.dockId);
      const spot = site ? miningSpot(this.system.def, site) : null;
      const dock = this.system.dock(m.dockId);
      if (!spot || !dock) continue;
      const exit = dock.dockPoint.clone().addScaledVector(dock.approach, 250);
      const rockAt = spot;
      // The ship cuts from 140 m off its rock, on the refinery's side.
      const station = rockAt.clone().addScaledVector(exit.clone().sub(rockAt).normalize(), 140);
      const [a, b] = m.phase === 'to-dock' ? [station, exit] : [exit, station];
      const at = m.phase === 'cutting' ? station : a.clone().lerp(b, m.progress);
      if (!existing && !first && !this.minersSeen.has(m.ship.id) && at.distanceTo(this.player.position) < 1_500) continue;
      if (existing) this.removeMiner(existing);
      const model = shipModel(m.ship.ship.model);
      const dockName = getLocation(m.dockId).name;
      const aboard = Object.entries(m.ship.ship.cargo).filter(([, q]) => (q ?? 0) > 0).map(([c, q]) => `${q} ${COMMODITIES[c as CommodityId].name.toLowerCase()}`).join(', ');
      const doing = m.phase === 'cutting' ? `mining for ${dockName}` : m.phase === 'to-dock' ? `${aboard || 'a load'} for ${dockName}` : `out to the rocks for ${dockName}`;
      const facing = m.phase === 'cutting' ? rockAt.clone().sub(station).normalize() : b.clone().sub(a).normalize();
      const npc = this.makeNpc(model.id, 'trader', 'independent', at, facing, `Captain ${m.hauler.captain} · ${doing}`, m.ship.ship.fittings);
      npc.name = model.name;
      npc.target.name = `Your ${model.name}`;
      npc.target.own = true;
      npc.target.cycle = true;
      npc.captain = { shipId: m.ship.id, key, name: m.hauler.captain, way: 'work', qty: 0, raid: null, safe: true };
      npc.miner = { phase: m.phase };
      if (m.phase === 'cutting') {
        npc.body.velocity.set(0, 0, 0);
        const rock = createMinableRock(hashString(m.ship.id) % 997, 42, { color: new THREE.Color('#7d6250'), ice: 0.1 }, this.ctx);
        rock.object.position.copy(rockAt);
        this.system.scene.add(rock.object);
        const beam = createMiningBeam(this.ctx);
        this.system.scene.add(beam.object);
        npc.miner = { phase: 'cutting', rock, beam, rockAt: rockAt.clone() };
      } else {
        npc.trader = new TraderBrain(m.phase === 'to-dock' ? { id: m.dockId, point: dock.dockPoint } : { id: 'spot', point: station }, npc.durability);
      }
      this.minersSeen.add(m.ship.id);
    }
    // A cutting ship whose captain no longer works here (recalled and gone) goes too.
    for (const n of [...this.npcs]) {
      // (A belt crew's cutter in a stand is no captain's: §40.3.)
      if (n.miner?.phase !== 'cutting' || !n.captain) continue;
      const still = minersIn(this.state, this.state.location.systemId, this.state.clock).some((m) => m.ship.id === n.captain?.shipId && m.phase === 'cutting');
      if (!still) this.removeMiner(n);
    }
  }

  /** A mining captain's ship leaves the scene (its next phase brings it back), with its rock and beam (removeNpc). */
  private removeMiner(n: NpcShip): void {
    this.removeNpc(n);
  }

  /** A mining captain cutting: it holds its place, nose to the rock, the beam on it. */
  private flyMinerCutting(n: NpcShip, dt: number): void {
    const m = n.miner!;
    n.controls.throttle = 0;
    n.body.velocity.multiplyScalar(Math.max(0, 1 - dt * 2));
    if (!m.rockAt || !m.beam || !m.rock) return;
    const nose = n.body.position.clone().addScaledVector(m.rockAt.clone().sub(n.body.position).normalize(), 8);
    const surface = m.rockAt.clone().addScaledVector(n.body.position.clone().sub(m.rockAt).normalize(), 40);
    m.beam.set(nose, surface);
    m.beam.update?.(dt, this.time, this.camera);
    m.rock.update?.(dt, this.time, this.camera);
  }

  /** Test hook: the pilot's mining captains' ships in this scene: their phase, and how far from the refinery's dock. */
  minerStatus(): { shipId: string; phase: string; distance: number; beam: boolean }[] {
    return this.npcs
      .filter((n) => n.miner && n.captain && n.durability.hull > 0)
      .map((n) => {
        const o = this.state.fleet.ships.find((x) => x.id === n.captain?.shipId);
        const dock = o?.hauler ? this.system.dock(o.hauler.route.to) : undefined;
        return { shipId: n.captain!.shipId, phase: n.miner!.phase, distance: dock ? Math.round(n.body.position.distanceTo(dock.dockPoint)) : -1, beam: !!n.miner!.beam };
      });
  }

  /** The player's own haulers flying in sight (their owned ships' ids): a raid due on one here waits for the flight (docs/PROCGEN.md §18.6). */
  captainsInSight(): string[] {
    return this.npcs.filter((n) => n.captain && n.durability.hull > 0).map((n) => n.captain!.shipId);
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

  /** A raider pack from the den or out of the dark (`fromDark`: always, as for the packs that hunt miners). Returns its number. */
  private spawnPack(spec: NonNullable<TrafficPlan['packs']>, fromDark = false): number {
    const pack = ++this.packSerial;
    const den = this.system.docks.find((d) => !d.dockable);
    let home: THREE.Vector3;
    const fromDen = !fromDark && !!den && this.rand() < 0.6;
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
    return pack;
  }

  /** A pack the player left behind (docs/PROCGEN.md §17): back where it was, and still hunting. */
  private spawnLingeringPack(p: Lingering['packs'][number]): void {
    const pack = ++this.packSerial;
    const home = new THREE.Vector3(...p.position);
    this.packHome.set(pack, home);
    const approaches = this.openDocks()
      .map((d) => d.dockPoint.clone().addScaledVector(d.approach, 2_500 + this.rand() * 2_000))
      .sort(() => this.rand() - 0.5)
      .slice(0, 2);
    const route = [home.clone(), ...approaches, home.clone()];
    const pool = RAIDERS[p.level];
    for (let i = 0; i < p.count; i++) {
      const model = pool[Math.floor(this.rand() * pool.length)]!;
      const position = home.clone().add(this.tmp.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(500));
      const bounty = bountyFor(model);
      const npc = this.makeNpc(model, 'raider', 'hollow-wake', position, this.player.position.clone().sub(position).normalize(), `${FACTIONS['hollow-wake'].name} raider · hostile · bounty ${bounty} cr`);
      npc.pack = pack;
      npc.bounty = bounty;
      npc.patrol = { brain: new PatrolBrain(route, 0), offset: new THREE.Vector3((i - p.count / 2) * 140, (i % 2) * 60, (i % 3) * 90) };
    }
  }

  /**
   * The scheduled haulers still flying when the player leaves (docs/PROCGEN.md §21) that are past
   * the middle of their leg here: the player saw them through, whatever a raid here would have done.
   */
  haulsSeenThrough(): string[] {
    return this.npcs.filter((n) => n.haul && n.durability.hull > 0 && this.state.clock >= (n.haul.leg.start + n.haul.leg.end) / 2).map((n) => n.haul!.haul.id);
  }

  /**
   * What stays when the player leaves (docs/PROCGEN.md §17): packs that saw the player (their
   * level, ships left and where they are) and pods still adrift.
   */
  lingering(): Pick<Lingering, 'packs' | 'pods'> {
    const packs = new Map<number, NpcShip[]>();
    for (const n of this.npcs) {
      if (n.side !== 'raider' || n.pack === undefined || !this.packAlerted.has(n.pack) || n.contract || n.hunter || n.den || n.encounter || n.site) continue;
      if (n.durability.hull <= 0 || n.brain.state === 'escaped') continue;
      (packs.get(n.pack) ?? packs.set(n.pack, []).get(n.pack)!).push(n);
    }
    const round = (v: THREE.Vector3): [number, number, number] => [Math.round(v.x), Math.round(v.y), Math.round(v.z)];
    return {
      packs: [...packs.values()].map((ships) => {
        const centre = ships.reduce((c, n) => c.add(n.body.position), new THREE.Vector3()).divideScalar(ships.length);
        return { level: Math.max(...ships.map((n) => this.raiderLevel(n))) as 1 | 2 | 3, count: ships.length, position: round(centre) };
      }),
      pods: this.loot
        .filter((l) => !l.recover && !l.site && l.target.alive)
        .slice(0, TRAFFIC.linger.maxPods)
        .map((l) => ({ position: round(l.position), value: l.value, ...(l.cargo ? { cargo: l.cargo } : {}), ...(l.gear ? { gear: l.gear } : {}) })),
    };
  }

  /** A bounty contract's pack: it lurks at its marked spot until the player comes for it. */
  private spawnContractPack(c: NonNullable<TrafficSetup['contractPacks']>[number]): void {
    const site = this.system.dock(c.locationId);
    if (!site || c.count <= 0) return;
    // By a raider den, packs wait well clear of its guns (it wakes for pilots it does not trust).
    const home = site.dockable
      ? site.dockPoint.clone().addScaledVector(site.approach, 2_600).add(this.tmp.set(0, 500, 0))
      : site.def.position.clone().addScaledVector(site.approach, site.radius + DENS.packStandoff);
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
      ace.seekerIn = this.seekerDelay();
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

  /**
   * The ship (or ships, for a convoy) of an escort contract: in its destination's system it sets off
   * alongside the player toward its dock; on its way to another system it keeps station off the
   * player, to jump with them. Raiders wait at the beacon for escorted ships that came through it.
   */
  private spawnEscort(e: EscortSetup): void {
    const names = e.convoy?.names ?? [e.name];
    if (!names.length) return;
    if (e.beacon && this.arrived) this.beaconAmbushes.push({ jobId: e.jobId, level: e.level, name: e.name, at: this.time + 3 });
    if (e.follow) {
      this.spawnFollowingEscort(e, names);
      return;
    }
    const dest = this.system.dock(e.to);
    if (!dest) return;
    const forward = this.player.forward(new THREE.Vector3());
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.player.quaternion);
    const owner = this.traffic?.owner;
    const faction = owner === 'sta' || owner === 'frontier' ? owner : 'independent';
    const [a, b] = CONTRACTS.escort.ambushAt;
    names.forEach((name, i) => {
      // A convoy flies in line abreast, alternating either side of the player.
      const lateral = e.convoy ? (i % 2 === 0 ? 1 : -1) * (180 + Math.floor(i / 2) * 220) : 180;
      const position = this.player.position.clone().addScaledVector(forward, 220 + i * 60).addScaledVector(side, lateral);
      const heading = dest.dockPoint.clone().sub(position).normalize();
      const npc = this.makeNpc(e.model, 'trader', faction, position, heading, `${e.convoy ? `The ${e.name}` : 'Your escort'} · bound for ${dest.name}`);
      npc.name = name;
      npc.target.name = `${name} (${e.convoy ? 'convoy' : 'escort'})`;
      npc.trader = new TraderBrain({ id: e.to, point: dest.dockPoint }, npc.durability);
      npc.escort = { jobId: e.jobId, start: position.clone(), ambushAt: a + this.rand() * (b - a), ambushed: false, level: e.level, ...(e.convoy ? { convoy: true } : {}) };
    });
    if (e.convoy) {
      // Waves spread along the route, the first a fifth of the way in.
      const n = e.convoy.waves;
      this.convoys.set(e.jobId, { waves: Array.from({ length: n }, (_, i) => 0.2 + (0.55 * i) / Math.max(1, n - 1)), next: 0, level: e.level, name: e.name });
      this.callbacks.onMessage(`The ${e.name} (${names.length} ships) is setting off for ${dest.name}. Stay close.`, 'info');
    } else {
      this.callbacks.onMessage(`The ${e.name} is setting off for ${dest.name}. Stay close.`, 'info');
    }
  }

  /** Escorted ships on their way to another system: they keep station behind the player, to jump with them. */
  private spawnFollowingEscort(e: EscortSetup, names: readonly string[]): void {
    const owner = this.traffic?.owner;
    const faction = owner === 'sta' || owner === 'frontier' ? owner : 'independent';
    const dest = getLocation(e.to);
    const where = `${dest.name} (${getSystem(dest.systemId).displayName})`;
    names.forEach((name, i) => {
      // Behind the player, either side, a little further back for each ship.
      const offset = new THREE.Vector3((i % 2 === 0 ? 1 : -1) * (160 + Math.floor(i / 2) * 140), -20, 240 + i * 90);
      const position = offset.clone().applyQuaternion(this.player.quaternion).add(this.player.position);
      const npc = this.makeNpc(e.model, 'trader', faction, position, this.player.forward(new THREE.Vector3()), `${e.convoy ? `The ${e.name}` : 'Your escort'} · bound for ${where}`);
      npc.name = name;
      npc.target.name = `${name} (${e.convoy ? 'convoy' : 'escort'})`;
      npc.target.hostile = false;
      npc.escort = { jobId: e.jobId, start: position.clone(), ambushAt: Infinity, ambushed: true, level: e.level, ...(e.convoy ? { convoy: true } : {}), follow: { offset } };
    });
    const who = e.convoy ? `The ${e.name} (${names.length} ships) is` : `The ${e.name} is`;
    this.callbacks.onMessage(`${who} with you, bound for ${where}. Jump with ${e.convoy ? 'them' : 'it'} within ${ESCORT_WAIT / 1000} km.`, 'info');
  }

  /** An escorted ship on its way to another system keeps station behind the player, catching up as wingmen do. */
  private flyEscortFollowing(n: NpcShip, dt: number): void {
    const f = n.escort!.follow!;
    for (const g of n.guns) g.tick(dt);
    const slot = this.tmp2.copy(f.offset).applyQuaternion(this.player.quaternion).add(this.player.position);
    if (!this.busy && n.body.position.distanceTo(this.player.position) > CATCH_UP) {
      n.body.position.copy(slot);
      n.body.velocity.copy(this.player.velocity);
    }
    flyTo(n.body, slot, { arriveDistance: 80, allowCruise: false, maxThrottle: 1 }, n.controls);
    n.body.requestCruise(this.player.cruise === 'on' && n.body.position.distanceTo(slot) > 400);
  }

  /** The escorted ship that should jump with the player but is too far away to (its name), if any. */
  escortBehind(): string | null {
    const far = this.npcs.find((n) => n.escort?.follow && n.durability.hull > 0 && n.body.position.distanceTo(this.player.position) > ESCORT_WAIT);
    return far?.name ?? null;
  }

  /**
   * Raiders jump the escorted ship: they come from ahead of it (at the beacon, from ahead of the
   * player) and go for it first.
   */
  private spawnAmbush(target: NpcShip, level: 1 | 2 | 3, convoy?: string, at: 'route' | 'beacon' = 'route'): number {
    const pack = ++this.packSerial;
    const ahead = target.trader && at === 'route' ? target.trader.destination.point.clone().sub(target.body.position).normalize() : this.player.forward(new THREE.Vector3());
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
    const who = convoy ? `the ${convoy}` : target.captain ? `your ${target.name}` : `the ${target.name}`;
    this.callbacks.onMessage(at === 'beacon' ? `Raiders were waiting at the beacon! They are closing on ${who}.` : `Ambush! Raiders are closing on ${who}.`, 'bad');
    return pack;
  }

  /**
   * Where a rescue's ship drifts: far from any dock (CONTRACTS.rescue.clearOfDocksM) and clear of
   * stars and planets, the same every time for the same job.
   */
  strandedPosition(jobId: string, beltId?: string): THREE.Vector3 {
    // Adrift in a belt (docs/PROCGEN.md §40.3): in its ring, clear of stations.
    const inBelt = beltId ? this.beltSpot(beltId, `stranded|${jobId}`) : null;
    if (inBelt) return inBelt;
    const r = seededRandom(hashString(`stranded|${jobId}`));
    const from = this.system.def.arrival.position;
    const clear = (p: THREE.Vector3) =>
      this.system.docks.every((d) => d.dockPoint.distanceTo(p) >= CONTRACTS.rescue.clearOfDocksM) && this.system.obstacles(null).every((o) => o.center.distanceTo(p) > o.radius + 3_000);
    let best: THREE.Vector3 | null = null;
    for (let i = 0; i < 24 && !best; i++) {
      const dir = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.3, r() - 0.5).normalize();
      const p = from.clone().addScaledVector(dir, 14_000 + r() * 14_000);
      if (clear(p)) best = p;
    }
    return best ?? from.clone().add(new THREE.Vector3(0, 2_000, -CONTRACTS.rescue.clearOfDocksM - 4_000));
  }

  // ---------------------------------------------------------------- a stand in a belt (docs/PROCGEN.md §40.3)

  /** The stand under way here: its setup, the crews' spot, the waves to come, and how it stands. */
  private stand: { setup: StandSetup; spot: THREE.Vector3; waves: number[]; next: number; t: number; state: 'waiting' | 'on' | 'won' | 'lost' } | null = null;

  /**
   * A spot in a belt's ring in this scene (its first ring, halfway across and level with it), at an
   * angle drawn from `key`, clear of every station by STAND.clear; null when the belt is not drawn here.
   */
  beltSpot(beltId: string, key: string): THREE.Vector3 | null {
    const ring = this.system.def.belts.find((b) => b.beltId === beltId && b.shape === 'ring');
    if (!ring) return null;
    const r = (ring.innerRadius + ring.outerRadius) / 2;
    const start = hashString(key) % 360;
    for (let k = 0; k < 24; k++) {
      const p = polar(ring.center, r, start + k * 15);
      if (this.system.docks.every((d) => d.dockPoint.distanceTo(p) >= STAND.clear)) return p;
    }
    return polar(ring.center, r, start);
  }

  /** The crews' cutters at their rocks, side by side along the ring, each with its beam on its rock. */
  private startStand(setup: StandSetup): void {
    if (this.stand) return;
    const ring = this.system.def.belts.find((b) => b.beltId === setup.beltId && b.shape === 'ring');
    const spot = this.beltSpot(setup.beltId, `stand|${setup.jobId}`);
    if (!ring || !spot) return;
    const waves = Array.from({ length: setup.waves }, (_, i) => Math.ceil((setup.ships - i) / setup.waves));
    this.stand = { setup, spot, waves, next: 0, t: STAND.waveDelay, state: 'waiting' };
    const out = spot.clone().sub(ring.center).setY(0).normalize();
    const along = new THREE.Vector3(-out.z, 0, out.x);
    const n = setup.crews.names.length;
    setup.crews.names.forEach((name, i) => {
      const rockAt = spot.clone().addScaledVector(along, (i - (n - 1) / 2) * STAND.spacing);
      const at = rockAt.clone().addScaledVector(out, STAND.standOff);
      const npc = this.makeNpc(STAND.cutter, 'trader', 'independent', at, rockAt.clone().sub(at).normalize(), `${name} · belt crew · fiction`);
      npc.name = name;
      npc.target.name = name;
      npc.target.cycle = true;
      if (i === 0) npc.target.id = standTargetId(setup.jobId);
      npc.cutter = { jobId: setup.jobId };
      npc.body.velocity.set(0, 0, 0);
      const rock = createMinableRock(hashString(`${setup.jobId}|${i}`) % 997, 42, { color: new THREE.Color('#9fb2c2'), ice: 0.8 }, this.ctx);
      rock.object.position.copy(rockAt);
      this.system.scene.add(rock.object);
      const beam = createMiningBeam(this.ctx);
      this.system.scene.add(beam.object);
      npc.miner = { phase: 'cutting', rock, beam, rockAt: rockAt.clone() };
    });
  }

  /**
   * The stand: it begins when the pilot comes within range of the crews' spot; each wave of
   * claim-jumpers comes out of the dark on the far side once the one before is down to one ship. All
   * downed with enough cutters left, it is won; with too few cutters left, lost.
   */
  private updateStand(dt: number): void {
    const st = this.stand;
    if (!st || st.state === 'won' || st.state === 'lost') return;
    const id = st.setup.jobId;
    const cutters = this.npcs.filter((n) => n.cutter?.jobId === id && n.durability.hull > 0).length;
    if (cutters < st.setup.crews.need) {
      st.state = 'lost';
      this.callbacks.onMessage(STAND_LINES.lost, 'bad');
      this.callbacks.onStand?.(id, 'lost');
      return;
    }
    if (st.state === 'waiting') {
      if (!this.alive || this.busy || st.spot.distanceTo(this.player.position) > STAND.range) return;
      st.state = 'on';
      this.callbacks.onMessage(STAND_LINES.begin.replace('{lead}', st.setup.crews.names[0]!), 'info');
    }
    const jumpers = this.npcs.filter((n) => n.jumper?.jobId === id && n.durability.hull > 0).length;
    if (st.next >= st.waves.length) {
      if (jumpers > 0) return;
      st.state = 'won';
      this.callbacks.onMessage(STAND_LINES.won, 'good');
      this.callbacks.onStand?.(id, 'won');
      return;
    }
    if (st.next > 0 && jumpers > 1) return;
    st.t -= dt;
    if (st.t > 0) return;
    const count = st.waves[st.next]!;
    st.next += 1;
    st.t = STAND.waveDelay;
    // Out of the dark on the side away from the pilot.
    const away = st.spot.clone().sub(this.player.position).setY(0);
    if (away.lengthSq() < 1) away.set(1, 0, 0);
    const home = st.spot.clone().addScaledVector(away.normalize(), STAND.from);
    const pool = RAIDERS[st.setup.level];
    for (let i = 0; i < count; i++) {
      const position = home.clone().add(new THREE.Vector3((i - (count - 1) / 2) * 160, i * 30, i * 90));
      const npc = this.makeNpc(pool[i % pool.length]!, 'raider', 'independent', position, st.spot.clone().sub(position).normalize(), 'Claim-jumper · hostile');
      npc.name = 'Claim-jumper';
      npc.target.name = npc.name;
      npc.jumper = { jobId: id };
    }
    this.sfx('alert');
    this.callbacks.onMessage((st.next === 1 ? STAND_LINES.first : STAND_LINES.next).replace('{n}', String(count)), 'bad');
  }

  /** A claim-jumper goes for the crews' cutters, and for the pilot once near. */
  private lifeboats: { setup: LifeboatSetup; spawned: boolean; aboard: number } | null = null;

  /** Where lifeboat `i` is at a time: out from the observatory on its own heading, drifting slowly (null without the observatory). */
  lifeboatPosition(setup: LifeboatSetup, i: number, clock: number): THREE.Vector3 | null {
    const site = this.system.dock(DOOMED.stations.observatory.id);
    if (!site) return null;
    const h = hashString(`${setup.jobId}|lifeboat|${i}`);
    const angle = ((i + (h % 1_000) / 2_000) / setup.count) * Math.PI * 2;
    const rise = (((h >>> 10) % 1_000) / 1_000 - 0.5) * 0.3;
    const dir = new THREE.Vector3(Math.cos(angle), rise, Math.sin(angle)).normalize();
    const out = EMBERS.start + EMBERS.drift * Math.max(0, clock - setup.launch);
    return site.def.position.clone().addScaledVector(dir, site.radius + out);
  }

  private nearestLifeboat(prefix: string): NpcShip | null {
    let best: NpcShip | null = null;
    for (const n of this.npcs) {
      if (!n.lifeboat || !n.target.alive || !n.target.id.startsWith(`${prefix}#`)) continue;
      if (!best || n.body.position.distanceTo(this.player.position) < best.body.position.distanceTo(this.player.position)) best = n;
    }
    return best;
  }

  /**
   * Pyre's lifeboats (docs/PROCGEN.md §42.4): they leave the observatory at the launch, drift out,
   * and are taken aboard as the pilot comes within reach; none before the launch or after the collapse.
   */
  private updateLifeboats(): void {
    const lb = this.lifeboats;
    if (!lb) return;
    const clock = this.state.clock;
    const { setup } = lb;
    if (clock < setup.launch || clock >= setup.collapse) return;
    if (!lb.spawned) {
      lb.spawned = true;
      for (let i = setup.gathered; i < setup.count; i++) {
        const at = this.lifeboatPosition(setup, i, clock);
        if (!at) return;
        const npc = this.makeNpc(EMBERS.boat, 'trader', 'independent', at, at.clone().sub(this.player.position).normalize(), 'Pyre Observatory · fiction');
        npc.name = `Lifeboat ${i + 1}`;
        npc.target.name = npc.name;
        npc.target.id = `${lifeboatTargetId(setup.jobId)}#${i}`;
        npc.target.hostile = false;
        npc.lifeboat = { jobId: setup.jobId, i };
        npc.body.velocity.set(0, 0, 0);
      }
      if (clock - setup.launch < 30) this.callbacks.onMessage(LIFEBOAT_LINES.launch.replace('{n}', String(setup.count - setup.gathered)), 'info');
    }
    for (const n of [...this.npcs]) {
      if (!n.lifeboat || n.lifeboat.jobId !== setup.jobId || !n.target.alive) continue;
      const at = this.lifeboatPosition(setup, n.lifeboat.i, clock);
      if (at) n.body.position.copy(at);
      n.body.velocity.set(0, 0, 0);
      if (!this.alive || this.busy || n.body.position.distanceTo(this.player.position) > EMBERS.pickup) continue;
      n.target.alive = false;
      this.removeNpc(n);
      lb.aboard = this.callbacks.onLifeboat?.(setup.jobId) ?? lb.aboard + 1;
      this.sfx('mission-complete');
      this.callbacks.onMessage(lb.aboard === setup.need ? `${LIFEBOAT_LINES.aboard.replace('{name}', n.name)} ${LIFEBOAT_LINES.enough}` : LIFEBOAT_LINES.aboard.replace('{name}', n.name), 'good');
    }
  }

  /** Test hook: the lifeboats here: launched, how many still out and aboard, the nearest's distance, and when the launch and collapse are. */
  lifeboatStatus(): { jobId: string; launched: boolean; out: number; aboard: number; nearest: number | null; launch: number; collapse: number } | null {
    const lb = this.lifeboats;
    if (!lb) return null;
    const out = this.npcs.filter((n) => n.lifeboat?.jobId === lb.setup.jobId && n.target.alive);
    const near = this.nearestLifeboat(lifeboatTargetId(lb.setup.jobId));
    return { jobId: lb.setup.jobId, launched: lb.spawned, out: out.length, aboard: lb.aboard, nearest: near ? Math.round(near.body.position.distanceTo(this.player.position)) : null, launch: lb.setup.launch, collapse: lb.setup.collapse };
  }

  private flyJumper(n: NpcShip, dt: number): void {
    const onPlayer = this.alive && !this.busy && this.autopilot.mode !== 'lane' && n.body.position.distanceTo(this.player.position) < 3_000;
    const cutter = onPlayer ? null : this.nearestShip(n.body.position, Infinity, (x) => x.cutter?.jobId === n.jumper!.jobId);
    n.foe = onPlayer ? 'player' : cutter;
    if (onPlayer) this.fightNpc(n, this.player, dt, TRAFFIC.npcDamage * DIFFICULTY[this.settings.difficulty].enemyDamage);
    else if (cutter) this.fightNpc(n, cutter.body, dt, TRAFFIC.npcDamage);
    else this.flyRaider(n, dt);
  }

  /** Test hook: the stand here: how it stands, the waves sent, the cutters and claim-jumpers left, and how far the pilot is from the spot. */
  standStatus(): { jobId: string; state: string; next: number; waves: number; cutters: number; jumpers: number; distance: number; spot: [number, number, number] } | null {
    const st = this.stand;
    if (!st) return null;
    const id = st.setup.jobId;
    return {
      jobId: id,
      state: st.state,
      next: st.next,
      waves: st.waves.length,
      cutters: this.npcs.filter((n) => n.cutter?.jobId === id && n.durability.hull > 0).length,
      jumpers: this.npcs.filter((n) => n.jumper?.jobId === id && n.durability.hull > 0).length,
      distance: Math.round(st.spot.distanceTo(this.player.position)),
      spot: [st.spot.x, st.spot.y, st.spot.z],
    };
  }

  /** A ship stranded by a drive failure: adrift far from any dock, perhaps watched by scavengers. */
  private spawnStranded(rescue: NonNullable<TrafficSetup['rescues']>[number]): void {
    const at = this.strandedPosition(rescue.jobId, rescue.beltId);
    const heading = new THREE.Vector3(1, 0, 0);
    const npc = this.makeNpc(rescue.model, 'trader', 'independent', at, heading, 'Adrift · drive failure');
    npc.name = rescue.name;
    npc.target.name = `${rescue.name} (stranded)`;
    npc.target.id = strandedTargetId(rescue.jobId);
    npc.target.hostile = false;
    npc.stranded = { jobId: rescue.jobId, handed: false, told: false };
    // Dead in space: no drive, no drift.
    npc.body.velocity.set(0, 0, 0);
    if (rescue.guard) {
      const pack = ++this.packSerial;
      const home = at.clone().add(new THREE.Vector3(0, 400, 600));
      this.packHome.set(pack, home);
      const pool = RAIDERS[rescue.guard];
      for (let i = 0; i < rescue.guard; i++) this.spawnGuard(pool[i % pool.length]!, pack, home.clone().add(this.tmp.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(500)));
    }
  }

  /** Adrift until the parts are handed over alongside; then its drive comes back and it makes for the nearest dock. */
  private flyStranded(n: NpcShip, dt: number): void {
    const s = n.stranded!;
    for (const g of n.guns) g.tick(dt);
    n.controls.throttle = 0;
    n.body.velocity.multiplyScalar(Math.max(0, 1 - dt * 0.5));
    if (!s.handed && this.alive && !this.busy && n.body.position.distanceTo(this.player.position) < RESCUE_RANGE) {
      const missing = this.callbacks.onHandOver?.(s.jobId) ?? 0;
      if (missing === 0) {
        s.handed = true;
        s.restartAt = this.time + 6;
        this.sfx('mission-complete');
        this.callbacks.onMessage(`The ${n.name}’s crew have the parts. Her drive will be back in a moment.`, 'good');
      } else if (!s.told) {
        s.told = true;
        this.callbacks.onMessage(`The ${n.name} needs ${missing} more for her drive: they are not in your hold.`, 'bad');
      }
    }
    if (s.handed && this.time >= (s.restartAt ?? Infinity)) {
      let best: DockSite | null = null;
      for (const d of this.openDocks()) if (!best || d.dockPoint.distanceTo(n.body.position) < best.dockPoint.distanceTo(n.body.position)) best = d;
      if (best) {
        n.trader = new TraderBrain({ id: best.def.locationId, point: best.dockPoint }, n.durability);
        n.target.subtitle = `Underway again · bound for ${getLocation(best.def.locationId).name}`;
      }
    }
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
        // One word for a convoy, not one per ship.
        const others = this.npcs.some((x) => x !== n && x.escort?.jobId === n.escort!.jobId && x.escort.waiting);
        if (!n.escort.waiting && !others) this.callbacks.onMessage(n.escort.convoy ? 'The convoy is holding position until you catch up.' : `The ${n.name} is holding position until you catch up.`, 'info');
      }
      n.escort.waiting = far;
    } else n.body.requestCruise(cruise);
    if (brain.attacked && !n.maydaySent) {
      n.maydaySent = true;
      if (n.haul) n.haul.downedAtMayday = this.raidersDowned;
      // The player's own captains always get through to them.
      if (n.captain) this.callbacks.onMessage(`Mayday from ${n.captain.name} in your ${n.name}: raiders attacking!`, 'bad');
      else if (n.body.position.distanceTo(this.player.position) < 15_000) this.callbacks.onMessage(`Mayday from the ${n.haul ? n.haul.haul.name : n.name}: raiders attacking!`, 'bad');
    }
    // Docked (or out through the jump beacon): it leaves the scene.
    if (brain.state === 'arrived') {
      if (n.escort) this.callbacks.onEscortArrived?.(n.escort.jobId);
      else if (n.captain) this.captainSafe(n, brain.destination.id === 'jump' ? 'Through the beacon and away, cargo and all. Thanks for the cover.' : 'Docked safe, cargo and all. Thanks for the cover.');
      else if (n.haul) {
        this.callbacks.onHaul?.(n.haul.haul.id, 'safe');
        // Kept alive through an attack by the player's guns (and never hit by them): its owners send thanks.
        const helped = n.haul.downedAtMayday !== undefined && this.raidersDowned > n.haul.downedAtMayday && n.playerHitAt === -Infinity;
        if (helped) this.callbacks.onHaulThanks?.(n.haul.haul);
      }
      this.removeNpc(n);
    }
  }

  private flyPatrol(n: NpcShip, dt: number): void {
    // Patrols turn on a pilot their faction hunts (fines owed, or Hostile standing) or who fired on them.
    const playerFair = this.alive && !this.busy && this.autopilot.mode !== 'lane';
    const onPlayer = playerFair && (n.foe === 'player' || huntedBy(this.state, n.faction)) && n.body.position.distanceTo(this.player.position) < PATROL_HUNT;
    // The opening raid, bounty-contract packs and bounty hunters are the player's fights; patrols leave them alone.
    const foe = onPlayer ? 'player' : this.nearestShip(n.body.position, 4_000, (x) => x.side === 'raider' && !x.encounter && !x.contract && !x.hunter && !x.duel);
    // Taking on raiders within radio range of the player, a patrol says so.
    if (foe && foe !== 'player' && (n.foe === null || n.foe === 'player') && n.faction !== 'independent' && this.inRadioRange(n)) {
      this.chatter('patrol-engage', `${FACTIONS[n.faction].shortName} patrol`);
    }
    n.foe = foe;
    if (foe === 'player') {
      this.fightNpc(n, this.player, dt, TRAFFIC.npcDamage * DIFFICULTY[this.settings.difficulty].enemyDamage);
    } else if (foe) {
      this.fightNpc(n, foe.body, dt, TRAFFIC.npcDamage);
    } else if (this.scan?.npc === n) {
      // Scanning: keep station off the player's wing.
      for (const g of n.guns) g.tick(dt);
      flyTo(n.body, this.player.position, { arriveDistance: 450, allowCruise: false, maxThrottle: 0.7 }, n.controls);
      n.body.requestCruise(false);
    } else {
      for (const g of n.guns) g.tick(dt);
      n.body.requestCruise(n.patrol!.brain.update(n.body, n.controls, this.frameObstacles, n.patrol!.offset));
      this.maybeScan(n);
    }
    // A badly damaged patrol breaks off and heads home.
    if (n.brain.state === 'escaped') this.removeNpc(n);
  }

  /** A patrol passing close may scan the player's hold: always with contraband aboard, now and then otherwise. */
  private maybeScan(n: NpcShip): void {
    if (this.scan || this.scanned || !this.alive || this.busy || n.scanRolled) return;
    if (this.race && this.race.phase !== 'done') return;
    const law = patrolsScanIn(this.state.location.systemId);
    if (!law || n.faction !== law || huntedBy(this.state, law)) return;
    if (n.body.position.distanceTo(this.player.position) > LAW.scans.range) return;
    n.scanRolled = true;
    // Customs tipped off by a rival (docs/PROCGEN.md §28) scan the player whatever the hold holds.
    if (!contrabandIn(this.state.ship.cargo).length && !this.traffic?.tipped && this.rand() >= LAW.scans.cleanChance) return;
    this.scan = { npc: n, t: 0 };
    // Out of cruise for the scan: fleeing it is the pilot's choice, never the ship's.
    this.player.requestCruise(false);
    this.sfx('scan');
    this.callbacks.onMessage(`${FACTIONS[law].shortName} patrol: hold your course for a cargo scan.`, 'info');
  }

  private updateScan(dt: number): void {
    const s = this.scan;
    if (!s) return;
    if (s.npc.durability.hull <= 0 || !this.alive || s.npc.foe === 'player') {
      this.scan = null;
      return;
    }
    const faction = s.npc.faction as FactionId;
    if (s.npc.body.position.distanceTo(this.player.position) > LAW.scans.escape) {
      this.scan = null;
      this.scanned = true;
      this.callbacks.onScan?.('evaded', faction);
      return;
    }
    s.t += dt;
    if (s.t >= LAW.scans.seconds) {
      this.scan = null;
      this.scanned = true;
      this.callbacks.onScan?.('complete', faction);
    }
  }

  /** A cargo scan under way: who is scanning and how long it has left. */
  get scanStatus(): { faction: FactionId; left: number } | null {
    return this.scan ? { faction: this.scan.npc.faction as FactionId, left: Math.max(0, LAW.scans.seconds - this.scan.t) } : null;
  }

  /** Bounty hunters: a pair after the player's fines, from out of the dark. */
  private spawnHunters(): void {
    const a = this.rand() * Math.PI * 2;
    const home = this.player.position.clone().add(this.tmp.set(Math.cos(a), 0.1, Math.sin(a)).normalize().multiplyScalar(5_000));
    for (let i = 0; i < LAW.hunters.count; i++) {
      const position = home.clone().add(new THREE.Vector3(i * 160, i * 40, i * 90));
      const npc = this.makeNpc(LAW.hunters.model, 'raider', 'independent', position, this.player.position.clone().sub(position).normalize(), 'Bounty hunter · after your fines');
      npc.hunter = true;
      npc.seekerIn = this.seekerDelay();
      npc.name = 'Bounty hunter';
      npc.target.name = 'Bounty hunter';
      npc.foe = 'player';
    }
    this.sfx('alert');
    this.callbacks.onMessage('Bounty hunters are on your trail!', 'bad');
  }

  /** Raiders leave a pilot the Wake trusts alone, until provoked. */
  private provoked(n: NpcShip): boolean {
    return this.npcs.some((x) => x.side === 'raider' && (x === n || (n.pack !== undefined && x.pack === n.pack)) && this.time - x.playerHitAt < 30);
  }

  private raiderSparesPlayer(n: NpcShip): boolean {
    // A duelist fights only in the duel; hired guns never spare their mark (docs/PROCGEN.md §28).
    if (n.duel) return n.duel.state !== 'on';
    if (n.hired || n.jumper) return false;
    // A pilot the Wake trusts, or one who paid its toll here (docs/PROCGEN.md §27).
    return !n.hunter && !n.encounter && (wakeFriendly(this.state) || this.tollPaid) && !this.provoked(n);
  }

  /** Can the player dock here? Open stations, and the raider dens for pilots the Wake trusts. */
  // ---------------------------------------------------------------- dens under fire

  /** Den markers: friendly to a pilot the Wake trusts, hostile to others, and silent once knocked out. */
  private refreshDenTargets(): void {
    for (const d of this.denTargets) {
      const id = d.locationId!;
      const down = this.downDens.has(id);
      d.hostile = !this.denOpen && !down;
      d.name = down ? `${getLocation(id).name} (wrecked)` : getLocation(id).name;
    }
  }

  private turretsStanding(locationId: string): boolean {
    return this.npcs.some((n) => n.den?.locationId === locationId && n.den.part === 'turret' && n.durability.hull > 0);
  }

  /**
   * A den under assault: gun turrets on a ring around it, the reactor on its far side (shielded
   * while a turret stands), raiders defending it, and a lawful wing flying with the player.
   */
  private spawnAssault(a: { jobId: string | null; locationId: string; turretsLeft: number; wing?: FactionId | null }): void {
    const site = this.system.dock(a.locationId);
    if (!site || this.downDens.has(a.locationId)) return;
    this.denAlerted.add(a.locationId);
    const centre = site.def.position;
    const out = site.approach.clone().normalize();
    const side = new THREE.Vector3().crossVectors(out, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const lift = new THREE.Vector3().crossVectors(side, out).normalize();
    for (let i = 0; i < a.turretsLeft; i++) {
      const angle = (i / DENS.turrets) * Math.PI * 2 + 0.5;
      const dir = out.clone().multiplyScalar(Math.cos(angle)).addScaledVector(side, Math.sin(angle)).addScaledVector(lift, 0.15).normalize();
      this.makeDenPart('turret', a, centre.clone().addScaledVector(dir, site.radius + DENS.turretStandoff), dir);
    }
    const reactorAt = centre.clone().addScaledVector(out, -(site.radius * 0.75 + 70));
    this.makeDenPart('reactor', a, reactorAt, out.clone().negate());
    // Mines on the way round to the reactor.
    for (let i = 0; i < COMBAT.mines.atDens; i++) {
      const dir = side.clone().multiplyScalar(Math.cos(i * 2.1)).addScaledVector(lift, Math.sin(i * 2.1) * 0.6).addScaledVector(out, -0.6).normalize();
      this.spawnMine(reactorAt.clone().addScaledVector(dir, 220 + i * 40), Infinity);
    }
    // The den's crews.
    const pack = ++this.packSerial;
    const home = site.def.position.clone().addScaledVector(out, site.radius + 1_200);
    this.packHome.set(pack, home);
    const pool = RAIDERS[DENS.guards.level];
    for (let i = 0; i < DENS.guards.count; i++) this.spawnGuard(pool[i % pool.length]!, pack, home.clone().add(this.tmp.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(600)));
    // The wing, alongside the player (on an assault a lawful faction asked for).
    const wing = a.wing;
    for (let i = 0; wing && (wing === 'sta' || wing === 'frontier') && i < DENS.wing.count; i++) {
      const offset = new THREE.Vector3(i % 2 === 0 ? 70 : -70, 12, 60 + i * 30);
      const position = offset.clone().applyQuaternion(this.player.quaternion).add(this.player.position);
      const npc = this.makeNpc(FLEETS[wing].patrols[0] ?? DENS.wing.model, 'patrol', wing, position, this.player.forward(new THREE.Vector3()), `${FACTIONS[wing].shortName} wing · with you`);
      npc.name = `Wing ${i + 1}`;
      npc.target.name = `Wing ${i + 1}`;
      npc.wingman = { offset };
    }
  }

  private makeDenPart(part: 'turret' | 'reactor', a: { jobId: string | null; locationId: string }, position: THREE.Vector3, facing: THREE.Vector3): NpcShip {
    const art = part === 'turret' ? createTurretArt(this.ctx) : createReactorArt(this.ctx);
    this.system.scene.add(art.object);
    const body = new ShipBody({ ...RAIDER_SHIP, maxSpeed: 0, boostSpeed: 0, strafeSpeed: 0, reverseSpeed: 0, cruiseSpeed: 0, radius: art.radius });
    body.position.copy(position);
    body.lookAlong(facing);
    art.object.position.copy(position);
    art.object.quaternion.copy(body.quaternion);
    const t = DENS.turret;
    const hull = part === 'turret' ? t.hull : DENS.reactor.hull;
    const shield = part === 'turret' ? t.shield : 0;
    const id = `den-${part}-${++this.trafficTimers.serial}`;
    const name = part === 'turret' ? 'Den turret' : `${getLocation(a.locationId).name} reactor`;
    const npc: NpcShip = {
      id,
      modelId: `den.${part}`,
      name,
      faction: 'hollow-wake',
      role: 'raider',
      side: 'raider',
      body,
      art,
      durability: { hull, hullMax: hull, shield, shieldMax: shield, shieldRegen: shield ? 5 : 0, shieldDelay: 4, shieldType: 'deflector', sinceHit: 99 },
      guns:
        part === 'turret'
          ? [new Gun({ damage: t.damage, shotsPerSecond: t.shotsPerSecond, projectileSpeed: t.projectileSpeed, range: t.range, energyPerShot: 0, kind: 'enemy-pulse', damageType: 'plasma' })]
          : [],
      brain: new PirateBrain(this.rand),
      controls: neutralControls(),
      target: {
        id: `ship:${id}`,
        name,
        kind: 'ship',
        position: body.position,
        velocity: body.velocity,
        radius: art.radius,
        subtitle: part === 'turret' ? 'Den defence · hostile' : 'Den reactor · shielded while the turrets stand',
        dataClass: 'fictional',
        faction: 'hollow-wake',
        hostile: true,
        alive: true,
        cycle: true,
      },
      foe: null,
      // Turrets knocked out on the player's own account pay a bounty; a contract's pay covers them otherwise.
      bounty: part === 'turret' && !a.jobId ? DENS.turretBounty : 0,
      playerHitAt: -Infinity,
      idle: 0,
      maydaySent: false,
      ...(a.jobId ? { contract: a.jobId } : {}),
      den: { locationId: a.locationId, part },
    };
    this.npcs.push(npc);
    return npc;
  }

  /** Turrets turn to the nearest foe in range (the player first) and fire with a lead; the reactor glows hotter as it is hit. */
  private flyDenPart(n: NpcShip, dt: number): void {
    const den = n.den!;
    if (den.part === 'reactor') {
      (n.art as ReturnType<typeof createReactorArt>).setHeat(1 - n.durability.hull / n.durability.hullMax);
      n.target.subtitle = this.turretsStanding(den.locationId) ? 'Den reactor · shielded while the turrets stand' : 'Den reactor · exposed';
      return;
    }
    const gun = n.guns[0]!;
    gun.tick(dt);
    n.body.energy = n.body.params.energyMax;
    const range = DENS.turret.range;
    const playerIn = this.alive && !this.busy && !this.raiderSparesPlayer(n) && n.body.position.distanceTo(this.player.position) < range + 300;
    const foe: ShipBody | null = playerIn ? this.player : (this.nearestShip(n.body.position, range, (x) => x.side === 'lawful')?.body ?? null);
    n.foe = playerIn ? 'player' : null;
    if (!foe) return;
    leadPoint(n.body.position, n.body.velocity, foe.position, foe.velocity, DENS.turret.projectileSpeed, this.aimPoint);
    // Turn the head toward the aim point at a turret's pace.
    this.tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.tmp.copy(this.aimPoint).sub(n.body.position).normalize());
    n.body.quaternion.rotateTowards(this.tmpQ, 1.2 * dt);
    if (n.body.position.distanceTo(foe.position) > range || !withinArc(n.body, this.aimPoint)) return;
    const scale = playerIn ? DIFFICULTY[this.settings.difficulty].enemyDamage : 1;
    if (gun.fire(n.body, n.art.muzzles, this.aimPoint, this.projectiles, n.id, scale).fired) {
      this.npcShots.set(n.id, (this.npcShots.get(n.id) ?? 0) + 1);
      if (n.body.position.distanceTo(this.player.position) < 2_500) this.sfx('laser-enemy', 0.3);
    }
  }

  /** The reactor goes: a big blast, the den falls silent, and the assault is done. */
  private knockOutDen(n: NpcShip): void {
    const { locationId } = n.den!;
    this.downDens.add(locationId);
    this.spawnEffect(createExplosion(n.body.position.clone(), 40, this.ctx));
    this.sfx('explosion-large', 1);
    for (const x of [...this.npcs]) if (x.den?.locationId === locationId && x !== n) this.removeNpc(x);
    this.refreshDenTargets();
    this.callbacks.onMessage(`${getLocation(locationId).name}’s reactor is down. The den is dark.`, 'good');
    for (let i = this.mines.length - 1; i >= 0; i--) if (this.mines[i]!.position.distanceTo(n.body.position) < 1_500) this.removeMine(i);
    this.callbacks.onDenDestroyed?.(locationId, n.contract ?? null);
  }

  /** A wingman keeps station off the player's wing and goes for raiders (and den turrets) near the player. */
  private flyWingman(n: NpcShip, dt: number): void {
    const w = n.wingman!;
    const view = this.wingView();
    // Left far behind (a lane, a long cruise), a wingman catches up, unless it holds a point or guards a ship.
    if (!this.busy && !this.wing.anchored && n.body.position.distanceTo(this.player.position) > CATCH_UP) {
      n.body.position.copy(w.offset).applyQuaternion(this.player.quaternion).add(this.player.position);
      n.body.velocity.copy(this.player.velocity);
    }
    // Badly hit, a hired wingman holds back from fights until mended or treated (docs/PROCGEN.md §34).
    if (w.crewId && !w.ally && !w.hurt && n.durability.hull < n.durability.hullMax * WING.hurt.hull) {
      w.hurt = true;
      this.callbacks.onWingHurt?.(w.crewId);
      this.callbacks.onComm?.(n.name, WING_RADIO.hurt);
    }
    if (w.crewId && n.durability.shield <= 0 && this.time - (w.hurtAt ?? -99) > 20) {
      w.hurtAt = this.time;
      this.chatter('wing-hurt', n.name);
    }
    const foe = this.wing.foeFor(n, view);
    n.foe = foe;
    if (foe) {
      this.fightNpc(n, foe.body, dt, w.damage ?? TRAFFIC.npcDamage);
      return;
    }
    for (const g of n.guns) g.tick(dt);
    const slot = this.wing.slotFor(n, view, this.tmp2);
    flyTo(n.body, slot, { arriveDistance: 60, allowCruise: false, maxThrottle: 1 }, n.controls);
    n.controls.boost = this.wing.boostHome(n, slot) && n.body.energy > n.body.params.energyMax * 0.3;
    n.body.requestCruise(!this.wing.anchored && this.player.cruise === 'on' && n.body.position.distanceTo(slot) > 400);
  }

  /** A guard or a hold ends (the ward gone, the pilot far off): the wing forms up and says so. */
  private updateWing(dt: number): void {
    for (const e of this.wing.update(this.wingView(), dt)) {
      const lead = this.npcs.find((x) => x.wingman?.crewId && x.durability.hull > 0) ?? this.npcs.find((x) => x.wingman && x.durability.hull > 0);
      if (lead) this.callbacks.onComm?.(lead.name, e.why === 'ward' ? WING_RADIO.wardGone.replace('{ward}', e.ward ?? 'ship') : WING_RADIO.tooFar);
    }
  }

  /** What the wing's orders need to know of this flight. */
  private wingView(): WingView {
    return {
      time: this.time,
      alive: this.alive,
      busy: this.busy,
      dueling: this.duelist?.duel?.state === 'on',
      player: this.player,
      selectedId: this.selectedId,
      npcs: this.npcs,
      // On the Wake's side of a border battle the wing holds its fire on the battle (docs/PROCGEN.md §35.3).
      fair: (x) => x.side === 'raider' && !x.hunter && !x.duel && !this.raiderSparesPlayer(x) && !(x.den?.part === 'reactor' && this.turretsStanding(x.den.locationId)) && !(x.battle && this.borderBattle.side === 'wake'),
    };
  }

  /** The order card's choices (docs/PROCGEN.md §34), each with why not when it cannot be given. */
  wingOptions(): WingOption[] {
    return this.wing.options(this.wingView());
  }

  /** Gives the wing an order: the lead wingman's reply, or null if it cannot be given now. */
  giveWingOrder(order: WingOrder): { speaker: string; text: string } | null {
    const wing = this.npcs.filter((x) => x.wingman && x.durability.hull > 0);
    const reply = wing.length ? this.wing.give(order, this.wingView()) : null;
    if (!reply) return null;
    this.sfx('ui-click');
    const lead = wing.find((x) => x.wingman?.crewId && !x.wingman.ally) ?? wing[0]!;
    return { speaker: lead.name, text: reply };
  }

  /** The order to carry into the next flight. */
  wingCarry(): WingOrder {
    return this.wing.order;
  }

  /** Test hook: the wing's order, ward and held point, what it has earned, and each wingman's foe and hurt. */
  wingStatus(): ReturnType<WingCommand['status']> & { earned: ReturnType<WingCommand['earnings']>; ships: { crewId: string | null; foe: string | null; hurt: boolean; distance: number }[] } {
    return {
      ...this.wing.status(),
      earned: this.wing.earnings(),
      ships: this.npcs.filter((x) => x.wingman && x.durability.hull > 0).map((x) => ({ crewId: x.wingman!.crewId ?? null, foe: x.foe && x.foe !== 'player' ? x.foe.id : x.foe === 'player' ? 'player' : null, hurt: !!x.wingman!.hurt, distance: x.body.position.distanceTo(this.player.position) })),
    };
  }

  // ---------------------------------------------------------------- the border in sight (docs/PROCGEN.md §35)

  /** Opens a border battle that is due, brings in its waves and ends it; the game hears of each. */
  private updateBattle(): void {
    const ready = this.alive && !this.busy && this.autopilot.mode !== 'lane' && !this.race && !this.traffic?.duel && !this.duelist;
    const events = this.borderBattle.update({ clock: this.state.clock, time: this.time, ready, npcs: this.npcs }, {
      site: (plan) => battleSite(this.system.def, plan),
      sideOf: (plan) => {
        const front = getFront(plan.frontId);
        return front && (huntedBy(this.state, front.faction) || wakeFriendly(this.state)) ? 'wake' : 'law';
      },
      spawn: (plan, side, count, from, post) => this.spawnBattleShips(plan, side, count, from, post),
      comm: (speaker, text) => this.callbacks.onComm?.(speaker, text),
    });
    for (const e of events) {
      if (e.kind === 'opened') this.sfx('alert');
      this.callbacks.onBattle?.(e);
    }
  }

  /** Brings a side's ships into a battle at its end of the line: the front's patrol fighters, or Wake raiders. */
  private spawnBattleShips(plan: BattlePlan, side: BattleSide, count: number, from: THREE.Vector3, post: THREE.Vector3): void {
    const front = getFront(plan.frontId);
    if (!front) return;
    const models = side === 'law' ? FLEETS[front.faction].patrols : RAIDERS[plan.level];
    const pack = ++this.packSerial;
    const across = this.tmp2.set(post.z - from.z, 0, from.x - post.x).normalize().clone();
    for (let i = 0; i < count; i++) {
      const model = models[(i + plan.key) % models.length]!;
      const spread = (i - (count - 1) / 2) * 260;
      const position = from.clone().addScaledVector(across, spread).add(this.tmp.set(0, (this.rand() - 0.5) * 300, 0));
      const forward = post.clone().sub(position).normalize();
      const npc =
        side === 'law'
          ? this.makeNpc(model, 'patrol', front.faction, position, forward, `${FACTIONS[front.faction].shortName} wing · border battle`)
          : this.makeNpc(model, 'raider', 'hollow-wake', position, forward, `${FACTIONS['hollow-wake'].name} raider · border battle · bounty ${bountyFor(model)} cr`);
      if (side === 'wake') {
        npc.pack = pack;
        npc.bounty = bountyFor(model);
      }
      npc.battle = { id: plan.id, side, post: post.clone().addScaledVector(across, spread * 0.6) };
    }
  }

  /**
   * A battle ship goes for the nearest ship of the other side in its battle, or for the pilot if the
   * pilot is its enemy and nearer; otherwise it closes on the line (or holds the station's approach).
   * Once the battle is over, the winners hold and the beaten run.
   */
  private flyBattleShip(n: NpcShip, dt: number): void {
    const b = n.battle!;
    if (b.over || n.brain.state === 'escaped') {
      for (const g of n.guns) g.tick(dt);
      n.foe = null;
      const away = n.body.position.clone().sub(b.post);
      const goal = b.over === 'hold' ? b.post : away.lengthSq() > 1 ? b.post.clone().addScaledVector(away.normalize(), 20_000) : b.post.clone().add(this.tmp.set(0, 20_000, 0));
      flyTo(n.body, goal, { arriveDistance: 200, allowCruise: b.over !== 'hold', maxThrottle: b.over === 'hold' ? 0.4 : 1 }, n.controls);
      n.body.requestCruise(b.over !== 'hold' && n.body.position.distanceTo(goal) > 3_000);
      if (n.body.position.distanceTo(this.player.position) > (b.over === 'hold' ? 9_000 : 6_000)) this.removeNpc(n);
      return;
    }
    const R = BATTLES.reach;
    // Nobody chases a ship that has fled the fight, or anyone far from the line.
    const inFight = (x: NpcShip) => x.durability.hull > 0 && x.brain.state !== 'flee' && x.brain.state !== 'escaped' && x.body.position.distanceTo(b.post) < BATTLES.leash;
    const pilotFair = this.alive && !this.busy && this.autopilot.mode !== 'lane' && this.borderBattle.enemyOfPilot(n) && this.player.position.distanceTo(b.post) < BATTLES.leash;
    const toPilot = this.player.position.distanceTo(n.body.position);
    const kept = n.foe && n.foe !== 'player' && n.foe.battle?.id === b.id && !n.foe.battle.over && inFight(n.foe) ? n.foe : null;
    const enemy = kept ?? this.nearestShip(n.body.position, R * 2, (x) => x.battle?.id === b.id && x.battle.side !== b.side && !x.battle.over && inFight(x));
    const foe = pilotFair && toPilot < R && (!enemy || toPilot < enemy.body.position.distanceTo(n.body.position)) ? 'player' : enemy;
    n.foe = foe;
    if (foe === 'player') {
      this.fightNpc(n, this.player, dt, TRAFFIC.npcDamage * DIFFICULTY[this.settings.difficulty].enemyDamage);
      if (n.seekerIn !== undefined) this.tickSeeker(n, dt);
    } else if (foe) {
      this.fightNpc(n, foe.body, dt, TRAFFIC.npcDamage);
    } else {
      for (const g of n.guns) g.tick(dt);
      flyTo(n.body, b.post, { arriveDistance: 250, allowCruise: false, maxThrottle: 0.8 }, n.controls);
      n.body.requestCruise(false);
    }
  }

  /** Test hook: the border battle due, under way or done here, the pilot's part, and each battle ship. */
  battleStatus(): ReturnType<BorderBattle['status']> & { ships: { id: string; side: BattleSide; hull: number; over: string | null; turned: boolean; foe: string | null; distance: number }[] } {
    return {
      ...this.borderBattle.status(),
      ships: this.npcs
        .filter((n) => n.battle && n.durability.hull > 0)
        .map((n) => ({ id: n.id, side: n.battle!.side, hull: n.durability.hull, over: n.battle!.over ?? null, turned: !!n.battle!.turned, foe: n.foe === 'player' ? 'player' : (n.foe?.id ?? null), distance: n.body.position.distanceTo(this.player.position) })),
    };
  }

  /** A sweep comes for a den: waves of lawful ships from the jump beacon, and the den's crews turn out. */
  private startSweep(d: NonNullable<TrafficSetup['defences']>[number]): void {
    const site = this.system.dock(d.locationId);
    if (!site || this.downDens.has(d.locationId)) return;
    // One ship more than must be downed, spread over the waves.
    const total = d.count + 1;
    const waves = Array.from({ length: DENS.sweep.waves }, (_, i) => Math.ceil((total - i) / DENS.sweep.waves));
    this.sweeps.push({ jobId: d.jobId, locationId: d.locationId, waves, next: 0, t: 6, faction: d.faction ?? 'sta' });
    const pack = ++this.packSerial;
    const home = site.def.position.clone().addScaledVector(site.approach, site.radius + 900);
    this.packHome.set(pack, home);
    const pool = RAIDERS[2];
    for (let i = 0; i < DENS.sweep.defenders; i++) this.spawnGuard(pool[i % pool.length]!, pack, home.clone().add(this.tmp.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(500)));
  }

  private updateSweeps(dt: number): void {
    for (const sw of this.sweeps) {
      if (sw.next >= sw.waves.length) continue;
      const flying = this.npcs.filter((n) => n.sweep && n.contract === sw.jobId && n.durability.hull > 0).length;
      // The next wave comes when the last is nearly spent.
      if (sw.next > 0 && flying > 1) continue;
      sw.t -= dt;
      if (sw.t > 0) continue;
      const count = sw.waves[sw.next]!;
      sw.next += 1;
      sw.t = 8;
      const site = this.system.dock(sw.locationId)!;
      const from = this.jumpPoint();
      const heading = site.def.position.clone().sub(from).normalize();
      for (let i = 0; i < count; i++) {
        const model = DENS.sweep.models[i % DENS.sweep.models.length]!;
        const position = from.clone().addScaledVector(heading, 800 + i * 60).add(this.tmp.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(400));
        const npc = this.makeNpc(model, 'patrol', sw.faction, position, heading, `${FACTIONS[sw.faction].shortName} sweep · hostile`);
        npc.name = `${FACTIONS[sw.faction].shortName} sweep`;
        npc.target.name = npc.name;
        npc.sweep = { locationId: sw.locationId };
        npc.contract = sw.jobId;
        npc.foe = 'player';
      }
      this.sfx('alert');
      this.callbacks.onMessage(sw.next === 1 ? `${count} ${FACTIONS[sw.faction].shortName} sweep ships inbound for ${getLocation(sw.locationId).name}!` : `A second wave: ${count} more sweep ships inbound!`, 'bad');
    }
  }

  /** Sweep ships make for the den, fighting the player and the den's crews on the way. */
  private flySweep(n: NpcShip, dt: number): void {
    const site = this.system.dock(n.sweep!.locationId);
    const onPlayer = this.alive && !this.busy && this.autopilot.mode !== 'lane' && n.body.position.distanceTo(this.player.position) < 4_000;
    const raider = onPlayer ? null : this.nearestShip(n.body.position, 4_000, (x) => x.side === 'raider' && !x.den);
    n.foe = onPlayer ? 'player' : raider;
    if (onPlayer) this.fightNpc(n, this.player, dt, TRAFFIC.npcDamage * DIFFICULTY[this.settings.difficulty].enemyDamage);
    else if (raider) this.fightNpc(n, raider.body, dt, TRAFFIC.npcDamage);
    else {
      for (const g of n.guns) g.tick(dt);
      if (site) flyTo(n.body, site.def.position.clone().addScaledVector(site.approach, site.radius + 700), { arriveDistance: 400, allowCruise: true, maxThrottle: 1 }, n.controls);
    }
  }

  // ---------------------------------------------------------------- combat depth (docs/PROCGEN.md §15)

  /** Damage to the ship's systems slows the engines, the guns' fire and the shield. */
  private applySystems(): void {
    const sys = this.state.ship.systems;
    const r = COMBAT.systems;
    const e = 1 - r.engines * sys.engines;
    const b = this.baseFlight;
    this.player.params = { ...b, maxSpeed: b.maxSpeed * e, boostSpeed: b.boostSpeed * e, cruiseSpeed: b.cruiseSpeed * e, strafeSpeed: b.strafeSpeed * e };
    // The gunner's guns hit harder, the engineer's shield recharges faster (docs/PROCGEN.md §30.2).
    const crew = this.crewNow;
    this.guns.forEach((g, i) => (g.profile = { ...g.profile, shotsPerSecond: this.baseGunRates[i]! * (1 - r.guns * sys.guns), damage: this.baseGunDamage[i]! * (1 + crew.gunDamage) }));
    const d = this.playerDurability;
    d.shieldRegen = this.baseShield.regen * (1 - r.shields.regen * sys.shields) * (1 + crew.shieldRegen);
    d.shieldMax = this.baseShield.capacity * (1 - r.shields.capacity * sys.shields);
    d.shield = Math.min(d.shield, d.shieldMax);
  }

  /** A hull hit may damage a system: engines, guns or shields. */
  private maybeHitSystem(hullDamage: number): void {
    if (this.rand() >= Math.min(0.6, hullDamage * COMBAT.systems.chancePerPoint)) return;
    const kinds = ['engines', 'guns', 'shields'] as const;
    const k = kinds[Math.floor(this.rand() * kinds.length)]!;
    const [lo, hi] = COMBAT.systems.severity;
    const sys = this.state.ship.systems;
    sys[k] = Math.min(1, sys[k] + lo + this.rand() * (hi - lo));
    this.applySystems();
    this.sfx('alert', 0.7);
    this.callbacks.onMessage(`${k === 'engines' ? 'Engines' : k === 'guns' ? 'Guns' : 'Shield generator'} damaged (${Math.round(sys[k] * 100)}%)! A repair kit or a dock will fix it.`, 'bad');
    this.maybeHurtCrew(k === 'guns' ? 'gunner' : 'engineer');
  }

  /** A hit may hurt the crew member who works what it struck (docs/PROCGEN.md §30.5): out of action until mended. */
  private maybeHurtCrew(role: CrewRole): void {
    const m = this.state.aboard?.members.find((x) => x.role === role);
    if (!m || isHurt(m, this.state.clock) || this.crewRand() >= CREW.hurt.odds[role]) return;
    const hurt = hurtCrew(this.state, role);
    if (!hurt) return;
    this.crewNow = crewEffects(this.state);
    this.applySystems();
    this.callbacks.onComm?.(hurt.name, CREW_RADIO.hurt[hashString(`${hurt.id}|${this.state.clock}`) % CREW_RADIO.hurt.length]!);
    this.callbacks.onMessage(CREW_NOTES.hurt.replace('{name}', hurt.name), 'bad');
  }

  /** The crew at work (docs/PROCGEN.md §30.2): who is well now, and the engineer mending damaged systems while no hostile is near. */
  private updateCrew(dt: number): void {
    if (!this.state.aboard?.members.length) return;
    this.crewTick -= dt;
    if (this.crewTick > 0) return;
    const step = 0.5 - this.crewTick;
    this.crewTick = 0.5;
    const before = this.crewNow;
    const e = (this.crewNow = crewEffects(this.state));
    let changed = before.gunDamage !== e.gunDamage || before.shieldRegen !== e.shieldRegen;
    const sys = this.state.ship.systems;
    const kinds = ['engines', 'guns', 'shields'] as const;
    if (e.mend > 0 && this.alive && !this.hostilesNearby(e.quiet)) {
      for (const k of kinds) {
        if (sys[k] <= e.floor) continue;
        sys[k] = Math.max(e.floor, sys[k] - e.mend * step);
        this.crewMending = changed = true;
      }
      // Done with what can be done out here: the engineer says so.
      if (this.crewMending && kinds.every((k) => sys[k] <= e.floor)) {
        this.crewMending = false;
        const eng = this.state.aboard.members.find((m) => m.role === 'engineer');
        if (eng) this.callbacks.onComm?.(eng.name, CREW_RADIO.mended[hashString(`${eng.id}|${Math.floor(this.state.clock)}`) % CREW_RADIO.mended.length]!);
      }
    }
    if (changed) this.applySystems();
  }

  /** The ship's scanner reach (a factor), the navigator's on top (docs/PROCGEN.md §30.2), cut by a flare in the system (§43.3). */
  private scanner(): number {
    return this.perf.scanRange * (1 + this.crewNow.scan) * this.flareFx.scanner;
  }

  /**
   * A flare star flaring in this system (docs/PROCGEN.md §43.3), looked at twice a second: shields
   * and scanners cut while it lasts, the star glowing, its target saying so, and the radio telling
   * of it when it starts, when the pilot finds one under way, and when it ends.
   */
  private updateFlare(dt: number): void {
    this.flareTick -= dt;
    if (this.flareTick > 0) return;
    this.flareTick = 0.5;
    const clock = this.state.clock;
    const systemId = this.state.location.systemId;
    const f = flareAt(systemId, clock);
    const before = this.flare;
    if ((f?.id ?? null) !== (before === undefined ? undefined : (before?.id ?? null))) {
      this.flare = f;
      this.flareFx = flareEffects(systemId, clock);
      const say = f ? flareComm(before !== undefined && clock - f.start < 30 ? 'start' : 'under', f, clock) : before ? flareComm('end', before, clock) : null;
      if (say) {
        this.callbacks.onComm?.(say.speaker, say.text);
        if (f && before !== undefined) this.sfx('alert', 0.5);
      }
    }
    for (const star of this.system.stars) {
      if (!flareStar(star.def.id)) continue;
      this.system.setStarFlare(star.def.id, starGlow(star.def.id, clock));
      const t = this.system.targets.find((x) => x.id === `star:${star.def.id}`);
      if (t) t.subtitle = flareSubtitle(star.def.id, clock);
    }
  }

  /** Test-only: the flare under way here, what it does, and how brightly its star glows (null without one). */
  debugFlare(): { id: string; star: string; kind: string; shields: number; scanner: number; glow: number; subtitle: string } | null {
    const f = this.flare;
    if (!f) return null;
    const t = this.system.targets.find((x) => x.id === `star:${f.star}`);
    return { id: f.id, star: f.star, kind: f.kind, shields: this.flareFx.shields, scanner: this.flareFx.scanner, glow: this.system.stars.find((x) => x.def.id === f.star)?.flare ?? 0, subtitle: t?.subtitle ?? '' };
  }

  /** Raiders who carry seekers fire one at the player now and then, when in range and roughly facing. */
  private tickSeeker(n: NpcShip, dt: number): void {
    if (n.seekerIn === undefined || !this.alive || this.busy) return;
    n.seekerIn -= dt;
    if (n.seekerIn > 0) return;
    const to = this.tmp.copy(this.player.position).sub(n.body.position);
    const d = to.length();
    const [lo, hi] = COMBAT.seekers.range;
    if (d < lo || d > hi || n.body.forward(this.tmp2).angleTo(to) > COMBAT.seekers.cone) return;
    const [a, b] = COMBAT.seekers.every;
    n.seekerIn = a + this.rand() * (b - a);
    const art = createMissileArt(this.ctx);
    this.system.scene.add(art.object);
    const dir = n.body.forward(new THREE.Vector3());
    const pos = n.body.position.clone().addScaledVector(dir, n.art.radius + 4);
    this.missiles.push({
      art,
      position: pos,
      direction: dir,
      speed: Math.max(60, n.body.velocity.length()),
      target: this.playerMissileTarget,
      ownerId: n.id,
      damage: COMBAT.seekers.damage * DIFFICULTY[this.settings.difficulty].enemyDamage,
      life: COMBAT.seekers.lifetime,
      alive: true,
      maxSpeed: COMBAT.seekers.speed,
      turnRate: COMBAT.seekers.turnRate,
    });
    this.sfx('missile-launch', 0.7);
    this.sfx('alert', 0.8);
    this.callbacks.onMessage(`Seeker inbound! Turn hard or drop a decoy (${this.state.ship.decoys} left).`, 'bad');
    this.chatter('missile', n.name);
  }

  /** Seekers homing on the player right now. */
  private get incomingSeekers(): number {
    return this.missiles.filter((m) => m.target === this.playerMissileTarget).length;
  }

  /** A decoy flare: seekers homing on the player nearby may go for it instead. */
  private launchDecoy(): void {
    if (!this.alive || this.busy) return;
    if (this.state.ship.decoys <= 0) {
      this.callbacks.onMessage('No decoys left.', 'bad');
      return;
    }
    if (this.decoyCooldown > 0) return;
    this.state.ship.decoys -= 1;
    this.decoyCooldown = COMBAT.decoys.cooldown;
    const position = this.player.position.clone().addScaledVector(this.player.up(this.tmp), -3).addScaledVector(this.player.forward(this.tmp2), -10);
    const velocity = this.player.velocity.clone().multiplyScalar(0.4).add(new THREE.Vector3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(60));
    const art = createFlareArt(this.ctx);
    art.object.position.copy(position);
    this.system.scene.add(art.object);
    const target: MissileTarget = { id: `decoy:${++this.lootSerial}`, position, velocity, radius: 30, alive: true };
    this.decoys.push({ art, position, velocity, life: COMBAT.decoys.lifetime, target });
    let fooled = 0;
    for (const m of this.missiles) {
      if (m.target !== this.playerMissileTarget || m.position.distanceTo(this.player.position) > COMBAT.decoys.range) continue;
      if (this.rand() < COMBAT.decoys.chance) {
        m.target = target;
        fooled++;
      }
    }
    this.sfx('missile-launch', 0.35);
    this.callbacks.onMessage(fooled ? `Decoy away: ${fooled === 1 ? 'the seeker is' : `${fooled} seekers are`} chasing it.` : 'Decoy away.', fooled ? 'good' : 'info');
  }

  private updateDecoys(dt: number): void {
    this.decoyCooldown = Math.max(0, this.decoyCooldown - dt);
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const d = this.decoys[i]!;
      d.life -= dt;
      d.velocity.multiplyScalar(Math.exp(-0.6 * dt));
      d.position.addScaledVector(d.velocity, dt);
      d.art.object.position.copy(d.position);
      d.art.setLife(d.life / COMBAT.decoys.lifetime);
      d.art.update?.(dt, this.time, this.camera);
      if (d.life > 0) continue;
      d.target.alive = false;
      this.system.scene.remove(d.art.object);
      d.art.dispose();
      this.decoys.splice(i, 1);
    }
  }

  /** A mine: it arms after a moment and goes off when a ship comes close, or when shot. */
  private spawnMine(at: THREE.Vector3, life: number = COMBAT.mines.life): void {
    const art = createMineArt(this.ctx);
    art.object.position.copy(at);
    this.system.scene.add(art.object);
    const position = at.clone();
    this.mines.push({
      art,
      position,
      armIn: COMBAT.mines.arm,
      life,
      hull: COMBAT.mines.hull,
      target: { id: `mine:${++this.lootSerial}`, name: 'Mine', kind: 'ship', position, radius: 6, subtitle: 'Proximity mine · shoot it or keep clear', dataClass: 'fictional', hostile: true, alive: true, cycle: false },
    });
  }

  private updateMines(dt: number): void {
    const m = COMBAT.mines;
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const mine = this.mines[i]!;
      mine.life -= dt;
      const wasArmed = mine.armIn <= 0;
      mine.armIn -= dt;
      if (!wasArmed && mine.armIn <= 0) mine.art.setArmed(true);
      mine.art.update?.(dt, this.time, this.camera);
      if (mine.life <= 0) {
        this.removeMine(i);
        continue;
      }
      if (mine.armIn > 0) continue;
      const near =
        (this.alive && !this.busy && mine.position.distanceTo(this.player.position) < m.trigger) ||
        this.npcs.some((n) => !n.den && n.durability.hull > 0 && n.body.position.distanceTo(mine.position) < m.trigger);
      if (near) this.detonateMine(i);
    }
  }

  /** The blast hurts every ship within reach, less at the edge. */
  private detonateMine(i: number): void {
    const mine = this.mines[i]!;
    const m = COMBAT.mines;
    const at = mine.position.clone();
    this.removeMine(i);
    this.spawnEffect(createExplosion(at, 7, this.ctx));
    if (at.distanceTo(this.player.position) < 3_000) this.sfx('explosion-small', 0.8);
    const falloff = (d: number) => Math.max(0, 1 - d / m.blast);
    const dp = at.distanceTo(this.player.position);
    if (this.alive && dp < m.blast) this.damagePlayer(m.damage * falloff(dp) * DIFFICULTY[this.settings.difficulty].enemyDamage, this.player.position.clone(), 'kinetic');
    for (const n of [...this.npcs]) {
      const d = n.body.position.distanceTo(at);
      if (!n.den && n.durability.hull > 0 && d < m.blast) this.damageNpc(n, m.damage * falloff(d), n.body.position.clone(), 'kinetic');
    }
  }

  private removeMine(i: number): void {
    const mine = this.mines[i]!;
    mine.target.alive = false;
    if (this.selectedId === mine.target.id) this.selectedId = null;
    this.system.scene.remove(mine.art.object);
    mine.art.dispose();
    this.mines.splice(i, 1);
  }

  /** A raider's threat level, from its ship: 1 for a light fighter, up to 3 for a heavy one of a higher class. */
  private raiderLevel(n: NpcShip): 1 | 2 | 3 {
    const model = shipModel(n.modelId);
    return Math.max(1, Math.min(3, model.tier + (model.class === 'heavy-fighter' ? 1 : 0))) as 1 | 2 | 3;
  }

  /** Salvaged equipment a raider of this level might carry: a catalogue item up to a class above its own. */
  private pickGear(level: 1 | 2 | 3): string | null {
    const pool = getCatalog().gear.filter((g) => g.tier <= Math.min(3, level + 1) && g.tier >= Math.max(1, level - 1));
    return pool.length ? pool[Math.floor(this.rand() * pool.length)]!.id : null;
  }

  /** Beyond salvage: a cargo pod now and then, and rarely an equipment crate (aces always carry one). */
  private dropLoot(n: NpcShip): void {
    const L = COMBAT.loot;
    const spill = () => n.body.position.clone().add(this.tmp.set((this.rand() - 0.5) * 50, (this.rand() - 0.5) * 20, (this.rand() - 0.5) * 50));
    if (this.rand() < L.podChance) {
      const [lo, hi] = L.podQty;
      this.spawnLoot(spill(), 0, { cargo: { commodity: L.podGoods[Math.floor(this.rand() * L.podGoods.length)] as CommodityId, qty: lo + Math.floor(this.rand() * (hi - lo + 1)) } });
    }
    const level = n.ace ? 3 : this.raiderLevel(n);
    if (n.ace || this.rand() < L.gearChance[level]) {
      const gear = this.pickGear(level);
      if (gear) this.spawnLoot(spill(), 0, { gear });
    }
  }

  /** Hired wingmen: they launch with the player and keep station off their wing. */
  private spawnCrew(crew: NonNullable<TrafficSetup['crew']>): void {
    crew.forEach((w, i) => {
      const offset = new THREE.Vector3(i % 2 === 0 ? -80 : 80, 14, 70 + i * 20);
      const position = offset.clone().applyQuaternion(this.player.quaternion).add(this.player.position);
      // A rival flying as an ally (docs/PROCGEN.md §28), in their own ship.
      const ally = w.ally ? rivalById(w.ally) : undefined;
      const npc = this.makeNpc(w.model, 'patrol', 'independent', position, this.player.forward(new THREE.Vector3()), ally ? `Your ally · the ${ally.shipName}` : 'Your wingman');
      npc.name = w.name;
      npc.target.name = w.name;
      npc.target.hostile = false;
      // By grade (docs/PROCGEN.md §34): an ally flies at its hire's grade and earns nothing.
      const skill = wingSkill(w.grade ?? (w.skill === 'sharp' ? 2 : 1));
      npc.wingman = { offset, crewId: w.id, damage: skill.damage, accuracy: skill.accuracy, evade: skill.evade, react: skill.react, ...(w.hurt ? { hurt: true } : {}), ...(w.ally ? { ally: true } : {}) };
      if (ally) npc.rival = { id: ally.id };
    });
    if (crew.length) this.chatter('wing-join', crew[0]!.name, true);
  }

  /** A raider den wakes when a pilot it does not trust comes near: turrets, the reactor, mines and its crews. */
  private watchDens(): void {
    if (this.denOpen || !this.alive) return;
    for (const d of this.denTargets) {
      const id = d.locationId!;
      if (this.denAlerted.has(id) || this.downDens.has(id)) continue;
      if (d.position.distanceTo(this.player.position) > DENS.alert) continue;
      this.denAlerted.add(id);
      this.spawnAssault({ jobId: null, locationId: id, turretsLeft: DENS.turrets, wing: null });
      this.sfx('alert');
      this.callbacks.onMessage(`${getLocation(id).name}’s defences are live: turrets, mines and the reactor behind them.`, 'bad');
      this.chatter('den-alert', 'Wake den', true);
    }
  }

  /** Close enough to the player for its radio chatter to be heard. */
  private inRadioRange(n: NpcShip): boolean {
    return n.body.position.distanceTo(this.player.position) < COMBAT.chatterRange;
  }

  /** Radio chatter, at most one line every few seconds. */
  private chatter(kind: ChatterKind, speaker: string, force = false): void {
    if (!force && this.time - this.chatterAt < COMBAT.chatterEvery) return;
    this.chatterAt = this.time;
    const lines = CHATTER[kind];
    this.callbacks.onComm?.(speaker, lines[Math.floor(this.rand() * lines.length)]!);
  }

  private canDock(site: DockSite): boolean {
    if (this.downDens.has(site.def.locationId)) return false;
    return site.dockable || (this.denOpen && getLocation(site.def.locationId).stationType === 'pirate-den');
  }

  private flyRaider(n: NpcShip, dt: number): void {
    if (n.hunter || n.hired) {
      // Hunters (and a rival's hired guns) want the player and nobody else; they wait out lanes and docking.
      n.foe = this.alive && !this.busy ? 'player' : null;
      if (n.foe) {
        this.fightNpc(n, this.player, dt, TRAFFIC.npcDamage * DIFFICULTY[this.settings.difficulty].enemyDamage);
        this.tickSeeker(n, dt);
      } else for (const g of n.guns) g.tick(dt);
      return;
    }
    const pack = this.npcs.filter((x) => x.pack === n.pack && x.durability.hull > 0);
    const sees = (x: NpcShip) => x.body.position.distanceTo(this.player.position) < TRAFFIC.detectRange;
    const playerFair = this.alive && !this.busy && this.autopilot.mode !== 'lane' && !this.raiderSparesPlayer(n);
    if (n.prey && n.prey.durability.hull > 0 && this.time - n.playerHitAt > 6) {
      // Ambushers go for the escorted ship until the player makes them turn.
      n.foe = n.prey;
    } else if (playerFair && (n.foe === 'player' || pack.some(sees))) {
      n.foe = 'player';
    } else {
      const prey = n.foe && n.foe !== 'player' && n.foe.durability.hull > 0 ? n.foe : this.nearestShip(n.body.position, TRAFFIC.huntRange, (x) => x.side === 'lawful' && !x.captain?.safe);
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
        this.chatter('raider-spot', 'Wake raider');
        if (this.autopilot.mode === 'goto') this.autopilot = { mode: 'none' };
        this.player.requestCruise(false);
      }
      const scale = TRAFFIC.npcDamage * (toPlayer ? DIFFICULTY[this.settings.difficulty].enemyDamage : 1) * (n.ace ? CONTRACTS.ace.damage : 1);
      this.fightNpc(n, toPlayer ? this.player : (n.foe as NpcShip).body, dt, scale);
      if (toPlayer) this.tickSeeker(n, dt);
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
    // Breaking off, a raider may dump a mine behind it.
    if (n.brain.state === 'escaped' && !n.mineRolled) {
      n.mineRolled = true;
      if (this.inRadioRange(n)) {
        this.chatter('raider-flee', n.name);
        if (this.rand() < COMBAT.mines.dropChance) this.spawnMine(n.body.position.clone().addScaledVector(n.body.forward(this.tmp), -40));
      }
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
      // Border battle ships aim alike at each other (docs/PROCGEN.md §35); at the pilot, raiders aim as the difficulty says.
      accuracy: n.battle && foe !== this.player ? BATTLES.aim : n.side === 'raider' ? DIFFICULTY[this.settings.difficulty].enemyAccuracy : (n.wingman?.accuracy ?? 0.6),
      projectileSpeed: g0?.profile.projectileSpeed ?? 800,
      gunRange: g0?.profile.range ?? 900,
      ...(n.wingman?.evade !== undefined ? { evade: n.wingman.evade } : {}),
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
    // A race under way is not stopped for a discovery: it comes after the finish (docs/PROCGEN.md §33.4).
    if (this.race?.closed) return;
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

  /** Tours seen here already, this flight. */
  private readonly sightsSeen = new Set<string>();

  /**
   * The far stars (docs/PROCGEN.md §25): how bright they are now, and their targets, which show
   * while a star's death is under way or a contract wants it watched (and never while it is gone).
   */
  private updateSky(): void {
    const here = this.state.location.systemId;
    const looks = this.skyStars.map((s) => (s.id === PYRE_ID ? pyreLook(here, this.state.clock) : farStarLook(s.id, this.state.clock)) ?? { magnitude: Infinity, colour: '#ffffff' });
    this.farSky.set(this.skyStars.map((s, i) => ({ dir: s.dir, magnitude: looks[i]!.magnitude, colour: looks[i]!.colour })));
    this.skyStars.forEach((s, i) => {
      if (s.id === PYRE_ID) return this.updatePyreTarget(s);
      const phase = skyPhase(s.id, this.state.clock);
      const show = looks[i]!.magnitude < STELLAR.nakedEye && (phase === 'dying' || observationsWanted(this.state, s.id).length > 0);
      s.target.alive = show;
      s.target.cycle = show;
      // The star is real; its death, and what is left after, are fiction, and the target says so.
      const what = s.id !== STELLAR.supernova.star ? 'Collapsing' : phase === 'dying' ? 'Supernova' : 'Supernova remnant';
      s.target.dataClass = phase === 'catalogue' ? 'observed' : 'fictional';
      s.target.subtitle = phase === 'catalogue' ? s.base : `${what} · magnitude ${magnitudeText(looks[i]!.magnitude)}`;
      if (!show && this.selectedId === s.target.id) this.selectedId = null;
    });
  }

  /**
   * Pyre's target (docs/PROCGEN.md §26), always marked as fiction: from its warning on, as the star,
   * then counting down to its light's arrival here, then the supernova and what is left of it.
   */
  private updatePyreTarget(s: { id: string; base: string; target: Target }): void {
    const edge = activeEdge();
    const clock = this.state.clock;
    const here = this.state.location.systemId;
    const show = edge !== null && clock >= edge;
    s.target.alive = show;
    s.target.cycle = show;
    if (edge === null) return;
    const look = pyreLook(here, clock, edge);
    const arrives = lightArrives(here, edge);
    const breakout = lightArrives(PYRE_ID, edge);
    if (clock >= arrives) s.target.subtitle = `${look.phase === 'remnant' ? 'Supernova remnant' : 'Supernova'} · magnitude ${magnitudeText(look.magnitude)}`;
    else if (clock >= breakout) {
      const left = Math.ceil(arrives - clock);
      s.target.subtitle = `Its light arrives in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    } else s.target.subtitle = s.base;
  }

  /** Sightseers' sights (docs/PROCGEN.md §23.2): seen once each, scanned before or not. */
  private watchSights(): void {
    if (!this.alive) return;
    for (const s of this.traffic?.sights ?? []) {
      if (this.sightsSeen.has(s.jobId) || !sightInView(this.system.def, s.targetId, this.player.position)) continue;
      this.sightsSeen.add(s.jobId);
      this.callbacks.onSight?.(s.jobId);
    }
  }

  // ---------------------------------------------------------------- wrecks to fly to (docs/PROCGEN.md §31)

  /** Brings a site marked mid-flight into the scene (a hail answered, a scan's find, a trail followed). */
  addSite(setup: SiteSetup): void {
    if (this.sites.some((s) => s.setup.id === setup.id)) return;
    this.spawnSite(setup);
  }

  /**
   * A site where the save puts it: a wreck tumbling with its pods round it (and raiders picking it
   * over), a derelict a size up and dark, a ship in distress at rest, or pods adrift round a spot.
   * Raiders lying dark by it come out only when sprung.
   */
  private spawnSite(setup: SiteSetup): void {
    const id = setup.id;
    const centre = placeSite(this.system.def, id, setup.body);
    const r = seededRandom(hashString(`site-look|${id}`));
    const spin = new THREE.Vector3(setup.kind === 'derelict' ? 0.004 : 0.02 + r() * 0.03, setup.kind === 'derelict' ? 0.006 : 0, 0);
    let hull: ShipArt | null = null;
    let target: Target;
    if (setup.kind === 'ship' && !setup.bait && setup.model) {
      // A ship in distress: dead in space until the pilot comes alongside.
      const npc = this.makeNpc(setup.model, 'trader', 'independent', centre, new THREE.Vector3(1, 0, 0), SITE_SUBTITLES.ship);
      npc.name = setup.ship;
      npc.site = id;
      npc.body.velocity.set(0, 0, 0);
      npc.target.id = `site:${id}`;
      npc.target.name = fillSite(SITE_NAMES.ship, setup);
      npc.target.hostile = false;
      if (setup.reached) npc.target.subtitle = SITE_NOTES.reached.replace('{ship}', setup.ship);
      target = npc.target;
    } else {
      if (setup.model) {
        hull = createCatalogShipArt(shipModel(setup.model), this.ctx);
        hull.object.position.copy(centre);
        hull.object.rotation.set(r() * Math.PI, r() * Math.PI, r() * Math.PI);
        hull.object.scale.setScalar(setup.scale);
        hull.setThrottle(0);
        this.system.scene.add(hull.object);
      }
      const first = setup.pods[0]?.what;
      const name =
        setup.kind === 'ship'
          ? SITE_NAMES.ship
          : setup.kind === 'wreck'
            ? SITE_NAMES.wreck
            : setup.kind === 'derelict'
              ? SITE_NAMES.derelict
              : first === 'lifepod'
                ? SITE_NAMES.lifepod
                : first === 'recorder'
                  ? SITE_NAMES.recorder
                  : SITE_NAMES.cargo;
      target = {
        id: `site:${id}`,
        name: fillSite(name, setup),
        // A decoy looks like any ship in distress.
        kind: setup.kind === 'ship' ? 'ship' : 'wreck',
        position: centre,
        radius: hull ? hull.radius * setup.scale : 15,
        subtitle: fillSite(SITE_SUBTITLES[setup.kind], setup),
        dataClass: 'fictional',
        hostile: false,
        alive: true,
        cycle: true,
      };
    }
    const site: SiteHere = { setup, centre, hull, spin, target, guardPack: null, near: false, scanned: false, ended: false };
    this.sites.push(site);
    // Its pods (those not yet tractored in), round the spot.
    for (const pod of setup.pods) {
      if (setup.taken.includes(pod.index)) continue;
      const what = pod.cargo ? `${pod.cargo.qty} × ${COMMODITIES[pod.cargo.commodity].name.toLowerCase()}` : pod.what === 'lifepod' && setup.person ? `${setup.person} aboard` : POD_NAMES[pod.what];
      this.spawnLoot(centre.clone().add(podOffset(id, pod.index)), 0, {
        ...(pod.cargo ? { cargo: pod.cargo } : {}),
        site: { id, index: pod.index, name: POD_NAMES[pod.what], subtitle: `${what} · ${POD_SUBTITLE}` },
      });
    }
    // Raiders picking a wreck over: seen, holding their spot, back whole until all are down.
    if (setup.guard && !setup.cleared) {
      const pack = ++this.packSerial;
      const home = centre.clone().add(new THREE.Vector3(0, 300, 0));
      this.packHome.set(pack, home);
      const pool = RAIDERS[setup.guard];
      for (let i = 0; i < setup.guard; i++) {
        const g = this.spawnGuard(pool[i % pool.length]!, pack, home.clone().add(this.tmp.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(500)));
        g.site = id;
      }
      site.guardPack = pack;
    }
  }

  /** The site whose marker this is (not one finished with). */
  private siteOf(targetId: string): SiteHere | null {
    return this.sites.find((s) => !s.ended && s.target.id === targetId) ?? null;
  }

  /** From the player to a site's hull (or its spot). */
  private siteDistance(s: SiteHere): number {
    return Math.max(0, s.target.position.distanceTo(this.player.position) - s.target.radius);
  }

  /** Raiders lying dark come out: by the hull, unless the Wake trusts the pilot (they wave them by). */
  private springSite(s: SiteHere, how: 'near' | 'scan'): void {
    s.setup.sprung = true;
    const friend = this.denOpen;
    if (!friend && s.setup.dark) {
      const pack = ++this.packSerial;
      const home = s.centre.clone();
      this.packHome.set(pack, home);
      const pool = RAIDERS[s.setup.dark];
      for (let i = 0; i < Math.max(1, s.setup.darkCount); i++) {
        const model = pool[Math.floor(this.rand() * pool.length)]!;
        const position = home.clone().add(this.tmp.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(400));
        const bounty = bountyFor(model);
        const npc = this.makeNpc(model, 'raider', 'hollow-wake', position, this.player.position.clone().sub(position).normalize(), `${FACTIONS['hollow-wake'].name} raider · hostile · bounty ${bounty} cr`);
        npc.pack = pack;
        npc.bounty = bounty;
        npc.site = s.setup.id;
      }
      this.sfx('alert');
    }
    this.callbacks.onSite?.(s.setup.id, 'sprung', { how, friend });
  }

  /** A scan of a site: a wreck's log read; from beyond the spring range, raiders lying dark shown and sprung. */
  private scanSite(s: SiteHere): void {
    const d = this.siteDistance(s);
    if (d > WRECKS.scanRange * this.scanner()) {
      this.callbacks.onMessage('Out of scan range — fly closer.', 'bad');
      return;
    }
    this.sfx('scan');
    s.scanned = true;
    let revealed = false;
    if (s.setup.dark !== null && !s.setup.sprung && d > WRECKS.danger.spring) {
      this.springSite(s, 'scan');
      revealed = true;
    }
    if (s.setup.kind === 'wreck') s.setup.read = true;
    this.callbacks.onSite?.(s.setup.id, 'scanned', { revealed });
  }

  /** A ship in distress: at rest until the pilot comes alongside, then its drive is back. */
  private flySiteShip(n: NpcShip, dt: number): void {
    for (const g of n.guns) g.tick(dt);
    n.controls.throttle = 0;
    n.body.velocity.multiplyScalar(Math.max(0, 1 - dt * 0.5));
    const s = this.sites.find((x) => x.setup.id === n.site);
    if (!s || s.setup.reached || s.ended || !this.alive || this.busy) return;
    if (n.body.position.distanceTo(this.player.position) > WRECKS.reach) return;
    s.setup.reached = true;
    n.target.subtitle = SITE_NOTES.reached.replace('{ship}', s.setup.ship);
    this.sfx('mission-complete');
    this.callbacks.onSite?.(s.setup.id, 'reached');
  }

  /** The derelict the pilot may board now: alongside, slow, nobody hostile near. */
  private boardable(): SiteHere | null {
    if (!this.alive || this.busy || this.boarding || this.player.speed > WRECKS.board.maxSpeed) return null;
    const near = this.sites.find((s) => !s.ended && s.setup.kind === 'derelict' && !s.setup.boarded && this.siteDistance(s) <= WRECKS.board.range);
    if (!near || this.hostilesNearby(WRECKS.board.quiet)) return null;
    return near;
  }

  private startBoarding(s: SiteHere): void {
    this.autopilot = { mode: 'none' };
    this.player.requestCruise(false);
    this.throttle = 0;
    this.drift = false;
    this.boarding = { id: s.setup.id, left: WRECKS.board.seconds };
    this.callbacks.onMessage(fillSite(SITE_NOTES.boarding, s.setup), 'info');
  }

  private breakBoarding(why: keyof typeof SITE_NOTES.why): void {
    this.boarding = null;
    this.callbacks.onMessage(SITE_NOTES.broken.replace('{why}', SITE_NOTES.why[why]), 'bad');
  }

  /**
   * Each frame: hulls turn; a site's radio as the pilot nears it; raiders lying dark spring within
   * range; a site's guards all down; boarding held (the ship eased to rest) or broken off.
   */
  private updateSites(dt: number): void {
    if (!this.sitesSpawned && this.time > 2) {
      this.sitesSpawned = true;
      for (const setup of this.traffic?.sites ?? []) this.addSite(setup);
    }
    for (const s of this.sites) {
      if (s.hull) {
        s.hull.object.rotation.x += s.spin.x * dt;
        s.hull.object.rotation.y += s.spin.y * dt;
      }
      if (s.ended) continue;
      const rec = this.state.world.wrecks?.sites[s.setup.id];
      if (!rec || rec.ended) {
        this.endSite(s, rec?.ended?.how ?? 'dropped');
        continue;
      }
      if (!this.alive) continue;
      const d = this.siteDistance(s);
      if (!s.near && d < 5_000) {
        s.near = true;
        this.callbacks.onSite?.(s.setup.id, 'near');
      }
      if (s.setup.dark !== null && !s.setup.sprung && d < WRECKS.danger.spring && !this.busy) this.springSite(s, 'near');
      if (s.guardPack !== null && !s.setup.cleared && !this.npcs.some((n) => n.pack === s.guardPack && n.durability.hull > 0)) {
        s.setup.cleared = true;
        this.callbacks.onSite?.(s.setup.id, 'cleared');
      }
    }
    const b = this.boarding;
    if (!b) return;
    const s = this.sites.find((x) => x.setup.id === b.id);
    if (!s || s.ended || !this.alive) return this.breakBoarding('gone');
    if (this.siteDistance(s) > WRECKS.board.range) return this.breakBoarding('range');
    if (this.player.speed > WRECKS.board.maxSpeed) return this.breakBoarding('speed');
    if (this.hostilesNearby(WRECKS.board.quiet)) return this.breakBoarding('hostile');
    this.player.velocity.multiplyScalar(Math.exp(-1.5 * dt));
    b.left -= dt;
    if (b.left > 0) return;
    this.boarding = null;
    s.setup.boarded = true;
    this.sfx('mission-complete');
    this.callbacks.onSite?.(s.setup.id, 'boarded');
  }

  /** A site finished with: its marker goes (a hull stays, drifting); pods are left only after it is done. */
  private endSite(s: SiteHere, how: string): void {
    s.ended = true;
    if (!this.npcs.some((n) => n.target === s.target)) {
      s.target.alive = false;
      if (this.selectedId === s.target.id) this.selectedId = null;
    }
    if (how === 'done') return;
    for (let i = this.loot.length - 1; i >= 0; i--) if (this.loot[i]!.site?.id === s.setup.id) this.removeLoot(i);
  }

  /** Whether a race is staged in this flight (it tells its own lapse), and whether one is under way. */
  get raceStaged(): boolean {
    return !!this.race && this.race.phase !== 'done';
  }

  get raceUnderWay(): boolean {
    return !!this.race?.closed;
  }

  /** Test-only: the race here (docs/PROCGEN.md §33), or null. */
  raceStatus(): ReturnType<RaceRun['status']> | null {
    return this.race?.status() ?? null;
  }

  /** Test-only: every racer's final time, flown on ahead from where they are. */
  raceField(): { id: string; time: number | null }[] {
    return this.race?.field().map((f) => ({ id: f.id, time: f.time })) ?? [];
  }

  /**
   * Test-only: the ship in the start box (`gate` -1, at rest), or 150 m short of a gate on its axis
   * at 140 m/s with the pilot's clock set on to `at` seconds; the flight's own steps carry it through.
   */
  raceAt(gate: number, at?: number): boolean {
    const race = this.race;
    if (!race) return false;
    this.autopilot = { mode: 'none' };
    this.player.requestCruise(false);
    const p = this.player;
    if (gate < 0) {
      const box = race.allTargets().find((t) => t.id === 'race-box');
      const g0 = race.gateAt(0);
      if (!box || !g0) return false;
      p.position.copy(box.position);
      p.velocity.set(0, 0, 0);
      p.angularVelocity.set(0, 0, 0);
      p.lookAlong(g0.normal);
      this.throttle = 0;
      return true;
    }
    const g = race.gateAt(gate);
    if (!g) return false;
    if (at !== undefined) race.setClock(at);
    p.position.copy(g.position).addScaledVector(g.normal, -150);
    p.velocity.copy(g.normal).multiplyScalar(140);
    p.angularVelocity.set(0, 0, 0);
    p.lookAlong(g.normal);
    this.throttle = 1;
    return true;
  }

  /** Test hook: the sites in this scene, and how each stands. */
  debugSites(): { id: string; kind: string; distance: number; pods: number; guards: number; dark: 'hidden' | 'sprung' | null; scanned: boolean; read: boolean; boarded: boolean; reached: boolean; boarding: number | null; ended: boolean }[] {
    return this.sites.map((s) => ({
      id: s.setup.id,
      kind: s.setup.kind,
      distance: this.siteDistance(s),
      pods: this.loot.filter((l) => l.site?.id === s.setup.id).length,
      guards: s.guardPack === null ? 0 : this.npcs.filter((n) => n.pack === s.guardPack && n.durability.hull > 0).length,
      dark: s.setup.dark === null ? null : s.setup.sprung ? 'sprung' : 'hidden',
      scanned: s.scanned,
      read: s.setup.read,
      boarded: s.setup.boarded,
      reached: s.setup.reached,
      boarding: this.boarding?.id === s.setup.id ? this.boarding.left : null,
      ended: s.ended,
    }));
  }

  // ---------------------------------------------------------------- mining (docs/PROCGEN.md §19)

  /** Distance from the player to a target's surface (a belt: its band of rock). */
  private surfaceDistance(t: Target): number {
    return this.mining.bandDistance(t.id, this.player.position) ?? Math.max(0, t.position.distanceTo(this.player.position) - t.radius);
  }

  /** The distance the HUD shows (`centre`: to the target's centre): to a body's surface or a belt's band, else to its centre. */
  private shownDistance(t: Target, centre: number): number {
    return t.kind === 'belt' || surfaced(t.kind) ? this.surfaceDistance(t) : centre;
  }

  /** A mining laser is fitted and the selected rock is within the beam's reach. */
  private miningReady(): boolean {
    if (this.perf.miningRate <= 0 || !this.alive || this.busy) return false;
    const sel = this.selectedTarget;
    return sel?.kind === 'rock' && this.surfaceDistance(sel) <= MINING.range;
  }

  /** A belt close enough to scan for its sources, or an unscanned rock close enough to read. */
  private canScanMining(t: Target): boolean {
    if (t.kind === 'rock') return !this.mining.rock(t.id)?.scanned && this.surfaceDistance(t) <= MINING.scanRange * this.scanner();
    if (t.kind === 'belt') return this.surfaceDistance(t) <= DEFAULT_SCAN_RANGE * 3 * this.scanner();
    return false;
  }

  /** Scanning a belt opens its science card; scanning a rock reads what it holds. */
  private scanMining(t: Target): void {
    const rock = this.mining.rock(t.id);
    const range = t.kind === 'belt' ? DEFAULT_SCAN_RANGE * 3 * this.scanner() : MINING.scanRange * this.scanner();
    if (this.surfaceDistance(t) > range) {
      this.callbacks.onMessage('Out of scan range — fly closer.', 'bad');
      return;
    }
    this.sfx('scan');
    if (t.kind === 'belt' || !rock) {
      // A belt scanned within range is on record (a story may want it scanned close, docs/PROCGEN.md §40.3).
      if (t.kind === 'belt' && t.bodyId && !this.state.discoveredBodies.includes(t.bodyId)) this.callbacks.onDiscovery(t.bodyId);
      this.callbacks.onScanInfo(t);
      // A belt's scan may pick up a faint return (docs/PROCGEN.md §31.3).
      if (t.kind === 'belt') this.callbacks.onBodyScan?.();
      return;
    }
    this.mining.scan(rock);
    const seams = this.perf.prospect > 1 ? ` Your prospecting scanner reads its seams: ×${this.perf.prospect} yield.` : '';
    this.callbacks.onMessage(`${t.name}: ${this.mining.contents(rock)}; ${Math.ceil(rock.left.left)} units of rock.${seams}`, 'info');
  }

  /** The Mine action: starts the beam on the selected rock, or stops it. */
  private toggleMining(): void {
    if (this.beam) {
      this.stopMining('Mining laser off.');
      return;
    }
    if (this.busy || !this.alive) return;
    if (this.perf.miningRate <= 0) {
      this.callbacks.onMessage('No mining laser fitted: outfitters sell them.', 'bad');
      this.sfx('ui-error');
      return;
    }
    const sel = this.selectedTarget;
    const rock = this.mining.rock(sel?.id ?? null);
    if (!sel || !rock) {
      this.callbacks.onMessage('Select a rock in a belt to mine.', 'info');
      return;
    }
    if (this.surfaceDistance(sel) > MINING.range) {
      this.callbacks.onMessage(`Out of the beam’s reach: fly within ${MINING.range} m of the rock.`, 'bad');
      this.sfx('ui-error');
      return;
    }
    if (!this.roomForMining(rock)) {
      this.callbacks.onMessage(`No room: the hold is full and ${MINING.pods} pods are adrift.`, 'bad');
      this.sfx('ui-error');
      return;
    }
    // What comes off the rock shows what it holds.
    if (!rock.scanned) this.mining.scan(rock);
    this.beam = { rockId: sel.id, cut: 0, pods: 0, soundIn: 0, sparkIn: 0, huntIn: MINING.hunt.every };
    this.player.requestCruise(false);
    this.callbacks.onMessage(`Mining ${sel.name}: ${this.mining.contents(rock)}.`, 'info');
  }

  private stopMining(message: string | null, tone: 'good' | 'bad' | 'info' = 'info'): void {
    if (!this.beam) return;
    this.beam = null;
    this.beamArt.set(null);
    if (message) this.callbacks.onMessage(message, tone);
  }

  /**
   * Cargo pods of cut rock adrift: any pod of ore, ice or volatiles (nothing else carries them in a
   * pod), including those the player left here last time.
   */
  private minedPods(): number {
    let n = 0;
    for (const l of this.loot) if (l.target.alive && l.cargo && (MINED_GOODS as readonly CommodityId[]).includes(l.cargo.commodity)) n++;
    return n;
  }

  /** Room for whatever the beam cuts from this rock next: one more pod, or room in the hold for each of its goods. */
  private roomForMining(rock: MinableRock): boolean {
    if (this.minedPods() < MINING.pods) return true;
    return (Object.keys(rock.spec.composition) as CommodityId[]).every((g) => itemsThatFit(this.state.ship.cargo, g, this.perf.cargo) > 0);
  }

  private readonly beamFrom = new THREE.Vector3();
  private readonly beamTo = new THREE.Vector3();

  /**
   * The beam at work: it cuts the rock at the lasers' rate, each whole unit into the hold when it
   * fits and out in a cargo pod when it does not, and stops when the target is lost, out of reach
   * or spent, or when the hold and the pods are full. Now and then raiders come for the miner.
   */
  private updateMining(dt: number): void {
    const b = this.beam;
    if (!b) return;
    const rock = this.mining.rock(b.rockId);
    if (!this.alive) return this.stopMining(null);
    if (this.busy) return this.stopMining('Mining laser off.');
    if (!rock || !rock.target.alive) return this.stopMining('The rock is spent. It grows back in time: try another.');
    if (this.selectedId !== b.rockId) return this.stopMining('Mining laser off: target lost.');
    if (this.surfaceDistance(rock.target) > MINING.range) return this.stopMining(`Mining laser off: out of the beam’s reach (${MINING.range} m).`, 'bad');
    if (!this.roomForMining(rock)) return this.stopMining(`Mining laser off: the hold is full and ${MINING.pods} pods are adrift. Collect them, or go and sell.`, 'bad');
    const out = this.tmp2.copy(this.player.position).sub(rock.position).normalize();
    const surface = this.beamTo.copy(rock.position).addScaledVector(out, rock.spec.radius * 0.92);
    for (const g of cutRock(rock.left, rock.spec.composition, dt, this.perf.miningRate, this.perf.prospect)) {
      if (stowUnit(this.state.ship.cargo, this.perf.cargo, g) === 'hold') {
        b.cut++;
        this.sfx('pickup', 0.25);
        this.callbacks.onMined?.(rock.spec.beltId, g, 'hold');
      } else {
        // Nothing cut is ever thrown away: the beam stops before the pods run out (a frame's cut may take one more).
        b.pods++;
        if (!this.holdFullSaid) {
          this.holdFullSaid = true;
          this.callbacks.onMessage('Hold full: what the beam cuts now goes out in cargo pods. Sell, then come back for them.', 'info');
        }
        this.spawnLoot(surface.clone().addScaledVector(out, 14), 0, { cargo: { commodity: g, qty: 1 } });
        this.callbacks.onMined?.(rock.spec.beltId, g, 'pod');
      }
    }
    this.mining.recordCut(rock);
    if (rock.left.left <= 0) return this.stopMining(`${rock.target.name} is spent. It grows back in time: try another.`);
    // The beam from the ship's nose to the cut, sparks where it bites, and its grind.
    this.playerArt.object.updateMatrixWorld();
    const muzzle = this.playerArt.muzzles[0];
    const from = muzzle ? this.playerArt.object.localToWorld(this.beamFrom.copy(muzzle)) : this.beamFrom.copy(this.player.position);
    this.beamArt.set(from, surface);
    this.beamArt.update?.(dt, this.time, this.camera);
    b.sparkIn -= dt;
    if (b.sparkIn <= 0) {
      b.sparkIn = 0.22;
      this.spawnEffect(createImpactSpark(surface.clone(), '#ffb070', this.ctx));
    }
    b.soundIn -= dt;
    if (b.soundIn <= 0) {
      b.soundIn = 0.45;
      this.sfx('mining', 0.8);
    }
    b.huntIn -= dt;
    if (b.huntIn <= 0) {
      b.huntIn = MINING.hunt.every;
      this.huntMiner();
    }
  }

  /**
   * Raiders who hunt miners: a beam lights up a belt, and lawless and thinly patrolled belts
   * sometimes send a small pack out of the dark for the miner; patrolled belts rarely do. The Wake
   * leaves a pilot it trusts alone, and one pack at a time comes.
   */
  private huntMiner(): void {
    if (this.denOpen || !this.traffic) return;
    if (this.minerPack !== null && this.npcs.some((n) => n.pack === this.minerPack && n.durability.hull > 0)) return;
    const odds = minerHunt(securityOf(this.system.def.systemId), this.traffic.plan.packs?.level ?? null);
    if (this.rand() >= odds.chance) return;
    this.minerPack = this.spawnPack({ max: 1, level: odds.level, size: odds.size, firstDelay: 0, interval: [60, 60] }, true);
    this.sfx('alert', 0.7);
    this.callbacks.onMessage('Raiders have seen your beam: a pack is coming for the miner.', 'bad');
  }

  /** What the HUD shows of the mining laser (null without one). */
  private miningHud(): HudMining | null {
    if (this.perf.miningRate <= 0) return null;
    const b = this.beam;
    const rock = b ? this.mining.rock(b.rockId) : undefined;
    return {
      rate: this.perf.miningRate,
      prospect: this.perf.prospect,
      active: !!b,
      ready: this.miningReady(),
      cut: b?.cut ?? 0,
      pods: b?.pods ?? 0,
      status: b && rock ? `Mining ${rock.target.name}: ${b.cut} cut${b.pods ? `, ${b.pods} in pods` : ''} · ${Math.ceil(rock.left.left)} units of rock left` : null,
    };
  }

  /** Mining state for automated tests. */
  debugMining(): { beam: string | null; cut: number; pods: number; rocks: { id: string; left: number; scanned: boolean; distance: number }[]; minerPack: boolean } {
    const rocks = this.mining.targets().filter((t) => t.kind === 'rock');
    return {
      beam: this.beam?.rockId ?? null,
      cut: this.beam?.cut ?? 0,
      pods: this.minedPods(),
      rocks: rocks.map((t) => {
        const r = this.mining.rock(t.id)!;
        return { id: t.id, left: r.left.left, scanned: r.scanned, distance: this.surfaceDistance(t) };
      }),
      minerPack: this.minerPack !== null && this.npcs.some((n) => n.pack === this.minerPack && n.durability.hull > 0),
    };
  }

  /** Test hook: puts the ship `distance` metres from a target's surface (a belt: its middle), facing it, at rest. */
  placeNear(targetId: string, distance: number, awayFromId?: string): boolean {
    this.mining.update(0, this.player.position, this.state.clock, this.camera, this.beam?.rockId ?? null);
    const t = this.findTarget(targetId);
    // The far stars are in the sky, never somewhere to be.
    if (!t || this.busy || t.kind === 'sky') return false;
    // On the side away from where the ship is, or from another target if one is named.
    const from = awayFromId ? this.findTarget(awayFromId) : null;
    if (awayFromId && !from) return false;
    const away = this.tmp.copy(from ? from.position : this.player.position).sub(t.position);
    if (from) away.negate();
    if (away.lengthSq() < 1) away.set(0, 0, 1);
    away.normalize();
    this.player.position.copy(t.position).addScaledVector(away, (t.kind === 'belt' ? 0 : t.radius) + distance);
    this.player.velocity.set(0, 0, 0);
    this.player.angularVelocity.set(0, 0, 0);
    this.player.lookAlong(away.negate());
    this.throttle = 0;
    this.autopilot = { mode: 'none' };
    this.chase.snap(this.player);
    return true;
  }

  /** Test-only: turns the ship where it is to face a target (a far star in the sky among them), its nose `belowDeg` under it. */
  face(targetId: string, belowDeg = 0): boolean {
    const t = this.findTarget(targetId);
    if (!t || this.busy) return false;
    const dir = this.tmp.copy(t.position).sub(this.player.position);
    if (dir.lengthSq() < 1) return false;
    dir.normalize();
    const right = this.tmp2.crossVectors(dir, WORLD_UP);
    if (belowDeg && right.lengthSq() > 1e-6) dir.applyAxisAngle(right.normalize(), (-belowDeg * Math.PI) / 180);
    this.player.velocity.set(0, 0, 0);
    this.player.angularVelocity.set(0, 0, 0);
    this.player.lookAlong(dir);
    this.throttle = 0;
    this.chase.snap(this.player);
    return true;
  }

  /**
   * Test-only: places the ship `distance` beyond a moon from its planet, looking at the moon with the
   * planet behind it (docs/PROCGEN.md §48.3); or, `near`, as far on the planet's side of it, looking out
   * at it as the planet sees it (Earth's Moon's phase, §51.3).
   */
  viewMoon(moonId: string, planetId: string, distance: number, near = false): boolean {
    const m = this.system.planets.find((p) => p.def.id === moonId)?.def;
    const planet = this.system.planets.find((p) => p.def.id === planetId)?.def;
    if (!m || !planet || this.busy) return false;
    const back = m.position.clone().sub(planet.position).normalize().multiplyScalar(near ? -1 : 1);
    const side = new THREE.Vector3().crossVectors(back, WORLD_UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    this.player.position.copy(m.position).addScaledVector(back, distance).addScaledVector(side, distance * 0.35).addScaledVector(WORLD_UP, distance * 0.12);
    this.player.velocity.set(0, 0, 0);
    this.player.angularVelocity.set(0, 0, 0);
    this.player.lookAlong(m.position.clone().sub(this.player.position).normalize());
    this.throttle = 0;
    this.autopilot = { mode: 'none' };
    this.chase.snap(this.player);
    return true;
  }

  /**
   * Test-only: places the ship `distance` from a named asteroid, looking at it (docs/PROCGEN.md §47.3):
   * from its sunlit side, or for one passing Earth from beyond it, with Earth behind it.
   */
  viewAsteroid(asteroidId: string, distance: number): boolean {
    const a = this.system.asteroids.find((x) => x.id === asteroidId);
    if (!a || this.busy) return false;
    const earth = this.system.planets.find((p) => p.def.id === 'earth')?.def.position;
    const back = a.near && earth ? a.position.clone().sub(earth).normalize() : a.position.clone().normalize().negate();
    const side = new THREE.Vector3().crossVectors(back, WORLD_UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    this.player.position.copy(a.position).addScaledVector(back, distance).addScaledVector(side, distance * 0.25).addScaledVector(WORLD_UP, distance * 0.12);
    this.player.velocity.set(0, 0, 0);
    this.player.angularVelocity.set(0, 0, 0);
    this.player.lookAlong(a.position.clone().sub(this.player.position).normalize());
    this.throttle = 0;
    this.autopilot = { mode: 'none' };
    this.chase.snap(this.player);
    return true;
  }

  /** Test-only: places the ship `distance` from a spacecraft on its sunlit side (for one near Earth, beyond it, with Earth behind it), looking at it (docs/PROCGEN.md §49.3). */
  viewCraft(craftId: string, distance: number): boolean {
    const c = this.system.craft.find((x) => x.id === craftId);
    if (!c || this.busy) return false;
    const earth = this.system.planets.find((p) => p.def.id === 'earth')?.def.position;
    const back = c.near && earth ? c.position.clone().sub(earth).normalize() : c.position.clone().normalize().negate();
    const side = new THREE.Vector3().crossVectors(back, WORLD_UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    this.player.position.copy(c.position).addScaledVector(back, distance).addScaledVector(side, distance * 0.35).addScaledVector(WORLD_UP, distance * 0.2);
    this.player.velocity.set(0, 0, 0);
    this.player.angularVelocity.set(0, 0, 0);
    this.player.lookAlong(c.position.clone().sub(this.player.position).normalize());
    this.throttle = 0;
    this.autopilot = { mode: 'none' };
    this.chase.snap(this.player);
    return true;
  }

  /** Test-only: places the ship beside a comet, `distance` off its tails, looking at them (docs/PROCGEN.md §45.3). */
  viewComet(cometId: string, distance: number): boolean {
    const c = this.system.comets.find((x) => x.id === cometId);
    if (!c || this.busy) return false;
    const along = c.gasDir.clone();
    const side = new THREE.Vector3().crossVectors(along, WORLD_UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const look = c.position.clone().addScaledVector(along, c.tail * 0.12);
    this.player.position.copy(look).addScaledVector(side, distance).addScaledVector(WORLD_UP, distance * 0.15);
    this.player.velocity.set(0, 0, 0);
    this.player.angularVelocity.set(0, 0, 0);
    this.player.lookAlong(look.sub(this.player.position).normalize());
    this.throttle = 0;
    this.autopilot = { mode: 'none' };
    this.chase.snap(this.player);
    return true;
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
    const hail = this.hail;
    hud.hail = hail ? { from: hail.from, text: hail.text, left: hail.left, held: hail.held, tone: hail.offer.kind === 'toll' ? 'toll' : hail.offer.kind === 'customs' ? 'law' : 'comms' } : null;
    const launcher = activeLauncher(this.state.ship);
    hud.missiles = launcher?.ammo ?? 0;
    hud.launcher = launcher ? roundsLabel(launcher.stats.kind) : null;
    hud.repairKits = this.state.ship.repairKits;
    hud.decoys = this.state.ship.decoys;
    hud.wing = this.wing.hud(this.npcs);
    hud.battle = this.borderBattle.hud(this.npcs);
    hud.mining = this.miningHud();
    hud.incoming = this.incomingSeekers;
    hud.systems = { ...this.state.ship.systems };
    hud.flash = { hull: this.settings.reducedMotion ? Math.min(0.4, this.hullFlash) : this.hullFlash, shield: this.settings.reducedMotion ? Math.min(0.3, this.shieldFlash) : this.shieldFlash };
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
    // Boarding a derelict (docs/PROCGEN.md §31.4): the seconds left, in the autopilot's line.
    const boarding = this.boarding ? this.sites.find((s) => s.setup.id === this.boarding!.id) : undefined;
    if (this.boarding && boarding) hud.autopilot = `${fillSite(SITE_NOTES.boarding, boarding.setup)} · ${Math.ceil(this.boarding.left)} s`;

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
      const rock = sel.kind === 'rock' ? this.mining.rock(sel.id) : undefined;
      hud.target = {
        id: sel.id,
        name: sel.name,
        kind: sel.kind,
        subtitle: sel.subtitle,
        distance: this.shownDistance(sel, dist),
        ...(sel.distanceLabel ? { distanceLabel: sel.distanceLabel } : {}),
        hostile: !!sel.hostile,
        ...(sel.faction ? { faction: sel.faction } : {}),
        ...(sel.own ? { own: true } : {}),
        dataClass: sel.dataClass,
        ...(npc ? { shield: npc.durability.shield / npc.durability.shieldMax, hull: npc.durability.hull / npc.durability.hullMax } : {}),
        ...(rock?.scanned ? { amount: rock.left.left / rock.spec.amount } : {}),
        lead,
        inGunRange: dist < this.gunRange,
      };
    } else {
      hud.target = null;
    }

    // Markers.
    const markers: HudMarker[] = [];
    const objId =
      this.race?.objectiveId() ??
      (this.objective.locationId
        ? `station:${this.objective.locationId}`
        : this.objective.bodyId
          ? `planet:${this.objective.bodyId}`
          : this.objective.targetId && (this.mining.find(this.objective.targetId) || this.objective.targetId.startsWith('sky:') || (this.objective.targetId.startsWith('site:') && this.findTarget(this.objective.targetId)))
            ? this.objective.targetId
            : null);
    for (const t of this.allTargets()) {
      const dist = t.position.distanceTo(p.position);
      const selected = t.id === this.selectedId;
      const objective = t.id === objId;
      const important = selected || objective || t.hostile || t.own;
      if (!important) {
        if (t.kind === 'lane' && dist > 25_000) continue;
        if (t.kind === 'loot' && dist > 3_000) continue;
        if (t.kind === 'drone' && dist > 4_000) continue;
        if (t.kind === 'beacon' && dist > 20_000) continue;
        if (t.kind === 'rock' && dist > 6_000) continue;
        if (t.kind === 'wreck' && dist > 30_000) continue;
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
        distance: this.shownDistance(t, dist),
        ...(t.distanceLabel ? { distanceLabel: t.distanceLabel } : {}),
        hostile: !!t.hostile,
        ...(t.faction ? { faction: t.faction } : {}),
        ...(t.own ? { own: true } : {}),
        selected,
        objective,
        dataClass: t.dataClass,
      });
    }
    hud.markers = markers;
    hud.context = this.contextAction();
    const near = this.nearestDock();
    hud.nearestDock = near ? { name: near.site.name, distance: Math.max(0, near.distance - near.site.radius) } : null;
    hud.race = this.race && this.race.phase !== 'done' ? this.race.hud(p.position) : null;
    hud.flare = this.flare ? fillFlare(FLARE_HUD, this.flare, this.state.clock) : null;

    const warnings: string[] = [];
    if (hud.incoming && this.alive) warnings.push(`Seeker inbound${hud.incoming > 1 ? ` ×${hud.incoming}` : ''}: drop a decoy`);
    if (d.hull / d.hullMax < 0.3 && this.alive) warnings.push('Hull critical');
    const sys = this.state.ship.systems;
    const hurt = (['engines', 'guns', 'shields'] as const).filter((k) => sys[k] >= 0.05).map((k) => `${k === 'shields' ? 'shield' : k} ${Math.round(sys[k] * 100)}%`);
    // The engineer at work says so (docs/PROCGEN.md §30.2).
    const mending = this.crewNow.mend > 0 && (['engines', 'guns', 'shields'] as const).some((k) => sys[k] > this.crewNow.floor) && !this.hostilesNearby(this.crewNow.quiet);
    if (hurt.length && this.alive) warnings.push(`Damaged: ${hurt.join(', ')}${mending ? ' (mending)' : ''}`);
    if (this.drift) warnings.push('Engines off (drift)');
    if (hud.encounterActive) warnings.push('Hostile contact');
    hud.warnings = warnings;
  }

  /** Test-only: destroy a ship outright, as the player's guns (or someone else's) would. */
  debugDestroy(id: string, byPlayer: boolean): boolean {
    const n = this.npcs.find((x) => x.id === id);
    if (!n) return false;
    this.damageNpc(n, 1e9, n.body.position.clone(), undefined, byPlayer);
    return true;
  }

  /** Debug: the player's ship takes a hit of this much (shields first), as from a gun. */
  debugHurt(amount: number): void {
    this.damagePlayer(amount, this.player.position.clone());
  }

  /** Debug snapshot of NPC state for automated tests. */
  debugNpcs(): {
    id: string;
    name: string;
    role: NpcRole;
    side: 'lawful' | 'raider';
    /** The escort contract it is the ship of, whether it is keeping with the player, and the escorted ship it goes for. */
    escort: string | null;
    following: boolean;
    prey: string | null;
    /** The timetable's haul it flies (docs/PROCGEN.md §21), and what it carries. */
    haul: string | null;
    /** The player's owned ship it is, flown by a captain (§18.6). */
    captain: string | null;
    /** The rival pilot flying it (§24); the rival who hired it, and where a duel stands (§28). */
    rival: string | null;
    hired: string | null;
    duel: string | null;
    /** The player's outpost's own (a turret, its stores, a guard), and a raider of a raid on it (its window; §29). */
    own: string | null;
    outpostRaid: number | null;
    /** The marked site it belongs to (docs/PROCGEN.md §31). */
    site: string | null;
    /** A crews' cutter or a claim-jumper of a stand in a belt (§40.3). */
    stand: 'cutter' | 'jumper' | null;
    subtitle: string;
    state: string;
    hull: number;
    shield: number;
    energy: number;
    distance: number;
    shotsFired: number;
  }[] {
    return this.npcs.map((n) => ({
      id: n.id,
      name: n.name,
      role: n.role,
      side: n.side,
      escort: n.escort?.jobId ?? null,
      following: !!n.escort?.follow,
      prey: n.prey?.name ?? null,
      haul: n.haul?.haul.id ?? null,
      captain: n.captain?.shipId ?? null,
      rival: n.rival?.id ?? null,
      hired: n.hired ?? null,
      duel: n.duel?.state ?? null,
      own: n.own?.kind ?? null,
      outpostRaid: n.outpostRaid ?? null,
      site: n.site ?? null,
      stand: n.cutter ? 'cutter' : n.jumper ? 'jumper' : null,
      subtitle: n.target.subtitle ?? '',
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

  /** A badly hurt ship keeps throwing sparks (docs/PROCGEN.md §15.6), when the player is near enough to see. */
  private hurtSparks(n: NpcShip, dt: number): void {
    if (n.durability.hull <= 0 || n.durability.hull > n.durability.hullMax * 0.34) return;
    n.sparkIn = (n.sparkIn ?? 0) - dt;
    if (n.sparkIn > 0) return;
    n.sparkIn = 0.35 + this.rand() * 0.4;
    if (n.body.position.distanceTo(this.player.position) > 2_500) return;
    const at = n.body.position.clone().add(this.tmp.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(n.art.radius));
    this.spawnEffect(createImpactSpark(at, this.rand() < 0.5 ? '#ff9a4a' : '#8a8f99', this.ctx));
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
    this.race?.dispose();
    this.race = null;
    this.system.scene.remove(this.farSky.object);
    this.farSky.dispose();
    this.audio.setEngine(null);
    this.audio.setCombatIntensity(0);
    this.stopMining(null);
    this.mining.dispose();
    this.system.scene.remove(this.beamArt.object);
    this.beamArt.dispose();
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
    for (const s of this.sites) {
      if (!s.hull) continue;
      this.system.scene.remove(s.hull.object);
      s.hull.dispose();
    }
    this.sites.length = 0;
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
