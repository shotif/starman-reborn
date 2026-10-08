/**
 * Dev-only harness for the neighborhood map (dev/map.html). Not bundled into the production build.
 *
 * Query parameters:
 *   system=sol            current system            select=alpha-centauri  system to select/focus on open
 *   credits=500           credits                   canJump=0&reason=...   jump readiness
 *   objective=barnard     objective system          visited=sol,barnard    visited systems
 *   discovered=proxima-cen-b,...                    coverage=sirius        contract covers fees to a system
 *   nowebgl=1             2D fallback only          mode=2d                start in the 2D view (via its toggle)
 *   textScale=1.5         --text-scale              reduced=1              reduced motion
 *   encyclopedia=1        open the standalone encyclopedia on load (map closed)
 */
// Sol's real sky, installed at once (docs/PROCGEN.md §50): the game fetches it behind the loading title.
import '../data/skyNow.ts';
import '../ui/styles/base.css';
import * as THREE from 'three';
import { detectWebGL2 } from '../app/webgl.ts';
import { SYSTEM_IDS } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { GalaxyMapView } from '../galaxy/GalaxyMapView.ts';
import type { MapState } from '../galaxy/types.ts';
import { button, setModalRoot, setToastRoot, toast } from '../ui/components.ts';
import { h } from '../ui/dom.ts';
import { openEncyclopedia } from '../ui/encyclopedia.ts';

const params = new URLSearchParams(location.search);

function systemParam(name: string): SystemId | null {
  const v = params.get(name);
  return v && (SYSTEM_IDS as readonly string[]).includes(v) ? (v as SystemId) : null;
}

function listParam(name: string): string[] {
  return (params.get(name) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const current = systemParam('system') ?? 'sol';
const coverage = systemParam('coverage');
const state: MapState = {
  currentSystemId: current,
  visited: new Set<SystemId>([current, ...listParam('visited').filter((v): v is SystemId => (SYSTEM_IDS as readonly string[]).includes(v))]),
  credits: Number(params.get('credits') ?? 500),
  readiness:
    params.get('canJump') === '0'
      ? { canJump: false, reason: params.get('reason') ?? 'Launch from the dock before jumping.' }
      : { canJump: true },
  objectiveSystemId: systemParam('objective'),
  discoveredBodies: new Set(listParam('discovered')),
  feeCoverage: coverage ? { systemId: coverage, note: 'Your delivery contract pays this jump.' } : null,
};

const textScale = params.get('textScale');
if (textScale) document.documentElement.style.setProperty('--text-scale', textScale);
const reducedMotion = params.get('reduced') === '1';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;
const toasts = h('div', { class: 'toasts passthrough' });
const modals = h('div', { class: 'passthrough' });
ui.append(toasts, modals);
setToastRoot(toasts);
setModalRoot(modals);

let renderer: THREE.WebGLRenderer | null = null;
const support = detectWebGL2();
if (support.webgl2) {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch (err) {
    console.warn('WebGL renderer failed; using the 2D map.', err);
    renderer = null;
  }
}

const devPanel = h(
  'div',
  { class: 'panel panel-pad stack', style: 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(22rem,90vw)' },
  h('h2', { style: 'margin:0' }, 'Map harness'),
  h('p', { class: 'muted', style: 'margin:0' }, renderer ? 'WebGL 2 renderer active.' : `2D only: ${support.reason ?? 'no renderer'}`),
  button('Open star map', { variant: 'primary', icon: 'map', onClick: () => openMap() }),
  button('About the science', { icon: 'info', onClick: () => openStandaloneEncyclopedia() }),
);
const showDevPanel = (on: boolean) => (devPanel.style.display = on ? '' : 'none');
showDevPanel(false);
ui.append(devPanel);

const view = new GalaxyMapView({
  root: ui,
  renderer,
  reducedMotion,
  callbacks: {
    onJump(route, fee) {
      state.credits -= fee;
      state.currentSystemId = route.to;
      state.visited = new Set([...state.visited, ...route.path]);
      if (state.objectiveSystemId === route.to) state.objectiveSystemId = null;
      toast(`Jumped ${route.path.join(' → ')} for ${fee} cr`, 'good');
      console.info('[harness] onJump', route.path, fee);
      view.update(state);
    },
    onClose() {
      console.info('[harness] onClose');
      view.close();
      showDevPanel(true);
    },
  },
});

function openMap(): void {
  showDevPanel(false);
  view.open(state, systemParam('select') ?? undefined);
  if (params.get('mode') === '2d') {
    document.querySelector<HTMLButtonElement>('.gmap-top [aria-label="2D view"]')?.click();
  }
}

function openStandaloneEncyclopedia(): void {
  showDevPanel(false);
  openEncyclopedia(ui, {
    discoveredBodies: state.discoveredBodies,
    ...(systemParam('select') ? { initialSystemId: systemParam('select')! } : {}),
    onClose: () => showDevPanel(true),
  });
}

function resize(): void {
  const w = window.innerWidth;
  const hgt = window.innerHeight;
  renderer?.setSize(w, hgt, false);
  view.resize(w, hgt);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (view.isOpen) view.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (params.get('encyclopedia') === '1') openStandaloneEncyclopedia();
else openMap();

// Handle for browser automation (dev only).
(window as unknown as { __mapHarness: unknown }).__mapHarness = { view, state, renderer };
