import { svg } from './dom.ts';

/**
 * Filled glyph icons for rails and room buttons (32x32 viewBox). Original drawings: simple
 * silhouettes shaded with a shared vertical gradient (pale steel, or amber when active — see
 * frame.css), with a thin dark outline so they read over any 3D background.
 */

type Part = { d: string; kind?: 'fill' | 'line' | 'dark'; evenodd?: boolean };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A gear outline with a round hole (even-odd). */
function gear(cx: number, cy: number, teeth: number, rOut: number, rIn: number, rHole: number): string {
  const step = (Math.PI * 2) / teeth;
  const pts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    for (const [r, k] of [
      [rIn, -0.3],
      [rOut, -0.16],
      [rOut, 0.16],
      [rIn, 0.3],
    ] as const) {
      pts.push(`${r2(cx + Math.cos(a + k * step) * r)} ${r2(cy + Math.sin(a + k * step) * r)}`);
    }
  }
  const hole = `M${cx - rHole} ${cy}a${rHole} ${rHole} 0 1 0 ${rHole * 2} 0a${rHole} ${rHole} 0 1 0 ${-rHole * 2} 0z`;
  return `M${pts.join('L')}z${hole}`;
}

/** An arrow pointing up from (16, y0), rotated about the centre by `deg`. */
function burstArm(deg: number): string {
  const rad = (deg * Math.PI) / 180;
  const rot = (x: number, y: number) => {
    const dx = x - 16;
    const dy = y - 16;
    return `${r2(16 + dx * Math.cos(rad) - dy * Math.sin(rad))} ${r2(16 + dx * Math.sin(rad) + dy * Math.cos(rad))}`;
  };
  const p = [
    [16, 1.5],
    [21, 8],
    [17.6, 8],
    [17.6, 12.5],
    [14.4, 12.5],
    [14.4, 8],
    [11, 8],
  ] as const;
  return `M${p.map(([x, y]) => rot(x, y)).join('L')}z`;
}

const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0z`;

const GLYPHS = {
  /** Hangar deck: a ship hovering over its landing pad. */
  deck: [
    { d: ellipse(16, 25.2, 12.8, 3.9) },
    { d: ellipse(16, 25.2, 8.2, 2.1), kind: 'dark' },
    { d: 'M16 3.2L22.4 17.2L18.4 15.8L16 19.6L13.6 15.8L9.6 17.2z' },
  ],
  /** Lounge: a glass on a stem. */
  bar: [
    { d: 'M7.5 5h17l-7 9.8v8.9h4.3v3H10.2v-3h4.3v-8.9z' },
    { d: 'M11.2 8.2h9.6l-2.3 3.2h-5z', kind: 'dark' },
  ],
  /** Trader: stacked cargo crates. */
  trader: [
    { d: 'M3.5 16.5h11.6v11H3.5z' },
    { d: 'M16.9 16.5h11.6v11H16.9z' },
    { d: 'M10.2 4.5h11.6v11H10.2z' },
    { d: 'M3.5 20.2h11.6v1.6H3.5zM16.9 20.2h11.6v1.6H16.9zM10.2 8.2h11.6v1.6H10.2z', kind: 'dark' },
  ],
  /** Outfitter: a gear. */
  outfitter: [{ d: gear(16, 16, 9, 13.5, 10.2, 4.4), evenodd: true }],
  /** Shipyard: a ship seen from the side on a cradle. */
  shipyard: [
    { d: 'M2.5 15.5L11 11h9.5l9 4.5l-9 3H8.5z' },
    { d: 'M9 21h14l-2 5.5H11z' },
    { d: 'M12.5 13h5v2h-5z', kind: 'dark' },
  ],
  /** Launch: a ship climbing away, with exhaust streaks. */
  launch: [
    { d: 'M16 2L22.2 16.6L18.4 15.4L16 19.4L13.6 15.4L9.8 16.6z' },
    { d: 'M12 21.5v5.5M16 22.5v7M20 21.5v5.5', kind: 'line' },
  ],
  /** Jobs: a briefcase. */
  jobs: [
    { d: 'M10.8 11.5V6.5h10.4v5h-2.6V9.1h-5.2v2.4z' },
    { d: 'M3.5 11.5h25v15h-25z' },
    { d: 'M3.5 16.8h25v2h-25z', kind: 'dark' },
    { d: 'M14.4 15.3h3.2v5h-3.2z' },
  ],
  /** News: a folded news sheet. */
  news: [
    { d: 'M4.5 5.5h19v21H7.5a3 3 0 0 1-3-3z' },
    { d: 'M23.5 10.5h4v13.5a2 2 0 0 1-4 0z' },
    { d: 'M8 9h12v2.4H8zM8 13.6h12v1.5H8zM8 17h12v1.5H8zM8 20.4h8v1.5H8z', kind: 'dark' },
  ],
  /** Star map: a four-point compass star. */
  map: [
    { d: 'M16 1.8l3.4 10.8L30.2 16l-10.8 3.4L16 30.2l-3.4-10.8L1.8 16l10.8-3.4z' },
    { d: ellipse(16, 16, 2.4, 2.4), kind: 'dark' },
  ],
  /** Journal: an open log book. */
  journal: [
    { d: 'M3 7.5c4.4-2 8.8-1.8 12.2 1.1v18.2c-3.4-2.9-7.8-3.1-12.2-1.1zM28.9 7.5c-4.4-2-8.8-1.8-12.2 1.1v18.2c3.4-2.9 7.8-3.1 12.2-1.1z' },
    { d: 'M6.2 11.5c2.4-.8 4.6-.6 6.3.4v1.4c-1.7-1-3.9-1.2-6.3-.4zM6.2 15.5c2.4-.8 4.6-.6 6.3.4v1.4c-1.7-1-3.9-1.2-6.3-.4zM19.4 11.9c1.7-1 3.9-1.2 6.3-.4v1.4c-2.4-.8-4.6-.6-6.3.4z', kind: 'dark' },
  ],
  /** Science notes: a ringed planet. */
  science: [
    { d: ellipse(16, 16, 7.6, 7.6) },
    { d: 'M2.8 21.6c-1.4-2.6 4.8-7.2 13.2-10.3s15.4-3.4 16.8-.8c.7 1.3-.5 3-3 4.9l-1.7-1.2c1.6-1.2 2.2-2.1 2-2.6-.8-1.5-7.2-.9-13.7 1.6S4.5 19.2 5.3 20.6c.3.5 1.5.8 3.3.7l.3 2.1c-3.1.3-5.4-.2-6.1-1.8z' },
  ],
  /** Menu: three bars. */
  menu: [{ d: 'M5 7h22v3.6H5zM5 14.2h22v3.6H5zM5 21.4h22v3.6H5z' }],
  /** Free flight: arrows bursting outwards. */
  freeflight: [0, 90, 180, 270].map((deg) => ({ d: burstArm(deg) })),
  /** Go to: an arrow heading for a marked target. */
  goto: [
    { d: 'M20.5 5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13zm0 3.2a3.3 3.3 0 1 0 0 6.6a3.3 3.3 0 1 0 0-6.6z', evenodd: true },
    { d: 'M3 29l9.8-9.8-1.8-1.8 7.4-2.1-2.1 7.4-1.8-1.8L4.7 30.7z' },
  ],
  /** Dock: a ship easing into a docking clamp. */
  dock: [
    { d: 'M16 1.8l4.4 8.6h-3v4.8h-2.8v-4.8h-3z' },
    { d: 'M4 17.5h7.5v4h9v-4H28v9.5H4z' },
  ],
  /** Cruise: double chevrons. */
  cruise: [{ d: 'M3.5 7.5h5l8.5 8.5-8.5 8.5h-5l8.5-8.5zM15 7.5h5l8.5 8.5-8.5 8.5h-5l8.5-8.5z' }],
  /** Medical supplies: a crate marked with a cross. */
  medical: [
    { d: 'M4 8.5h24v18H4z' },
    { d: 'M4 11.5h24v1.6H4z', kind: 'dark' },
    { d: 'M14 14.5h4v3h3v4h-3v3h-4v-3h-3v-4h3z', kind: 'dark' },
  ],
  /** Fabricators: a machine block with a tool head. */
  fabricators: [
    { d: 'M5 13.5h22v13H5z' },
    { d: 'M12 4.5h8v4h-2.2v5h-3.6v-5H12z' },
    { d: 'M8.5 17h6v6h-6zM17.5 17h6v2h-6zM17.5 21h6v2h-6z', kind: 'dark' },
  ],
  /** Deuterium: a pressure canister. */
  deuterium: [
    { d: 'M11 7.5h10l2 3v15.5a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V10.5z' },
    { d: 'M13.5 3.5h5v4h-5z' },
    { d: 'M9 14.5h14v2H9zM9 20.5h14v2H9z', kind: 'dark' },
  ],
  /** Guns: a twin-barrel turret. */
  gun: [
    { d: 'M5 20.5h14v6.5H5z' },
    { d: 'M8 14.5h9l3 6H6z' },
    { d: 'M15 15.4l12.5-4.3.8 2.3-12.5 4.3zM16 18.4l12.5-4.3.8 2.3-12.5 4.3z' },
  ],
  /** Shields: a projected shield. */
  shieldgen: [
    { d: 'M16 3l11 4.2v7.3c0 6.8-4.6 11.9-11 14.5-6.4-2.6-11-7.7-11-14.5V7.2z' },
    { d: 'M16 8l6.4 2.5v4.4c0 4-2.7 7.1-6.4 8.7-3.7-1.6-6.4-4.7-6.4-8.7v-4.4z', kind: 'dark' },
  ],
  /** Missiles. */
  missile: [
    { d: 'M24.8 4.2l3 3-2 5-11.8 11.8-6-6L19.8 6.2z' },
    { d: 'M8 18l6 6-2.8.8-4-4zM6.5 21.6l3.9 3.9L5 28.8l-1.8-1.8z' },
  ],
  /** Repair kit: a wrench over a case. */
  repair: [
    { d: 'M4 15.5h24v12H4z' },
    { d: 'M12 11.5h8v4h-2v-2h-4v2h-2z' },
    { d: 'M20.8 3.4a5 5 0 0 0-6 6.4L8.3 16.3l2.9 2.9 6.5-6.5a5 5 0 0 0 6.4-6l-2.9 2.9-2.4-.5-.5-2.4z', kind: 'dark' },
  ],
  /** Cruise engine: body and nozzle with exhaust. */
  engine: [
    { d: 'M3 11h11v10H3z' },
    { d: 'M14 12.5l8-4.5v16l-8-4.5z' },
    { d: 'M23.5 11.5l5.5 4.5-5.5 4.5z' },
    { d: 'M5.5 13.5h6v5h-6z', kind: 'dark' },
  ],
  /** Thruster: a flame. */
  thruster: [
    { d: 'M16 2.5c5 6 9 9.5 9 15.5a9 9 0 0 1-18 0c0-4 2-6.5 4-9 .5 3 1.8 4.6 3.6 5.4C14 10.5 14.5 6.5 16 2.5z' },
    { d: 'M16 16c2 2.2 3.5 3.6 3.5 6a3.5 3.5 0 0 1-7 0c0-2 1.2-3.4 3.5-6z', kind: 'dark' },
  ],
  /** Power plant: a lightning bolt. */
  power: [{ d: 'M18.5 2.5L6.5 18h7.5l-2.5 11.5L25.5 13H18z' }],
  /** Armour: stacked plates with rivets. */
  armor: [
    { d: 'M4 5h24v6.5H4zM4 12.8h24v6.5H4zM4 20.6h24v6.5H4z' },
    { d: 'M6 7.3h2v2H6zM24 7.3h2v2h-2zM6 15.1h2v2H6zM24 15.1h2v2h-2zM6 22.9h2v2H6zM24 22.9h2v2h-2z', kind: 'dark' },
  ],
  /** Cargo pod: a ribbed container. */
  cargopod: [
    { d: 'M5 9h22a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3z' },
    { d: 'M9 9h2v14H9zM15 9h2v14h-2zM21 9h2v14h-2z', kind: 'dark' },
  ],
  /** Scanner: a dish sending signal arcs. */
  scanner: [
    { d: 'M3 14c4 9 13 13 22 11L9 5C5 7 3 10 3 14z' },
    { d: 'M20 3a9 9 0 0 1 9 9h-2.5A6.5 6.5 0 0 0 20 5.5z' },
    { d: 'M20 8a4 4 0 0 1 4 4h-2.4A1.6 1.6 0 0 0 20 10.4z' },
    { d: 'M11.5 21.5l3.5 7.5H8z', kind: 'dark' },
  ],
  /** Tractor beam: a magnet. */
  tractor: [
    { d: 'M6 4h7v12a3 3 0 0 0 6 0V4h7v12a10 10 0 0 1-20 0z' },
    { d: 'M6 4h7v4H6zM19 4h7v4h-7z', kind: 'dark' },
  ],
  /** Information. */
  info: [
    { d: `${ellipse(16, 16, 13, 13)}M14.3 13.5h3.4v10h-3.4zM16 7.2a2.1 2.1 0 1 1 0 4.2a2.1 2.1 0 1 1 0-4.2z`, evenodd: true },
  ],
} satisfies Record<string, Part[]>;

export type GlyphName = keyof typeof GLYPHS;

let defsReady = false;

/** Shared gradients for all glyphs, added to the document once. */
function ensureDefs(): void {
  if (defsReady || typeof document === 'undefined') return;
  defsReady = true;
  const stops = (list: [number, string][]) => list.map(([o, c]) => svg('stop', { offset: String(o), 'stop-color': c }));
  const defs = svg(
    'svg',
    { width: '0', height: '0', 'aria-hidden': 'true', style: 'position:absolute;width:0;height:0;overflow:hidden' },
    svg(
      'defs',
      {},
      svg('linearGradient', { id: 'g-glyph', x1: '0', y1: '0', x2: '0', y2: '1' }, ...stops([[0, '#ffffff'], [0.45, '#d6e6fb'], [1, '#7e9cc6']])),
      svg('linearGradient', { id: 'g-glyph-on', x1: '0', y1: '0', x2: '0', y2: '1' }, ...stops([[0, '#fff7cf'], [0.45, '#ffd84a'], [1, '#d38a0c']])),
    ),
  );
  document.body.appendChild(defs);
}

export function glyph(name: GlyphName, label?: string): SVGSVGElement {
  ensureDefs();
  const parts: Part[] = GLYPHS[name];
  return svg(
    'svg',
    {
      class: 'glyph',
      viewBox: '0 0 32 32',
      'aria-hidden': label ? undefined : 'true',
      role: label ? 'img' : undefined,
      'aria-label': label,
    },
    ...parts.map((p) =>
      svg('path', { d: p.d, class: `g-${p.kind ?? 'fill'}`, 'fill-rule': p.evenodd ? 'evenodd' : undefined }),
    ),
  );
}

export const GLYPH_NAMES = Object.keys(GLYPHS) as GlyphName[];
