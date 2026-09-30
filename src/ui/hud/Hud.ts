import { FACTIONS } from '../../economy/factions.ts';
import type { FlightAction } from '../../flight/input/types.ts';
import type { TargetKind } from '../../world/targets.ts';
import { dataBadge } from '../components.ts';
import { formatCredits, formatRange, h, replaceChildren } from '../dom.ts';
import { glyph, type GlyphName } from '../glyphs.ts';
import { icon } from '../icons.ts';
import type { HudMarker, HudModel } from './hudModel.ts';
import '../styles/hud.css';

export interface HudCallbacks {
  onMap(): void;
  onPause(): void;
  onHelp(): void;
  onAvoidCombat(): void;
  onContextAction(): void;
  onSelectMarker(id: string): void;
  /** Flight commands from the command rail (desktop). */
  onCommand(action: FlightAction): void;
}

export interface HudStatus {
  credits: number;
  cargoUsed: number;
  cargoCapacity: number;
  objective: string | null;
  systemName: string;
  scaleNote: string;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Segmented bar fill (0..1), written only when it changes. */
function setFill(el: HTMLElement, fraction: number): void {
  const v = Math.max(0, Math.min(1, fraction)).toFixed(3);
  if (el.dataset.fill !== v) {
    el.dataset.fill = v;
    el.style.setProperty('--fill', v);
  }
}

function setFlag(el: HTMLElement, attr: string, on: boolean): void {
  const v = String(on);
  if (el.getAttribute(attr) !== v) el.setAttribute(attr, v);
}

const TARGET_GLYPH: Record<TargetKind, GlyphName> = {
  station: 'dock',
  ship: 'gun',
  drone: 'freeflight',
  planet: 'science',
  star: 'map',
  lane: 'cruise',
  beacon: 'info',
  loot: 'trader',
};

/**
 * Flight HUD. DOM elements are created once and updated in place each frame; marker elements
 * are pooled. Every state carries a shape and text alongside colour.
 *
 * Desktop follows the classic layout: command rail top centre (objective hanging below), menus
 * top right, wallet top left, target window bottom left, gauge cluster bottom centre, loadout
 * bottom right. Touch keeps the bottom of the screen for the thumbs: gauges top left, menus and
 * wallet top right, objective, target and toasts in the centre column.
 */
export class Hud {
  readonly root: HTMLElement;
  private readonly callbacks: HudCallbacks;
  private readonly markerLayer: HTMLElement;
  private readonly markerPool: HTMLElement[] = [];
  private readonly reticle: HTMLElement;
  private readonly lead: HTMLElement;
  private readonly shieldBar: HTMLElement;
  private readonly hullBar: HTMLElement;
  private readonly energyBar: HTMLElement;
  private readonly shieldText: HTMLElement;
  private readonly hullText: HTMLElement;
  private readonly speedText: HTMLElement;
  private readonly throttleText: HTMLElement;
  private readonly modeText: HTMLElement;
  private readonly creditsText: HTMLElement;
  private readonly cargoText: HTMLElement;
  private readonly objectiveText: HTMLElement;
  private readonly objectivePanel: HTMLElement;
  private readonly autopilotText: HTMLElement;
  private readonly warningText: HTMLElement;
  private readonly targetPanel: HTMLElement;
  /** Toast container used during touch flight (flows below the target panel). */
  readonly toastSlot: HTMLElement;
  private readonly contextHint: HTMLButtonElement;
  private readonly encounterBanner: HTMLElement;
  private readonly status: HTMLElement;
  private readonly wallet: HTMLElement;
  private readonly buttons: HTMLElement;
  private readonly commandRail: HTMLElement;
  private readonly commands: Record<'free' | 'goto' | 'dock' | 'cruise', HTMLButtonElement>;
  private readonly loadout: HTMLElement;
  private readonly weaponText: HTMLElement;
  private readonly missileText: HTMLElement;
  private readonly launcherText: HTMLElement;
  private readonly kitText: HTMLElement;
  private readonly left: HTMLElement;
  private readonly centerColumn: HTMLElement;
  private readonly right: HTMLElement;
  private readonly bottomLeft: HTMLElement;
  private readonly bottomCenter: HTMLElement;
  private readonly bottomRight: HTMLElement;
  private readonly systemText: HTMLElement;
  private readonly scaleText: HTMLElement;
  private readonly lockText: HTMLElement;
  private lastTargetKey = '';
  /** Mirrors the Text size setting (label decluttering estimates label sizes from it). */
  textScale = 1;
  private desktopCursor = true;
  private reticleMoved = false;

  constructor(parent: HTMLElement, callbacks: HudCallbacks) {
    this.callbacks = callbacks;
    this.markerLayer = h('div', { class: 'hud-markers' });
    this.reticle = h('div', { class: 'reticle', 'aria-hidden': 'true' }, h('span', { class: 'reticle-ring' }), h('span', { class: 'reticle-dot' }));
    this.lead = h('div', { class: 'lead-marker', 'aria-hidden': 'true' });
    this.lockText = h('div', { class: 'lock-text' });

    // Gauges: throttle | shield, hull, energy | speed.
    const seg = (color: string) => h('div', { class: 'segbar', style: `--seg-color: ${color}; --segments: 12` });
    this.shieldBar = seg('var(--shield)');
    this.hullBar = seg('var(--hull)');
    this.energyBar = seg('var(--energy)');
    this.shieldText = h('span', { class: 'num' });
    this.hullText = h('span', { class: 'num' });
    this.speedText = h('span', { class: 'num speed' });
    this.throttleText = h('span', { class: 'num' });
    this.modeText = h('span', { class: 'mode' });
    const gauge = (label: string, bar: HTMLElement, value?: HTMLElement) =>
      h('div', { class: 'gauge-row' }, h('span', { class: 'gauge-label' }, label), bar, value ?? h('span'));
    this.status = h(
      'div',
      { class: 'hud-panel frame hud-status', 'data-testid': 'hud-status' },
      h('div', { class: 'gauge-thr' }, h('span', { class: 'gauge-label' }, 'Thr'), this.throttleText),
      h('div', { class: 'gauge-bars' }, gauge('Shield', this.shieldBar, this.shieldText), gauge('Hull', this.hullBar, this.hullText), gauge('Energy', this.energyBar)),
      h('div', { class: 'gauge-spd' }, this.speedText, h('span', { class: 'unit' }, 'm/s'), this.modeText),
    );

    this.creditsText = h('span', { class: 'num', 'data-testid': 'hud-credits' });
    this.cargoText = h('span', { class: 'num', 'data-testid': 'hud-cargo' });
    this.systemText = h('div', { class: 'hud-system' });
    this.wallet = h(
      'div',
      { class: 'hud-panel frame frame-sm hud-wallet' },
      h('div', { class: 'row' }, icon('credits'), this.creditsText),
      h('div', { class: 'row' }, icon('cargo'), this.cargoText),
      this.systemText,
    );
    const menuBtn = (g: GlyphName, label: string, testId: string | undefined, onClick: () => void) =>
      h('button', { type: 'button', class: 'rail-btn rail-btn-sm hud-btn', 'aria-label': label, title: label, 'data-testid': testId, onClick }, glyph(g));
    this.buttons = h(
      'nav',
      { class: 'rail frame attach-top attach-right hud-buttons', 'aria-label': 'Menus' },
      menuBtn('map', 'Open star map (Tab)', 'hud-map', () => callbacks.onMap()),
      menuBtn('info', 'Controls help', undefined, () => callbacks.onHelp()),
      menuBtn('menu', 'Pause (Esc)', 'hud-pause', () => callbacks.onPause()),
    );

    const command = (g: GlyphName, label: string, key: string, action: FlightAction) =>
      h(
        'button',
        {
          type: 'button',
          class: 'rail-btn rail-btn-sm',
          'aria-label': key ? `${label} (${key})` : label,
          title: key ? `${label} (${key})` : label,
          'data-testid': `hud-cmd-${action}`,
          onClick: () => callbacks.onCommand(action),
        },
        glyph(g),
        h('span', null, label),
      );
    this.commands = {
      free: command('freeflight', 'Free flight', '', 'cancel-autopilot'),
      goto: command('goto', 'Go to', 'G', 'goto'),
      dock: command('dock', 'Dock', 'E', 'interact'),
      cruise: command('cruise', 'Cruise', 'Space', 'cruise'),
    };
    this.commandRail = h('nav', { class: 'rail frame attach-top hud-commands', 'aria-label': 'Flight commands' }, Object.values(this.commands));

    this.objectiveText = h('span', { class: 'objective-text', 'data-testid': 'hud-objective' });
    this.objectivePanel = h(
      'button',
      {
        type: 'button',
        class: 'hud-panel frame frame-sm hud-objective',
        'aria-expanded': 'true',
        onClick: () => this.objectivePanel.classList.toggle('collapsed'),
      },
      icon('objective'),
      this.objectiveText,
    );
    this.autopilotText = h('div', { class: 'hud-autopilot', 'aria-live': 'polite' });
    this.warningText = h('div', { class: 'hud-warning', role: 'alert' });

    this.targetPanel = h('div', { class: 'hud-panel frame hud-target', 'data-testid': 'hud-target', hidden: true });
    this.toastSlot = h('div', { class: 'toasts hud-toasts', 'aria-live': 'polite' });
    this.contextHint = h('button', { type: 'button', class: 'btn btn-primary hud-context', 'data-testid': 'hud-context', onClick: () => callbacks.onContextAction() });
    this.encounterBanner = h(
      'div',
      { class: 'frame frame-sm encounter-banner', role: 'alert', hidden: true, 'data-testid': 'encounter-banner' },
      h('strong', null, '◆ Raider inbound'),
      h('span', { class: 'muted' }, 'Fight, or skip it:'),
      h('button', { type: 'button', class: 'btn btn-sm', 'data-testid': 'avoid-combat', onClick: () => callbacks.onAvoidCombat() }, 'Avoid combat'),
    );
    this.scaleText = h('div', { class: 'hud-scale' });

    this.weaponText = h('span', { class: 'load-name' });
    this.missileText = h('span', { class: 'num' });
    this.launcherText = h('span', { class: 'load-name' }, 'Missiles');
    this.kitText = h('span', { class: 'num' });
    const loadRow = (g: GlyphName, name: HTMLElement | string, value: HTMLElement | null, key: string) =>
      h('div', { class: 'load-row' }, glyph(g), typeof name === 'string' ? h('span', { class: 'load-name' }, name) : name, value ?? h('span'), h('kbd', { class: 'kbd' }, key));
    this.loadout = h(
      'div',
      { class: 'hud-panel frame hud-loadout', 'aria-label': 'Loadout' },
      loadRow('gun', this.weaponText, null, 'RMB'),
      loadRow('missile', this.launcherText, this.missileText, 'F'),
      loadRow('repair', 'Repair kits', this.kitText, 'R'),
    );

    this.left = h('div', { class: 'hud-left' });
    this.centerColumn = h('div', { class: 'hud-center' });
    this.right = h('div', { class: 'hud-right' });
    this.bottomLeft = h('div', { class: 'hud-bottom-left' });
    this.bottomCenter = h('div', { class: 'hud-bottom' });
    this.bottomRight = h('div', { class: 'hud-bottom-right' });
    this.root = h(
      'div',
      { class: 'hud', 'data-testid': 'hud' },
      this.markerLayer,
      this.lead,
      this.reticle,
      this.lockText,
      h('div', { class: 'hud-top' }, this.left, this.centerColumn, this.right),
      this.bottomLeft,
      this.bottomCenter,
      this.bottomRight,
    );
    parent.appendChild(this.root);
    this.setDesktopCursor(true);
    this.setVisible(false);
  }

  setVisible(on: boolean): void {
    this.root.hidden = !on;
    // Until the mouse moves, the desktop reticle waits at the screen centre (not the corner).
    if (on && this.desktopCursor && !this.reticleMoved) {
      this.reticle.style.transform = `translate(${window.innerWidth / 2}px, ${window.innerHeight / 2}px)`;
    }
  }

  /** Desktop shows the reticle at the mouse and the full layout; touch keeps the thumbs' areas clear. */
  setDesktopCursor(on: boolean): void {
    this.desktopCursor = on;
    this.root.classList.toggle('touch-mode', !on);
    if (on) {
      this.left.replaceChildren(this.wallet, this.scaleText);
      this.centerColumn.replaceChildren(this.commandRail, this.objectivePanel, this.autopilotText, this.warningText, this.encounterBanner);
      this.right.replaceChildren(this.buttons);
      this.bottomLeft.replaceChildren(this.targetPanel);
      this.bottomCenter.replaceChildren(this.contextHint, this.status);
      this.bottomRight.replaceChildren(this.loadout);
    } else {
      // Touch: the target panel and toasts stack in the centre column under the objective and
      // any alert (never on top of them).
      this.left.replaceChildren(this.status);
      this.centerColumn.replaceChildren(this.objectivePanel, this.autopilotText, this.warningText, this.encounterBanner, this.targetPanel, this.toastSlot);
      this.right.replaceChildren(this.buttons, this.wallet);
      this.bottomLeft.replaceChildren();
      this.bottomCenter.replaceChildren(this.contextHint);
      this.bottomRight.replaceChildren();
    }
  }

  /** Immediate reticle move on mouse motion (avoids a frame of latency). */
  moveReticle(x: number, y: number): void {
    this.reticleMoved = true;
    this.reticle.style.transform = `translate(${x}px, ${y}px)`;
  }

  setEncounterBanner(visible: boolean): void {
    this.encounterBanner.hidden = !visible;
  }

  update(model: HudModel, status: HudStatus): void {
    setFill(this.shieldBar, model.shield);
    setFill(this.hullBar, model.hull);
    setFill(this.energyBar, model.energy);
    setText(this.shieldText, String(Math.round(model.shieldValue)));
    setText(this.hullText, String(Math.round(model.hullValue)));
    setText(this.speedText, String(Math.round(model.speed)));
    setText(this.throttleText, `${Math.round(model.throttle * 100)}%`);
    const mode = model.inLane
      ? 'Lane'
      : model.cruise === 'on'
        ? 'Cruise'
        : model.cruise === 'charging'
          ? `Cruise ${Math.round(model.cruiseCharge * 100)}%`
          : model.boosting
            ? 'Boost'
            : model.drift
              ? 'Drift'
              : '';
    setText(this.modeText, mode);
    this.root.dataset.cruise = model.cruise;
    setText(this.creditsText, formatCredits(status.credits));
    setText(this.cargoText, `${status.cargoUsed}/${status.cargoCapacity} cargo`);
    setText(
      this.systemText,
      model.nearestDock ? `${status.systemName} · dock ${model.nearestDock.name} ${formatRange(model.nearestDock.distance)}` : status.systemName,
    );
    setText(this.scaleText, status.scaleNote);
    this.objectivePanel.hidden = !status.objective;
    if (status.objective) setText(this.objectiveText, status.objective);
    this.objectivePanel.setAttribute('aria-expanded', String(!this.objectivePanel.classList.contains('collapsed')));
    setText(this.autopilotText, model.autopilot ?? '');
    setText(this.warningText, model.warnings.join(' · '));

    // Command rail: lit command = what is flying the ship; Dock is live only when it is offered.
    const ap = model.autopilotMode;
    setFlag(this.commands.free, 'aria-pressed', ap === 'none');
    setFlag(this.commands.goto, 'aria-pressed', ap === 'goto');
    setFlag(this.commands.dock, 'aria-pressed', ap === 'dock');
    setFlag(this.commands.cruise, 'aria-pressed', model.cruise !== 'off' || model.inLane);
    const canDock = model.context?.action === 'interact' && model.context.icon === 'dock';
    if (this.commands.dock.disabled === (canDock || ap === 'dock')) this.commands.dock.disabled = !(canDock || ap === 'dock');
    setText(this.weaponText, model.weapon);
    setText(this.missileText, String(model.missiles));
    setText(this.launcherText, model.launcher ?? 'No launcher');
    setText(this.kitText, String(model.repairKits));

    this.updateTarget(model);
    this.updateMarkers(model.markers);

    const ctx = model.context;
    this.contextHint.hidden = !ctx;
    if (ctx) {
      const label = this.desktopCursor ? `${ctx.label}  [${ctx.action === 'goto' ? 'G' : ctx.action === 'scan' ? 'X' : 'E'}]` : ctx.label;
      setText(this.contextHint, label);
    }

    if (!this.desktopCursor) this.moveReticle(model.reticle.x, model.reticle.y);
    this.reticle.classList.toggle('out-of-arc', !model.reticle.inArc);
    this.reticle.classList.toggle('assisted', model.reticle.assisted);
    const t = model.target;
    if (t?.lead) {
      this.lead.hidden = false;
      this.lead.style.transform = `translate(${t.lead.x}px, ${t.lead.y}px)`;
    } else {
      this.lead.hidden = true;
    }
    this.lockText.hidden = model.missileLock === 'none';
    this.lockText.className = `lock-text ${model.missileLock}`;
    setText(this.lockText, model.missileLock === 'locked' ? `LOCK · ${(model.launcher ?? 'missiles').toUpperCase()} ${model.missiles}` : 'Locking…');
    this.lockText.style.transform = this.reticle.style.transform;
  }

  private updateTarget(model: HudModel): void {
    const t = model.target;
    this.targetPanel.hidden = !t;
    if (!t) {
      this.lastTargetKey = '';
      return;
    }
    const key = `${t.id}|${t.dataClass}|${t.hostile}`;
    if (key !== this.lastTargetKey) {
      this.lastTargetKey = key;
      const faction = t.faction ? FACTIONS[t.faction] : null;
      this.targetPanel.classList.toggle('hostile', t.hostile);
      replaceChildren(
        this.targetPanel,
        h(
          'div',
          { class: 'target-head' },
          glyph(t.hostile ? 'gun' : TARGET_GLYPH[t.kind]),
          h('strong', { class: 'target-name' }, t.name),
          t.hostile
            ? h('span', { class: 'badge badge-hostile' }, '◆ Hostile')
            : faction
              ? h('span', { class: 'badge badge-friendly' }, `■ ${faction.shortName}`)
              : dataBadge(t.dataClass === 'fictional' ? 'fictional' : 'observed', t.dataClass === 'observed' ? 'Real' : undefined),
        ),
        h('div', { class: 'target-sub muted' }, t.subtitle),
        h('div', { class: 'target-dist num' }),
        h('div', { class: 'target-bars' }),
      );
    }
    const dist = this.targetPanel.querySelector<HTMLElement>('.target-dist')!;
    setText(dist, `${formatRange(t.distance)}${t.hostile ? (t.inGunRange ? ' · in gun range' : ' · out of range') : ''}`);
    const bars = this.targetPanel.querySelector<HTMLElement>('.target-bars')!;
    if (t.shield !== undefined && t.hull !== undefined) {
      if (!bars.firstChild) {
        bars.append(
          h('div', { class: 'segbar', style: '--seg-color: var(--shield); --segments: 10' }),
          h('div', { class: 'segbar', style: '--seg-color: var(--hull); --segments: 10' }),
        );
      }
      setFill(bars.children[0] as HTMLElement, t.shield);
      setFill(bars.children[1] as HTMLElement, t.hull);
    } else if (bars.firstChild) {
      bars.replaceChildren();
    }
  }

  private readonly placedLabels: { x: number; y: number; w: number; h: number }[] = [];

  /** Higher first: selected, objective, hostile, then stations/lanes, then the rest; nearer first. */
  private static priority(m: HudMarker): number {
    if (m.selected) return 0;
    if (m.objective) return 1;
    if (m.hostile) return 2;
    if (m.kind === 'station' || m.kind === 'loot' || m.kind === 'drone') return 3;
    if (m.kind === 'lane') return 4;
    return 5;
  }

  private updateMarkers(markers: HudMarker[]): void {
    markers.sort((a, b) => Hud.priority(a) - Hud.priority(b) || a.distance - b.distance);
    const scale = this.textScale;
    this.placedLabels.length = 0;
    while (this.markerPool.length < markers.length) {
      const el = h(
        'button',
        { type: 'button', class: 'marker', tabindex: '-1' },
        h('span', { class: 'marker-shape' }),
        h('span', { class: 'marker-label' }, h('span', { class: 'marker-name' }), h('span', { class: 'marker-dist num' })),
      );
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const id = el.dataset.id;
        if (id) this.callbacks.onSelectMarker(id);
      });
      this.markerLayer.appendChild(el);
      this.markerPool.push(el);
    }
    for (let i = 0; i < this.markerPool.length; i++) {
      const el = this.markerPool[i]!;
      const m = markers[i];
      if (!m) {
        if (!el.hidden) {
          el.hidden = true;
          delete el.dataset.id;
        }
        continue;
      }
      el.hidden = false;
      el.dataset.id = m.id;
      const cls = `marker kind-${m.kind}${m.hostile ? ' hostile' : ''}${m.selected ? ' selected' : ''}${m.objective ? ' objective' : ''}${m.onScreen ? '' : ' offscreen'}${m.faction ? ` faction-${m.faction}` : ''}`;
      if (el.className !== cls) el.className = cls;
      el.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
      const shape = el.firstChild as HTMLElement;
      if (!m.onScreen) shape.style.transform = `rotate(${m.edgeAngle.toFixed(3)}rad)`;
      else if (shape.style.transform) shape.style.transform = '';
      const name = el.querySelector<HTMLElement>('.marker-name')!;
      const prefix = m.hostile ? '◆ ' : m.objective ? '⚑ ' : '';
      setText(name, `${prefix}${m.name}`);
      // Declutter: hide a label that would overlap a more important one (the shape stays).
      const w = (Math.max(m.name.length + prefix.length, 8) * 6.4 + 8) * scale;
      const hgt = 26 * scale;
      const box = m.onScreen ? { x: m.x + 18, y: m.y - 10, w, h: hgt } : { x: m.x - 40, y: m.y + 14, w: 80 * scale, h: hgt };
      const clash = this.placedLabels.some((b) => box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h);
      el.classList.toggle('label-hidden', clash && !m.selected);
      if (!clash || m.selected) this.placedLabels.push(box);
      setText(el.querySelector<HTMLElement>('.marker-dist')!, formatRange(m.distance));
      el.setAttribute('aria-label', `${m.hostile ? 'Hostile ' : ''}${m.name}, ${formatRange(m.distance)}`);
    }
  }
}
