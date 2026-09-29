import { SYSTEMS } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { button, setModalRoot, setToastRoot } from '../ui/components.ts';
import { h } from '../ui/dom.ts';
import '../ui/styles/screens.css';
import { applyDocumentSettings, Game } from './Game.ts';
import { detectBackend } from './save/backend.ts';
import { SaveManager } from './save/SaveManager.ts';
import { sanitizeSettings } from './settings.ts';
import { detectWebGL2 } from './webgl.ts';

/** Friendly fallback when WebGL 2 is missing: the 2D star map and the science notes still work. */
async function renderCompat(ui: HTMLElement, reason: string | undefined): Promise<void> {
  const [{ renderStarMap2D }, { openEncyclopedia }] = await Promise.all([
    import('../galaxy/GalaxyMapView.ts'),
    import('../ui/encyclopedia.ts'),
  ]);
  const mapBox = h('div', { class: 'panel panel-pad compat-map', 'data-testid': 'compat-map' });
  const layer = h('div', { class: 'modal-layer' });
  const state = {
    currentSystemId: 'sol' as SystemId,
    visited: new Set<SystemId>(['sol']),
    credits: 0,
    readiness: { canJump: false, reason: 'Flight needs WebGL 2.' },
    objectiveSystemId: null,
    discoveredBodies: new Set<string>(),
    feeCoverage: null,
  };
  const draw = (selected?: SystemId) =>
    renderStarMap2D(mapBox, state, (id) => draw(id), selected);
  ui.append(
    h(
      'section',
      { class: 'screen compat-screen', 'data-testid': 'compat-screen' },
      h(
        'div',
        { class: 'compat-card' },
        h(
          'div',
          { class: 'panel panel-pad stack' },
          h('h1', { style: 'margin:0' }, 'Starman Reborn'),
          h(
            'p',
            null,
            'This browser or device did not provide WebGL 2, which the 3D flight scenes need. You can still explore the 2D map of the real nearby stars and read the science notes.',
          ),
          reason ? h('p', { class: 'muted small' }, `Details: ${reason}`) : null,
          h('p', { class: 'muted small' }, 'Try an up-to-date Chrome, Edge, Firefox or Safari (iOS 15+), and make sure hardware acceleration is enabled.'),
          h('div', { class: 'row wrap' }, button('About the science', { icon: 'source', testId: 'compat-about', onClick: () => openEncyclopedia(layer, { discoveredBodies: new Set(), onClose: () => {} }) })),
        ),
        mapBox,
        h('p', { class: 'muted small' }, `${SYSTEMS.length} systems · star positions and distances from astronomical data; travel and stations are fiction.`),
      ),
    ),
    layer,
  );
  draw();
}

export async function boot(): Promise<void> {
  const ui = document.getElementById('ui')!;
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const saves = new SaveManager(await detectBackend());
  const settings = sanitizeSettings(await saves.loadSettings());
  applyDocumentSettings(settings);
  const support = detectWebGL2();
  if (!support.webgl2) {
    canvas.style.display = 'none';
    const toasts = h('div', { class: 'toasts' });
    ui.appendChild(toasts);
    setToastRoot(toasts);
    setModalRoot(ui);
    await renderCompat(ui, support.reason);
    return;
  }
  const game = new Game(canvas, ui, saves, settings);
  const params = new URLSearchParams(window.location.search);
  if (params.get('test') === '1' || import.meta.env.DEV) {
    (window as unknown as { __starman: ReturnType<Game['testApi']> }).__starman = game.testApi();
  }
  await game.showTitle();
}
