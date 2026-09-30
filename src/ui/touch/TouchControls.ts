import { WING_ORDER_LABEL, type WingOrder } from '../hud/hudModel.ts';
import type { AimAssist } from '../../app/settings.ts';
import { AIM_REACH, type FlightAction, type FlightInput } from '../../flight/input/types.ts';
import { TouchControlsModel, type VirtualStick } from '../../flight/input/touchModel.ts';
import { h } from '../dom.ts';
import { icon, type IconName } from '../icons.ts';
import '../styles/touch.css';

export interface TouchCallbacks {
  onAction(action: FlightAction): void;
  onAimAssistCycle(): void;
  /** Any touch activity (switches the UI to the touch scheme). */
  onActivity(): void;
}

/**
 * Two-thumb flight controls. The left zone spawns a floating steering stick; the right zone
 * spawns an aim stick that moves the reticle and fires while held. Every control tracks its own
 * pointer id with pointer capture, so both thumbs work independently; pointercancel and lost
 * capture always release. Only these regions set touch-action: none.
 */
export class TouchControls {
  readonly root: HTMLElement;
  readonly model = new TouchControlsModel();
  invertY = false;

  private readonly callbacks: TouchCallbacks;
  private readonly steerZone: HTMLElement;
  private readonly aimZone: HTMLElement;
  private readonly steerKnob: HTMLElement;
  private readonly steerBase: HTMLElement;
  private readonly aimKnob: HTMLElement;
  private readonly aimBase: HTMLElement;
  private readonly contextBtn: HTMLButtonElement;
  private readonly contextLabel: HTMLElement;
  private readonly cruiseBtn: HTMLButtonElement;
  private readonly boostBtn: HTMLButtonElement;
  private readonly missileCount: HTMLElement;
  private readonly repairCount: HTMLElement;
  private readonly decoyCount: HTMLElement;
  private readonly driftBtn: HTMLButtonElement;
  private readonly assistChip: HTMLButtonElement;
  private readonly wingChip: HTMLButtonElement;
  private readonly throttleTrack: HTMLElement;
  private readonly throttleFill: HTMLElement;
  private readonly throttleValue: HTMLElement;
  private throttle = 0;
  private throttlePointer: number | null = null;
  private throttleChanged = false;
  private contextAction: FlightAction | null = null;

  constructor(parent: HTMLElement, callbacks: TouchCallbacks) {
    this.callbacks = callbacks;
    this.steerBase = h('div', { class: 'stick-base' });
    this.steerKnob = h('div', { class: 'stick-knob' });
    this.aimBase = h('div', { class: 'stick-base aim' });
    this.aimKnob = h('div', { class: 'stick-knob aim' });
    this.steerZone = h(
      'div',
      { class: 'touch-zone steer', 'aria-label': 'Steering stick', 'data-testid': 'touch-steer' },
      h('div', { class: 'zone-hint' }, icon('goto'), 'Steer'),
      this.steerBase,
      this.steerKnob,
    );
    this.aimZone = h(
      'div',
      { class: 'touch-zone aim', 'aria-label': 'Aim pad: hold to fire', 'data-testid': 'touch-aim' },
      h('div', { class: 'zone-hint' }, icon('target'), 'Aim · hold to fire'),
      this.aimBase,
      this.aimKnob,
    );
    this.bindStick(this.steerZone, this.model.steer, this.steerBase, this.steerKnob);
    this.bindStick(this.aimZone, this.model.aim, this.aimBase, this.aimKnob);

    const mk = (name: IconName, label: string, testId: string, cls = '') =>
      h('button', { type: 'button', class: `tbtn ${cls}`, 'aria-label': label, 'data-testid': testId }, icon(name), h('span', { class: 'tlabel' }, label));

    this.boostBtn = mk('boost', 'Boost', 'touch-boost', 'boost');
    this.bindHold(this.boostBtn);
    this.cruiseBtn = mk('cruise', 'Cruise', 'touch-cruise', 'cruise');
    this.bindTap(this.cruiseBtn, 'cruise');
    const targetBtn = mk('target', 'Target', 'touch-target', 'target');
    this.bindTap(targetBtn, 'target-next', 'target-hostile');
    const missileBtn = mk('missile', 'Missile', 'touch-missile', 'missile');
    this.missileCount = h('span', { class: 'tcount' }, '0');
    missileBtn.appendChild(this.missileCount);
    this.bindTap(missileBtn, 'missile');
    const repairBtn = mk('repair', 'Repair', 'touch-repair', 'repair small');
    this.repairCount = h('span', { class: 'tcount' }, '0');
    repairBtn.appendChild(this.repairCount);
    this.bindTap(repairBtn, 'repair');
    const decoyBtn = mk('decoy', 'Decoy', 'touch-decoy', 'decoy small');
    this.decoyCount = h('span', { class: 'tcount' }, '0');
    decoyBtn.appendChild(this.decoyCount);
    this.bindTap(decoyBtn, 'decoy');
    this.contextLabel = h('span', { class: 'tlabel' }, 'Dock');
    this.contextBtn = h(
      'button',
      { type: 'button', class: 'tbtn context', 'data-testid': 'touch-context', 'aria-label': 'Dock' },
      icon('dock'),
      this.contextLabel,
    );
    this.contextBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.callbacks.onActivity();
      if (this.contextAction && !this.contextBtn.disabled) this.callbacks.onAction(this.contextAction);
    });
    this.contextBtn.addEventListener('click', (e) => {
      // Keyboard activation (Enter/Space) of the focused button.
      if (e.detail === 0 && this.contextAction) this.callbacks.onAction(this.contextAction);
    });
    this.driftBtn = mk('kill', 'Drift', 'touch-drift', 'drift small');
    this.bindTap(this.driftBtn, 'engine-kill');
    this.assistChip = h('button', { type: 'button', class: 'assist-chip', 'data-testid': 'touch-assist' }, 'Aim assist: Low');
    this.assistChip.addEventListener('click', () => this.callbacks.onAimAssistCycle());
    // The wing's standing order, shown and cycled only while a wing flies with you.
    this.wingChip = h('button', { type: 'button', class: 'wing-chip', 'data-testid': 'touch-wing', hidden: true }, 'Wing') as HTMLButtonElement;
    this.bindTap(this.wingChip, 'wing-order');

    this.throttleFill = h('div', { class: 'throttle-fill' });
    this.throttleValue = h('div', { class: 'throttle-value num' }, '0%');
    this.throttleTrack = h(
      'div',
      {
        class: 'throttle-track',
        role: 'slider',
        'aria-label': 'Throttle',
        'aria-valuemin': '-25',
        'aria-valuemax': '100',
        'aria-valuenow': '0',
        'data-testid': 'touch-throttle',
      },
      h('div', { class: 'throttle-zero' }),
      this.throttleFill,
    );
    this.bindThrottle();

    // The decoy button sits with the combat buttons in portrait, and with Cruise and Go To in
    // landscape, where the right-hand column is already full (docs/PROCGEN.md §15).
    const leftCluster = h('div', { class: 'tcluster left' }, this.cruiseBtn, this.contextBtn);
    const rightCluster = h('div', { class: 'tcluster right' }, targetBtn, missileBtn, this.boostBtn, repairBtn);
    const placeDecoy = (landscape: boolean) => (landscape ? leftCluster : rightCluster).appendChild(decoyBtn);
    const orientation = typeof matchMedia === 'function' ? matchMedia('(orientation: landscape)') : null;
    placeDecoy(orientation?.matches ?? false);
    orientation?.addEventListener?.('change', (e) => placeDecoy(e.matches));
    this.root = h(
      'div',
      { class: 'touch-controls', 'data-testid': 'touch-controls' },
      this.steerZone,
      this.aimZone,
      leftCluster,
      rightCluster,
      h('div', { class: 'throttle' }, this.throttleValue, this.throttleTrack, this.driftBtn),
      h('div', { class: 'touch-chips' }, this.wingChip, this.assistChip),
    );
    parent.appendChild(this.root);
    this.setVisible(false);
  }

  setVisible(on: boolean): void {
    this.root.hidden = !on;
    if (!on) this.resetPointers();
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  setSwapSides(swap: boolean): void {
    this.root.classList.toggle('swapped', swap);
  }

  /** Drops every held pointer (orientation change, pause, menus). */
  resetPointers(): void {
    this.model.resetAll();
    this.throttlePointer = null;
    this.boostBtn.classList.remove('pressed');
    for (const [base, knob] of [
      [this.steerBase, this.steerKnob],
      [this.aimBase, this.aimKnob],
    ] as const) {
      base.classList.remove('active');
      knob.classList.remove('active');
    }
  }

  setContextAction(label: string | null, action: FlightAction | null, iconName: IconName = 'dock'): void {
    this.contextAction = action;
    this.contextBtn.disabled = !action;
    this.contextBtn.classList.toggle('ready', !!action);
    const text = label ?? 'No action';
    if (this.contextLabel.textContent !== text) {
      this.contextLabel.textContent = text;
      this.contextBtn.setAttribute('aria-label', text);
      this.contextBtn.querySelector('svg')?.replaceWith(icon(iconName));
    }
  }

  setCruiseState(state: 'off' | 'charging' | 'on'): void {
    this.cruiseBtn.dataset.state = state;
  }

  /** Shows the wing's order chip while a wing flies with the player. */
  setWing(wing: { count: number; order: WingOrder } | null): void {
    this.wingChip.hidden = !wing;
    if (wing) {
      const text = `Wing: ${WING_ORDER_LABEL[wing.order]}`;
      if (this.wingChip.textContent !== text) this.wingChip.textContent = text;
    }
  }

  setCounts(missiles: number, repairKits: number, decoys = 0): void {
    this.missileCount.textContent = String(missiles);
    this.repairCount.textContent = String(repairKits);
    this.decoyCount.textContent = String(decoys);
  }

  setDrift(on: boolean): void {
    this.driftBtn.classList.toggle('on', on);
  }

  setAimAssist(level: AimAssist): void {
    this.assistChip.textContent = `Aim assist: ${level === 'off' ? 'Off' : level === 'low' ? 'Low' : 'Medium'}`;
    this.assistChip.dataset.level = level;
  }

  /** Mirrors the flight throttle (e.g. after keyboard or autopilot changes). */
  setThrottle(value: number): void {
    if (this.throttlePointer !== null) return;
    this.throttle = value;
    this.renderThrottle();
  }

  poll(out: FlightInput): void {
    if (!this.visible) return;
    const steer = this.model.steer.vector;
    if (this.model.steer.active) {
      out.steerX = steer.x;
      out.steerY = this.invertY ? -steer.y : steer.y;
      if (Math.hypot(steer.x, steer.y) > 0.2) out.manualOverride = true;
    }
    if (this.model.aim.active) {
      const aim = this.model.aim.vector;
      out.aimX = aim.x * AIM_REACH.x;
      out.aimY = aim.y * AIM_REACH.y;
      out.aimActive = true;
      out.fire = true;
    }
    if (this.model.boost.held) {
      out.boost = true;
      out.manualOverride = true;
    }
    if (this.throttleChanged) {
      out.throttleTarget = this.throttle;
      out.manualOverride = true;
      this.throttleChanged = false;
    }
  }

  private bindStick(zone: HTMLElement, stick: VirtualStick, base: HTMLElement, knob: HTMLElement): void {
    const place = () => {
      const o = stick.origin;
      const k = stick.knob;
      base.style.transform = `translate(${o.x}px, ${o.y}px)`;
      knob.style.transform = `translate(${o.x + k.x}px, ${o.y + k.y}px)`;
    };
    zone.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      this.callbacks.onActivity();
      const r = zone.getBoundingClientRect();
      if (!stick.down(e.pointerId, e.clientX - r.left, e.clientY - r.top)) return;
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointers in tests may not support capture.
      }
      base.classList.add('active');
      knob.classList.add('active');
      place();
    });
    zone.addEventListener('pointermove', (e) => {
      if (stick.owner !== e.pointerId) return;
      e.preventDefault();
      const r = zone.getBoundingClientRect();
      stick.move(e.pointerId, e.clientX - r.left, e.clientY - r.top);
      place();
    });
    const release = (e: PointerEvent) => {
      if (!stick.release(e.pointerId)) return;
      base.classList.remove('active');
      knob.classList.remove('active');
    };
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);
    zone.addEventListener('lostpointercapture', release);
  }

  private bindHold(btn: HTMLButtonElement): void {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.callbacks.onActivity();
      if (!this.model.boost.down(e.pointerId)) return;
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      btn.classList.add('pressed');
    });
    const release = (e: PointerEvent) => {
      if (this.model.boost.release(e.pointerId)) btn.classList.remove('pressed');
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
  }

  /** Tap fires `action` on press; a long press (>450 ms) fires `longAction` instead when given. */
  private bindTap(btn: HTMLButtonElement, action: FlightAction, longAction?: FlightAction): void {
    let timer = 0;
    let longFired = false;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.callbacks.onActivity();
      btn.classList.add('pressed');
      longFired = false;
      if (longAction) {
        timer = window.setTimeout(() => {
          longFired = true;
          this.callbacks.onAction(longAction);
        }, 450);
      } else {
        this.callbacks.onAction(action);
      }
    });
    const end = (e: PointerEvent) => {
      btn.classList.remove('pressed');
      if (longAction) {
        window.clearTimeout(timer);
        if (!longFired && e.type === 'pointerup') this.callbacks.onAction(action);
      }
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('pointerleave', (e) => {
      if (longAction) window.clearTimeout(timer);
      btn.classList.remove('pressed');
      void e;
    });
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) this.callbacks.onAction(action);
    });
  }

  private bindThrottle(): void {
    const track = this.throttleTrack;
    const setFrom = (clientY: number) => {
      const r = track.getBoundingClientRect();
      const t = 1 - (clientY - r.top) / r.height; // 0 at bottom, 1 at top
      // Bottom 20% of the track is reverse.
      const v = t < 0.2 ? (t - 0.2) / 0.2 * 0.25 : (t - 0.2) / 0.8;
      this.throttle = Math.max(-0.25, Math.min(1, Math.abs(v) < 0.04 ? 0 : v));
      this.throttleChanged = true;
      this.renderThrottle();
    };
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.callbacks.onActivity();
      if (this.throttlePointer !== null) return;
      this.throttlePointer = e.pointerId;
      try {
        track.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setFrom(e.clientY);
    });
    track.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.throttlePointer) setFrom(e.clientY);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId === this.throttlePointer) this.throttlePointer = null;
    };
    track.addEventListener('pointerup', release);
    track.addEventListener('pointercancel', release);
    track.addEventListener('lostpointercapture', release);
    track.tabIndex = 0;
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.throttle = Math.max(-0.25, Math.min(1, this.throttle + (e.key === 'ArrowUp' ? 0.1 : -0.1)));
        this.throttleChanged = true;
        this.renderThrottle();
      }
    });
  }

  private renderThrottle(): void {
    const t = this.throttle;
    const pos = t >= 0 ? 0.2 + t * 0.8 : 0.2 + (t / 0.25) * 0.2;
    this.throttleFill.style.transform = `scaleY(${pos})`;
    this.throttleFill.classList.toggle('reverse', t < 0);
    this.throttleValue.textContent = `${Math.round(t * 100)}%`;
    this.throttleTrack.setAttribute('aria-valuenow', String(Math.round(t * 100)));
  }
}
