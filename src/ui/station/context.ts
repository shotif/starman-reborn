import type { SfxId } from '../../audio/types.ts';
import type { GameState } from '../../app/state.ts';
import type { SystemId } from '../../data/types.ts';
import type { RoomView, ViewTransition } from '../../world/rooms/types.ts';

/** Everything the station screens need from the game. */
export interface StationContext {
  state: GameState;
  locationId: string;
  /** Persist after any change (also re-evaluates contract objectives). */
  save(): void;
  /** The player bought a different ship (the hangar shows the new one). */
  shipChanged(): void;
  sfx(id: SfxId): void;
  launch(): void;
  openMap(): void;
  openEncyclopedia(): void;
  openSettings(): void;
  openControls(): void;
  quitToTitle(): void;
  acceptJob(jobId: string): void;
  deliverJob(jobId: string): void;
  /** Jump fees between systems (0 when covered by a contract). */
  travelCost(from: SystemId, to: SystemId): number;
  /** Moves the 3D interior to a room; null when no interior is shown. */
  setView(room: RoomView): ViewTransition | null;
}

/** Re-render hook passed to room content builders. */
export type Refresh = () => void;
