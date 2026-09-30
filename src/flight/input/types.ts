/** Edge-triggered flight actions (consumed once per frame). */
export type FlightAction =
  | 'cruise'
  | 'target-next'
  | 'target-hostile'
  | 'interact'
  | 'goto'
  | 'scan'
  | 'missile'
  | 'repair'
  | 'decoy'
  /** Starts or stops the mining laser on the selected rock (docs/PROCGEN.md §19). */
  | 'mine'
  | 'wing-order'
  | 'engine-kill'
  | 'map'
  | 'pause'
  | 'help'
  | 'cancel-autopilot';

/** The device driving the HUD: its layout, where the reticle comes from and which buttons it names. */
export type InputScheme = 'desktop' | 'touch' | 'gamepad';

/** How far from the screen centre (NDC) a fully pushed aim stick puts the reticle, on touch and gamepad. */
export const AIM_REACH = { x: 0.62, y: 0.55 } as const;

/** One frame of player intent, produced by the desktop, touch or gamepad adapter. */
export interface FlightInput {
  /** Steering command, -1..1: x = yaw (+ right), y = pitch (+ up). */
  steerX: number;
  steerY: number;
  /** Reticle position in normalised device coordinates (-1..1, +y up). */
  aimX: number;
  aimY: number;
  /** True while the reticle is being actively placed by the player (touch aim pad held, mouse present). */
  aimActive: boolean;
  fire: boolean;
  /** Absolute throttle target from a slider, or null. */
  throttleTarget: number | null;
  /** Throttle change to apply this frame (keys/wheel). */
  throttleDelta: number;
  strafeX: number;
  strafeY: number;
  boost: boolean;
  actions: Set<FlightAction>;
  /** Screen point (CSS px) the player clicked/tapped to select a target, or null. */
  selectAt: { x: number; y: number } | null;
  /** Deliberate manual flight input this frame (cancels autopilot). */
  manualOverride: boolean;
}

export function emptyInput(): FlightInput {
  return {
    steerX: 0,
    steerY: 0,
    aimX: 0,
    aimY: 0,
    aimActive: false,
    fire: false,
    throttleTarget: null,
    throttleDelta: 0,
    strafeX: 0,
    strafeY: 0,
    boost: false,
    actions: new Set(),
    selectAt: null,
    manualOverride: false,
  };
}

/** Applies a central dead zone and a gentle response curve to a -1..1 axis value. */
export function shapeAxis(v: number, deadZone: number, exponent = 1.35): number {
  const a = Math.abs(v);
  if (a <= deadZone) return 0;
  const t = Math.min(1, (a - deadZone) / (1 - deadZone));
  return Math.sign(v) * Math.pow(t, exponent);
}
