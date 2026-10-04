import { wingOrderLabel } from './hudModel.ts';
import { FACTIONS } from '../../economy/factions.ts';
import { PAD_FOR, PAD_HOLDS, padLabel, type PadButton, type PadStyle } from '../../flight/input/GamepadInput.ts';
import type { FlightAction, InputScheme } from '../../flight/input/types.ts';
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
  /** "Wanted · fines 1,200 cr" while the player owes fines (docs/PROCGEN.md §12). */
  wanted?: string | null;
}

/** A race clock: "1:23.4". */
function raceClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const rest = seconds - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${s}`;
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

/** The loadout panel's key hints, and the pad buttons that do the same. */
const LOADOUT_KEYS = { gun: 'RMB', missile: 'F', repair: 'R', decoy: 'C' } as const;
const LOADOUT_PAD: Record<keyof typeof LOADOUT_KEYS, PadButton> = {
  gun: PAD_HOLDS.fire,
  missile: PAD_FOR.missile,
  repair: PAD_FOR.repair,
  decoy: PAD_FOR.decoy,
};

const TARGET_GLYPH: Record<TargetKind, GlyphName> = {
  station: 'dock',
  ship: 'gun',
  drone: 'freeflight',
  planet: 'science',
  star: 'map',
  lane: 'cruise',
  beacon: 'info',
  loot: 'trader',
  belt: 'science',
  rock: 'mining-laser',
  sky: 'scanner',
  hole: 'scanner',
  wreck: 'salvage',
  gate: 'thruster',
};

/** The Mine key (docs/PROCGEN.md §19); on a pad Mine is the context action. */
const MINE_KEY = 'B';

/**
 * Flight HUD. DOM elements are created once and updated in place each frame; marker elements
 * are pooled. Every state carries a shape and text alongside colour.
 *
 * Desktop (and gamepad) follows the classic layout: command rail top centre (objective hanging
 * below), menus top right, wallet top left, target window bottom left, gauge cluster bottom centre,
 * loadout bottom right. Touch keeps the bottom of the screen for the thumbs: gauges top left, menus
 * and wallet top right, objective, target and toasts in the centre column.
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
  private readonly wantedRow: HTMLElement;
  private readonly wantedText: HTMLElement;
  private readonly objectiveText: HTMLElement;
  private readonly objectivePanel: HTMLElement;
  /** A race under way (docs/PROCGEN.md §33.4): in the objective panel's place. */
  private readonly racePanel: HTMLElement;
  private readonly raceName: HTMLElement;
  private readonly raceGate: HTMLElement;
  private readonly raceTime: HTMLElement;
  private readonly raceSplit: HTMLElement;
  private readonly racePlace: HTMLElement;
  private readonly raceCount: HTMLElement;
  private readonly autopilotText: HTMLElement;
  private readonly warningText: HTMLElement;
  private readonly targetPanel: HTMLElement;
  /** Toast container used during touch flight (flows below the target panel). */
  readonly toastSlot: HTMLElement;
  private readonly contextHint: HTMLButtonElement;
  private readonly encounterBanner: HTMLElement;
  /** A hail on the lanes (docs/PROCGEN.md §27): who calls, what they say, Answer, and its time left. */
  private readonly hailBanner: HTMLElement;
  private readonly hailFrom: HTMLElement;
  private readonly hailText: HTMLElement;
  private readonly hailAnswer: HTMLButtonElement;
  private readonly hailKey: HTMLElement;
  private readonly hailLeft: HTMLElement;
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
  private readonly decoyText: HTMLElement;
  private readonly wingText: HTMLElement;
  private readonly wingRow: HTMLElement;
  private readonly wingKey: HTMLElement;
  private readonly miningName: HTMLElement;
  private readonly miningState: HTMLElement;
  private readonly miningRow: HTMLElement;
  private readonly miningKey: HTMLElement;
  private readonly miningText: HTMLElement;
  private readonly loadoutKeys: Record<keyof typeof LOADOUT_KEYS, HTMLElement>;
  private readonly flashEl: HTMLElement;
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
  private scheme: InputScheme = 'desktop';
  private padStyle: PadStyle = 'xbox';
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
    this.wantedText = h('span', { 'data-testid': 'hud-wanted' });
    this.wantedRow = h('div', { class: 'row hud-wanted', hidden: true }, icon('alert'), this.wantedText);
    this.systemText = h('div', { class: 'hud-system' });
    this.wallet = h(
      'div',
      { class: 'hud-panel frame frame-sm hud-wallet' },
      h('div', { class: 'row' }, icon('credits'), this.creditsText),
      h('div', { class: 'row' }, icon('cargo'), this.cargoText),
      this.wantedRow,
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
    this.raceName = h('span', { class: 'race-name' });
    this.raceGate = h('span', { class: 'race-gate', 'data-testid': 'hud-race-gate' });
    this.raceTime = h('span', { class: 'race-time', 'data-testid': 'hud-race-time' });
    this.raceSplit = h('span', { class: 'race-split', 'data-testid': 'hud-race-split' });
    this.racePlace = h('span', { class: 'race-place', 'data-testid': 'hud-race-place' });
    this.raceCount = h('span', { class: 'race-count', 'data-testid': 'hud-race-count', 'aria-live': 'assertive' });
    this.racePanel = h(
      'div',
      { class: 'hud-panel frame frame-sm hud-race', 'data-testid': 'hud-race', hidden: true },
      icon('objective'),
      h('span', { class: 'race-line' }, this.raceName, this.raceGate, this.raceTime, this.raceSplit, this.racePlace),
      this.raceCount,
    );
    this.autopilotText = h('div', { class: 'hud-autopilot', 'aria-live': 'polite' });
    this.miningText = h('div', { class: 'hud-mining', 'data-testid': 'hud-mining', hidden: true });
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
    this.hailFrom = h('strong', { class: 'hail-from' });
    this.hailText = h('span', { class: 'hail-text' });
    this.hailKey = h('kbd', { class: 'kbd' }, 'Q');
    this.hailAnswer = h('button', { type: 'button', class: 'btn btn-sm btn-primary hail-answer', 'data-testid': 'hail-answer', onClick: () => callbacks.onCommand('answer') }, 'Answer', this.hailKey) as HTMLButtonElement;
    this.hailLeft = h('span', { class: 'hail-left num' });
    this.hailBanner = h('div', { class: 'frame frame-sm hail-banner', role: 'status', hidden: true, 'data-testid': 'hail-banner' }, this.hailFrom, this.hailText, h('span', { class: 'hail-actions' }, this.hailAnswer, this.hailLeft));
    this.scaleText = h('div', { class: 'hud-scale' });

    this.weaponText = h('span', { class: 'load-name' });
    this.missileText = h('span', { class: 'num' });
    this.launcherText = h('span', { class: 'load-name' }, 'Missiles');
    this.kitText = h('span', { class: 'num' });
    this.decoyText = h('span', { class: 'num' });
    this.wingText = h('span', { class: 'load-name' });
    const kbd = (key: keyof typeof LOADOUT_KEYS) => h('kbd', { class: 'kbd' }, LOADOUT_KEYS[key]);
    this.loadoutKeys = { gun: kbd('gun'), missile: kbd('missile'), repair: kbd('repair'), decoy: kbd('decoy') };
    // Wing orders: a key (V), the Wing chip on touch, or Back held on a pad (docs/PROCGEN.md §34).
    this.wingKey = h('kbd', { class: 'kbd' }, 'V');
    this.miningName = h('span', { class: 'load-name' });
    this.miningState = h('span', { class: 'num' });
    this.miningKey = h('kbd', { class: 'kbd' }, MINE_KEY);
    const loadRow = (g: GlyphName, name: HTMLElement | string, value: HTMLElement | null, key: HTMLElement) =>
      h('div', { class: 'load-row' }, glyph(g), typeof name === 'string' ? h('span', { class: 'load-name' }, name) : name, value ?? h('span'), key);
    this.loadout = h(
      'div',
      { class: 'hud-panel frame hud-loadout', 'aria-label': 'Loadout' },
      loadRow('gun', this.weaponText, null, this.loadoutKeys.gun),
      loadRow('missile', this.launcherText, this.missileText, this.loadoutKeys.missile),
      loadRow('repair', 'Repair kits', this.kitText, this.loadoutKeys.repair),
      loadRow('scanner', 'Decoys', this.decoyText, this.loadoutKeys.decoy),
      (this.wingRow = loadRow('wing', this.wingText, null, this.wingKey)),
      (this.miningRow = loadRow('mining-laser', this.miningName, this.miningState, this.miningKey)),
    );
    this.miningRow.hidden = true;
    // Hit flashes around the screen's edges.
    this.flashEl = h('div', { class: 'hud-flash', 'aria-hidden': 'true' });

    this.left = h('div', { class: 'hud-left' });
    this.centerColumn = h('div', { class: 'hud-center' });
    this.right = h('div', { class: 'hud-right' });
    this.bottomLeft = h('div', { class: 'hud-bottom-left' });
    this.bottomCenter = h('div', { class: 'hud-bottom' });
    this.bottomRight = h('div', { class: 'hud-bottom-right' });
    this.root = h(
      'div',
      { class: 'hud', 'data-testid': 'hud' },
      this.flashEl,
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
    this.setScheme('desktop');
    this.setVisible(false);
  }

  setVisible(on: boolean): void {
    this.root.hidden = !on;
    // Until the mouse moves, the desktop reticle waits at the screen centre (not the corner).
    if (on && this.scheme === 'desktop' && !this.reticleMoved) {
      this.reticle.style.transform = `translate(${window.innerWidth / 2}px, ${window.innerHeight / 2}px)`;
    }
  }

  /**
   * Follows the device in use. Desktop and gamepad get the full layout; touch keeps the thumbs'
   * areas clear. The reticle sits at the mouse on desktop and follows the aim (stick or pad)
   * otherwise, and the hints name the keys or the pad's buttons (`style`: whose names).
   */
  setScheme(scheme: InputScheme, style: PadStyle = 'xbox'): void {
    this.scheme = scheme;
    this.padStyle = style;
    const pad = scheme === 'gamepad';
    for (const [key, el] of Object.entries(this.loadoutKeys) as [keyof typeof LOADOUT_KEYS, HTMLElement][]) {
      setText(el, pad ? padLabel(LOADOUT_PAD[key], style) : LOADOUT_KEYS[key]);
    }
    this.wingKey.hidden = pad;
    // On a pad, Mine is the context action (every button already has a job).
    setText(this.miningKey, pad ? padLabel(PAD_FOR.interact, style) : MINE_KEY);
    const full = scheme !== 'touch';
    this.root.classList.toggle('touch-mode', !full);
    if (full) {
      this.left.replaceChildren(this.wallet, this.scaleText);
      this.centerColumn.replaceChildren(this.commandRail, this.objectivePanel, this.racePanel, this.autopilotText, this.miningText, this.warningText, this.encounterBanner, this.hailBanner);
      this.right.replaceChildren(this.buttons);
      this.bottomLeft.replaceChildren(this.targetPanel);
      this.bottomCenter.replaceChildren(this.contextHint, this.status);
      this.bottomRight.replaceChildren(this.loadout);
    } else {
      // Touch: the target panel and toasts stack in the centre column under the objective and
      // any alert (never on top of them).
      this.left.replaceChildren(this.status);
      this.centerColumn.replaceChildren(this.objectivePanel, this.racePanel, this.autopilotText, this.miningText, this.warningText, this.encounterBanner, this.hailBanner, this.targetPanel, this.toastSlot);
      this.right.replaceChildren(this.buttons, this.wallet);
      this.bottomLeft.replaceChildren();
      this.bottomCenter.replaceChildren(this.contextHint);
      this.bottomRight.replaceChildren();
    }
  }

  /** The key or pad button named in the context action's hint; none on touch, which has its own button. */
  private contextKey(action: FlightAction): string | null {
    if (this.scheme === 'gamepad') return padLabel(PAD_FOR.interact, this.padStyle);
    if (this.scheme === 'desktop') return action === 'goto' ? 'G' : action === 'scan' ? 'X' : action === 'mine' ? MINE_KEY : action === 'answer' ? 'Q' : 'E';
    return null;
  }

  /** Immediate reticle move on mouse motion (avoids a frame of latency). */
  moveReticle(x: number, y: number): void {
    this.reticleMoved = true;
    this.reticle.style.transform = `translate(${x}px, ${y}px)`;
  }

  /** The hail banner: shown while a hail waits, its answer closed while hostiles are near. */
  private updateHail(model: HudModel): void {
    const hail = model.hail;
    this.hailBanner.hidden = !hail;
    if (!hail) return;
    this.hailBanner.dataset.tone = hail.tone;
    setText(this.hailFrom, hail.from);
    setText(this.hailText, hail.text);
    this.hailAnswer.disabled = hail.held;
    this.hailKey.hidden = this.scheme !== 'desktop';
    // On touch the HUD lies under the thumb zones: the action button answers (it reads Answer).
    const touch = this.scheme === 'touch';
    this.hailAnswer.hidden = touch;
    setText(this.hailLeft, hail.held ? 'Not now: hostile contact' : touch ? `${Math.ceil(hail.left)} s · tap Answer` : `${Math.ceil(hail.left)} s`);
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
    this.wantedRow.hidden = !status.wanted;
    if (status.wanted) setText(this.wantedText, status.wanted);
    setText(
      this.systemText,
      model.nearestDock ? `${status.systemName} · dock ${model.nearestDock.name} ${formatRange(model.nearestDock.distance)}` : status.systemName,
    );
    setText(this.scaleText, status.scaleNote);
    this.updateHail(model);
    this.objectivePanel.hidden = !status.objective || !!model.race;
    if (status.objective) setText(this.objectiveText, status.objective);
    this.updateRace(model);
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
    setText(this.decoyText, String(model.decoys));
    this.wingRow.hidden = !model.wing;
    if (model.wing) setText(this.wingText, `Wing ${model.wing.count} · ${wingOrderLabel(model.wing.order)}${model.wing.hurt ? ` · ${model.wing.hurt} hurt` : ''}`);
    const m = model.mining;
    this.miningRow.hidden = !m;
    if (m) {
      setText(this.miningName, `Mining laser ${m.rate}/min${m.prospect > 1 ? ` ×${m.prospect}` : ''}`);
      setText(this.miningState, m.active ? 'cutting' : m.ready ? 'ready' : '');
    }
    this.miningText.hidden = !m?.status;
    setText(this.miningText, m?.status ?? '');
    const hull = Math.round(model.flash.hull * 100) / 100;
    const shield = Math.round(model.flash.shield * 100) / 100;
    if (this.flashEl.dataset.v !== `${hull},${shield}`) {
      this.flashEl.dataset.v = `${hull},${shield}`;
      this.flashEl.style.setProperty('--hull', String(hull));
      this.flashEl.style.setProperty('--shield', String(shield));
    }
    this.flashEl.classList.toggle('seeker', model.incoming > 0);

    this.updateTarget(model);
    this.updateMarkers(model.markers);

    const ctx = model.context;
    this.contextHint.hidden = !ctx;
    if (ctx) {
      const key = this.contextKey(ctx.action);
      setText(this.contextHint, key ? `${ctx.label}  [${key}]` : ctx.label);
    }

    if (this.scheme !== 'desktop') this.moveReticle(model.reticle.x, model.reticle.y);
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

  /** The race strip: the course, gates passed, the clock, the split against the pilot's best or par, the place on the road. */
  private updateRace(model: HudModel): void {
    const r = model.race;
    this.racePanel.hidden = !r;
    if (!r) return;
    const running = r.phase === 'on';
    setText(this.raceName, r.name);
    setText(this.raceGate, running ? `Gate ${r.gate}/${r.gates}` : r.phase === 'countdown' ? 'Starting' : r.phase === 'ready' ? 'Press Start' : 'To the start');
    setText(this.raceTime, running ? raceClock(r.time) : '');
    setText(this.raceSplit, running && r.split !== null ? `${r.split < 0 ? '−' : '+'}${Math.abs(r.split).toFixed(2)} ${r.split < 0 ? 'ahead' : 'behind'}` : '');
    this.raceSplit.dataset.ahead = String((r.split ?? 0) < 0);
    setText(this.racePlace, running ? `${ordinal(r.place)} of ${r.of}` : '');
    setText(this.raceCount, r.count ?? '');
    this.raceCount.hidden = !r.count;
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
            : t.own
              ? h('span', { class: 'badge badge-own' }, '■ Yours')
              : faction
              ? h('span', { class: 'badge badge-friendly' }, `■ ${faction.shortName}`)
              : dataBadge(t.dataClass === 'fictional' ? 'fictional' : 'observed', t.dataClass === 'observed' ? 'Real' : undefined),
        ),
        h('div', { class: 'target-sub muted' }, t.subtitle),
        h('div', { class: 'target-dist num' }),
        h('div', { class: 'target-bars' }),
      );
    }
    // Subtitles change under way (a rock scanned and cut, a den's reactor exposed).
    setText(this.targetPanel.querySelector<HTMLElement>('.target-sub')!, t.subtitle);
    const dist = this.targetPanel.querySelector<HTMLElement>('.target-dist')!;
    setText(dist, `${t.distanceLabel ?? formatRange(t.distance)}${t.hostile ? (t.inGunRange ? ' · in gun range' : ' · out of range') : ''}`);
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
    } else if (t.amount !== undefined) {
      // A scanned rock: what is left of it to cut.
      if (!bars.firstChild) bars.append(h('div', { class: 'segbar', style: '--seg-color: var(--warm); --segments: 10', 'aria-label': 'Rock left' }));
      setFill(bars.children[0] as HTMLElement, t.amount);
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
    if (m.kind === 'station' || m.kind === 'loot' || m.kind === 'wreck' || m.kind === 'drone') return 3;
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
      const cls = `marker kind-${m.kind}${m.hostile ? ' hostile' : ''}${m.own ? ' own' : ''}${m.selected ? ' selected' : ''}${m.objective ? ' objective' : ''}${m.onScreen ? '' : ' offscreen'}${m.faction ? ` faction-${m.faction}` : ''}`;
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
      setText(el.querySelector<HTMLElement>('.marker-dist')!, m.distanceLabel ?? formatRange(m.distance));
      el.setAttribute('aria-label', `${m.hostile ? 'Hostile ' : ''}${m.name}, ${m.distanceLabel ?? formatRange(m.distance)}`);
    }
  }
}
