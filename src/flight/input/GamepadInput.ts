import { AIM_REACH, shapeAxis, type FlightAction, type FlightInput } from './types.ts';

/**
 * Gamepad flight controls, read through the Gamepad API's "standard" layout (buttons by position,
 * named here as on an Xbox pad; `padLabel` gives the PlayStation names):
 *
 * - Left stick steers, like the mouse or the touch steering stick: pushing up lifts the nose unless
 *   pitch is inverted. Right stick moves the reticle off the centre, like the touch aim stick; let
 *   go and it drifts back.
 * - Held: RT fires, LT boosts, D-pad up and down move the throttle.
 * - Once per press: A is the HUD's context action (dock, enter lane, scan, go to or stop: the E key),
 *   B free flight, X missile, Y next target, RB nearest hostile, LB decoy flare, D-pad left repair
 *   kit, D-pad right cruise, L3 engines off, R3 go to the selected target, Start pause and Back the
 *   star map.
 *
 * Pads the browser reports without the standard layout are announced but not read: their buttons
 * could be anywhere.
 */

/** Button indices of the standard layout, named as on an Xbox pad. */
export const PAD_BUTTON = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  back: 8,
  start: 9,
  ls: 10,
  rs: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

export type PadButton = keyof typeof PAD_BUTTON;

/** Buttons that fire a flight action once per press. */
export const PAD_ACTIONS = {
  a: 'interact',
  b: 'cancel-autopilot',
  x: 'missile',
  y: 'target-next',
  rb: 'target-hostile',
  lb: 'decoy',
  left: 'repair',
  right: 'cruise',
  ls: 'engine-kill',
  rs: 'goto',
  start: 'pause',
  back: 'map',
} as const satisfies Partial<Record<PadButton, FlightAction>>;

/** A flight action that a pad button fires. */
export type PadAction = (typeof PAD_ACTIONS)[keyof typeof PAD_ACTIONS];

/** The button for each action the pad fires (PAD_ACTIONS the other way round), for hints and help. */
export const PAD_FOR = Object.fromEntries(Object.entries(PAD_ACTIONS).map(([button, action]) => [action, button])) as Record<PadAction, PadButton>;

/** Buttons that act for as long as they are held. */
export const PAD_HOLDS = { fire: 'rt', boost: 'lt', throttleUp: 'up', throttleDown: 'down' } as const satisfies Record<string, PadButton>;

const ACTION_BUTTONS = (Object.entries(PAD_ACTIONS) as [PadButton, PadAction][]).map(([button, action]) => [PAD_BUTTON[button], action] as const);

/** Which names the pad's buttons carry. */
export type PadStyle = 'xbox' | 'playstation';

const XBOX_NAMES: Record<PadButton, string> = {
  a: 'A',
  b: 'B',
  x: 'X',
  y: 'Y',
  lb: 'LB',
  rb: 'RB',
  lt: 'LT',
  rt: 'RT',
  back: 'Back',
  start: 'Start',
  ls: 'L3',
  rs: 'R3',
  up: 'D-pad ↑',
  down: 'D-pad ↓',
  left: 'D-pad ←',
  right: 'D-pad →',
};

/** A PlayStation pad names the same positions differently. */
const PLAYSTATION_NAMES: Record<PadButton, string> = {
  ...XBOX_NAMES,
  a: '✕',
  b: '○',
  x: '□',
  y: '△',
  lb: 'L1',
  rb: 'R1',
  lt: 'L2',
  rt: 'R2',
  back: 'Create',
  start: 'Options',
};

/** A button's name on the player's pad, for the HUD hints and the controls help. */
export function padLabel(button: PadButton, style: PadStyle = 'xbox'): string {
  return (style === 'playstation' ? PLAYSTATION_NAMES : XBOX_NAMES)[button];
}

/** Sony pads (vendor 054c, or named so) get PlayStation names; any other pad is named as an Xbox pad. */
export function padStyle(id: string): PadStyle {
  return /054c|playstation|dualshock|dualsense|sony/i.test(id) ? 'playstation' : 'xbox';
}

/** What this adapter reads of a Gamepad: the browser's object fits, and unit tests pass plain fakes. */
export interface PadState {
  readonly id: string;
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}

/** Where the pads come from: the browser, or a fake in tests. */
export type PadSource = () => readonly (PadState | null)[];

/** The browser's pads; none where the API is missing or blocked (an insecure page, a permissions policy). */
function browserPads(): readonly (PadState | null)[] {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  } catch {
    return [];
  }
}

const BUTTONS = 16;
/** Stick travel ignored around the centre (worn sticks rest a little off it). */
const DEAD_ZONE = 0.2;
/** Trigger travel that counts as a pull, so a finger resting on it does not fire. */
const TRIGGER_PULL = 0.3;
/** How far a stick must move (after shaping) to count as using the pad: a drifting stick never does. */
const STICK_USE = 0.3;
/** Steering beyond this takes over from the autopilot. */
const STEER_OVERRIDE = 0.15;
/** Throttle change per second while the D-pad is held: the same as the W and S keys. */
const THROTTLE_RATE = 0.9;

interface Vec {
  x: number;
  y: number;
}

function axis(pad: PadState, i: number): number {
  const v = pad.axes[i] ?? 0;
  return Number.isFinite(v) ? v : 0;
}

function isDown(pad: PadState, i: number): boolean {
  const b = pad.buttons[i];
  if (!b) return false;
  // Triggers are analogue: only a real pull counts.
  return i === PAD_BUTTON.lt || i === PAD_BUTTON.rt ? b.value > TRIGGER_PULL : b.pressed || b.value > 0.5;
}

/** Radial dead zone and response curve for one stick, with +y up (the Gamepad API reports up as -1). */
function shapeStick(x: number, y: number, out: Vec): void {
  const len = Math.hypot(x, y);
  const shaped = shapeAxis(len, DEAD_ZONE);
  // `|| 0` keeps a centred axis at 0 rather than -0.
  out.x = shaped === 0 ? 0 : (x / len) * shaped || 0;
  out.y = shaped === 0 ? 0 : (-y / len) * shaped || 0;
}

/**
 * Whether a stick was pushed far enough from where it last counted as use (that becomes the new
 * mark). Letting go is not use: a stick springing back to the centre never takes the HUD back.
 */
function pushedFrom(stick: Vec, mark: Vec): boolean {
  if (Math.hypot(stick.x - mark.x, stick.y - mark.y) <= STICK_USE) return false;
  mark.x = stick.x;
  mark.y = stick.y;
  return stick.x !== 0 || stick.y !== 0;
}

/**
 * Gamepad adapter. `update` reads the pads once per frame; `poll` merges the frame into the flight
 * input like the desktop and touch adapters. Presses fire once (edge-triggered); fire, boost and
 * throttle act while held. With several pads, buttons from any of them count and each stick follows
 * whichever pad pushes it further.
 */
export class GamepadInput {
  /** Mirrors the Invert pitch setting. */
  invertY = false;
  /** The pad was used (a press or a stick push), so the HUD can switch to the gamepad scheme. */
  onActivity: (() => void) | null = null;
  /** A pad came; `supported` is false for one without the standard layout (it is not read). */
  onConnected: ((supported: boolean) => void) | null = null;
  /** A pad went; `anyLeft` says whether a usable pad remains. */
  onDisconnected: ((anyLeft: boolean) => void) | null = null;
  /** Button names for the hints: those of the first usable pad. */
  style: PadStyle = 'xbox';

  private readonly source: PadSource;
  /** Pads announced so far, by index: their id, and whether they have the standard layout. */
  private readonly known = new Map<number, { id: string; standard: boolean }>();
  private down = new Array<boolean>(BUTTONS).fill(false);
  private wasDown = new Array<boolean>(BUTTONS).fill(false);
  private readonly pressedNow = new Set<FlightAction>();
  private readonly steer: Vec = { x: 0, y: 0 };
  private readonly aim: Vec = { x: 0, y: 0 };
  /** Where each stick was when it last counted as use. */
  private readonly steerMark: Vec = { x: 0, y: 0 };
  private readonly aimMark: Vec = { x: 0, y: 0 };
  /** Set when the pads change: buttons already held must be let go before they act. */
  private resync = true;
  /** Standard-layout pads read this frame. */
  private reading = 0;

  constructor(source: PadSource = browserPads) {
    this.source = source;
  }

  /** Whether a usable (standard-layout) pad is connected. */
  get connected(): boolean {
    for (const pad of this.known.values()) if (pad.standard) return true;
    return false;
  }

  /** Listens for pads coming and going; returns a function that stops listening. */
  listen(target: EventTarget): () => void {
    const padOf = (e: Event) => (e as Event & { gamepad?: PadState }).gamepad;
    const onConnect = (e: Event) => {
      const pad = padOf(e);
      if (pad) this.connect(pad);
    };
    const onDisconnect = (e: Event) => {
      const pad = padOf(e);
      if (pad) this.disconnect(pad.index);
    };
    target.addEventListener('gamepadconnected', onConnect);
    target.addEventListener('gamepaddisconnected', onDisconnect);
    return () => {
      target.removeEventListener('gamepadconnected', onConnect);
      target.removeEventListener('gamepaddisconnected', onDisconnect);
    };
  }

  /**
   * Reads the pads. Call it once per frame in every mode, so a press counts once and a press made
   * on one screen never acts on the next.
   */
  update(): void {
    this.pressedNow.clear();
    const last = this.down;
    this.down = this.wasDown;
    this.wasDown = last;
    this.down.fill(false);
    const pads = this.source();
    this.reconcile(pads);
    let sx = 0;
    let sy = 0;
    let ax = 0;
    let ay = 0;
    this.reading = 0;
    for (const pad of pads) {
      if (!pad || !pad.connected || pad.mapping !== 'standard') continue;
      this.reading++;
      for (let i = 0; i < BUTTONS; i++) if (isDown(pad, i)) this.down[i] = true;
      const lx = axis(pad, 0);
      const ly = axis(pad, 1);
      const rx = axis(pad, 2);
      const ry = axis(pad, 3);
      if (Math.hypot(lx, ly) > Math.hypot(sx, sy)) {
        sx = lx;
        sy = ly;
      }
      if (Math.hypot(rx, ry) > Math.hypot(ax, ay)) {
        ax = rx;
        ay = ry;
      }
    }
    shapeStick(sx, sy, this.steer);
    shapeStick(ax, ay, this.aim);
    if (this.resync) {
      this.resync = false;
      for (let i = 0; i < BUTTONS; i++) this.wasDown[i] = this.down[i] === true;
      Object.assign(this.steerMark, this.steer);
      Object.assign(this.aimMark, this.aim);
      return;
    }
    let used = false;
    for (let i = 0; i < BUTTONS; i++) if (this.down[i] && !this.wasDown[i]) used = true;
    for (const [i, action] of ACTION_BUTTONS) if (this.down[i] && !this.wasDown[i]) this.pressedNow.add(action);
    // Evaluate both sticks, so each keeps its own mark.
    const steered = pushedFrom(this.steer, this.steerMark);
    const aimed = pushedFrom(this.aim, this.aimMark);
    if (used || steered || aimed) this.onActivity?.();
  }

  /**
   * Merges this frame's gamepad intent into `out` (after `update`). Presses and held buttons always
   * count, alongside the mouse, keyboard or touch. `drive` means the pad is the device in use: its
   * sticks then own steering and aim even at rest, so a mouse left off-centre cannot steer.
   */
  poll(dt: number, out: FlightInput, drive: boolean): void {
    if (this.reading === 0) return;
    for (const action of this.pressedNow) out.actions.add(action);
    if (this.held('fire')) out.fire = true;
    if (this.held('boost')) {
      out.boost = true;
      out.manualOverride = true;
    }
    const throttle = (this.held('throttleUp') ? 1 : 0) - (this.held('throttleDown') ? 1 : 0);
    if (throttle !== 0) {
      out.throttleDelta += throttle * THROTTLE_RATE * dt;
      out.manualOverride = true;
    }
    if (!drive) return;
    out.steerX = this.steer.x;
    out.steerY = (this.invertY ? -this.steer.y : this.steer.y) || 0;
    if (Math.hypot(this.steer.x, this.steer.y) > STEER_OVERRIDE) out.manualOverride = true;
    out.aimActive = this.aim.x !== 0 || this.aim.y !== 0;
    if (out.aimActive) {
      out.aimX = this.aim.x * AIM_REACH.x;
      out.aimY = this.aim.y * AIM_REACH.y;
    }
  }

  /**
   * A press for a dialog this frame (after `update`): the D-pad up or down to move between its
   * buttons, A to press the one in focus, B to close it; null for none.
   */
  menu(): 'up' | 'down' | 'confirm' | 'back' | null {
    if (this.reading === 0) return null;
    const edge = (b: PadButton) => this.down[PAD_BUTTON[b]] === true && this.wasDown[PAD_BUTTON[b]] !== true;
    return edge('up') ? 'up' : edge('down') ? 'down' : edge('a') ? 'confirm' : edge('b') ? 'back' : null;
  }

  /** Whether the button for `action` was pressed this frame (the pause menu and star map listen for Start and Back). */
  pressed(action: FlightAction): boolean {
    return this.pressedNow.has(action);
  }

  private held(hold: keyof typeof PAD_HOLDS): boolean {
    return this.down[PAD_BUTTON[PAD_HOLDS[hold]]] === true;
  }

  /** Catches pads that came or went without an event, or before the game listened. */
  private reconcile(pads: readonly (PadState | null)[]): void {
    for (const pad of pads) if (pad?.connected) this.connect(pad);
    for (const index of this.known.keys()) {
      if (!pads.some((pad) => pad?.connected && pad.index === index)) this.disconnect(index);
    }
  }

  private connect(pad: PadState): void {
    if (this.known.get(pad.index)?.id === pad.id) return;
    const standard = pad.mapping === 'standard';
    this.known.set(pad.index, { id: pad.id, standard });
    this.changed();
    this.onConnected?.(standard);
  }

  private disconnect(index: number): void {
    if (!this.known.delete(index)) return;
    this.changed();
    this.onDisconnected?.(this.connected);
  }

  /** The pads changed: take the new pad's button names, and make held buttons wait for a fresh press. */
  private changed(): void {
    this.resync = true;
    let style: PadStyle = 'xbox';
    for (const pad of this.known.values()) {
      if (!pad.standard) continue;
      style = padStyle(pad.id);
      break;
    }
    this.style = style;
  }
}
