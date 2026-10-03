import type { StationType } from '../world/types.ts';
import type { ShipClassId } from '../types.ts';

/**
 * Races on the lanes (docs/PROCGEN.md §33): racing clubs at stations in well-policed systems hold a
 * Sprint round a real planet, moon or star and a Run between docks (or out and back), heat after
 * heat. Club racers and rival pilots really fly the gates beside the pilot, in two classes of hull.
 * Fiction: the clubs, gates, racers and records are invented; the bodies the courses round are real,
 * at their schematic places in the scene. Every time is in game seconds, every distance in metres,
 * every pay in credits.
 */

export type CourseKind = 'sprint' | 'run';
export type RaceClass = 'light' | 'heavy';
export const COURSE_KINDS: readonly CourseKind[] = ['sprint', 'run'];
export const RACE_CLASSES: readonly RaceClass[] = ['light', 'heavy'];

export interface CourseShape {
  /** Gates on the course, the start and finish lines included. */
  gates: readonly [number, number];
  /** A leg between two gates. */
  leg: readonly [number, number];
  /** The whole course, start line to finish line. */
  length: readonly [number, number];
  /** How far off the body's surface the ring of gates runs (a star's surface counted at 1.3 radii). */
  ring: readonly [number, number];
  /** Degrees of the ring the course flies round. */
  arc: readonly [number, number];
  /** A gate's radius. */
  gate: number;
  /** Whether cruise is allowed. */
  cruise: boolean;
}

export const RACING = {
  /**
   * Where clubs are: a system at least this secure (never Pyre), with an open lawful or independent
   * dock and room for both its courses. The host is the system's hand-made station, else its first
   * open station by `prefer`.
   */
  venues: {
    minSecurity: 0.5,
    prefer: ['trade-port', 'military-base', 'shipyard', 'research-station', 'relay', 'customs-depot', 'agri-station', 'factory', 'refinery', 'mining-outpost'] as readonly StationType[],
    count: [10, 20] as const,
  },
  /** One heat of every course and class in each slot of the game clock; a pilot races once a heat, anywhere. */
  heatSeconds: 1_800,
  sprint: { gates: [6, 8], leg: [900, 3_300], length: [9_000, 24_000], ring: [1_500, 3_000], arc: [200, 300], gate: 140, cruise: false } as CourseShape,
  run: { gates: [6, 12], leg: [2_000, 10_000], length: [25_000, 80_000], ring: [2_500, 6_000], arc: [90, 300], gate: 260, cruise: true } as CourseShape,
  /**
   * Room a course keeps: gates this far off any star's or planet's surface (legs `leg`), `apart` from
   * each other, `dock` from any station (or any outpost a pilot might build), `lane` from any lane,
   * `belt` outside any belt; a Run's start and finish this far off their docks. No turn sharper than
   * `maxTurn` (radians) at a gate.
   */
  clear: { body: 1_500, leg: 800, apart: 900, dock: 1_800, startOff: [1_400, 1_800, 2_200] as const, lane: 400, belt: 600 },
  maxTurn: 1.92,
  /**
   * The start: the pilot waits in the box behind the start line (within `box` of it, slower than
   * `maxSpeed`) once the heat is open; the countdown runs `countdown` seconds. An entry is for the
   * heat under way if `earlyClose` seconds of it are left, else the next. The racers line up `back`
   * behind the line, `apart` from each other.
   */
  start: { box: 450, maxSpeed: 30, countdown: 3, earlyClose: 300, line: { back: 150, apart: 70 } },
  /** The marshals close the course this many times the class's par after the start. */
  cutoff: 3,
  /** Retiring: offered when held under `speed` for `seconds`. */
  retire: { speed: 5, seconds: 3 },
  /** The classes, by hull class, and the hull each class's par is flown in. */
  classes: {
    light: { hulls: ['courier', 'light-fighter', 'surveyor'] as readonly ShipClassId[], ref: 'ship.courier.1.halden' },
    heavy: { hulls: ['heavy-fighter', 'gunship', 'freighter'] as readonly ShipClassId[], ref: 'ship.freighter.1.halden' },
  },
  /** A club's level, 1–3: the tiers its members' hulls are, their skill, and its purse's share. */
  levels: {
    tiers: [
      [1, 1],
      [1, 2],
      [2, 3],
    ] as const,
    skill: [
      [0.8, 0.92],
      [0.86, 0.98],
      [0.92, 1.04],
    ] as const,
    purse: [0.5, 0.75, 1] as const,
  },
  /** A course record in a class: the club's best member flown clean at their very best, times a draw in this. */
  record: [0.97, 0.99] as const,
  /**
   * The racing pilot every racer is flown by, on its own fixed step so a heat comes out the same on
   * every device. Skill s runs 0.8–1.05: each pair is [at 0.8, at 1.05], drawn between linearly.
   * `reaction`: seconds off the line; `throttle`; `steer`: the stick's reach (0.7 is what touch
   * steering manages); `lead`: how far toward the next gate it aims through a gate (a share of the
   * radius); `offset`: its line's error, at most this share of the radius at the lowest skill;
   * `boostFrom`: boosts while energy is above this share; `cruiseExit`: drops out of cruise this many
   * times the autopilot's distance short of a gate; `slip`: the chance at each gate of a moment off the
   * throttle, and how long.
   */
  pilot: {
    step: 1 / 60,
    reaction: [1, 0.2] as const,
    throttle: [0.92, 1] as const,
    steer: [0.7, 1] as const,
    lead: [0.15, 0.5] as const,
    offset: 0.55,
    boostFrom: [0.5, 0.25] as const,
    cruiseExit: [1.8, 1.25] as const,
    slip: { chance: [0.3, 0.02] as const, seconds: [0.5, 2] as const },
  },
  /** Per club and class: `members` racers, `club` of them on the line in a heat with up to `rivals` rival pilots, `size` racers at most. */
  field: { members: 6, club: 4, rivals: 2, size: 5, jitter: 0.02 },
  /** A rival's skill by their style. */
  rivalSkill: { runner: [1, 1.04], hunter: [0.94, 1], trader: [0.86, 0.94] } as const,
  /**
   * Pay: the fee and purse at a level-3 club (lower levels pay `levels.purse` of both), the share of
   * the purse each place takes, and a one-off purse for the course record in a class.
   */
  pay: { fee: { sprint: 60, run: 120 }, purse: { sprint: 450, run: 900 }, places: [1, 0.4, 0.2] as const, record: 300 },
  /** The Racing rating's points, each times the club's level; the record's once per course and class. */
  points: { finish: 1, podium: 2, win: 3, record: 5 },
  /** Standing with each rival pilot in a heat the pilot finishes, up to `upTo`. */
  standing: { raced: 2, upTo: 30 },
  /** The last results kept in the save. */
  keep: { results: 12 },
  /** A result in the News this long, this many jumps away. */
  news: { jumps: 2, seconds: 3_600 },
  /** Past the finish line the racers ease off, and are gone after `after` seconds. */
  ease: { after: 20 },
} as const;

export type RacingRules = typeof RACING;
