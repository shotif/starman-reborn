// Capture harness for the trailer: launches the game in headless Chromium, runs it on a virtual
// clock and writes one image per frame, with a cue sheet of every sound the game asked for.
//
// Nothing here changes committed game code. The capture-only overrides are all in this file:
//   - requestAnimationFrame and performance.now run on a virtual clock (the init script),
//   - the frame governor is held at a fixed scale, so the resolution never drops while frames are
//     stepped, and the 3D canvas is drawn at twice the frame's size while a shot is recorded,
//   - AudioEngine's play/setMusic/setCombatIntensity/setEngine/setAmbience are wrapped to log cues,
//   - injected CSS hides the cursor, the toasts and the title's build label, and the whole
//     interface where a shot asks for that,
//   - `rig` places the game's own camera somewhere other than the chase position.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROMO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = resolve(PROMO, '..');
export const OUT = join(PROMO, 'out');
export const PORT = Number(process.env.PROMO_PORT ?? 5173);
export const BASE = `http://localhost:${PORT}`;
/** The trailer's frame. */
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const FPS = 60;
/**
 * The game's own window, in CSS pixels. At 1280×720 the HUD is drawn half as large again as at
 * 1920×1080, as on a laptop with a scaled display, which keeps it readable in a small store player.
 */
export const LAYOUTS = { hud: { width: 1280, height: 720 }, wide: { width: 1920, height: 1080 } };

/** The browser: PROMO_CHROME, else the newest Chromium Playwright has downloaded, else Chrome itself. */
export function chromePath() {
  if (process.env.PROMO_CHROME) return process.env.PROMO_CHROME;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  const builds = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
  for (const b of builds) {
    for (const rel of ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-linux/chrome', 'chrome-linux64/chrome']) {
      const p = join(cache, b, rel);
      if (existsSync(p)) return p;
    }
  }
  const system = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return existsSync(system) ? system : undefined;
}

/** Whether the capture draws on the machine's GPU (PROMO_GPU=1) or in software, as the game's own browser tests do. */
export const GPU = process.env.PROMO_GPU === '1';

/**
 * WebGL in software (SwiftShader, the flags of playwright.config.ts) unless PROMO_GPU=1.
 * Software is slow, about half a second a frame, but every frame is whole. On an Apple GPU
 * (Chromium 153, Skia Graphite on Metal) a frame takes a tenth of that, and about one in three
 * hundred, more in some scenes, comes out with a tile of the 3D canvas missing: capture.mjs scans
 * for those after every capture (promo/scan.mjs) and fails the shot if it finds one.
 */
function glArgs() {
  if (process.env.PROMO_GL_ARGS !== undefined) return process.env.PROMO_GL_ARGS.split(' ').filter(Boolean);
  if (!GPU) return ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  if (process.platform === 'darwin') return ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'];
  return ['--ignore-gpu-blocklist', '--enable-gpu'];
}

/** Starts the Vite dev server unless one already answers (the module patches need the dev server). */
export async function ensureServer() {
  const up = async () => fetch(`${BASE}/`).then((r) => r.ok).catch(() => false);
  if (await up()) return null;
  const child = spawn(join(REPO, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], { cwd: REPO, stdio: 'ignore', detached: false });
  for (let i = 0; i < 120; i++) {
    if (await up()) return child;
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error(`Vite did not come up on ${BASE}`);
}

/** The virtual clock: once started, time only moves when `__vtStep` is called. */
function virtualClock() {
  // Room for every module the dev server sends, so the capture can find the ones the game loaded.
  performance.setResourceTimingBufferSize?.(8000);
  const realRaf = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  const realCancel = window.cancelAnimationFrame.bind(window);
  const vt = { on: false, now: 0, q: new Map(), id: 1e6 };
  /** Callbacks waiting on the real clock: they move to the virtual one the moment it starts. */
  const waiting = new Map();
  window.__vt = vt;
  performance.now = () => (vt.on ? vt.now : realNow());
  window.requestAnimationFrame = (cb) => {
    if (vt.on) {
      const id = ++vt.id;
      vt.q.set(id, cb);
      return id;
    }
    const id = realRaf((t) => {
      waiting.delete(id);
      cb(t);
    });
    waiting.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    vt.q.delete(id);
    waiting.delete(id);
    realCancel(id);
  };
  window.__vtStart = () => {
    if (vt.on) return;
    vt.now = realNow();
    vt.on = true;
    for (const [id, cb] of waiting) {
      realCancel(id);
      vt.q.set(++vt.id, cb);
    }
    waiting.clear();
  };
  window.__vtStop = () => {
    if (!vt.on) return;
    vt.on = false;
    const cbs = [...vt.q.values()];
    vt.q.clear();
    for (const cb of cbs) window.requestAnimationFrame(cb);
  };
  window.__vtStep = (ms, parts = 1) => {
    for (let i = 0; i < parts; i++) {
      vt.now += ms / parts;
      const cbs = [...vt.q.values()];
      vt.q.clear();
      for (const cb of cbs) cb(vt.now);
    }
    return vt.now;
  };
}

/**
 * A browser on the game's title screen, graphics on High, ready to stage a shot.
 * The page is laid out at the layout's CSS size in a window of exactly 1920×1080 device pixels, and
 * a frame is that window as the compositor draws it. While a shot is recorded the 3D canvas is drawn
 * at twice that, 3840×2160, and the compositor scales it down: the High preset's bloom chain has no
 * multisampling, so this is the trailer's anti-aliasing (PROMO_SUPERSAMPLE=1 for none). While a shot
 * is being staged it is drawn small, so software rendering keeps up with the waits.
 */
export async function open({ layout = 'hud', query = '' } = {}) {
  const css = LAYOUTS[layout];
  const scale = WIDTH / css.width;
  const supersample = Number(process.env.PROMO_SUPERSAMPLE ?? 2);
  // The canvas' size while staging, as a share of the frame's: small in software, where it sets the pace.
  const staging = Number(process.env.PROMO_STAGING ?? (GPU ? 1 : 0.5));
  const server = await ensureServer();
  const extra = (process.env.PROMO_FLAGS ?? '').split(' ').filter(Boolean);
  // The window's own device scale factor makes it 1920×1080 device pixels, so a screenshot is the
  // compositor's frame as it stands, not the page painted again at another scale.
  // Headless Chromium keeps part of the window for a frame nobody sees: the height asked for is
  // corrected until the page itself is the layout's size.
  let pad = Number(process.env.PROMO_WINDOW_PAD ?? 87);
  let browser;
  let context;
  for (let attempt = 0; ; attempt++) {
    browser = await chromium.launch({
      headless: true,
      executablePath: chromePath(),
      args: [...glArgs(), ...extra, `--force-device-scale-factor=${scale}`, `--window-size=${css.width},${css.height + pad}`, '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--force-color-profile=srgb'],
    });
    context = await browser.newContext({ viewport: null, colorScheme: 'dark', reducedMotion: 'no-preference' });
    const probe = await context.newPage();
    const size = await pageSize(probe);
    await probe.close();
    if (size.width === css.width && size.height === css.height) break;
    await browser.close();
    if (attempt >= 3 || size.width !== css.width) throw new Error(`The page is ${size.width}×${size.height}, not ${css.width}×${css.height}`);
    pad += css.height - size.height;
  }
  const page = await context.newPage();
  page.cssSize = css;
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.addInitScript(virtualClock);
  await page.goto(`${BASE}/?test=1${query}`);
  await page.evaluate(async () => {
    await new Promise((done) => {
      const req = indexedDB.deleteDatabase('starman-reborn');
      req.onsuccess = req.onerror = req.onblocked = () => done();
    });
    localStorage.clear();
  });
  await page.goto(`${BASE}/?test=1${query}`);
  await page.getByTestId('title-screen').waitFor();
  // High quality, as a player would set it.
  await page.getByTestId('title-settings').click();
  await page.getByTestId('set-quality').selectOption('high');
  await page.getByTestId('sheet-close').click();
  await patch(page, supersample, staging);
  // The quality again, so the renderer takes the pixel ratio the patch allows.
  await page.getByTestId('title-settings').click();
  await page.getByTestId('set-quality').selectOption('medium');
  await page.getByTestId('set-quality').selectOption('high');
  await page.getByTestId('sheet-close').click();
  const cdp = await context.newCDPSession(page);
  const close = async () => {
    await browser.close();
    server?.kill();
  };
  return { browser, context, page, cdp, scale, supersample, css, close };
}

/** The capture-only overrides, made through Vite's dev server (the same module instances the game runs). */
async function patch(page, supersample, staging) {
  await page.evaluate(async ([ss, stage]) => {
    const promo = (window.__promo = { cues: [], chase: null, rig: null, engine: null, logOn: false, sizes: { record: ss, stage }, size: stage });
    // The module instance the game itself runs: after a hot update Vite serves it under a `?t=` address.
    const loaded = (path) => {
      const hit = performance.getEntriesByType('resource').map((r) => new URL(r.name)).filter((u) => u.pathname === path).pop();
      return import(/* @vite-ignore */ hit ? hit.pathname + hit.search : path);
    };
    // The frame governor never lowers the resolution while frames are stepped. Its scale on the
    // preset's pixel ratio is held instead at the size the capture asks for (`promo.size`: the
    // supersampling factor while recording), and High's cap is lifted to allow it.
    const { FrameGovernor, PRESETS } = await loaded('/src/app/frameGovernor.ts');
    PRESETS.high.dprCap = 8;
    FrameGovernor.prototype.record = function () {
      if (this.scale === promo.size) return null;
      this.scale = promo.size;
      return 'scale';
    };
    const reset = FrameGovernor.prototype.reset;
    FrameGovernor.prototype.reset = function (...a) {
      reset.apply(this, a);
      this.scale = promo.size;
    };

    const { AudioEngine } = await loaded('/src/audio/AudioEngine.ts');
    // What is playing now, whether or not a shot is being recorded: a recording begins with it.
    promo.playing = {};
    const log = (cue) => {
      if (cue.kind !== 'sfx') promo.playing[cue.kind] = cue;
      if (promo.logOn) promo.cues.push({ t: performance.now(), ...cue });
    };
    const wrap = (name, describe) => {
      const original = AudioEngine.prototype[name];
      AudioEngine.prototype[name] = function (...args) {
        const cue = describe.call(this, ...args);
        if (cue) log(cue);
        return original.apply(this, args);
      };
    };
    wrap('play', (id, opts) => ({ kind: 'sfx', id, opts: opts ?? {} }));
    wrap('setMusic', function (mood) {
      return mood === this.currentMood ? null : { kind: 'music', mood };
    });
    let intensity = -1;
    wrap('setCombatIntensity', (value) => (value === intensity ? null : { kind: 'intensity', value: (intensity = value) }));
    let engine = '';
    wrap('setEngine', (state) => {
      // Called every frame: only its changes are logged (throttle and speed to two places).
      const s = state ? { throttle: Math.round(state.throttle * 50) / 50, speed: Math.round(state.speed * 50) / 50, boost: state.boost, cruise: state.cruise, lane: state.lane } : null;
      const key = JSON.stringify(s);
      if (key === engine) return null;
      engine = key;
      return { kind: 'engine', state: s };
    });
    let ambience;
    wrap('setAmbience', (room) => (room === ambience ? null : { kind: 'ambience', room: (ambience = room) }));

    // The chase camera in use, and an optional rig: an offset and look-ahead other than the game's.
    const { ChaseCamera } = await loaded('/src/flight/ChaseCamera.ts');
    const update = ChaseCamera.prototype.update;
    ChaseCamera.prototype.update = function (ship, dt, speedFraction) {
      promo.chase = this;
      promo.ship = ship;
      promo.rig?.before?.(this, ship, dt);
      update.call(this, ship, dt, speedFraction);
      promo.rig?.after?.(this, ship, dt);
    };
    const snap = ChaseCamera.prototype.snap;
    ChaseCamera.prototype.snap = function (ship) {
      promo.chase = this;
      promo.ship = ship;
      snap.call(this, ship);
    };

    // The flight under way, for staging: where things are, and the ship put somewhere among them.
    const { FlightSession } = await loaded('/src/world/FlightSession.ts');
    const flightUpdate = FlightSession.prototype.update;
    FlightSession.prototype.update = function (dt, input) {
      promo.flight = this;
      return flightUpdate.call(this, dt, input);
    };
    promo.targets = () => promo.flight.allTargets().map((t) => ({ id: t.id, kind: t.kind, name: t.name, p: t.position.toArray().map((x) => Math.round(x)), r: Math.round(t.radius), d: Math.round(t.position.distanceTo(promo.flight.player.position)) }));
    /** The ship at rest at a point, looking at another (as the game's own placeNear and face hooks leave it). */
    promo.place = (at, lookAt) => {
      const f = promo.flight;
      const p = f.player;
      p.position.set(at[0], at[1], at[2]);
      p.velocity.set(0, 0, 0);
      p.angularVelocity.set(0, 0, 0);
      p.lookAlong(p.position.clone().set(lookAt[0], lookAt[1], lookAt[2]).sub(p.position).normalize());
      f.throttle = 0;
      f.autopilot = { mode: 'none' };
      f.chase.snap(p);
    };
    /**
     * A camera rig: the game's own camera, put somewhere other than the chase position after the
     * chase camera has run. `az` turns it round the ship (0 behind, 90 to starboard, 180 ahead),
     * `el` lifts it, `dist` is metres from the ship, `ahead` and `up` shift the point it looks at
     * along the ship's nose and roof, `roll` in degrees. `from` eases to `to` over `seconds`.
     */
    promo.setRig = (rig) => {
      if (!rig) {
        promo.rig = null;
        return;
      }
      let t = 0;
      const rad = Math.PI / 180;
      const mix = (key, k, fallback) => {
        const a = rig.from?.[key] ?? rig[key] ?? fallback;
        const b = rig.to?.[key] ?? a;
        return a + (b - a) * k;
      };
      promo.rig = {
        after(chase, ship, dt) {
          t += dt;
          const x = Math.max(0, Math.min(1, rig.seconds ? t / rig.seconds : 1));
          const k = rig.linear ? x : x * x * (3 - 2 * x);
          const az = mix('az', k, 0) * rad;
          const el = mix('el', k, 10) * rad;
          const dist = mix('dist', k, 25);
          const cam = chase.camera;
          // The frame: the ship's own (it banks with it), or the world's with the ship's heading.
          const q = rig.frame === 'world' ? (promo.rigQ ??= ship.quaternion.clone()) : ship.quaternion;
          const offset = ship.position.clone().set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist).applyQuaternion(q);
          const target = ship.position.clone().set(mix('side', k, 0), mix('up', k, 0), -mix('ahead', k, 0)).applyQuaternion(q).add(ship.position);
          cam.position.copy(ship.position).add(offset);
          cam.up.set(0, 1, 0).applyQuaternion(q);
          cam.lookAt(target);
          const roll = mix('roll', k, 0) * rad;
          if (roll) cam.rotateZ(roll);
          const fov = mix('fov', k, chase.baseFov);
          if (Math.abs(cam.fov - fov) > 0.01) {
            cam.fov = fov;
            cam.updateProjectionMatrix();
          }
        },
      };
      promo.rigQ = null;
    };

    const style = document.createElement('style');
    style.id = 'promo-style';
    document.head.appendChild(style);
    promo.css = (text) => (style.textContent = text);
  }, [supersample, staging]);
}

/** Calls a `window.__starman` test hook (?test=1). */
export function api(page, fn, arg) {
  return page.evaluate(([f, a]) => window.__starman[f](a), [fn, arg]);
}

export async function waitUntil(page, label, check, timeout = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

export async function press(page, testId) {
  await page.getByTestId(testId).click();
}

/** Injected CSS for a shot. `hud: false` hides the whole interface; toasts are hidden unless `toasts: true`. */
export async function look(page, { hud = true, toasts = false, extra = '' } = {}) {
  const rules = ['.title-build { display: none !important; }', '* { cursor: none !important; }'];
  if (!hud) rules.push('#ui { visibility: hidden !important; }');
  if (!toasts) rules.push('.toasts, .toast { display: none !important; }');
  rules.push(extra);
  await page.evaluate((css) => window.__promo.css(css), rules.join('\n'));
}

/** A rig for the game's own camera (see `promo.setRig` above), or null for the chase camera again. */
export async function rig(page, r) {
  await page.evaluate((x) => window.__promo.setRig(x), r);
}

/** Every target in the flight: id, kind, name, position, radius and distance from the ship. */
export function targets(page) {
  return page.evaluate(() => window.__promo.targets());
}

/** The ship at rest at a point, looking at another. */
export async function place(page, at, lookAt) {
  await page.evaluate(([a, b]) => window.__promo.place(a, b), [at, lookAt]);
}

/** Starts the virtual clock (idempotent). From here the game only moves with `step` or a recorder. */
export async function freeze(page) {
  await page.evaluate(() => window.__vtStart());
}
export async function thaw(page) {
  await page.evaluate(() => window.__vtStop());
}
/** Moves the game on `seconds` without capturing, in steps of `dt` (docked and menu screens draw every other step). */
export async function step(page, seconds, dt = 1 / FPS) {
  const n = Math.round(seconds / dt);
  await page.evaluate(([count, ms]) => {
    for (let i = 0; i < count; i++) window.__vtStep(ms);
  }, [n, dt * 1000]);
}

/**
 * Records a shot: each `frame()` steps the game one frame on the virtual clock and saves it.
 * `halfRate` is for the title and docked screens, which draw every other refresh (Loop.lowPower):
 * the frame's time is stepped in two halves so every saved frame is a drawn one.
 */
export class Recorder {
  constructor(session, name, { fps = FPS, halfRate = false, format = 'png', every = 1 } = {}) {
    // `every` N saves one frame in N (a preview of the shot's motion, for look development).
    this.every = every;
    this.page = session.page;
    this.cdp = session.cdp;
    this.name = name;
    this.fps = fps;
    this.halfRate = halfRate;
    this.format = format;
    this.dir = join(OUT, every > 1 ? 'preview' : 'frames', name);
    this.count = 0;
    this.t0 = 0;
    this.notes = [];
  }

  async start() {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    await freeze(this.page);
    this.t0 = await this.page.evaluate((preview) => {
      const promo = window.__promo;
      // From the next frame on the canvas is drawn at the recording's size (a preview at the frame's own).
      promo.size = preview ? 1 : promo.sizes.record;
      const now = performance.now();
      promo.cues.length = 0;
      for (const cue of Object.values(promo.playing)) promo.cues.push({ t: now, ...cue });
      promo.logOn = true;
      return now;
    }, this.every > 1);
    this.started = Date.now();
    return this;
  }

  /** Seconds of shot recorded so far. */
  get time() {
    return this.count / this.fps;
  }

  /** A note in the cue sheet at the current frame (what the script did: "fire", "boost", …). */
  mark(label) {
    this.notes.push({ frame: this.count, t: this.time, label });
  }

  async frame() {
    await this.page.evaluate(([ms, parts]) => window.__vtStep(ms, parts), [1000 / this.fps, this.halfRate ? 2 : 1]);
    if (this.count % this.every !== 0) {
      this.count++;
      return;
    }
    const params = { format: this.format, optimizeForSpeed: true, captureBeyondViewport: false, fromSurface: true };
    if (this.format === 'jpeg') params.quality = 96;
    const { data } = await this.cdp.send('Page.captureScreenshot', params);
    writeFileSync(join(this.dir, `${String(Math.floor(this.count / this.every)).padStart(5, '0')}.${this.format === 'jpeg' ? 'jpg' : 'png'}`), Buffer.from(data, 'base64'));
    this.count++;
  }

  /** Records `seconds`, calling `each(i, t)` before every frame (input, camera moves). */
  async run(seconds, each) {
    const n = Math.round(seconds * this.fps);
    for (let i = 0; i < n; i++) {
      if (each) await each(i, i / this.fps, n);
      await this.frame();
    }
  }

  async finish(extra = {}) {
    // A cue is stamped with the clock as it stood during the step that drew its frame, which is the
    // end of that frame's sixtieth: a frame earlier is when the frame comes on screen.
    const cues = await this.page.evaluate(([t0, frame]) => {
      window.__promo.logOn = false;
      window.__promo.size = window.__promo.sizes.stage;
      return window.__promo.cues.map((c) => ({ ...c, t: Math.max(0, Math.round(c.t - t0 - frame)) / 1000 }));
    }, [this.t0, 1000 / this.fps]);
    const sheet = { shot: this.name, fps: this.fps, frames: this.count, seconds: this.count / this.fps, clock: 'frame-start', captureSeconds: Math.round((Date.now() - this.started) / 100) / 10, notes: this.notes, ...extra, cues };
    const cueDir = this.every > 1 ? join(OUT, 'preview') : join(PROMO, 'cues');
    mkdirSync(cueDir, { recursive: true });
    writeFileSync(join(cueDir, `${this.name}.json`), JSON.stringify(sheet, null, 1) + '\n');
    console.log(`[${this.name}] ${this.count} frames (${sheet.seconds.toFixed(2)} s) in ${sheet.captureSeconds} s, ${cues.length} cues`);
    return sheet;
  }
}

/** One still at the final framing (look development): `promo/out/stills/<name>.png`. */
export async function still(session, name) {
  const dir = join(OUT, 'stills');
  mkdirSync(dir, { recursive: true });
  // One frame of no time at the recording's size, so the still is drawn as a recorded frame would be.
  await session.page.evaluate(() => {
    const promo = window.__promo;
    promo.size = promo.sizes.record;
    window.__vtStart();
    window.__vtStep(0, 2);
    promo.size = promo.sizes.stage;
  });
  const { data } = await session.cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, captureBeyondViewport: false, fromSurface: true });
  const path = join(dir, `${name}.png`);
  writeFileSync(path, Buffer.from(data, 'base64'));
  return path;
}

// ---------------------------------------------------------------------------------- staging

/** Clicks through whatever is said on docking (story lines, an outpost's people) until nothing more comes. */
export async function hearAll(page) {
  for (let q = 0, i = 0; q < 3 && i < 30; i++) {
    const next = page.getByTestId('story-continue').or(page.getByTestId('folk-continue')).first();
    if (await next.isVisible().catch(() => false)) {
      q = 0;
      await next.click().catch(() => {});
    } else q++;
    await page.waitForTimeout(200);
  }
}

/** A new game past its opening card, the first contract done so the neighbourhood's boards post. */
export async function newGame(page, { lifeline = true } = {}) {
  await press(page, 'title-play');
  await press(page, 'intro-ok');
  if (lifeline) await api(page, 'completeJobs', ['lifeline']);
}

export async function clock(page) {
  return (await api(page, 'state')).clock;
}

export async function dockAt(page, id) {
  await api(page, 'dockAt', id);
  await waitUntil(page, `docked at ${id}`, async () => (await api(page, 'state')).location.dockedAt === id);
  await hearAll(page);
}

/** Puts away a discovery card (a planet first seen pauses the flight). */
export async function putAway(page) {
  for (const id of ['discovery-ok', 'sheet-close']) {
    const el = page.getByTestId(id).last();
    if (await el.isVisible().catch(() => false)) await el.click({ timeout: 2_000 }).catch(() => {});
  }
}

/** Launches from the dock and waits until the ship is the pilot's to fly. */
export async function launch(page) {
  await press(page, 'dock-launch');
  await waitUntil(page, 'undocked', async () => {
    await putAway(page);
    return (await api(page, 'player'))?.autopilot === 'none';
  });
}

/** Jumps straight to a system's arrival point and waits until the ship is the pilot's to fly. */
export async function warp(page, systemId) {
  await api(page, 'warp', systemId);
  await waitUntil(page, `flying in ${systemId}`, async () => {
    await putAway(page);
    return (await api(page, 'mode')) === 'flight' && (await api(page, 'player'))?.autopilot === 'none';
  });
}

/** The page's size in CSS pixels. */
export const pageSize = (page) => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));

export async function centreMouse(page) {
  const v = await pageSize(page);
  await page.mouse.move(v.width / 2, v.height / 2);
}

/** Smoothstep 0..1. */
export const ease = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;
