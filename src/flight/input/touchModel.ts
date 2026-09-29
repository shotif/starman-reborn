/**
 * Pointer-ownership model for on-screen sticks. DOM-free so it can be unit-tested: the touch
 * controls feed it pointer ids and coordinates, and each stick only ever listens to the one
 * pointer that claimed it until that pointer lifts or is cancelled.
 */
export class VirtualStick {
  /** Travel (CSS px) from the touch origin that maps to full deflection. */
  radius: number;
  deadZone: number;
  private ownerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private dx = 0;
  private dy = 0;

  constructor(radius: number, deadZone = 0.08) {
    this.radius = radius;
    this.deadZone = deadZone;
  }

  get owner(): number | null {
    return this.ownerId;
  }

  get active(): boolean {
    return this.ownerId !== null;
  }

  get origin(): { x: number; y: number } {
    return { x: this.originX, y: this.originY };
  }

  /** Raw knob offset from the origin in CSS px, clamped to the radius. */
  get knob(): { x: number; y: number } {
    return { x: this.dx, y: this.dy };
  }

  /**
   * Stick vector in -1..1 with +y meaning "up" on screen (so pushing up pitches the nose up
   * unless the player inverts it). Dead zone applied radially.
   */
  get vector(): { x: number; y: number } {
    if (this.ownerId === null) return { x: 0, y: 0 };
    const len = Math.hypot(this.dx, this.dy) / this.radius;
    if (len <= this.deadZone) return { x: 0, y: 0 };
    const scaled = Math.min(1, (len - this.deadZone) / (1 - this.deadZone));
    const nx = this.dx / this.radius / len;
    const ny = this.dy / this.radius / len;
    return { x: nx * scaled, y: -ny * scaled };
  }

  /** Claims the stick for this pointer if it is free. Returns whether the pointer now owns it. */
  down(pointerId: number, x: number, y: number): boolean {
    if (this.ownerId !== null && this.ownerId !== pointerId) return false;
    this.ownerId = pointerId;
    this.originX = x;
    this.originY = y;
    this.dx = 0;
    this.dy = 0;
    return true;
  }

  move(pointerId: number, x: number, y: number): void {
    if (pointerId !== this.ownerId) return;
    let dx = x - this.originX;
    let dy = y - this.originY;
    const len = Math.hypot(dx, dy);
    if (len > this.radius) {
      dx = (dx / len) * this.radius;
      dy = (dy / len) * this.radius;
    }
    this.dx = dx;
    this.dy = dy;
  }

  /** Releases the stick if this pointer owns it (pointerup, pointercancel, lost capture). */
  release(pointerId: number): boolean {
    if (pointerId !== this.ownerId) return false;
    this.ownerId = null;
    this.dx = 0;
    this.dy = 0;
    return true;
  }

  reset(): void {
    this.ownerId = null;
    this.dx = 0;
    this.dy = 0;
  }
}

/** A press-and-hold button that tracks which pointer holds it. */
export class HoldButton {
  private ownerId: number | null = null;

  get held(): boolean {
    return this.ownerId !== null;
  }

  down(pointerId: number): boolean {
    if (this.ownerId !== null) return false;
    this.ownerId = pointerId;
    return true;
  }

  release(pointerId: number): boolean {
    if (pointerId !== this.ownerId) return false;
    this.ownerId = null;
    return true;
  }

  reset(): void {
    this.ownerId = null;
  }
}

/** The two-thumb layout: left stick steers, right stick aims and fires while held. */
export class TouchControlsModel {
  readonly steer: VirtualStick;
  readonly aim: VirtualStick;
  readonly boost = new HoldButton();

  constructor(steerRadius = 64, aimRadius = 72) {
    this.steer = new VirtualStick(steerRadius, 0.1);
    this.aim = new VirtualStick(aimRadius, 0.04);
  }

  /** Firing is "hold within the aim pad". */
  get firing(): boolean {
    return this.aim.active;
  }

  /** Releases whatever this pointer owned. */
  release(pointerId: number): void {
    this.steer.release(pointerId);
    this.aim.release(pointerId);
    this.boost.release(pointerId);
  }

  resetAll(): void {
    this.steer.reset();
    this.aim.reset();
    this.boost.reset();
  }
}
