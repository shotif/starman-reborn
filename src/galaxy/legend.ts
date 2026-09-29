/** Map legend shared by the 3D view and the 2D SVG map. */
import { hasProvisionalData } from '../data/systems.ts';
import { dataBadge } from '../ui/components.ts';
import { h, svg } from '../ui/dom.ts';
import { MAP_LEGEND_TEXT } from './mapText.ts';

function swatch(kind: 'link' | 'route' | 'current' | 'objective' | 'visited' | 'drop'): SVGSVGElement {
  const el = svg('svg', { class: `gmap-swatch gmap-swatch-${kind}`, viewBox: '0 0 28 16', 'aria-hidden': 'true' });
  switch (kind) {
    case 'link':
      el.append(svg('line', { x1: 2, y1: 8, x2: 26, y2: 8 }));
      break;
    case 'route':
      el.append(svg('line', { x1: 3, y1: 8, x2: 25, y2: 8 }));
      break;
    case 'current':
    case 'visited':
      el.append(svg('circle', { cx: 14, cy: 8, r: 6 }));
      break;
    case 'objective':
      el.append(svg('path', { d: 'M14 1.5L20.5 8 14 14.5 7.5 8z' }));
      break;
    case 'drop':
      el.append(svg('line', { x1: 14, y1: 1, x2: 14, y2: 13 }), svg('circle', { cx: 14, cy: 13.5, r: 1.8 }));
      break;
  }
  return el;
}

/**
 * Legend with the required disclaimer and a collapsible key.
 * `mode` adjusts the plane/height wording between the 3D view and the top-down 2D map.
 */
export function buildLegend(mode: '3d' | '2d', tag: 'div' | 'figcaption' = 'div'): HTMLElement {
  // The required disclaimer is always visible; it doubles as the toggle for the symbol key.
  const summary = h(
    'summary',
    { class: 'gmap-legend-text' },
    MAP_LEGEND_TEXT,
    hasProvisionalData() ? [' ', dataBadge('provisional')] : null,
    ' ',
    h('span', { class: 'gmap-key-hint' }, 'Key'),
  );
  const list = h(
    'ul',
    { class: 'gmap-key-list' },
    h('li', null, swatch('link'), h('span', null, 'Jump link ', dataBadge('fictional'))),
    h('li', null, swatch('route'), h('span', null, 'Selected route ', dataBadge('fictional'))),
    h('li', null, swatch('current'), h('span', null, 'You are here')),
    h('li', null, swatch('objective'), h('span', null, 'Objective')),
    h('li', null, swatch('visited'), h('span', null, 'Visited')),
    mode === '3d'
      ? h('li', null, swatch('drop'), h('span', null, 'Line down to the celestial equator plane (the grid); rings every 2 ly from Sol'))
      : h('li', null, h('span', null, 'Seen from above the north celestial pole; rings every 2 ly from Sol; labels give height above or below the plane')),
    h('li', null, h('span', null, dataBadge('estimated'), ' Star colours and glow sizes')),
  );
  return h(tag, { class: 'gmap-legend' }, h('details', { class: 'gmap-key' }, summary, list));
}
