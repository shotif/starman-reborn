/** Largest simulated step per frame: after a stall or tab resume the game never "catches up". */
export const MAX_FRAME_DT = 0.1;

/**
 * requestAnimationFrame loop with bounded deltas. Stops completely while the page is hidden
 * (no background simulation) and restarts with a zero first delta, so nothing teleports on resume.
 * `lowPower` renders at roughly half rate (menus, docked screens) to save battery.
 */
export class Loop {
  lowPower = false;
  private readonly tick: (dt: number) => void;
  private raf = 0;
  private last = 0;
  private running = false;
  private skip = false;
  onVisibility: ((visible: boolean) => void) | null = null;

  constructor(tick: (dt: number) => void) {
    this.tick = tick;
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private readonly frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.lowPower) {
      this.skip = !this.skip;
      if (this.skip) return;
    }
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt >= 0)) dt = 0;
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
    this.tick(dt);
  };

  private readonly onVisibilityChange = () => {
    const visible = document.visibilityState === 'visible';
    if (visible) {
      this.last = performance.now();
      if (!this.running) this.start();
    } else {
      this.stop();
    }
    this.onVisibility?.(visible);
  };
}
