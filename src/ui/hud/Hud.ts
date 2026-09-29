import { FACTIONS } from '../../economy/factions.ts';
import { dataBadge } from '../components.ts';
import { formatCredits, formatRange, h, replaceChildren } from '../dom.ts';
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

function setWidth(el: HTMLElement, fraction: number): void {
  const v = `scaleX(${Math.max(0, Math.min(1, fraction)).toFixed(3)})`;
  if (el.style.transform !== v) el.style.transform = v;
}

/**
 * Flight HUD. DOM elements are created once and updated in place each frame; marker elements
 * are pooled. Every state carries a shape and text alongside colour.
 */
export class Hud {
  readonly root: HTMLElement;
  private readonly callbacks: HudCallbacks;
  private readonly markerLayer: HTMLElement;
  private readonly markerPool: HTMLElement[] = [];
  private readonly reticle: HTMLElement;
  private readonly lead: HTMLElement;
  private readonly shieldFill: HTMLElement;
  private readonly hullFill: HTMLElement;
  private readonly energyFill: HTMLElement;
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
  private readonly contextHint: HTMLButtonElement;
  private readonly encounterBanner: HTMLElement;
  private readonly systemText: HTMLElement;
  private readonly scaleText: HTMLElement;
  private readonly lockText: HTMLElement;
  private lastTargetKey = '';
  private desktopCursor = true;

  constructor(parent: HTMLElement, callbacks: HudCallbacks) {
    this.callbacks = callbacks;
    this.markerLayer = h('div', { class: 'hud-markers' });
    this.reticle = h('div', { class: 'reticle', 'aria-hidden': 'true' }, h('span', { class: 'reticle-ring' }), h('span', { class: 'reticle-dot' }));
    this.lead = h('div', { class: 'lead-marker', 'aria-hidden': 'true' });
    this.lockText = h('div', { class: 'lock-text' });

    this.shieldFill = h('span');
    this.hullFill = h('span');
    this.energyFill = h('span');
    this.shieldText = h('span', { class: 'num' });
    this.hullText = h('span', { class: 'num' });
    this.speedText = h('span', { class: 'num speed' });
    this.throttleText = h('span', { class: 'num' });
    this.modeText = h('span', { class: 'mode' });
    const bar = (label: string, fill: HTMLElement, kind: string, value?: HTMLElement) =>
      h('div', { class: 'hud-bar' }, h('span', { class: 'hud-bar-label' }, label), h('div', { class: `meter ${kind}` }, fill), value ?? null);

    const status = h(
      'div',
      { class: 'hud-panel hud-status', 'data-testid': 'hud-status' },
      bar('Shield', this.shieldFill, 'shield', this.shieldText),
      bar('Hull', this.hullFill, 'hull', this.hullText),
      bar('Energy', this.energyFill, 'energy'),
      h('div', { class: 'hud-speed' }, this.speedText, h('span', { class: 'unit' }, 'm/s'), h('span', { class: 'dim' }, ' · thr '), this.throttleText, this.modeText),
    );

    this.creditsText = h('span', { class: 'num', 'data-testid': 'hud-credits' });
    this.cargoText = h('span', { class: 'num', 'data-testid': 'hud-cargo' });
    this.systemText = h('div', { class: 'hud-system' });
    const topRight = h(
      'div',
      { class: 'hud-panel hud-wallet' },
      h('div', { class: 'row' }, icon('credits'), this.creditsText),
      h('div', { class: 'row' }, icon('cargo'), this.cargoText),
      this.systemText,
    );
    const buttons = h(
      'div',
      { class: 'hud-buttons' },
      h('button', { type: 'button', class: 'hud-btn', 'aria-label': 'Open star map (Tab)', 'data-testid': 'hud-map', onClick: () => callbacks.onMap() }, icon('map'), h('span', null, 'Map')),
      h('button', { type: 'button', class: 'hud-btn', 'aria-label': 'Controls help', onClick: () => callbacks.onHelp() }, icon('help')),
      h('button', { type: 'button', class: 'hud-btn', 'aria-label': 'Pause (Esc)', 'data-testid': 'hud-pause', onClick: () => callbacks.onPause() }, icon('pause')),
    );

    this.objectiveText = h('span', { class: 'objective-text', 'data-testid': 'hud-objective' });
    this.objectivePanel = h(
      'button',
      {
        type: 'button',
        class: 'hud-panel hud-objective',
        'aria-expanded': 'true',
        onClick: () => this.objectivePanel.classList.toggle('collapsed'),
      },
      icon('objective'),
      this.objectiveText,
    );
    this.autopilotText = h('div', { class: 'hud-autopilot', 'aria-live': 'polite' });
    this.warningText = h('div', { class: 'hud-warning', role: 'alert' });

    this.targetPanel = h('div', { class: 'hud-panel hud-target', 'data-testid': 'hud-target', hidden: true });
    this.contextHint = h('button', { type: 'button', class: 'hud-context', 'data-testid': 'hud-context', onClick: () => callbacks.onContextAction() });
    this.encounterBanner = h(
      'div',
      { class: 'encounter-banner', role: 'alert', hidden: true, 'data-testid': 'encounter-banner' },
      h('strong', null, 'Raider inbound'),
      h('span', { class: 'muted' }, 'Fight, or skip it:'),
      h('button', { type: 'button', class: 'btn btn-sm', 'data-testid': 'avoid-combat', onClick: () => callbacks.onAvoidCombat() }, 'Avoid combat'),
    );
    this.scaleText = h('div', { class: 'hud-scale' });

    this.root = h(
      'div',
      { class: 'hud', 'data-testid': 'hud' },
      this.markerLayer,
      this.lead,
      this.reticle,
      this.lockText,
      h('div', { class: 'hud-top' }, status, h('div', { class: 'hud-center' }, this.objectivePanel, this.autopilotText, this.warningText, this.encounterBanner), h('div', { class: 'hud-right' }, buttons, topRight)),
      h('div', { class: 'hud-bottom' }, this.targetPanel, this.contextHint),
      this.scaleText,
    );
    parent.appendChild(this.root);
    this.setVisible(false);
  }

  setVisible(on: boolean): void {
    this.root.hidden = !on;
  }

  /** Desktop shows the reticle at the mouse; touch keeps it near the centre. */
  setDesktopCursor(on: boolean): void {
    this.desktopCursor = on;
    this.root.classList.toggle('touch-mode', !on);
  }

  /** Immediate reticle move on mouse motion (avoids a frame of latency). */
  moveReticle(x: number, y: number): void {
    this.reticle.style.transform = `translate(${x}px, ${y}px)`;
  }

  setEncounterBanner(visible: boolean): void {
    this.encounterBanner.hidden = !visible;
  }

  update(model: HudModel, status: HudStatus): void {
    setWidth(this.shieldFill, model.shield);
    setWidth(this.hullFill, model.hull);
    setWidth(this.energyFill, model.energy);
    setText(this.shieldText, String(Math.round(model.shieldValue)));
    setText(this.hullText, String(Math.round(model.hullValue)));
    setText(this.speedText, String(Math.round(model.speed)));
    setText(this.throttleText, `${Math.round(model.throttle * 100)}%`);
    const mode = model.inLane
      ? ' · LANE'
      : model.cruise === 'on'
        ? ' · CRUISE'
        : model.cruise === 'charging'
          ? ` · CRUISE ${Math.round(model.cruiseCharge * 100)}%`
          : model.boosting
            ? ' · BOOST'
            : model.drift
              ? ' · DRIFT'
              : '';
    setText(this.modeText, mode);
    this.root.dataset.cruise = model.cruise;
    setText(this.creditsText, formatCredits(status.credits));
    setText(this.cargoText, `${status.cargoUsed}/${status.cargoCapacity} cargo`);
    setText(this.systemText, status.systemName);
    setText(this.scaleText, status.scaleNote);
    this.objectivePanel.hidden = !status.objective;
    if (status.objective) setText(this.objectiveText, status.objective);
    this.objectivePanel.setAttribute('aria-expanded', String(!this.objectivePanel.classList.contains('collapsed')));
    setText(this.autopilotText, model.autopilot ?? '');
    setText(this.warningText, model.warnings.join(' · '));

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
    setText(this.lockText, model.missileLock === 'locked' ? `MISSILE LOCK · ${model.missiles}` : 'Locking…');
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
      replaceChildren(
        this.targetPanel,
        h(
          'div',
          { class: 'spread' },
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
          h('div', { class: 'meter shield' }, h('span')),
          h('div', { class: 'meter hull' }, h('span')),
        );
      }
      setWidth(bars.children[0]!.firstChild as HTMLElement, t.shield);
      setWidth(bars.children[1]!.firstChild as HTMLElement, t.hull);
    } else if (bars.firstChild) {
      bars.replaceChildren();
    }
  }

  private updateMarkers(markers: HudMarker[]): void {
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
      setText(el.querySelector<HTMLElement>('.marker-dist')!, formatRange(m.distance));
      el.setAttribute('aria-label', `${m.hostile ? 'Hostile ' : ''}${m.name}, ${formatRange(m.distance)}`);
    }
  }
}
