import { svg } from '../ui/dom.ts';

/** Extra line icons for the map (same 24x24 stroke style as src/ui/icons.ts). */
const PATHS = {
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  reset: ['M3.5 12a8.5 8.5 0 1 0 2.6-6.1', 'M3 4v5h5'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  chevronUp: ['M6 15l6-6 6 6'],
  chevronDown: ['M6 9l6 6 6-6'],
  plane: ['M3 8l9-5 9 5-9 5z', 'M3 16l9 5 9-5', 'M3 12l9 5 9-5'],
  book: ['M12 6c-2-1.5-5-2-8-1.5v14c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-14c-3-.5-6 0-8 1.5z', 'M12 6v14'],
  search: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z', 'M15.5 15.5L21 21'],
  pinch: ['M8 8L3 3', 'M3 7V3h4', 'M16 16l5 5', 'M21 17v4h-4', 'M12 12h.01'],
} as const;

export type MapIconName = keyof typeof PATHS;

export function mapIcon(name: MapIconName): SVGSVGElement {
  return svg(
    'svg',
    { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    ...PATHS[name].map((d) => svg('path', { d })),
  );
}
