import type { EventKind } from '../content/events/rules.ts';
import type { SystemId } from '../data/types.ts';
import type { Route } from './routing.ts';

/** Whether the ship may start a jump right now, independent of the chosen route. */
export interface JumpReadiness {
  canJump: boolean;
  /** Shown when canJump is false, e.g. "Launch from the dock first". */
  reason?: string;
}

/** Game state the neighborhood map needs; supplied by the game each time the map opens/refreshes. */
export interface MapState {
  currentSystemId: SystemId;
  visited: ReadonlySet<SystemId>;
  credits: number;
  readiness: JumpReadiness;
  /** System holding the active objective (highlighted), if any. */
  objectiveSystemId: SystemId | null;
  /** Confirmed-planet ids the player has discovered (scanned) in flight. */
  discoveredBodies: ReadonlySet<string>;
  /**
   * Fee coverage from an active contract: jumps ending at `systemId` cost nothing and show `note`.
   * Null when no contract covers fees.
   */
  feeCoverage: { systemId: SystemId; note: string } | null;
  /** World events the player has heard of (the news within reach of where they are). */
  news?: readonly MapNewsItem[];
  /** Systems where active contracts send the player (besides the objective). */
  contractSystems?: ReadonlySet<SystemId>;
  /** Every active mission and the system it sends the player to now (the map's missions list). */
  missions?: readonly MapMission[];
  /** The player's codex: bodies scanned (for the science notes). */
  catalogued?: ReadonlySet<string>;
  /** Reach of the ship's long-range jump drive, light-years (0: none): frontier lanes need it. */
  jumpReach?: number;
}

export interface MapMission {
  jobId: string;
  /** Where the mission sends the player next. */
  systemId: SystemId;
  /** The job's title. */
  title: string;
  /** What to do next, as the flight view says it. */
  step: string;
  /** The objective the flight view tracks. */
  primary: boolean;
}

export interface MapNewsItem {
  id: string;
  systemId: SystemId;
  /** A world event, or a border front that is fighting (docs/PROCGEN.md §20). */
  kind: EventKind | 'border';
  headline: string;
  detail: string;
  active: boolean;
}

export interface GalaxyMapCallbacks {
  /** The player confirmed a jump along `route` (the game executes every hop and charges `fee`). */
  onJump(route: Route, fee: number): void;
  onClose(): void;
}
