/**
 * Accessible 2D fallback: a top-down SVG projection of the equatorial plane (seen from the north
 * celestial pole) with distance rings, fictional jump links, the selected route and each system as
 * a focusable button. Heights above/below the plane are given in the labels. Used when WebGL 2 is
 * unavailable and as the "2D view" of the map. Re-renders itself when the container resizes.
 *
 * On the full-screen map it zooms and pans too (`zoomable`): a pinch or the wheel zooms about the
 * fingers or the cursor, a drag moves the map and a double tap zooms in. While a gesture lasts the
 * drawing is only transformed; it is drawn again, labels laid out afresh, when the gesture ends.
 */
import '../ui/styles/map.css';
import { isNewSystem, MAP_SYSTEMS } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { h, svg } from '../ui/dom.ts';
import { GestureTracker } from './gestures.ts';
import { buildLegend } from './legend.ts';
import {
  MAP_LINKS,
  MAP_STARS,
  RING_RADII_LY,
  fitProjection2D,
  formatHeightLong,
  formatHeightShort,
  formatLy,
  labelsOf,
  planarUV,
  project2D,
  type MapLabel,
  type Projection2D,
} from './mapData.ts';
import { laneTaker } from './jumpRules.ts';
import { clamp, type Rect } from './mapMath.ts';
import { findRoute } from './routing.ts';
import { createLabelBox, layoutLabels, rectsOverlap, type LabelBox } from './screenLayout.ts';
import type { MapState } from './types.ts';

type SelectFn = (id: SystemId) => void;

export interface Map2DOptions {
  /**
   * Pinch, drag, double tap and the wheel zoom and pan the map. For the full-screen map only: the
   * page without WebGL scrolls, and a map that took every touch would trap it.
   */
  zoomable?: boolean;
  /** Parts of the map covered by controls (container px): labels keep clear of them. */
  obstacles?: () => Rect[];
  /** Height at the top kept clear of stars at the fitted view (for controls along the top edge). */
  insetTop?: number;
}

/** The 2D view: zoom (1 is the whole map fitted) and the equatorial-plane point (ly) in the middle. */
interface View2D {
  zoom: number;
  x: number;
  y: number;
}

interface Entry {
  state: MapState;
  onSelect: SelectFn;
  selected: SystemId | null;
  observer: ResizeObserver | null;
  width: number;
  height: number;
  keyOpen: boolean;
  opts: Map2DOptions;
  /** Null: fitted. */
  view: View2D | null;
  /** The projection last drawn (gestures and zoom work from it), and the group a gesture transforms. */
  proj: Projection2D | null;
  content: SVGGElement | null;
  detach: (() => void) | null;
}

const entries = new WeakMap<HTMLElement, Entry>();

/** Hit radius (CSS px) around each system: targets of at least 44 px. */
const HIT_RADIUS = 23;

/** Most a 2D map zooms in on the fitted view. */
export const MAX_ZOOM_2D = 8;

export function renderStarMap2D(
  container: HTMLElement,
  state: MapState,
  onSelect: (id: SystemId) => void,
  selected?: SystemId,
  opts: Map2DOptions = {},
): void {
  let entry = entries.get(container);
  if (!entry) {
    const created: Entry = {
      state,
      onSelect,
      selected: null,
      observer: null,
      width: -1,
      height: -1,
      keyOpen: false,
      opts,
      view: null,
      proj: null,
      content: null,
      detach: null,
    };
    entry = created;
    entries.set(container, created);
    if (typeof ResizeObserver !== 'undefined') {
      created.observer = new ResizeObserver(() => {
        if (container.clientWidth !== created.width || container.clientHeight !== created.height) draw(container, created);
      });
      created.observer.observe(container);
    }
  }
  entry.state = state;
  entry.onSelect = onSelect;
  entry.selected = selected ?? null;
  entry.opts = opts;
  if (opts.zoomable && !entry.detach) entry.detach = attachGestures(container, entry);
  draw(container, entry);
}

/** Stops resize tracking and gestures and clears the container. */
export function disposeStarMap2D(container: HTMLElement): void {
  const e = entries.get(container);
  e?.observer?.disconnect();
  e?.detach?.();
  entries.delete(container);
  container.replaceChildren();
}

/** Zooms a zoomable 2D map about its middle (factor > 1 zooms in). */
export function zoomStarMap2D(container: HTMLElement, factor: number): void {
  const e = entries.get(container);
  if (!e?.proj || !(factor > 0)) return;
  const p = e.proj;
  setView(e, (e.view?.zoom ?? 1) * factor, planeToEq(p.ou, p.ov, p.rotate));
  draw(container, e);
}

/** Pans a zoomable 2D map by CSS px (the map follows: dx right, dy down). */
export function panStarMap2D(container: HTMLElement, dx: number, dy: number): void {
  const e = entries.get(container);
  if (!e?.proj) return;
  const p = e.proj;
  setView(e, e.view?.zoom ?? 1, planeToEq(p.ou - dx / p.scale, p.ov + dy / p.scale, p.rotate));
  draw(container, e);
}

/** Back to the whole map. */
export function resetStarMap2D(container: HTMLElement): void {
  const e = entries.get(container);
  if (!e || !e.view) return;
  e.view = null;
  draw(container, e);
}

/** Brings a system to the middle of a zoomed-in 2D map (the fitted view already shows it). */
export function centreStarMap2D(container: HTMLElement, id: SystemId): void {
  const e = entries.get(container);
  if (!e?.view) return;
  const sys = MAP_SYSTEMS.find((s) => s.id === id);
  if (!sys) return;
  setView(e, e.view.zoom, [sys.positionLy[0], sys.positionLy[1]]);
  draw(container, e);
}

/** The view's zoom (1 when fitted), for tests and the zoom buttons. */
export function starMap2DZoom(container: HTMLElement): number {
  return entries.get(container)?.view?.zoom ?? 1;
}

/** Equatorial-plane x, y (ly) of plane coordinates u, v (see planarUV). */
function planeToEq(u: number, v: number, rotate: boolean): [number, number] {
  return rotate ? [-v, u] : [u, v];
}

const PLANE_BOUNDS = (() => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of MAP_STARS) {
    minX = Math.min(minX, s.eq[0]);
    maxX = Math.max(maxX, s.eq[0]);
    minY = Math.min(minY, s.eq[1]);
    maxY = Math.max(maxY, s.eq[1]);
  }
  return { minX, maxX, minY, maxY };
})();

/** Sets the view, kept within the zoom range and over the stars. */
function setView(e: Entry, zoom: number, centre: [number, number]): void {
  const b = PLANE_BOUNDS;
  e.view = {
    zoom: clamp(zoom, 1, MAX_ZOOM_2D),
    x: clamp(centre[0], b.minX, b.maxX),
    y: clamp(centre[1], b.minY, b.maxY),
  };
}

/**
 * Pinch, drag, double tap and wheel on a zoomable map. The drawing follows at once through a
 * transform (x' = s·x + t) and is drawn again when the gesture ends. Returns the detach function.
 */
function attachGestures(container: HTMLElement, e: Entry): () => void {
  let s = 1;
  let tx = 0;
  let ty = 0;
  let moved = false;
  let suppressClick = false;
  let commitTimer = 0;
  const local = (ev: { clientX: number; clientY: number }): [number, number] => {
    const r = container.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  };
  const apply = () => e.content?.setAttribute('transform', `matrix(${s} 0 0 ${s} ${tx} ${ty})`);
  const zoomBy = (k: number, px: number, py: number) => {
    const now = (e.view?.zoom ?? 1) * s;
    const f = clamp(now * k, 1, MAX_ZOOM_2D) / now;
    if (!(f > 0) || f === 1) return;
    s *= f;
    tx = px + (tx - px) * f;
    ty = py + (ty - py) * f;
    moved = true;
    apply();
  };
  const panBy = (dx: number, dy: number) => {
    tx += dx;
    ty += dy;
    moved = true;
    apply();
  };
  const commit = () => {
    window.clearTimeout(commitTimer);
    const p = e.proj;
    if (!p || (s === 1 && tx === 0 && ty === 0)) return;
    // The drawn point now in the middle of the view becomes the view's centre.
    const mx = (p.cx - tx) / s;
    const my = (p.cy - ty) / s;
    const zoom = (e.view?.zoom ?? 1) * s;
    s = 1;
    tx = 0;
    ty = 0;
    setView(e, zoom, planeToEq(p.ou + (mx - p.cx) / p.scale, p.ov - (my - p.cy) / p.scale, p.rotate));
    draw(container, e);
  };
  const tracker = new GestureTracker({
    rotate: panBy,
    pan: panBy,
    zoom: (f, x, y) => zoomBy(1 / f, x, y),
    // A tap is the system's own click (it selects); a double tap zooms in there.
    tap: () => {},
    doubleTap: (x, y) => zoomBy(2, x, y),
  });
  const onMove = (ev: PointerEvent) => {
    const [x, y] = local(ev);
    tracker.move(ev.pointerId, x, y);
  };
  const finish = () => {
    if (tracker.activePointers > 0) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    if (moved) {
      // The click that ends a drag (or a double tap) must not select what is under it.
      suppressClick = true;
      window.setTimeout(() => (suppressClick = false), 0);
    }
    commit();
  };
  const onUp = (ev: PointerEvent) => {
    const [x, y] = local(ev);
    tracker.up(ev.pointerId, x, y, ev.timeStamp);
    finish();
  };
  const onCancel = (ev: PointerEvent) => {
    tracker.cancel(ev.pointerId);
    finish();
  };
  const onDown = (ev: PointerEvent) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    // Clicks on the map's own controls (its key) are not gestures.
    if (ev.target instanceof Element && ev.target.closest('.gmap-legend')) return;
    // A first finger while fingers are still tracked: their ends were lost.
    if (ev.pointerType === 'touch' && ev.isPrimary && tracker.tracks('touch')) tracker.releaseAll();
    if (tracker.activePointers === 0) moved = false;
    const [x, y] = local(ev);
    if (!tracker.down(ev.pointerId, x, y, ev.timeStamp, ev.pointerType || 'mouse')) return;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };
  const onWheel = (ev: WheelEvent) => {
    // The key scrolls as usual.
    if (ev.target instanceof Element && ev.target.closest('.gmap-legend')) return;
    ev.preventDefault();
    let dy = ev.deltaY;
    if (ev.deltaMode === 1) dy *= 16;
    else if (ev.deltaMode === 2) dy *= container.clientHeight;
    const [x, y] = local(ev);
    zoomBy(Math.exp(-clamp(dy * (ev.ctrlKey ? 0.01 : 0.0015), -0.8, 0.8)), x, y);
    window.clearTimeout(commitTimer);
    commitTimer = window.setTimeout(commit, 160);
  };
  const onClick = (ev: MouseEvent) => {
    if (!suppressClick) return;
    ev.stopPropagation();
    ev.preventDefault();
  };
  container.classList.add('is-zoomable');
  container.addEventListener('pointerdown', onDown);
  container.addEventListener('wheel', onWheel, { passive: false });
  container.addEventListener('click', onClick, true);
  return () => {
    window.clearTimeout(commitTimer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    container.removeEventListener('pointerdown', onDown);
    container.removeEventListener('wheel', onWheel);
    container.removeEventListener('click', onClick, true);
    container.classList.remove('is-zoomable');
  };
}

function lightYears(v: number): string {
  return `${v.toFixed(2)} light-years`;
}

function systemAriaLabel(id: SystemId, state: MapState): string {
  const parts = labelsOf(id).map((l) =>
    l.distanceLy === null
      ? `${l.name}, origin of the map`
      : `${l.name}, ${lightYears(l.distanceLy)} from Sol, ${formatHeightLong(l.heightLy)}`,
  );
  if (state.currentSystemId === id) parts.push('you are here');
  if (state.objectiveSystemId === id) parts.push('objective');
  if (state.visited.has(id) && state.currentSystemId !== id) parts.push('visited');
  return parts.join('; ');
}

function labelMeta(l: MapLabel): string {
  return l.distanceLy === null ? 'origin' : `${formatLy(l.distanceLy)} · ${formatHeightShort(l.heightLy)}`;
}

function textWidth(el: SVGTextContentElement, fallbackPx: number): number {
  try {
    const w = el.getComputedTextLength();
    if (w > 0) return w;
  } catch {
    // Not rendered (e.g. detached); fall back to an estimate.
  }
  return (el.textContent ?? '').length * fallbackPx * 0.56;
}

function draw(container: HTMLElement, e: Entry): void {
  const active = document.activeElement;
  const focusId = active instanceof Element && container.contains(active) ? active.getAttribute('data-system-id') : null;
  const W = container.clientWidth;
  const H = container.clientHeight;
  e.width = W;
  e.height = H;
  container.classList.add('map2d-host');

  const svgEl = svg('svg', {
    class: 'map2d-svg',
    width: W,
    height: H,
    viewBox: `0 0 ${Math.max(1, W)} ${Math.max(1, H)}`,
    role: 'group',
    'aria-label': 'Top-down star map. Each star system is a button.',
  });
  const caption = buildLegend('2d', 'figcaption');
  const details = caption.querySelector('details');
  if (details) {
    details.open = e.keyOpen;
    details.addEventListener('toggle', () => (e.keyOpen = details.open));
  }
  container.replaceChildren(h('figure', { class: 'map2d' }, svgEl, caption));
  if (W < 80 || H < 80) return;

  // Fit the stars above the caption (its summary line); the open key may overlay the map.
  const captionTop = caption.getBoundingClientRect().top - container.getBoundingClientRect().top;
  const fitH = Math.max(80, Math.min(H, (details?.open ? H : captionTop) - 6));
  const rotate = W / fitH > 1.15;
  // Frame what the player knows (the first catalogue's systems, and any visited, selected, current or
  // the objective): the far shell beyond spills past the edge, as on the 3D map, and is in the list.
  const st = e.state;
  const frames = (id: SystemId) => !isNewSystem(id) || st.visited.has(id) || id === st.currentSystemId || id === st.objectiveSystemId || id === e.selected;
  // Controls along the top (the full-screen map's Find and Missions) keep the fitted stars below them.
  const inset = Math.min(Math.max(0, e.opts.insetTop ?? 0), fitH / 3);
  const fit = fitProjection2D(W, fitH - inset, rotate, Math.min(56, W * 0.06 + 12), 22, frames);
  fit.cy += inset;
  let proj = fit;
  if (e.view) {
    const [u, v] = planarUV([e.view.x, e.view.y, 0], rotate, [0, 0]);
    proj = { ...fit, scale: fit.scale * e.view.zoom, ou: u, ov: v };
  }
  e.proj = proj;
  const content = svg('g', { class: 'map2d-content' });
  e.content = content;
  svgEl.append(content);
  // Small maps show a second label line (distance, plane height) only for key systems.
  const compact = proj.scale < 26;
  const pt: [number, number] = [0, 0];
  const sol = project2D(proj, [0, 0, 0], [0, 0]);

  // Rings and ring labels (upper right of Sol; dropped later where star labels need the space).
  const rings = svg('g', { class: 'map2d-rings', 'aria-hidden': 'true' });
  const ringLabels: SVGTextElement[] = [];
  for (const r of RING_RADII_LY) {
    const rr = r * proj.scale;
    rings.append(svg('circle', { class: 'map2d-ring', cx: sol[0], cy: sol[1], r: rr }));
    const lx = sol[0] + rr * Math.SQRT1_2 + 3;
    const ly = sol[1] - rr * Math.SQRT1_2 - 3;
    if (lx > 4 && lx < W - 36 && ly > 12 && ly < fitH - 4) {
      const t = svg('text', { class: 'map2d-ring-label', x: lx, y: ly }, `${r} ly`);
      rings.append(t);
      ringLabels.push(t);
    }
  }
  content.append(rings);

  // Fictional jump links (dashed) and the selected route.
  const anchors = new Map<SystemId, [number, number]>();
  for (const s of MAP_SYSTEMS) anchors.set(s.id, project2D(proj, s.positionLy, [0, 0]));
  const links = svg('g', { class: 'map2d-links', 'aria-hidden': 'true' });
  for (const l of MAP_LINKS) {
    const a = anchors.get(l.a)!;
    const b = anchors.get(l.b)!;
    links.append(svg('line', { class: 'map2d-link', x1: a[0], y1: a[1], x2: b[0], y2: b[1] }));
  }
  content.append(links);
  const selected = e.selected;
  if (selected && selected !== e.state.currentSystemId) {
    const route = findRoute(MAP_SYSTEMS, e.state.currentSystemId, selected, { canTake: laneTaker(e.state.jumpReach ?? 0) });
    if (route && route.path.length > 1) {
      const points = route.path.map((id) => anchors.get(id)!.join(',')).join(' ');
      content.append(
        svg('polyline', { class: 'map2d-route-glow', points, 'aria-hidden': 'true' }),
        svg('polyline', { class: 'map2d-route', points, 'aria-hidden': 'true' }),
      );
    }
  }

  // Systems as buttons.
  const labelEls: { text: SVGTextElement; name: SVGTSpanElement; meta: SVGTSpanElement; def: MapLabel; box: LabelBox; leader: SVGLineElement | null }[] = [];
  // The far shell first and dimmed, so the systems the player knows are drawn over it.
  const knownOf = (id: SystemId) => !isNewSystem(id) || e.state.visited.has(id);
  const drawOrder = [...MAP_SYSTEMS].sort((a, b) => Number(knownOf(a.id)) - Number(knownOf(b.id)));
  for (const s of drawOrder) {
    const id = s.id;
    const [ax, ay] = anchors.get(id)!;
    const isSel = selected === id;
    const isCur = e.state.currentSystemId === id;
    const isObj = e.state.objectiveSystemId === id;
    const isVis = e.state.visited.has(id) && !isCur;
    const far = !knownOf(id) && !isSel && !isCur && !isObj;
    const g = svg('g', {
      class: `map2d-sys${isSel ? ' is-selected' : ''}${isCur ? ' is-current' : ''}${isObj ? ' is-objective' : ''}${far ? ' is-far' : ''}`,
      role: 'button',
      tabindex: 0,
      'aria-pressed': isSel ? 'true' : 'false',
      'aria-label': systemAriaLabel(id, e.state),
      'data-system-id': id,
    });
    g.append(
      svg('circle', { class: 'map2d-hit', cx: ax, cy: ay, r: HIT_RADIUS }),
      svg('circle', { class: 'map2d-focus', cx: ax, cy: ay, r: 17 }),
    );
    if (isSel) g.append(svg('circle', { class: 'map2d-selected', cx: ax, cy: ay, r: 14 }));
    if (isCur) g.append(svg('circle', { class: 'map2d-current', cx: ax, cy: ay, r: 11 }));
    if (isVis) g.append(svg('circle', { class: 'map2d-visited', cx: ax, cy: ay, r: 11 }));
    if (isObj) {
      g.append(svg('path', { class: 'map2d-objective', d: `M${ax} ${ay - 19}L${ax + 19} ${ay}L${ax} ${ay + 19}L${ax - 19} ${ay}Z` }));
    }
    for (const star of MAP_STARS) {
      if (star.systemId !== id) continue;
      project2D(proj, star.eq, pt);
      const r = Math.min(7.5, Math.max(2.4, star.glowPx / 5));
      g.append(
        svg('circle', { class: 'map2d-star-glow', cx: pt[0], cy: pt[1], r: r * 2.3, fill: star.colorHex }),
        svg('circle', { class: 'map2d-star', cx: pt[0], cy: pt[1], r, fill: star.colorHex }),
      );
    }
    for (const def of labelsOf(id)) {
      const name = svg('tspan', { class: 'map2d-label-name' }, def.name);
      const showMeta = !compact || isSel || isCur;
      const meta = svg('tspan', { class: 'map2d-label-meta' }, showMeta ? labelMeta(def) : '');
      const text = svg('text', { class: `map2d-label${def.primary ? '' : ' is-secondary'}` }, name, showMeta ? meta : null);
      const leader = def.primary ? null : svg('line', { class: 'map2d-leader' });
      if (leader) g.append(leader);
      g.append(text);
      const box = createLabelBox();
      project2D(proj, def.eq, pt);
      box.anchorX = pt[0];
      box.anchorY = pt[1];
      box.gap = Math.min(7.5, Math.max(2.4, def.glowPx / 5)) * 1.6 + 5;
      // As on the 3D map: the first catalogue's systems and those you have been to win space over the far shell.
      const known = knownOf(id);
      box.priority = (def.primary ? 50 : 30) + (known ? 8 : 0) + (isSel ? 100 : 0) + (isCur ? 60 : 0) + (isObj ? 40 : 0);
      // Far-shell dots may sit under a label; the known systems' dots keep theirs clear.
      box.anchorBlocks = known || isSel || isCur || isObj;
      box.active = true;
      box.far = !def.primary;
      labelEls.push({ text, name, meta, def, box, leader });
    }
    const activate = () => e.onSelect(id);
    g.addEventListener('click', activate);
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        activate();
      }
    });
    content.append(g);
  }

  // Measure labels, then place them without overlaps (hidden when they cannot fit).
  const sizes: [number, number][] = [];
  for (const l of labelEls) {
    const nameSize = parseFloat(getComputedStyle(l.name).fontSize) || 13;
    const metaSize = parseFloat(getComputedStyle(l.meta).fontSize) || 11;
    sizes.push([nameSize, metaSize]);
    const hasMeta = l.meta.isConnected;
    l.box.width = Math.max(textWidth(l.name, nameSize), hasMeta ? textWidth(l.meta, metaSize) : 0) + 2;
    l.box.height = nameSize * 1.2 + (hasMeta ? metaSize * 1.25 : 0);
  }
  layoutLabels(
    labelEls.map((l) => l.box),
    { x: 4, y: 4, w: W - 8, h: fitH - 6 },
    e.opts.obstacles?.() ?? [],
    [],
    [],
  );
  labelEls.forEach((l, i) => {
    const b = l.box;
    if (!b.visible) {
      l.text.setAttribute('visibility', 'hidden');
      l.leader?.remove();
      return;
    }
    const [nameSize, metaSize] = sizes[i]!;
    l.name.setAttribute('x', String(b.x));
    l.name.setAttribute('y', String(b.y + nameSize * 0.95));
    l.meta.setAttribute('x', String(b.x));
    l.meta.setAttribute('y', String(b.y + nameSize * 1.2 + metaSize * 0.95));
    if (l.leader) {
      // Short leader from a secondary star (e.g. Proxima Centauri) to its label.
      const nx = Math.min(Math.max(b.anchorX, b.x), b.x + b.width);
      const ny = Math.min(Math.max(b.anchorY, b.y), b.y + b.height);
      if (Math.hypot(nx - b.anchorX, ny - b.anchorY) > b.gap - 2) {
        l.leader.setAttribute('x1', String(b.anchorX));
        l.leader.setAttribute('y1', String(b.anchorY));
        l.leader.setAttribute('x2', String(nx));
        l.leader.setAttribute('y2', String(ny));
      } else {
        l.leader.remove();
      }
    }
  });

  for (const t of ringLabels) {
    const x = Number(t.getAttribute('x'));
    const y = Number(t.getAttribute('y'));
    const box = { x, y: y - 11, w: 34, h: 13 };
    if (labelEls.some((l) => l.box.visible && rectsOverlap(l.box.x, l.box.y, l.box.width, l.box.height, box, 2))) t.remove();
  }

  if (focusId) {
    container.querySelector<SVGGElement>(`[data-system-id="${focusId}"]`)?.focus({ preventScroll: true });
  }
}

