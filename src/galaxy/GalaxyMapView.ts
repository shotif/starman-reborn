/**
 * Neighborhood star map: a 3D view (own scene and camera drawn with the game's shared renderer) or
 * an SVG top-down fallback, plus DOM panels (system list, info card, legend, labels).
 *
 * Usage: construct once; open(state) when the player opens the map; call render(dt) every frame
 * and resize(w, h) on canvas resize while open; update(state) when credits/readiness change;
 * close() when callbacks.onClose() asks for it; dispose() on teardown.
 */
import '../ui/styles/map.css';
import type * as THREE from 'three';
import { MAP_SYSTEMS, getSystem, isNewSystem } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { formatCredits, h, replaceChildren } from '../ui/dom.ts';
import { openEncyclopedia } from '../ui/encyclopedia.ts';
import { icon } from '../ui/icons.ts';
import { GestureTracker } from './gestures.ts';
import { InfoCard } from './infoCard.ts';
import type { JumpEvaluation } from './jumpRules.ts';
import { buildLegend } from './legend.ts';
import { KEY_ROTATE_STEP, KEY_ZOOM_STEP, OrbitController } from './mapCamera.ts';
import { openMissionsDialog, openSearchDialog, type MapDialog, type PickerContext } from './mapDialogs.ts';
import { MAP_LABELS, MAP_STARS, RING_RADII_LY, formatLy, mapBounds, systemFocus, type MapLabel } from './mapData.ts';
import { mapIcon } from './mapIcons.ts';
import {
  clamp,
  createScreenPoint,
  fitOrbitDistance,
  smoothingFactor,
  stageShift,
  type OrbitState,
  type Rect,
  type ScreenPoint,
  type Vec3,
} from './mapMath.ts';
import { MAP_FOV_DEG, MapScene } from './mapScene.ts';
import { createLabelBox, layoutLabels, pickNearestPoint, type LabelBox } from './screenLayout.ts';
import { centreStarMap2D, disposeStarMap2D, panStarMap2D, renderStarMap2D, resetStarMap2D, zoomStarMap2D } from './starMap2d.ts';
import type { GalaxyMapCallbacks, MapState } from './types.ts';

export { renderStarMap2D } from './starMap2d.ts';

export interface GalaxyMapOptions {
  /** Container for the map's DOM panels (absolutely positioned full-screen layer; you create children). */
  root: HTMLElement;
  /** Shared renderer, or null when WebGL 2 is unavailable (then show only the 2D SVG map). */
  renderer: THREE.WebGLRenderer | null;
  callbacks: GalaxyMapCallbacks;
  reducedMotion?: boolean;
}

type Mode = '3d' | '2d';

interface ViewLabel {
  el: HTMLElement;
  box: LabelBox;
  /** Star label definition, or null for a distance-ring label. */
  def: MapLabel | null;
  ringLy: number;
  anchor: Vec3;
  point: ScreenPoint;
  lastX: number;
  lastY: number;
  lastVisible: boolean;
}

/** Tap radius around projected stars (CSS px). */
const PICK_RADIUS_TOUCH = 28;
const PICK_RADIUS_MOUSE = 18;
/** A double tap on empty space zooms in this much toward it. */
const DOUBLE_TAP_ZOOM = 2;
/** A system found by search or the missions list is shown with about this many light-years around it. */
const LOCATE_SPAN_LY = 8;
/** The gesture hint shows on a touch screen's first few map openings, for a few seconds. */
const HINT_KEY = 'starman.mapHints';
const HINT_SHOWS = 3;
const HINT_MS = 7000;
const MAP_BOUNDS = mapBounds();
/** The overview frames the familiar neighbourhood (the first catalogue's systems); zoom out for the far shell. */
const STAR_POSITIONS = MAP_STARS.filter((s) => !isNewSystem(s.systemId)).map((s) => s.pos);

let instances = 0;

export class GalaxyMapView {
  private readonly root: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer | null;
  private readonly callbacks: GalaxyMapCallbacks;
  private reducedMotion: boolean;
  private readonly uid = ++instances;

  // DOM
  private readonly el: HTMLElement;
  private readonly labelLayer: HTMLElement;
  private readonly creditsValue: HTMLElement;
  private readonly toggle2d: HTMLButtonElement | null;
  private readonly listButtons = new Map<SystemId, { btn: HTMLButtonElement; marks: HTMLElement }>();
  private readonly stage: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly map2d: HTMLElement;
  private readonly zoomControls: HTMLElement;
  private readonly tools: HTMLElement;
  private readonly searchButton: HTMLButtonElement;
  private readonly missionsButton: HTMLButtonElement;
  private readonly missionsCount: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly card: InfoCard;
  private readonly live: HTMLElement;
  private readonly observer: ResizeObserver | null;

  // 3D
  private readonly mapScene: MapScene | null;
  private readonly controller: OrbitController;
  private readonly gestures: GestureTracker;
  private readonly labels: ViewLabel[] = [];
  private readonly starPoints: ScreenPoint[] = MAP_STARS.map(() => createScreenPoint());
  private readonly labelOrder: number[] = [];
  private readonly labelPlaced: number[] = [];
  private readonly labelBoxes: LabelBox[] = [];
  private readonly camPos: Vec3 = [0, 0, 0];

  // State
  private opened = false;
  private state: MapState | null = null;
  private signature = '';
  private selected: SystemId = 'sol';
  private mode: Mode;
  private encyclopedia: { close(): void } | null = null;
  private dialog: MapDialog | null = null;
  private hintTimer = 0;
  private previousFocus: HTMLElement | null = null;
  private rootPointerEvents = '';
  private time = 0;

  // Layout, in CSS px relative to the map container
  private sizeHint = { w: 0, h: 0 };
  private canvasX = 0;
  private canvasY = 0;
  private canvasW = 1;
  private canvasH = 1;
  private stageRect: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private obstacles: Rect[] = [];
  private readonly shift = { x: 0, y: 0 };
  private readonly shiftGoal = { x: 0, y: 0 };
  private shiftInitialized = false;
  private layoutDirty = true;
  private viewDirty = true;
  private labelSizeDirty = true;
  private lastViewVersion = -1;
  private initialView: { focus: SystemId | null } | null = null;
  private pointerRect: DOMRect | null = null;

  constructor(opts: GalaxyMapOptions) {
    this.root = opts.root;
    this.renderer = opts.renderer;
    this.callbacks = opts.callbacks;
    this.reducedMotion =
      opts.reducedMotion ??
      (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.mapScene = this.renderer ? new MapScene() : null;
    this.mode = this.renderer ? '3d' : '2d';
    this.controller = new OrbitController({ target: [...MAP_BOUNDS.center], yaw: 1.2, pitch: 0.5, distance: 24 });
    this.controller.reducedMotion = this.reducedMotion;
    this.gestures = new GestureTracker({
      rotate: (dx, dy) => this.controller.rotateByPixels(dx, dy),
      pan: (dx, dy) => this.controller.pan(dx, dy, this.canvasH, MAP_FOV_DEG),
      zoom: (f, x, y) => this.zoomAtScreen(f, x, y),
      tap: (x, y, type) => {
        const id = this.pickAt(x, y, type);
        if (id) this.select(id, { announce: true, revealInList: true });
      },
      doubleTap: (x, y, type) => {
        const id = this.pickAt(x, y, type);
        // On empty space, zoom in toward the tap; on a star, centre it.
        if (!id) {
          this.zoomAtScreen(1 / DOUBLE_TAP_ZOOM, x, y, true);
          return;
        }
        this.select(id, { announce: true, revealInList: true });
        this.focusOn(id);
      },
    });

    // ----- DOM -----
    const titleId = `gmap-title-${this.uid}`;
    this.creditsValue = h('span', { class: 'num' }, '');
    this.toggle2d = this.renderer
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn gmap-action',
            'aria-pressed': 'false',
            'aria-label': '2D view',
            title: 'Top-down 2D view',
            onClick: () => this.setMode(this.mode === '3d' ? '2d' : '3d'),
          },
          mapIcon('plane'),
          h('span', { class: 'gmap-btn-text' }, '2D view'),
        )
      : null;
    const top = h(
      'header',
      { class: 'gmap-top panel' },
      h(
        'div',
        { class: 'gmap-titles' },
        h('h2', { class: 'gmap-title', id: titleId }, icon('map'), h('span', null, 'Star map')),
        this.renderer ? null : h('p', { class: 'gmap-subtitle' }, '2D view · 3D needs WebGL 2'),
      ),
      h('p', { class: 'gmap-credits' }, icon('credits'), h('span', { class: 'sr-only' }, 'Credits: '), this.creditsValue),
      h(
        'div',
        { class: 'gmap-actions' },
        this.toggle2d,
        h(
          'button',
          {
            type: 'button',
            class: 'btn gmap-action',
            'aria-label': 'About the science',
            title: 'About the science',
            onClick: () => this.showEncyclopedia(null),
          },
          mapIcon('book'),
          h('span', { class: 'gmap-btn-text' }, 'About the science'),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn gmap-action',
            'aria-label': 'Close map',
            title: 'Close map',
            'data-testid': 'map-close',
            onClick: () => this.callbacks.onClose(),
          },
          icon('close'),
          h('span', { class: 'gmap-btn-text' }, 'Close'),
        ),
      ),
    );

    const listTitleId = `gmap-list-title-${this.uid}`;
    const list = h(
      'nav',
      { class: 'gmap-list panel', 'aria-labelledby': listTitleId },
      h('p', { class: 'gmap-list-title eyebrow', id: listTitleId }, 'Systems · ly from Sol'),
      h(
        'ul',
        { class: 'gmap-list-items' },
        MAP_SYSTEMS.map((s) => {
          const star = MAP_STARS.find((m) => m.systemId === s.id)!;
          const marks = h('span', { class: 'gmap-sys-marks' });
          const btn = h(
            'button',
            {
              type: 'button',
              class: 'gmap-sys',
              'aria-pressed': 'false',
              'data-system-id': s.id,
              'data-testid': `map-system-${s.id}`,
              onClick: () => {
                this.select(s.id, { announce: true });
                this.panTo(s.id);
              },
              onDblclick: () => this.focusOn(s.id),
            },
            h('span', { class: 'gmap-sys-dot', style: `--star: ${star.colorHex}`, 'aria-hidden': 'true' }),
            h(
              'span',
              { class: 'gmap-sys-text' },
              h('span', { class: 'gmap-sys-name' }, s.displayName),
              h('span', { class: 'gmap-sys-dist num' }, s.id === 'sol' ? 'origin' : formatLy(s.distanceLightYears)),
            ),
            marks,
          );
          this.listButtons.set(s.id, { btn, marks });
          return h('li', null, btn);
        }),
      ),
    );

    this.viewport = h('div', {
      class: 'gmap-viewport',
      tabindex: '0',
      role: 'group',
      'aria-roledescription': '3D star map',
      'aria-label':
        'Star map view. Arrow keys rotate, plus and minus zoom, Home resets the view. Choose systems from the list.',
    });
    this.map2d = h('div', { class: 'gmap-2d', hidden: true });
    const zoomButton = (name: 'plus' | 'minus' | 'reset', label: string, action: () => void) =>
      h('button', { type: 'button', class: 'btn gmap-zoom-btn', 'aria-label': label, title: label, onClick: action }, mapIcon(name));
    this.zoomControls = h(
      'div',
      { class: 'gmap-zoom', role: 'group', 'aria-label': 'Map view' },
      zoomButton('plus', 'Zoom in', () => this.zoomStep(1 / KEY_ZOOM_STEP)),
      zoomButton('minus', 'Zoom out', () => this.zoomStep(KEY_ZOOM_STEP)),
      zoomButton('reset', 'Reset view', () => this.resetView()),
    );
    // Finding systems: by name, or where your missions send you.
    this.searchButton = h(
      'button',
      {
        type: 'button',
        class: 'btn gmap-tool',
        'aria-label': 'Find a system',
        'aria-haspopup': 'dialog',
        title: 'Find a system by name (/)',
        'data-testid': 'map-search',
        onClick: () => this.openSearch(),
      },
      mapIcon('search'),
      h('span', { class: 'gmap-tool-text' }, 'Find'),
    );
    this.missionsCount = h('span', { class: 'gmap-tool-count num', 'aria-hidden': 'true', hidden: true });
    this.missionsButton = h(
      'button',
      {
        type: 'button',
        class: 'btn gmap-tool',
        'aria-label': 'Missions',
        'aria-haspopup': 'dialog',
        title: 'Systems your missions send you to',
        'data-testid': 'map-missions',
        onClick: () => this.openMissions(),
      },
      icon('objective'),
      h('span', { class: 'gmap-tool-text' }, 'Missions'),
      this.missionsCount,
    );
    this.tools = h('div', { class: 'gmap-tools', role: 'group', 'aria-label': 'Find systems' }, this.searchButton, this.missionsButton);
    this.hint = h(
      'p',
      { class: 'gmap-hint', hidden: true, 'data-testid': 'map-hint' },
      mapIcon('pinch'),
      h('span', null, 'Pinch to zoom · drag to turn · double-tap to zoom in'),
    );
    this.legend = buildLegend('3d');
    this.stage = h('div', { class: 'gmap-stage' }, this.viewport, this.map2d, this.tools, this.zoomControls, this.legend, this.hint);

    this.card = new InfoCard({
      onJump: (ev) => this.jump(ev),
      onEncyclopedia: (id) => this.showEncyclopedia(id),
      onCenter: (id) => this.focusOn(id),
    });
    this.live = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    this.labelLayer = h('div', { class: 'gmap-labels', 'aria-hidden': 'true' });

    this.el = h(
      'section',
      {
        class: 'gmap passthrough',
        'aria-labelledby': titleId,
        'data-mode': this.mode,
        'data-testid': 'galaxy-map',
        hidden: true,
      },
      h('div', { class: 'gmap-backdrop2d', 'aria-hidden': 'true' }),
      this.labelLayer,
      top,
      list,
      this.stage,
      this.card.el,
      this.live,
    );
    this.el.classList.toggle('reduced-motion', this.reducedMotion);
    this.buildLabels();
    this.root.appendChild(this.el);

    this.observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            this.layoutDirty = true;
          })
        : null;
    if (this.observer) {
      for (const target of [this.el, top, list, this.stage, this.card.el, this.legend, this.zoomControls, this.tools]) {
        this.observer.observe(target);
      }
    }
  }

  get isOpen(): boolean {
    return this.opened;
  }

  // ---------- Public API ----------

  open(state: MapState, focusSystemId?: SystemId): void {
    if (this.opened) {
      this.update(state);
      if (focusSystemId) {
        this.select(focusSystemId, { announce: true, revealInList: true });
        this.panTo(focusSystemId);
      }
      return;
    }
    this.opened = true;
    this.state = state;
    this.signature = '';
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.rootPointerEvents = this.root.style.pointerEvents;
    // The map layer must let canvas gestures through; only its panels take pointer events.
    this.root.style.pointerEvents = 'none';
    this.el.hidden = false;
    this.selected =
      focusSystemId ??
      (state.objectiveSystemId && state.objectiveSystemId !== state.currentSystemId
        ? state.objectiveSystemId
        : state.currentSystemId);
    this.initialView = { focus: focusSystemId ?? null };
    this.shiftInitialized = false;
    this.layoutDirty = true;
    this.viewDirty = true;
    this.labelSizeDirty = true;
    this.time = 0;
    this.gestures.reset();
    this.attach();
    this.applyMode();
    this.refresh(true);
    this.maybeShowHint();
    const btn = this.listButtons.get(this.selected)?.btn;
    btn?.focus({ preventScroll: true });
    this.revealInList(this.selected, false);
    this.announce(`Star map open. ${this.selectionSummary(this.selected)}`);
  }

  update(state: MapState): void {
    this.state = state;
    if (this.opened) this.refresh(false);
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.encyclopedia?.close();
    this.encyclopedia = null;
    this.dialog?.close();
    this.dialog = null;
    this.hideHint();
    this.detach();
    this.gestures.reset();
    this.el.hidden = true;
    this.root.style.pointerEvents = this.rootPointerEvents;
    const prev = this.previousFocus;
    this.previousFocus = null;
    if (prev && prev.isConnected && this.el.contains(document.activeElement)) prev.focus({ preventScroll: true });
    else if (this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  render(dt: number): void {
    const scene = this.mapScene;
    const renderer = this.renderer;
    if (!this.opened || !scene || !renderer || this.mode !== '3d' || this.encyclopedia) return;
    const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    this.time += step;
    if (this.layoutDirty) this.measureLayout();
    if (this.initialView) this.applyInitialView();
    this.controller.update(step);

    // Ease the projection centre toward the visible stage (bottom sheet / side panels).
    const k = this.reducedMotion || !this.shiftInitialized ? 1 : smoothingFactor(step, 0.08);
    this.shiftInitialized = true;
    let sx = this.shift.x + (this.shiftGoal.x - this.shift.x) * k;
    let sy = this.shift.y + (this.shiftGoal.y - this.shift.y) * k;
    if (Math.abs(this.shiftGoal.x - sx) < 0.05) sx = this.shiftGoal.x;
    if (Math.abs(this.shiftGoal.y - sy) < 0.05) sy = this.shiftGoal.y;
    if (sx !== this.shift.x || sy !== this.shift.y) {
      this.shift.x = sx;
      this.shift.y = sy;
      scene.setViewShift(sx, sy);
      this.viewDirty = true;
    }

    const cur = this.controller.current;
    this.controller.cameraPosition(this.camPos);
    scene.updateFrame(this.camPos, cur.target, cur.distance, this.time, !this.reducedMotion);
    if (this.controller.version !== this.lastViewVersion || this.viewDirty) {
      this.lastViewVersion = this.controller.version;
      this.viewDirty = false;
      this.layoutScreen();
    }

    const prevAutoClear = renderer.autoClear;
    const prevTarget = renderer.getRenderTarget();
    renderer.autoClear = true;
    renderer.setRenderTarget(null);
    renderer.render(scene.scene, scene.camera);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  resize(width: number, height: number): void {
    this.sizeHint.w = width;
    this.sizeHint.h = height;
    this.layoutDirty = true;
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.controller.reducedMotion = on;
    this.el.classList.toggle('reduced-motion', on);
  }

  /**
   * For browser tests (?test=1): the camera distance, the projection centre and where each plotted
   * star is (CSS px in the map layer, whose page offset is `origin`). Null unless the 3D map is open.
   */
  debugView(): {
    /** Still easing or waiting for a frame: the positions are not final yet. */
    moving: boolean;
    distance: number;
    origin: { x: number; y: number };
    centre: { x: number; y: number };
    stars: { id: SystemId; x: number; y: number; depth: number; visible: boolean }[];
  } | null {
    if (!this.opened || this.mode !== '3d') return null;
    const r = this.el.getBoundingClientRect();
    return {
      moving:
        !!this.initialView ||
        this.layoutDirty ||
        this.viewDirty ||
        this.controller.isAnimating ||
        this.controller.version !== this.lastViewVersion ||
        this.shift.x !== this.shiftGoal.x ||
        this.shift.y !== this.shiftGoal.y,
      distance: this.controller.current.distance,
      origin: { x: r.left, y: r.top },
      centre: { x: this.canvasX + this.canvasW / 2 + this.shift.x, y: this.canvasY + this.canvasH / 2 + this.shift.y },
      stars: MAP_STARS.map((star, i) => {
        const p = this.starPoints[i]!;
        return { id: star.systemId, x: p.x, y: p.y, depth: p.depth, visible: p.visible };
      }),
    };
  }

  dispose(): void {
    this.close();
    this.observer?.disconnect();
    disposeStarMap2D(this.map2d);
    this.mapScene?.dispose();
    this.el.remove();
  }

  // ---------- Selection and view ----------

  private select(id: SystemId, opts: { announce?: boolean; revealInList?: boolean } = {}): void {
    this.selected = id;
    this.refreshSelection();
    if (opts.revealInList) this.revealInList(id, !this.reducedMotion);
    if (opts.announce) this.announce(this.selectionSummary(id));
  }

  private selectionSummary(id: SystemId): string {
    const s = getSystem(id);
    const where = id === 'sol' ? 'the origin of the map' : `${s.distanceLightYears.toFixed(2)} light-years from Sol`;
    const ev = this.card.jumpEvaluation;
    const jump =
      ev && ev.destination === id
        ? ev.canJump
          ? `Jump available, fee ${formatCredits(ev.fee)}.`
          : (ev.reasons[0] ?? '')
        : '';
    return `${s.displayName} selected, ${where}. ${jump}`;
  }

  /**
   * Lays out and sets the opening view now if the first frame has not done so yet, so that a move
   * asked for before it (a pick from a list) is not undone by it.
   */
  private ensureView(): void {
    if (!this.opened) return;
    if (this.layoutDirty) this.measureLayout();
    if (this.initialView) this.applyInitialView();
  }

  /** Centres the orbit on a system and zooms in close enough to separate its stars. */
  private focusOn(id: SystemId): void {
    if (this.mode !== '3d') return;
    this.ensureView();
    const f = systemFocus(id);
    this.controller.transitionTo({ target: f.target, distance: f.distance }, 0.14);
  }

  /**
   * Selects a system found by name or from the missions list and brings it to the middle of the
   * stage, with about LOCATE_SPAN_LY of its neighbourhood around it.
   */
  private locate(id: SystemId): void {
    this.select(id, { announce: true, revealInList: true });
    if (this.mode !== '3d') {
      centreStarMap2D(this.map2d, id);
      return;
    }
    this.ensureView();
    const f = systemFocus(id);
    const st = this.stageRect;
    const span = Math.max(1, Math.min(st.w, st.h));
    const distance = (LOCATE_SPAN_LY * this.canvasH) / (2 * Math.tan((MAP_FOV_DEG * Math.PI) / 360) * span);
    this.controller.transitionTo({ target: f.target, distance: Math.max(f.distance, distance) }, 0.14);
  }

  /** Zoom about a point of the map layer (CSS px): what is under it stays there. */
  private zoomAtScreen(factor: number, x: number, y: number, animate = false): void {
    this.ensureView();
    // The projection centre: the canvas centre moved by the view shift (the middle of the stage).
    const dx = x - (this.canvasX + this.canvasW / 2 + this.shift.x);
    const dy = y - (this.canvasY + this.canvasH / 2 + this.shift.y);
    this.controller.zoomAt(factor, dx, dy, this.canvasH, MAP_FOV_DEG, animate);
  }

  /** Centres the orbit on a system without changing zoom. */
  private panTo(id: SystemId): void {
    if (this.mode !== '3d') return;
    this.ensureView();
    this.controller.transitionTo({ target: systemFocus(id).target }, 0.12);
  }

  /** A zoom button or key: the distance multiplier (< 1 zooms in), about the middle. */
  private zoomStep(factor: number): void {
    if (this.mode === '2d') zoomStarMap2D(this.map2d, 1 / factor);
    else this.controller.zoom(factor);
  }

  private resetView(): void {
    if (this.mode === '2d') {
      resetStarMap2D(this.map2d);
      return;
    }
    this.ensureView();
    this.controller.transitionTo(this.overviewOrbit(), 0.14);
  }

  /** Whole-neighborhood view framed to the visible stage (long axis along the stage's long side). */
  private overviewOrbit(): OrbitState {
    const st = this.stageRect;
    const portrait = st.h > st.w * 1.05;
    const target: Vec3 = [MAP_BOUNDS.center[0], MAP_BOUNDS.center[1], MAP_BOUNDS.center[2]];
    const yaw = portrait ? 0.3 : 1.22;
    const pitch = portrait ? 0.9 : 0.55;
    const margin = Math.min(56, Math.max(24, Math.min(st.w, st.h) * 0.1));
    const distance = fitOrbitDistance(STAR_POSITIONS, target, yaw, pitch, MAP_FOV_DEG, st.w, st.h, this.canvasH, margin);
    return { target, yaw, pitch, distance };
  }

  private applyInitialView(): void {
    const iv = this.initialView;
    this.initialView = null;
    if (!iv) return;
    const overview = this.overviewOrbit();
    this.controller.jumpTo(overview);
    if (iv.focus) {
      // Bring the system toward the centre while keeping its neighbours in view.
      const f = systemFocus(iv.focus).target;
      const c = overview.target;
      this.controller.transitionTo(
        {
          target: [c[0] + (f[0] - c[0]) * 0.6, c[1] + (f[1] - c[1]) * 0.6, c[2] + (f[2] - c[2]) * 0.6],
          distance: overview.distance * 0.82,
        },
        0.16,
      );
    }
  }

  private setMode(mode: Mode): void {
    if (!this.renderer && mode === '3d') return;
    this.mode = mode;
    this.gestures.reset();
    this.applyMode();
  }

  private applyMode(): void {
    this.el.dataset['mode'] = this.mode;
    this.toggle2d?.setAttribute('aria-pressed', this.mode === '2d' ? 'true' : 'false');
    const is2d = this.mode === '2d';
    this.map2d.hidden = !is2d;
    this.viewport.hidden = is2d;
    this.legend.hidden = is2d;
    this.labelLayer.hidden = is2d;
    if (is2d) this.hideHint();
    if (is2d) this.render2d();
    else {
      this.layoutDirty = true;
      this.viewDirty = true;
    }
  }

  private render2d(): void {
    if (!this.state || this.mode !== '2d' || !this.opened) return;
    renderStarMap2D(this.map2d, this.state, (id) => this.select(id, { announce: true, revealInList: true }), this.selected, {
      zoomable: true,
      obstacles: () => this.overlays2d(),
      insetTop: this.tools.offsetHeight + 6,
    });
  }

  /** The controls lying over the 2D map (Find and Missions, the zoom buttons), in its own px. */
  private overlays2d(): Rect[] {
    const base = this.map2d.getBoundingClientRect();
    const out: Rect[] = [];
    for (const o of [this.tools, this.zoomControls]) {
      const r = o.getBoundingClientRect();
      if (!o.hidden && r.width > 0) out.push({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
    }
    return out;
  }

  private jump(ev: JumpEvaluation): void {
    if (!ev.canJump || !ev.route) return;
    this.callbacks.onJump(ev.route, ev.fee);
  }

  private openSearch(): void {
    this.openDialog(openSearchDialog, this.searchButton);
  }

  private openMissions(): void {
    this.openDialog(openMissionsDialog, this.missionsButton);
  }

  private openDialog(build: (ctx: PickerContext) => MapDialog, opener: HTMLElement): void {
    if (this.dialog || this.encyclopedia || !this.opened || !this.state) return;
    this.gestures.reset();
    this.hideHint();
    this.dialog = build({
      host: this.el,
      state: this.state,
      marks: (id) => this.systemMarks(id),
      onClose: () => {
        this.dialog = null;
        if (this.opened && opener.isConnected) opener.focus({ preventScroll: true });
      },
      onPick: (id) => this.locate(id),
    });
  }

  /** The gesture hint, on a touch screen's first few openings of the 3D map. */
  private maybeShowHint(): void {
    if (this.mode !== '3d' || typeof matchMedia !== 'function' || !matchMedia('(pointer: coarse)').matches) return;
    let shown = 0;
    try {
      shown = Number(localStorage.getItem(HINT_KEY)) || 0;
      if (shown < HINT_SHOWS) localStorage.setItem(HINT_KEY, String(shown + 1));
    } catch {
      // Storage unavailable: show it this time.
    }
    if (shown >= HINT_SHOWS) return;
    this.hint.hidden = false;
    this.layoutDirty = true;
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hideHint(), HINT_MS);
  }

  private hideHint(): void {
    window.clearTimeout(this.hintTimer);
    if (this.hint.hidden) return;
    this.hint.hidden = true;
    this.layoutDirty = true;
  }

  private showEncyclopedia(systemId: SystemId | null): void {
    if (this.encyclopedia || this.dialog || !this.opened) return;
    this.gestures.reset();
    this.encyclopedia = openEncyclopedia(this.el, {
      discoveredBodies: this.state?.discoveredBodies ?? new Set<string>(),
      ...(this.state?.catalogued ? { catalogued: this.state.catalogued } : {}),
      ...(systemId ? { initialSystemId: systemId } : {}),
      onClose: () => {
        this.encyclopedia = null;
        this.viewDirty = true;
      },
    });
  }

  // ---------- State to DOM ----------

  private stateSignature(s: MapState): string {
    return [
      s.currentSystemId,
      [...s.visited].sort().join(','),
      s.credits,
      s.readiness.canJump ? 1 : 0,
      s.readiness.reason ?? '',
      s.objectiveSystemId ?? '',
      [...s.discoveredBodies].sort().join(','),
      s.feeCoverage ? `${s.feeCoverage.systemId}:${s.feeCoverage.note}` : '',
      (s.news ?? []).map((n) => `${n.id}:${n.active ? 1 : 0}`).join(','),
      [...(s.contractSystems ?? [])].sort().join(','),
      (s.missions ?? []).map((m) => `${m.jobId}:${m.systemId}:${m.primary ? 1 : 0}`).join(','),
    ].join('|');
  }

  private refresh(force: boolean): void {
    const state = this.state;
    if (!state) return;
    const sig = this.stateSignature(state);
    if (!force && sig === this.signature) return;
    this.signature = sig;
    this.creditsValue.textContent = formatCredits(state.credits);
    for (const [id, { marks }] of this.listButtons) marks.replaceChildren(...this.systemMarks(id));
    const count = new Set((state.missions ?? []).map((m) => m.systemId)).size;
    this.missionsCount.textContent = String(count);
    this.missionsCount.hidden = count === 0;
    this.missionsButton.setAttribute('aria-label', count ? `Missions: ${count === 1 ? '1 system' : `${count} systems`}` : 'Missions: none active');
    this.refreshSelection();
  }

  /** Marks for a system: you are here, objective or contract, in the news, visited. */
  private systemMarks(id: SystemId): Node[] {
    const state = this.state;
    if (!state) return [];
    const items: Node[] = [];
    if (state.currentSystemId === id) items.push(this.mark('current', icon('goto'), 'you are here'));
    if (state.objectiveSystemId === id) items.push(this.mark('objective', icon('objective'), 'objective'));
    else if (state.contractSystems?.has(id)) items.push(this.mark('contract', icon('objective'), 'contract'));
    if (state.news?.some((n) => n.systemId === id && n.active)) items.push(this.mark('news', icon('alert'), 'in the news'));
    if (state.visited.has(id) && state.currentSystemId !== id) items.push(this.mark('visited', mapIcon('check'), 'visited'));
    return items;
  }

  private mark(kind: string, glyph: SVGSVGElement, text: string): HTMLElement {
    return h('span', { class: `gmap-mark gmap-mark-${kind}`, title: text }, glyph, h('span', { class: 'sr-only' }, `, ${text}`));
  }

  private refreshSelection(): void {
    const state = this.state;
    if (!state) return;
    for (const [id, { btn }] of this.listButtons) btn.setAttribute('aria-pressed', id === this.selected ? 'true' : 'false');
    this.card.render(this.selected, state);
    const route = this.card.jumpEvaluation?.route?.path ?? null;
    this.mapScene?.setMarkers({
      current: state.currentSystemId,
      selected: this.selected,
      objective: state.objectiveSystemId,
      visited: state.visited,
      route,
    });
    this.refreshLabelStatus(route);
    if (this.mode === '2d') this.render2d();
  }

  private revealInList(id: SystemId, smooth: boolean): void {
    const btn = this.listButtons.get(id)?.btn;
    btn?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  }

  private announce(text: string): void {
    this.live.textContent = '';
    queueMicrotask(() => (this.live.textContent = text));
  }

  // ---------- Labels ----------

  private buildLabels(): void {
    for (const def of MAP_LABELS) {
      const el = h('div', { class: `gmap-label${def.primary ? '' : ' is-secondary'}`, 'data-system-id': def.systemId });
      const box = createLabelBox();
      box.gap = def.glowPx * 0.42 + 5;
      box.anchorBlocks = true;
      this.labels.push({
        el,
        box,
        def,
        ringLy: 0,
        anchor: [def.pos[0], def.pos[1], def.pos[2]],
        point: createScreenPoint(),
        lastX: NaN,
        lastY: NaN,
        lastVisible: false,
      });
      this.labelLayer.append(el);
    }
    for (const r of RING_RADII_LY) {
      const el = h('div', { class: 'gmap-label gmap-ring-label' }, `${r} ly`);
      const box = createLabelBox();
      box.gap = 3;
      box.anchorBlocks = false;
      box.priority = 0;
      this.labels.push({
        el,
        box,
        def: null,
        ringLy: r,
        anchor: [r, 0, 0],
        point: createScreenPoint(),
        lastX: NaN,
        lastY: NaN,
        lastVisible: false,
      });
      this.labelLayer.append(el);
    }
    for (const l of this.labels) this.labelBoxes.push(l.box);
  }

  private refreshLabelStatus(route: readonly SystemId[] | null): void {
    const state = this.state;
    if (!state) return;
    for (const l of this.labels) {
      const def = l.def;
      if (!def) continue;
      const id = def.systemId;
      const cur = state.currentSystemId === id;
      const obj = state.objectiveSystemId === id;
      const sel = this.selected === id;
      const vis = state.visited.has(id) && !cur;
      const onRoute = !!route && route.includes(id);
      l.el.className = `gmap-label${def.primary ? '' : ' is-secondary'}${sel ? ' is-selected' : ''}${cur ? ' is-current' : ''}${obj ? ' is-objective' : ''}${onRoute ? ' on-route' : ''}`;
      const contract = !obj && !!state.contractSystems?.has(id);
      const news = !!state.news?.some((n) => n.systemId === id && n.active);
      const marks: Node[] = [];
      if (def.primary || contract || news) {
        if (cur) marks.push(icon('goto'));
        if (obj) marks.push(icon('objective'));
        if (contract) marks.push(h('span', { class: 'gmap-contract-mark' }, icon('objective')));
        if (news) marks.push(h('span', { class: 'gmap-news-mark' }, icon('alert')));
        if (vis && def.primary) marks.push(mapIcon('check'));
      }
      replaceChildren(
        l.el,
        marks.length ? h('span', { class: 'gmap-label-marks' }, marks) : null,
        h('span', { class: 'gmap-label-name' }, def.name),
        def.distanceLy !== null ? h('span', { class: 'gmap-label-dist' }, ` · ${formatLy(def.distanceLy)}`) : null,
      );
      // The first catalogue's systems and those you have been to win space over the far shell.
      const known = !isNewSystem(id) || state.visited.has(id);
      l.box.priority = (def.primary ? 50 : 30) + (known ? 8 : 0) + (sel ? 100 : 0) + (cur ? 60 : 0) + (obj ? 40 : 0) + (contract ? 25 : 0) + (news ? 15 : 0) + (onRoute ? 20 : 0);
    }
    this.labelSizeDirty = true;
    this.viewDirty = true;
  }

  private measureLabels(): void {
    for (const l of this.labels) {
      l.box.width = l.el.offsetWidth;
      l.box.height = l.el.offsetHeight;
    }
    this.labelSizeDirty = false;
  }

  // ---------- Layout ----------

  private relRect(el: Element, base: DOMRect): Rect {
    const r = el.getBoundingClientRect();
    return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
  }

  private measureLayout(): void {
    const base = this.el.getBoundingClientRect();
    let cw = this.sizeHint.w;
    let ch = this.sizeHint.h;
    let cx = 0;
    let cy = 0;
    if (this.renderer) {
      const r = this.renderer.domElement.getBoundingClientRect();
      cx = r.left - base.left;
      cy = r.top - base.top;
      if (r.width > 0 && r.height > 0) {
        cw = r.width;
        ch = r.height;
      }
    }
    if (!(cw > 0 && ch > 0)) {
      cw = base.width || 1;
      ch = base.height || 1;
    }
    this.canvasX = cx;
    this.canvasY = cy;
    this.canvasW = cw;
    this.canvasH = ch;
    this.stageRect = this.relRect(this.stage, base);
    this.obstacles.length = 0;
    for (const o of [this.legend, this.zoomControls, this.tools, this.hint]) {
      if (!o.hidden) this.obstacles.push(this.relRect(o, base));
    }
    stageShift(cw, ch, { x: this.stageRect.x - cx, y: this.stageRect.y - cy, w: this.stageRect.w, h: this.stageRect.h }, this.shiftGoal);
    this.mapScene?.setSize(cw, ch);
    this.layoutDirty = false;
    this.labelSizeDirty = true;
    this.viewDirty = true;
  }

  /** Projects stars and labels, lays labels out and writes only changed label transforms. */
  private layoutScreen(): void {
    const scene = this.mapScene;
    if (!scene) return;
    if (this.labelSizeDirty) this.measureLabels();
    const st = this.stageRect;
    const cx = this.canvasX;
    const cy = this.canvasY;
    for (let i = 0; i < MAP_STARS.length; i++) {
      const p = scene.project(MAP_STARS[i]!.pos, this.starPoints[i]!);
      p.x += cx;
      p.y += cy;
      p.visible = p.visible && p.x >= st.x && p.x <= st.x + st.w && p.y >= st.y && p.y <= st.y + st.h;
    }
    const cur = this.controller.current;
    const ringAngle = cur.yaw + 0.5;
    const showRings = cur.pitch > 0.22;
    for (const l of this.labels) {
      if (!l.def) {
        l.anchor[0] = Math.sin(ringAngle) * l.ringLy;
        l.anchor[1] = 0;
        l.anchor[2] = Math.cos(ringAngle) * l.ringLy;
      }
      const p = scene.project(l.anchor, l.point);
      const x = p.x + cx;
      const y = p.y + cy;
      l.box.anchorX = x;
      l.box.anchorY = y;
      l.box.active =
        p.visible && (l.def !== null || showRings) && x >= st.x && x <= st.x + st.w && y >= st.y && y <= st.y + st.h;
    }
    layoutLabels(this.labelBoxes, { x: st.x + 2, y: st.y + 2, w: st.w - 4, h: st.h - 4 }, this.obstacles, this.labelOrder, this.labelPlaced);
    for (const l of this.labels) {
      const b = l.box;
      if (b.visible !== l.lastVisible) {
        l.el.classList.toggle('is-visible', b.visible);
        l.lastVisible = b.visible;
      }
      if (!b.visible) continue;
      const x = Math.round(b.x);
      const y = Math.round(b.y);
      if (x !== l.lastX || y !== l.lastY) {
        l.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        l.lastX = x;
        l.lastY = y;
      }
    }
  }

  /** System under a tap: nearest projected star within the touch radius, else a visible label. */
  private pickAt(x: number, y: number, pointerType: string): SystemId | null {
    const radius = pointerType === 'mouse' ? PICK_RADIUS_MOUSE : PICK_RADIUS_TOUCH;
    const i = pickNearestPoint(this.starPoints, x, y, radius);
    if (i >= 0) return MAP_STARS[i]!.systemId;
    for (const l of this.labels) {
      const b = l.box;
      if (!l.def || !b.visible) continue;
      if (x >= b.x - 4 && x <= b.x + b.width + 4 && y >= b.y - 4 && y <= b.y + b.height + 4) return l.def.systemId;
    }
    return null;
  }

  // ---------- Input ----------

  private attach(): void {
    const c = this.renderer?.domElement;
    if (c) {
      c.addEventListener('pointerdown', this.onPointerDown);
      c.addEventListener('pointermove', this.onPointerMove);
      c.addEventListener('pointerup', this.onPointerUp);
      c.addEventListener('pointercancel', this.onPointerCancel);
      c.addEventListener('lostpointercapture', this.onPointerCancel);
      c.addEventListener('wheel', this.onWheel, { passive: false });
      c.addEventListener('contextmenu', this.onContextMenu);
    }
    document.addEventListener('keydown', this.onKeyDown);
    // Safari's own pinch events: never zoom the page from the map.
    document.addEventListener('gesturestart', this.onSafariGesture, { passive: false });
    document.addEventListener('gesturechange', this.onSafariGesture, { passive: false });
  }

  private detach(): void {
    const c = this.renderer?.domElement;
    if (c) {
      c.removeEventListener('pointerdown', this.onPointerDown);
      c.removeEventListener('pointermove', this.onPointerMove);
      c.removeEventListener('pointerup', this.onPointerUp);
      c.removeEventListener('pointercancel', this.onPointerCancel);
      c.removeEventListener('lostpointercapture', this.onPointerCancel);
      c.removeEventListener('wheel', this.onWheel);
      c.removeEventListener('contextmenu', this.onContextMenu);
    }
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('gesturestart', this.onSafariGesture);
    document.removeEventListener('gesturechange', this.onSafariGesture);
  }

  private interactive(): boolean {
    return this.opened && this.mode === '3d' && !this.encyclopedia && !this.dialog;
  }

  private readonly onSafariGesture = (e: Event): void => {
    const t = e.target;
    if (this.opened && (t === this.renderer?.domElement || (t instanceof Node && this.stage.contains(t)))) e.preventDefault();
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.interactive()) return;
    const mouse = e.pointerType === 'mouse';
    if (mouse && e.button > 2) return;
    const pan = mouse && (e.button === 1 || e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey);
    // A first finger while fingers are still tracked: their ends were lost (a missed pointerup).
    if (e.pointerType === 'touch' && e.isPrimary && this.gestures.tracks('touch')) this.gestures.releaseAll();
    this.hideHint();
    const rect = this.el.getBoundingClientRect();
    if (this.gestures.activePointers === 0) this.pointerRect = rect;
    const base = this.pointerRect ?? rect;
    const accepted = this.gestures.down(
      e.pointerId,
      e.clientX - base.left,
      e.clientY - base.top,
      e.timeStamp,
      e.pointerType || 'mouse',
      pan,
      !mouse || e.button === 0,
    );
    if (!accepted) return;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail for synthetic events; gestures still work while the pointer stays on the canvas.
    }
    // Keys should drive the map after touching it, not the panel that had focus.
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.el.contains(active)) active.blur();
    e.preventDefault();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.interactive() || this.gestures.activePointers === 0) return;
    const base = this.pointerRect;
    if (!base) return;
    this.gestures.move(e.pointerId, e.clientX - base.left, e.clientY - base.top);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const base = this.pointerRect;
    if (!base) return;
    if (this.interactive()) this.gestures.up(e.pointerId, e.clientX - base.left, e.clientY - base.top, e.timeStamp);
    else this.gestures.cancel(e.pointerId);
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      // Already released.
    }
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    this.gestures.cancel(e.pointerId);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.interactive()) return;
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= this.canvasH;
    const k = e.ctrlKey ? 0.01 : 0.0015;
    // Toward the cursor, like a map.
    const rect = this.el.getBoundingClientRect();
    this.zoomAtScreen(Math.exp(clamp(dy * k, -0.8, 0.8)), e.clientX - rect.left, e.clientY - rect.top);
  };

  private readonly onContextMenu = (e: Event): void => {
    if (this.interactive()) e.preventDefault();
  };

  /** Keys on the 2D map: arrows move it, plus and minus zoom, Home shows all of it. */
  private onKeyDown2d(e: KeyboardEvent): void {
    const step = 60;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[e.key];
    if (move) panStarMap2D(this.map2d, move[0], move[1]);
    else if (e.key === '+' || e.key === '=') this.zoomStep(1 / KEY_ZOOM_STEP);
    else if (e.key === '-' || e.key === '_') this.zoomStep(KEY_ZOOM_STEP);
    else if (e.key === 'Home') this.resetView();
    else return;
    e.preventDefault();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.opened || this.encyclopedia || this.dialog || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    const canvas = this.renderer?.domElement ?? null;
    const inMap = t === document.body || t === document.documentElement || t === canvas || (t instanceof Node && this.el.contains(t));
    if (!inMap) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.callbacks.onClose();
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      this.openSearch();
      return;
    }
    if (t instanceof Node && this.card.el.contains(t)) return;
    if (this.mode === '2d') {
      this.onKeyDown2d(e);
      return;
    }
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
        this.controller.rotate(KEY_ROTATE_STEP, 0);
        break;
      case 'ArrowRight':
        this.controller.rotate(-KEY_ROTATE_STEP, 0);
        break;
      case 'ArrowUp':
        this.controller.rotate(0, KEY_ROTATE_STEP);
        break;
      case 'ArrowDown':
        this.controller.rotate(0, -KEY_ROTATE_STEP);
        break;
      case '+':
      case '=':
        this.controller.zoom(1 / KEY_ZOOM_STEP);
        break;
      case '-':
      case '_':
        this.controller.zoom(KEY_ZOOM_STEP);
        break;
      case 'Home':
        this.resetView();
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };
}
