import { LOAD_MARKS } from './loadMarks.ts';

/**
 * The device report (Settings): what this phone or computer and its browser tell the game about
 * themselves, in plain text to copy into a message or the test record (docs/TEST_RECORD.md, the
 * real-device checklist). Nothing in it is sent anywhere; it is only shown.
 */

/** The cache the service worker keeps the game in (public/sw.js). */
export const OFFLINE_CACHE = 'starman-reborn-v1';

export interface FrameRateSummary {
  /** Frames per second over the whole flight, pauses left out. */
  average: number;
  /** The slowest whole second of it. */
  slowest: number | null;
  /** How long the flight ran, in seconds. */
  seconds: number;
}

/**
 * Frame rate over one flight: the average, and the slowest second (what a fight feels like).
 * Started again at each launch or jump; paused time and trips to another app are left out.
 */
export class FrameRateLog {
  private seconds = 0;
  private frames = 0;
  private windowTime = 0;
  private windowFrames = 0;
  private slowest = Infinity;

  start(): void {
    this.seconds = 0;
    this.frames = 0;
    this.windowTime = 0;
    this.windowFrames = 0;
    this.slowest = Infinity;
  }

  frame(dt: number): void {
    // A gap of half a second is a pause or another app in front, not a frame.
    if (!(dt > 0) || dt > 0.5) return;
    this.seconds += dt;
    this.frames++;
    this.windowTime += dt;
    this.windowFrames++;
    // (A second of frames can add up to a hair under 1.)
    if (this.windowTime >= 1 - 1e-6) {
      this.slowest = Math.min(this.slowest, this.windowFrames / this.windowTime);
      this.windowTime = 0;
      this.windowFrames = 0;
    }
  }

  /** Null until a second of flight has been drawn. */
  summary(): FrameRateSummary | null {
    if (this.seconds < 1 - 1e-6) return null;
    return { average: this.frames / this.seconds, slowest: Number.isFinite(this.slowest) ? this.slowest : null, seconds: this.seconds };
  }
}

export type OfflineStatus =
  | { kind: 'unsupported' }
  | { kind: 'tests' }
  | { kind: 'insecure' }
  | { kind: 'not-yet' }
  | { kind: 'kept'; kept: number; of: number; missing: readonly string[] };

export interface DeviceFacts {
  build: string;
  taken: Date;
  browser: string;
  screen: { width: number; height: number; ratio: number };
  window: { width: number; height: number };
  /** The part of the window not covered by the on-screen keyboard or browser bars, when known. */
  visible: { width: number; height: number } | null;
  safeArea: { top: number; right: number; bottom: number; left: number };
  input: { touchPoints: number; coarse: boolean; hover: boolean; gamepads: number };
  graphics: { webgl2: boolean; gpu: string; maxTexture: number } | null;
  quality: { setting: string; preset: string; pixelRatio: number; bloom: boolean };
  frameRate: FrameRateSummary | null;
  /**
   * Seconds from opening the page to the loading title and to the title with Play; kilobytes over
   * the network. A service worker hides the sizes of the files it hands the page (`viaWorker`).
   */
  load: { firstScreen: number | null; title: number | null; downloadedKB: number | null; viaWorker: boolean };
  network: { type: string; downlink: number | null } | null;
  offline: OfflineStatus;
  sound: { state: string; muted: boolean };
  textScale: number;
  reducedMotion: boolean;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const secs = (s: number): string => `${s.toFixed(1)} s`;

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

function offlineLine(o: OfflineStatus): string {
  switch (o.kind) {
    case 'unsupported':
      return 'not possible in this browser (no service workers)';
    case 'tests':
      return 'off in test runs';
    case 'insecure':
      return 'needs the site over HTTPS';
    case 'not-yet':
      return 'not kept yet (it starts once the game has loaded)';
    case 'kept':
      return o.kept >= o.of ? `ready: all ${o.of} files kept` : `${o.kept} of ${o.of} files kept so far (not yet: ${o.missing.join(', ')})`;
  }
}

/** The report as plain text, one fact per line. */
export function formatReport(f: DeviceFacts): string {
  const t = f.taken;
  const when = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())} ${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
  const portrait = f.screen.height >= f.screen.width;
  const inputs = [
    f.input.touchPoints > 0 ? `touch (${f.input.touchPoints} point${f.input.touchPoints > 1 ? 's' : ''})` : 'no touch',
    f.input.coarse ? 'finger-sized pointer' : 'fine pointer',
    f.input.hover ? 'hover' : 'no hover',
    f.input.gamepads > 0 ? `${f.input.gamepads} gamepad${f.input.gamepads > 1 ? 's' : ''}` : 'no gamepad',
  ];
  const load = f.load;
  const loadParts = [
    load.firstScreen !== null ? `title showed at ${secs(load.firstScreen)}` : null,
    load.title !== null ? `Play at ${secs(load.title)}` : null,
  ].filter(Boolean);
  const size = load.viaWorker
    ? '; the offline copy handed over the files, so their download size is not known'
    : load.downloadedKB === null
      ? ''
      : load.downloadedKB > 0
        ? `; ${Math.round(load.downloadedKB)} KB downloaded`
        : '; all from the browser’s cache';
  const loadLine = (loadParts.length ? `${loadParts.join(', ')} after opening the page` : 'not measured') + size;
  const fr = f.frameRate;
  return [
    'Starman Reborn device report',
    `Build: ${f.build}`,
    `Taken: ${when} (local time)`,
    `Browser: ${f.browser}`,
    `Screen: ${f.screen.width} × ${f.screen.height} at pixel ratio ${Number(f.screen.ratio.toFixed(2))}, ${portrait ? 'portrait' : 'landscape'}`,
    `Window: ${f.window.width} × ${f.window.height}${f.visible ? `; visible ${f.visible.width} × ${f.visible.height}` : ''}`,
    `Safe areas: top ${f.safeArea.top}, right ${f.safeArea.right}, bottom ${f.safeArea.bottom}, left ${f.safeArea.left}`,
    `Input: ${inputs.join(', ')}`,
    f.graphics
      ? `Graphics: WebGL ${f.graphics.webgl2 ? 2 : 1}, ${f.graphics.gpu}; textures up to ${f.graphics.maxTexture} px`
      : 'Graphics: not available',
    `Quality: ${capital(f.quality.setting)}${f.quality.setting === 'auto' ? ` (now ${capital(f.quality.preset)})` : ''}, pixel ratio ${Number(f.quality.pixelRatio.toFixed(2))}, bloom ${f.quality.bloom ? 'on' : 'off'}`,
    fr
      ? `Frame rate, last flight: ${Math.round(fr.average)} fps on average${fr.slowest !== null ? `, ${Math.round(fr.slowest)} in the slowest second` : ''} (${duration(fr.seconds)})`
      : 'Frame rate, last flight: no flight yet',
    `Load: ${loadLine}`,
    f.network ? `Network: ${f.network.type}${f.network.downlink !== null ? `, about ${f.network.downlink} Mbit/s` : ''}` : 'Network: not reported by this browser',
    `Offline play: ${offlineLine(f.offline)}`,
    `Sound: ${f.sound.state}${f.sound.muted ? ', muted' : ''}`,
    `Text size ${Math.round(f.textScale * 100)}%, reduced motion ${f.reducedMotion ? 'on' : 'off'}`,
  ].join('\n');
}

/** Seconds since the page opened at which a load mark was left, if it was. */
function markAt(name: string): number | null {
  const e = performance.getEntriesByName(name)[0];
  return e ? e.startTime / 1000 : null;
}

/** A build file's name without its content hash: `boot-CCQjQR63.js` is `boot.js`. */
export function shortName(file: string): string {
  const name = file.split('/').pop() ?? file;
  return name.replace(/-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)$/, '$1');
}

/**
 * Kilobytes of this page and its files that came over the network (null where the browser does not
 * say), and whether a service worker handed over the files: then the browser reports them as 0
 * bytes even when the worker downloaded them.
 */
function downloads(): { downloadedKB: number | null; viaWorker: boolean } {
  const entries = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')] as PerformanceResourceTiming[];
  const viaWorker = entries.some((e) => e.entryType === 'resource' && e.workerStart > 0);
  if (viaWorker || !entries.length || entries.every((e) => e.transferSize === undefined)) return { downloadedKB: null, viaWorker };
  return { downloadedKB: entries.reduce((sum, e) => sum + (e.transferSize ?? 0), 0) / 1024, viaWorker };
}

/** The notch and rounded corners the page keeps clear of, in CSS pixels (src/ui/styles/base.css). */
function safeArea(): DeviceFacts['safeArea'] {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const px = (v: string): number => Math.round(parseFloat(v) || 0);
  const out = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
  probe.remove();
  return out;
}

async function offline(): Promise<OfflineStatus> {
  if (!('serviceWorker' in navigator) || typeof caches === 'undefined') return { kind: 'unsupported' };
  if (new URLSearchParams(location.search).has('test')) return { kind: 'tests' };
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return { kind: 'insecure' };
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration || !(await caches.has(OFFLINE_CACHE))) return { kind: 'not-yet' };
    const files = JSON.parse(document.getElementById('offline-files')?.textContent ?? '[]') as string[];
    const cache = await caches.open(OFFLINE_CACHE);
    const missing: string[] = [];
    for (const f of files) if (!(await cache.match(new URL(f, location.href).href))) missing.push(shortName(f));
    return { kind: 'kept', kept: files.length - missing.length, of: files.length, missing };
  } catch {
    return { kind: 'not-yet' };
  }
}

/** What the game itself knows, passed in by the caller. */
export interface GameFacts {
  build: string;
  graphics: DeviceFacts['graphics'];
  quality: DeviceFacts['quality'];
  frameRate: FrameRateSummary | null;
  sound: DeviceFacts['sound'];
  textScale: number;
  reducedMotion: boolean;
}

/** Gathers the report's facts from the browser, adding what the game knows. */
export async function collectDeviceFacts(game: GameFacts): Promise<DeviceFacts> {
  const conn = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } }).connection;
  const vv = window.visualViewport;
  const pads = typeof navigator.getGamepads === 'function' ? [...navigator.getGamepads()].filter(Boolean).length : 0;
  return {
    build: game.build,
    taken: new Date(),
    browser: navigator.userAgent,
    screen: { width: screen.width, height: screen.height, ratio: window.devicePixelRatio || 1 },
    window: { width: window.innerWidth, height: window.innerHeight },
    visible: vv ? { width: Math.round(vv.width), height: Math.round(vv.height) } : null,
    safeArea: safeArea(),
    input: {
      touchPoints: navigator.maxTouchPoints || 0,
      coarse: matchMedia('(pointer: coarse)').matches,
      hover: matchMedia('(hover: hover)').matches,
      gamepads: pads,
    },
    graphics: game.graphics,
    quality: game.quality,
    frameRate: game.frameRate,
    load: { firstScreen: markAt(LOAD_MARKS.firstScreen), title: markAt(LOAD_MARKS.title), ...downloads() },
    network: conn?.effectiveType ? { type: conn.effectiveType, downlink: typeof conn.downlink === 'number' ? conn.downlink : null } : null,
    offline: await offline(),
    sound: game.sound,
    textScale: game.textScale,
    reducedMotion: game.reducedMotion,
  };
}
