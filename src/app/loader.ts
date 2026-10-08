import { renderLoadingTitle, type LoadingTitle } from '../ui/screens/TitleScreen.ts';
import { BOOT_FILES_ID, downloadAll, parseBootFiles } from './download.ts';
import { LOAD_MARKS } from './loadMarks.ts';
import { detectBackend, type SaveBackend } from './save/backend.ts';
import { applyDocumentSettings, loadSettings, type Settings } from './settings.ts';

/** What the loading title hands the game: storage and settings already read, and the moment to leave. */
export interface Handover {
  backend: SaveBackend;
  settings: Settings;
  /** The game's title is up (or the compatibility screen): the loading title goes. */
  done(): void;
}

/**
 * The first thing on screen: the title, with a bar where Play will be, while the game itself
 * (three.js, the world, the sky and the game code) arrives behind it, and then Sol's real sky
 * (docs/PROCGEN.md §50). True once the game is up.
 */
export async function startGame(): Promise<boolean> {
  const ui = document.getElementById('ui')!;
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const files = parseBootFiles(document.getElementById(BOOT_FILES_ID)?.textContent);
  let latest: number | null = files.length > 0 ? 0 : null;
  let shell: LoadingTitle | null = null;
  let frame = 0;
  // Fetching starts at once; the title appears as soon as the settings say how big its text is.
  const download = downloadAll(files, (fraction) => {
    latest = fraction;
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        shell?.progress(latest);
      });
    }
  });
  // Handled below, once the title is up; this keeps an early failure from being reported as unhandled.
  download.catch(() => undefined);
  const backend = await detectBackend();
  const settings = await loadSettings(backend);
  applyDocumentSettings(settings);
  // The 3D view fades in behind the title once the game has drawn it.
  canvas.classList.add('awaiting-game');
  const layer = document.createElement('div');
  layer.className = 'screen-layer passthrough';
  ui.appendChild(layer);
  shell = renderLoadingTitle(layer, { systemCount: __SYSTEM_COUNT__ });
  shell.progress(latest);
  performance.mark(LOAD_MARKS.firstScreen);

  let boot: typeof import('./boot.ts').boot;
  try {
    await download;
    if (files.length > 0) shell.starting();
    // Sol's real sky (docs/PROCGEN.md §50) is fetched once the game's own files are in, while their
    // code starts up, and put in place before the game starts: nothing in the game reads it as its
    // module loads, and everything after finds the comets, asteroids, moons and spacecraft.
    const sky = Promise.all([import('../data/skyData.ts'), import('../data/sky.ts')]);
    // Marked when in (a failure is handled below, once the game's code is up).
    sky.then(() => performance.mark(LOAD_MARKS.sky), () => undefined);
    ({ boot } = await import('./boot.ts'));
    performance.mark(LOAD_MARKS.code);
    const [{ SKY }, { installSky }] = await sky;
    installSky(SKY);
    shell.starting();
  } catch (err) {
    console.error('Starman Reborn did not finish loading', err);
    shell.failed(() => window.location.reload());
    return false;
  }
  await boot({
    backend,
    settings,
    done: () => {
      layer.remove();
      canvas.classList.remove('awaiting-game');
      performance.mark(LOAD_MARKS.title);
    },
  });
  return true;
}
