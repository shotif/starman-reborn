/**
 * Accessible 2D fallback: a top-down SVG projection of the equatorial plane (seen from the north
 * celestial pole) with distance rings, fictional jump links, the selected route and each system as
 * a focusable button. Heights above/below the plane are given in the labels. Used when WebGL 2 is
 * unavailable and as the "2D view" of the map. Re-renders itself when the container resizes.
 */
import '../ui/styles/map.css';
import { SYSTEMS } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { h, svg } from '../ui/dom.ts';
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
  project2D,
  type MapLabel,
} from './mapData.ts';
import { findRoute } from './routing.ts';
import { createLabelBox, layoutLabels, rectsOverlap, type LabelBox } from './screenLayout.ts';
import type { MapState } from './types.ts';

type SelectFn = (id: SystemId) => void;

interface Entry {
  state: MapState;
  onSelect: SelectFn;
  selected: SystemId | null;
  observer: ResizeObserver | null;
  width: number;
  height: number;
  keyOpen: boolean;
}

const entries = new WeakMap<HTMLElement, Entry>();

/** Hit radius (CSS px) around each system: targets of at least 44 px. */
const HIT_RADIUS = 23;

export function renderStarMap2D(
  container: HTMLElement,
  state: MapState,
  onSelect: (id: SystemId) => void,
  selected?: SystemId,
): void {
  let entry = entries.get(container);
  if (!entry) {
    const created: Entry = { state, onSelect, selected: null, observer: null, width: -1, height: -1, keyOpen: false };
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
  draw(container, entry);
}

/** Stops resize tracking and clears the container. */
export function disposeStarMap2D(container: HTMLElement): void {
  entries.get(container)?.observer?.disconnect();
  entries.delete(container);
  container.replaceChildren();
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
  const proj = fitProjection2D(W, fitH, rotate, Math.min(56, W * 0.06 + 12), 22);
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
  svgEl.append(rings);

  // Fictional jump links (dashed) and the selected route.
  const anchors = new Map<SystemId, [number, number]>();
  for (const s of SYSTEMS) anchors.set(s.id, project2D(proj, s.positionLy, [0, 0]));
  const links = svg('g', { class: 'map2d-links', 'aria-hidden': 'true' });
  for (const l of MAP_LINKS) {
    const a = anchors.get(l.a)!;
    const b = anchors.get(l.b)!;
    links.append(svg('line', { class: 'map2d-link', x1: a[0], y1: a[1], x2: b[0], y2: b[1] }));
  }
  svgEl.append(links);
  const selected = e.selected;
  if (selected && selected !== e.state.currentSystemId) {
    const route = findRoute(SYSTEMS, e.state.currentSystemId, selected);
    if (route && route.path.length > 1) {
      const points = route.path.map((id) => anchors.get(id)!.join(',')).join(' ');
      svgEl.append(
        svg('polyline', { class: 'map2d-route-glow', points, 'aria-hidden': 'true' }),
        svg('polyline', { class: 'map2d-route', points, 'aria-hidden': 'true' }),
      );
    }
  }

  // Systems as buttons.
  const labelEls: { text: SVGTextElement; name: SVGTSpanElement; meta: SVGTSpanElement; def: MapLabel; box: LabelBox; leader: SVGLineElement | null }[] = [];
  for (const s of SYSTEMS) {
    const id = s.id;
    const [ax, ay] = anchors.get(id)!;
    const isSel = selected === id;
    const isCur = e.state.currentSystemId === id;
    const isObj = e.state.objectiveSystemId === id;
    const isVis = e.state.visited.has(id) && !isCur;
    const g = svg('g', {
      class: `map2d-sys${isSel ? ' is-selected' : ''}${isCur ? ' is-current' : ''}${isObj ? ' is-objective' : ''}`,
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
      box.priority = (def.primary ? 50 : 30) + (isSel ? 100 : 0) + (isCur ? 60 : 0) + (isObj ? 40 : 0);
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
    svgEl.append(g);
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
    [],
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

