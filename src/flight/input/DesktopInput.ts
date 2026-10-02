import type { SteeringMode } from '../../app/settings.ts';
import { shapeAxis, type FlightAction, type FlightInput } from './types.ts';

/** Physical key codes (layout-independent) for each binding; also used to render the controls help. */
export const KEY_BINDINGS = {
  throttleUp: ['KeyW'],
  throttleDown: ['KeyS'],
  strafeLeft: ['KeyA'],
  strafeRight: ['KeyD'],
  boost: ['ShiftLeft', 'ShiftRight'],
  cruise: ['Space'],
  map: ['Tab', 'KeyM'],
  interact: ['KeyE'],
  pause: ['Escape', 'KeyP'],
  targetNext: ['KeyT'],
  targetHostile: ['KeyH'],
  goto: ['KeyG'],
  scan: ['KeyX'],
  missile: ['KeyF'],
  repair: ['KeyR'],
  decoy: ['KeyC'],
  mine: ['KeyB'],
  wingOrder: ['KeyV'],
  engineKill: ['KeyZ'],
  help: ['F1', 'Slash'],
  answer: ['KeyQ'],
  steerLeft: ['ArrowLeft', 'KeyJ'],
  steerRight: ['ArrowRight', 'KeyL'],
  steerUp: ['ArrowUp', 'KeyI'],
  steerDown: ['ArrowDown', 'KeyK'],
} as const;

const ACTION_KEYS: Record<string, FlightAction> = {};
for (const [binding, action] of [
  ['cruise', 'cruise'],
  ['map', 'map'],
  ['interact', 'interact'],
  ['pause', 'pause'],
  ['targetNext', 'target-next'],
  ['targetHostile', 'target-hostile'],
  ['goto', 'goto'],
  ['scan', 'scan'],
  ['missile', 'missile'],
  ['repair', 'repair'],
  ['decoy', 'decoy'],
  ['mine', 'mine'],
  ['wingOrder', 'wing-order'],
  ['engineKill', 'engine-kill'],
  ['help', 'help'],
  ['answer', 'answer'],
] as const) {
  for (const code of KEY_BINDINGS[binding]) ACTION_KEYS[code] = action;
}

const HANDLED_CODES = new Set<string>(Object.values(KEY_BINDINGS).flat());

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Arrow')) return { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }[code] ?? code;
  if (code.startsWith('Shift')) return 'Shift';
  if (code === 'Slash') return '?';
  if (code === 'Escape') return 'Esc';
  return code;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/**
 * Mouse + keyboard adapter. The reticle is the visible cursor: its screen position is both the aim
 * point and, in "mouse" steering, the desired heading (with a central dead zone).
 */
export class DesktopInput {
  enabled = false;
  steering: SteeringMode = 'mouse';
  invertY = false;
  /** Called on any mouse/keyboard activity so the UI can switch to the desktop scheme. */
  onActivity: (() => void) | null = null;
  /** Called on every mouse move so the reticle can be drawn without frame latency. */
  onPointerMove: ((x: number, y: number) => void) | null = null;

  private readonly canvas: HTMLCanvasElement;
  private readonly keys = new Set<string>();
  private readonly pendingActions = new Set<FlightAction>();
  private mouseX = 0;
  private mouseY = 0;
  private hasMouse = false;
  private rightDown = false;
  private leftDown = false;
  private leftDownAt = { x: 0, y: 0, t: 0 };
  private dragging = false;
  private wheel = 0;
  private click: { x: number; y: number } | null = null;
  private keySteerX = 0;
  private keySteerY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('keyup', this.onKeyUp, { capture: true });
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pointermove', this.onMove, { passive: true });
    // Capture at the window so right-button firing works even when the cursor is over a HUD marker.
    window.addEventListener('pointerdown', this.onDown, { capture: true });
    window.addEventListener('pointerup', this.onUp, { capture: true });
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('contextmenu', this.onContextMenu, { capture: true });
  }

  private readonly onContextMenu = (e: Event) => {
    if (this.enabled || e.target === this.canvas) e.preventDefault();
  };

  /** Cursor position in CSS pixels relative to the canvas. */
  get cursor(): { x: number; y: number; present: boolean } {
    return { x: this.mouseX, y: this.mouseY, present: this.hasMouse };
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.clear();
  }

  clear(): void {
    this.keys.clear();
    this.pendingActions.clear();
    this.rightDown = false;
    this.leftDown = false;
    this.dragging = false;
    this.wheel = 0;
    this.click = null;
    this.keySteerX = 0;
    this.keySteerY = 0;
  }

  /** Queue an action (used by on-screen buttons that share desktop semantics). */
  trigger(action: FlightAction): void {
    this.pendingActions.add(action);
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled || isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!HANDLED_CODES.has(e.code)) return;
    // Keep Tab/Space/arrows from moving focus or scrolling while flying.
    e.preventDefault();
    this.onActivity?.();
    if (!e.repeat) {
      const action = ACTION_KEYS[e.code];
      if (action) this.pendingActions.add(action);
    }
    this.keys.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private readonly onBlur = () => {
    this.keys.clear();
    this.rightDown = false;
    this.leftDown = false;
    this.dragging = false;
  };

  private readonly onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - rect.left;
    this.mouseY = e.clientY - rect.top;
    this.hasMouse = true;
    if (this.leftDown && Math.hypot(this.mouseX - this.leftDownAt.x, this.mouseY - this.leftDownAt.y) > 6) {
      this.dragging = true;
    }
    if (this.enabled) {
      this.onActivity?.();
      this.onPointerMove?.(this.mouseX, this.mouseY);
    }
  };

  private readonly onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || !this.enabled) return;
    const target = e.target as HTMLElement | null;
    const onCanvas = target === this.canvas;
    const onControl = !!target?.closest?.('button, a, input, select, [role="slider"], .panel');
    this.onActivity?.();
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - rect.left;
    this.mouseY = e.clientY - rect.top;
    this.hasMouse = true;
    if (e.button === 2) {
      // Fire wherever the cursor is, including over markers.
      e.preventDefault();
      this.rightDown = true;
    } else if (e.button === 1) {
      e.preventDefault();
      this.pendingActions.add('missile');
    } else if (e.button === 0 && (onCanvas || !onControl)) {
      e.preventDefault();
      this.canvas.focus({ preventScroll: true });
      this.leftDown = true;
      this.dragging = false;
      this.leftDownAt = { x: this.mouseX, y: this.mouseY, t: performance.now() };
    }
  };

  private readonly onUp = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    if (e.button === 2) this.rightDown = false;
    if (e.button === 0 && this.leftDown) {
      this.leftDown = false;
      const quick = performance.now() - this.leftDownAt.t < 350;
      if (this.enabled && !this.dragging && quick) this.click = { x: this.mouseX, y: this.mouseY };
      this.dragging = false;
    }
  };

  private readonly onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.onActivity?.();
    this.wheel += Math.sign(e.deltaY);
  };

  private pressed(binding: keyof typeof KEY_BINDINGS): boolean {
    return KEY_BINDINGS[binding].some((code) => this.keys.has(code));
  }

  /** Writes this frame's desktop intent into `out` (merging with anything already there). */
  poll(dt: number, out: FlightInput): void {
    if (!this.enabled) return;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const ndcX = (this.mouseX / w) * 2 - 1;
    const ndcY = -((this.mouseY / h) * 2 - 1);
    if (this.hasMouse) {
      out.aimX = ndcX;
      out.aimY = ndcY;
      out.aimActive = true;
    }

    // Steering.
    const ySign = this.invertY ? -1 : 1;
    if (this.steering === 'keyboard') {
      const tx = (this.pressed('steerRight') ? 1 : 0) - (this.pressed('steerLeft') ? 1 : 0);
      const ty = (this.pressed('steerUp') ? 1 : 0) - (this.pressed('steerDown') ? 1 : 0);
      const k = 1 - Math.exp(-10 * dt);
      this.keySteerX += (tx - this.keySteerX) * k;
      this.keySteerY += (ty - this.keySteerY) * k;
      out.steerX = this.keySteerX;
      out.steerY = this.keySteerY * ySign;
      if (tx !== 0 || ty !== 0) out.manualOverride = true;
    } else if (this.hasMouse && (this.steering === 'mouse' || (this.steering === 'drag' && this.leftDown && this.dragging))) {
      out.steerX = shapeAxis(ndcX, 0.07);
      out.steerY = shapeAxis(ndcY, 0.07) * ySign;
      if (this.steering === 'drag') out.manualOverride = true;
    }

    out.fire = out.fire || this.rightDown;
    const throttleKeys = (this.pressed('throttleUp') ? 1 : 0) - (this.pressed('throttleDown') ? 1 : 0);
    out.throttleDelta += throttleKeys * 0.9 * dt - this.wheel * 0.1;
    out.strafeX = (this.pressed('strafeRight') ? 1 : 0) - (this.pressed('strafeLeft') ? 1 : 0);
    out.boost = out.boost || this.pressed('boost');
    if (throttleKeys !== 0 || out.strafeX !== 0 || this.wheel !== 0 || out.boost) out.manualOverride = true;
    this.wheel = 0;
    for (const a of this.pendingActions) out.actions.add(a);
    this.pendingActions.clear();
    if (this.click) {
      out.selectAt = this.click;
      this.click = null;
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    window.removeEventListener('keyup', this.onKeyUp, { capture: true });
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp, { capture: true });
    window.removeEventListener('pointerdown', this.onDown, { capture: true });
    window.removeEventListener('contextmenu', this.onContextMenu, { capture: true });
    this.canvas.removeEventListener('wheel', this.onWheel);
  }
}
