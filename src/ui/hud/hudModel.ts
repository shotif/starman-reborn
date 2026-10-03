import type { DataClass, FactionId } from '../../data/types.ts';
import type { FlightAction } from '../../flight/input/types.ts';
import type { CruiseState } from '../../flight/ShipBody.ts';
import type { IconName } from '../icons.ts';
import type { TargetKind } from '../../world/targets.ts';

export interface HudMarker {
  id: string;
  name: string;
  kind: TargetKind;
  /** CSS px within the viewport (clamped to the edge when off-screen). */
  x: number;
  y: number;
  onScreen: boolean;
  /** Direction (radians, screen space) toward an off-screen marker. */
  edgeAngle: number;
  distance: number;
  /** Shown instead of the distance (a far star's light-years). */
  distanceLabel?: string;
  hostile: boolean;
  faction?: FactionId;
  /** One of the player's own ships (docs/PROCGEN.md §18.6). */
  own?: boolean;
  selected: boolean;
  objective: boolean;
  dataClass: DataClass;
}

export interface HudTarget {
  id: string;
  name: string;
  kind: TargetKind;
  subtitle: string;
  distance: number;
  /** Shown instead of the distance (a far star's light-years). */
  distanceLabel?: string;
  hostile: boolean;
  faction?: FactionId;
  own?: boolean;
  dataClass: DataClass;
  shield?: number;
  hull?: number;
  /** A scanned rock: the share of it still to cut (0–1). */
  amount?: number;
  /** Lead indicator (CSS px) for moving targets, when on screen. */
  lead: { x: number; y: number } | null;
  inGunRange: boolean;
}

/** A hail on the lanes (docs/PROCGEN.md §27): who calls, what they say, and how long it waits. */
export interface HudHail {
  from: string;
  text: string;
  /** Seconds before it lapses. */
  left: number;
  /** Hostiles near: it waits, and cannot be answered now. */
  held: boolean;
  /** Its colour: a call on the comms, the Wake's toll, the law. */
  tone: 'comms' | 'toll' | 'law';
}

export interface HudContextAction {
  label: string;
  action: FlightAction;
  icon: IconName;
}

/** The mining laser (docs/PROCGEN.md §19): what it cuts, and what the beam is doing. */
export interface HudMining {
  /** Units of rock a minute, and the prospecting scanner's yield (1 without one). */
  rate: number;
  prospect: number;
  /** The beam is cutting the selected rock. */
  active: boolean;
  /** A rock is selected within the beam's reach. */
  ready: boolean;
  /** Units cut into the hold and cargo pods released since the beam started. */
  cut: number;
  pods: number;
  /** "Rock 12.3: metal ore 70% · water ice 30%" while cutting. */
  status: string | null;
}

/** A race under way (docs/PROCGEN.md §33.4): the HUD's race strip, in the objective panel's place. */
export interface HudRace {
  name: string;
  phase: 'approach' | 'ready' | 'countdown' | 'on' | 'done';
  /** Gates passed since the start line, of those to pass (the finish line included). */
  gate: number;
  gates: number;
  /** Seconds since the start (the finish time once across the line). */
  time: number;
  /** Seconds against the pilot's best (or par) at the last gate passed: negative is ahead. */
  split: number | null;
  /** The countdown's word, while it runs. */
  count: string | null;
  place: number;
  of: number;
  /** Cruise is sealed (a Sprint under way). */
  sealedCruise: boolean;
}

/** A wing's standing order: engage raiders near the player, go for the player's target, or stay in formation. */
export type WingOrder = 'free' | 'attack' | 'form';

export const WING_ORDER_LABEL: Record<WingOrder, string> = { free: 'Engage at will', attack: 'Attack my target', form: 'Form up' };

export interface HudModel {
  speed: number;
  throttle: number;
  cruise: CruiseState;
  cruiseCharge: number;
  boosting: boolean;
  drift: boolean;
  energy: number;
  shield: number;
  hull: number;
  shieldValue: number;
  hullValue: number;
  /** Label for the active autopilot/lane leg, or null under manual control. */
  autopilot: string | null;
  /** Which autopilot is flying the ship (drives the command rail). */
  autopilotMode: 'none' | 'goto' | 'lane' | 'dock' | 'undock';
  /** Name of the fitted gun (loadout panel). */
  weapon: string;
  inLane: boolean;
  target: HudTarget | null;
  markers: HudMarker[];
  reticle: { x: number; y: number; inArc: boolean; assisted: boolean };
  missileLock: 'none' | 'locking' | 'locked';
  context: HudContextAction | null;
  /** A hail on the lanes waiting for an answer (docs/PROCGEN.md §27), or null. */
  hail: HudHail | null;
  warnings: string[];
  /** Rounds left in the active launcher, and what they are ('Seekers'); null without a launcher. */
  missiles: number;
  launcher: string | null;
  repairKits: number;
  /** Decoy flares left, and seekers homing on the player now (docs/PROCGEN.md §15). */
  decoys: number;
  incoming: number;
  /** Damage to the ship's systems, 0–1. */
  systems: { engines: number; guns: number; shields: number };
  /** Screen-edge flashes after hits, 0–1 (hull red, shield blue). */
  flash: { hull: number; shield: number };
  /** Ships flying on the player's wing, and their standing order (null without a wing). */
  wing: { count: number; order: WingOrder } | null;
  /** The mining laser, when one is fitted. */
  mining: HudMining | null;
  encounterActive: boolean;
  /** Closest dock in this system (name and distance), for the HUD. */
  nearestDock: { name: string; distance: number } | null;
  /** A race the pilot has entered here (docs/PROCGEN.md §33), or null. */
  race: HudRace | null;
}

export function emptyHudModel(): HudModel {
  return {
    speed: 0,
    throttle: 0,
    cruise: 'off',
    cruiseCharge: 0,
    boosting: false,
    drift: false,
    energy: 1,
    shield: 1,
    hull: 1,
    shieldValue: 0,
    hullValue: 0,
    autopilot: null,
    autopilotMode: 'none',
    weapon: '',
    inLane: false,
    target: null,
    markers: [],
    reticle: { x: 0, y: 0, inArc: true, assisted: false },
    missileLock: 'none',
    context: null,
    hail: null,
    warnings: [],
    missiles: 0,
    launcher: null,
    repairKits: 0,
    decoys: 0,
    incoming: 0,
    systems: { engines: 0, guns: 0, shields: 0 },
    flash: { hull: 0, shield: 0 },
    wing: null,
    mining: null,
    encounterActive: false,
    nearestDock: null,
    race: null,
  };
}
