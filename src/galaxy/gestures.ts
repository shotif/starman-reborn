/**
 * Pointer gesture recognizer for the map canvas (pure: fed coordinates and timestamps).
 * One pointer drags to rotate (or pans in pan mode), two pointers pinch to zoom and drag to pan,
 * a short press without movement is a tap, and two quick taps close together are a double tap.
 */

export interface GestureSink {
  rotate(dx: number, dy: number): void;
  pan(dx: number, dy: number): void;
  /** Distance multiplier (< 1 zooms in) about the point (x, y) between the fingers. */
  zoom(factor: number, x: number, y: number): void;
  tap(x: number, y: number, pointerType: string): void;
  doubleTap(x: number, y: number, pointerType: string): void;
}

interface TrackedPointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startT: number;
  type: string;
  pan: boolean;
  tapAllowed: boolean;
}

/** Movement (CSS px) before a press becomes a drag. */
export const DRAG_SLOP_MOUSE = 4;
export const DRAG_SLOP_TOUCH = 10;
/** A press longer than this (ms) is not a tap. */
export const TAP_MAX_MS = 650;
/** Second tap within this time (ms) and distance (px) of the first is a double tap. */
export const DOUBLE_TAP_MS = 380;
export const DOUBLE_TAP_PX = 36;

export class GestureTracker {
  private readonly sink: GestureSink;
  private readonly pointers: TrackedPointer[] = [];
  /** The current gesture moved past the slop or used two pointers: no tap at the end. */
  private dragged = false;
  private pinchDistance = 0;
  private midX = 0;
  private midY = 0;
  private lastTapT = -Infinity;
  private lastTapX = 0;
  private lastTapY = 0;
  private lastTapType = '';

  constructor(sink: GestureSink) {
    this.sink = sink;
  }

  get activePointers(): number {
    return this.pointers.length;
  }

  /** Returns false when the pointer is ignored (a third finger). */
  down(id: number, x: number, y: number, t: number, type: string, pan = false, tapAllowed = true): boolean {
    if (this.pointers.length >= 2 || this.find(id) >= 0) return false;
    this.pointers.push({ id, x, y, startX: x, startY: y, startT: t, type, pan, tapAllowed });
    if (this.pointers.length === 1) {
      this.dragged = false;
    } else {
      this.dragged = true;
      this.startPinch();
    }
    return true;
  }

  move(id: number, x: number, y: number): void {
    const i = this.find(id);
    if (i < 0) return;
    const p = this.pointers[i]!;
    if (this.pointers.length === 1) {
      if (!this.dragged) {
        const slop = p.type === 'mouse' ? DRAG_SLOP_MOUSE : DRAG_SLOP_TOUCH;
        if (Math.hypot(x - p.startX, y - p.startY) < slop) return;
        this.dragged = true;
      }
      const dx = x - p.x;
      const dy = y - p.y;
      p.x = x;
      p.y = y;
      if (dx === 0 && dy === 0) return;
      if (p.pan) this.sink.pan(dx, dy);
      else this.sink.rotate(dx, dy);
      return;
    }
    p.x = x;
    p.y = y;
    const a = this.pointers[0]!;
    const b = this.pointers[1]!;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    // Zoom about where the fingers were, then follow them: what is under them stays there.
    if (this.pinchDistance > 0 && dist > 0) {
      const factor = this.pinchDistance / dist;
      if (factor !== 1) this.sink.zoom(factor, this.midX, this.midY);
    }
    const pdx = mx - this.midX;
    const pdy = my - this.midY;
    if (pdx !== 0 || pdy !== 0) this.sink.pan(pdx, pdy);
    this.pinchDistance = dist;
    this.midX = mx;
    this.midY = my;
  }

  up(id: number, x: number, y: number, t: number): void {
    const i = this.find(id);
    if (i < 0) return;
    const p = this.pointers[i]!;
    this.pointers.splice(i, 1);
    if (this.pointers.length > 0) {
      // Pinch ended with one finger still down: keep rotating from where it is, never tap.
      this.dragged = true;
      return;
    }
    if (this.dragged || !p.tapAllowed || t - p.startT > TAP_MAX_MS) return;
    const isDouble =
      t - this.lastTapT <= DOUBLE_TAP_MS &&
      p.type === this.lastTapType &&
      Math.hypot(x - this.lastTapX, y - this.lastTapY) <= DOUBLE_TAP_PX;
    if (isDouble) {
      this.lastTapT = -Infinity;
      this.sink.doubleTap(x, y, p.type);
    } else {
      this.lastTapT = t;
      this.lastTapX = x;
      this.lastTapY = y;
      this.lastTapType = p.type;
      this.sink.tap(x, y, p.type);
    }
  }

  /** pointercancel / lost capture: forget the pointer and never turn the gesture into a tap. */
  cancel(id: number): void {
    const i = this.find(id);
    if (i < 0) return;
    this.pointers.splice(i, 1);
    this.dragged = true;
    if (this.pointers.length === 1) this.pinchDistance = 0;
  }

  reset(): void {
    this.releaseAll();
    this.lastTapT = -Infinity;
  }

  /**
   * Forgets every pointer but keeps the last tap (for a double tap). For a new first touch while
   * touches are still tracked: their ends never arrived, and stale fingers would turn every later
   * drag into a pinch.
   */
  releaseAll(): void {
    this.pointers.length = 0;
    this.dragged = false;
    this.pinchDistance = 0;
  }

  /** Whether any tracked pointer is of this type. */
  tracks(type: string): boolean {
    return this.pointers.some((p) => p.type === type);
  }

  private find(id: number): number {
    for (let i = 0; i < this.pointers.length; i++) if (this.pointers[i]!.id === id) return i;
    return -1;
  }

  private startPinch(): void {
    const a = this.pointers[0]!;
    const b = this.pointers[1]!;
    this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    this.midX = (a.x + b.x) / 2;
    this.midY = (a.y + b.y) / 2;
  }
}
