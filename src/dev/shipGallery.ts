/**
 * Dev-only gallery of the generated catalogue ships (served by Vite at /dev/ships.html; not part of
 * the production build). One model at a time with prev/next, or every model in a grid.
 * Query parameters make captures scriptable:
 *   id=<model id> grid=1 (grid of every model) class=<class> maker=<maker> tier=<n> (filters)
 *   matrix=1 (every class with every maker's style at tier=<n>, default Mk II, catalogue or not)
 *   cols=<n> (grid columns when filtered) yaw=<deg> (grid ship heading) spin=1 (turntable)
 *   quality=low|medium|high rm=1 (reduced motion) bloom=0|1 panel=0 (hide UI) labels=0 sky=0
 *   dist=<camera distance> az=<deg> el=<deg> t=<seconds to pre-simulate> freeze=1 (stop the clock)
 *   throttle=<0..1> boost=1 cruise=1 shield=1 markers=1 (muzzles, nozzles, bounding sphere)
 *   compare=1 (the hand-built player ship alongside, for scale)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { getCatalog } from '../content/catalog.ts';
import { RULES } from '../content/rules/index.ts';
import type { ShipModel, Tier } from '../content/types.ts';
import { createPlayerShip, createSkybox } from '../world/art/index.ts';
import type { ArtContext, ArtObject, QualityLevel } from '../world/art/index.ts';
import { createCatalogShipArt, createShipModelArt, shipArtCacheStats } from '../world/art/shipgen/index.ts';
import type { GeneratedShipArt } from '../world/art/shipgen/index.ts';

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number): number => {
  const v = params.get(key);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const flag = (key: string, fallback = false): boolean => {
  const v = params.get(key);
  return v === null ? fallback : v === '1' || v === 'true';
};

const quality = (['low', 'medium', 'high'].includes(params.get('quality') ?? '') ? params.get('quality') : 'high') as QualityLevel;
const ctx: ArtContext = { quality, reducedMotion: flag('rm') };
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/* ---------------------------------------------------------------------------------------------- */
/* What to show: catalogue models (filtered), or the class x maker matrix.                         */
/* ---------------------------------------------------------------------------------------------- */

interface Entry {
  id: string;
  cls: string;
  /** Label: name, then class / maker / mark. */
  title: string;
  sub: string;
  radius: number;
  make(): GeneratedShipArt;
}

const catalog = getCatalog();
const classOrder = RULES.classes.map((c) => c.id as string);
const makerOrder = RULES.makers.map((m) => m.id as string);
const className = (id: string): string => RULES.classes.find((c) => c.id === id)?.name ?? id;
const makerName = (id: string): string => RULES.makers.find((m) => m.id === id)?.name ?? id;

function catalogEntry(s: ShipModel): Entry {
  return {
    id: s.id,
    cls: s.class,
    title: s.name,
    sub: `${className(s.class)} · ${makerName(s.maker)} · Mk ${ROMAN[s.tier]}`,
    radius: s.radius,
    make: () => createCatalogShipArt(s, ctx),
  };
}

/** Every class built in every maker's style (most combinations are not in the catalogue). */
function matrixEntries(tier: Tier): Entry[] {
  const out: Entry[] = [];
  for (const cls of RULES.classes) {
    for (const mk of RULES.makers) {
      const id = `ship.${cls.id}.${tier}.${mk.id}`;
      const opts = { id, shipClass: cls.id, tier, style: mk.style, guns: cls.slots.gun[tier - 1] ?? 2, radius: cls.base.radius };
      out.push({
        id,
        cls: cls.id,
        title: `${mk.short} ${cls.name.toLowerCase()}`,
        sub: `Mk ${ROMAN[tier]}${catalog.shipById.has(id) ? '' : ' · not in catalogue'}`,
        radius: cls.base.radius,
        make: () => createShipModelArt(opts, ctx),
      });
    }
  }
  return out;
}

const allShips = [...catalog.ships].sort(
  (a, b) => classOrder.indexOf(a.class) - classOrder.indexOf(b.class) || makerOrder.indexOf(a.maker) - makerOrder.indexOf(b.maker) || a.tier - b.tier,
);
const fClass = params.get('class');
const fMaker = params.get('maker');
const fTier = num('tier', 0);
const matrixMode = flag('matrix');
const gridMode = flag('grid') || matrixMode;
const filtered = allShips.filter((s) => (!fClass || s.class === fClass) && (!fMaker || s.maker === fMaker) && (!fTier || s.tier === fTier));
const list = filtered.length > 0 ? filtered : allShips;
const current = list.find((s) => s.id === params.get('id')) ?? allShips.find((s) => s.id === params.get('id')) ?? list[0]!;

/* ---------------------------------------------------------------------------------------------- */
/* Renderer and scene (as in the art gallery).                                                     */
/* ---------------------------------------------------------------------------------------------- */

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLElement;
const titleEl = document.getElementById('title') as HTMLElement;
const labelsEl = document.getElementById('labels') as HTMLElement;
if (params.get('panel') === '0') panel.classList.add('hidden');
const showLabels = flag('labels', true);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'low' ? 1 : 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
// A long lens in the grid, so every ship is seen from nearly the same angle.
const camera = new THREE.PerspectiveCamera(gridMode ? 16 : 60, window.innerWidth / window.innerHeight, 0.5, 2_000_000);
scene.add(camera);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

const sunLight = new THREE.DirectionalLight(0xfff3e2, 2.5);
sunLight.position.set(-0.55, 0.45, -0.7).normalize().multiplyScalar(1000);
scene.add(sunLight);
const hemi = new THREE.HemisphereLight(0x8fa3c8, 0x1c1612, 0.3);
scene.add(hemi);

const useBloom = params.has('bloom') ? flag('bloom') : quality === 'high';
let composer: EffectComposer | null = null;
if (useBloom) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.45, 0.85));
  composer.addPass(new OutputPass());
}

const objects: ArtObject[] = [];
if (flag('sky', true)) {
  const sky = createSkybox({ seed: 11, baseColor: '#02050b', nebulaColors: ['#1b5876', '#23827f', '#3a4a9c'], nebulaIntensity: 0.55, starDensity: 1, bandTilt: 0.5 }, ctx);
  scene.add(sky.object);
  objects.push(sky);
}

/* ---------------------------------------------------------------------------------------------- */
/* Ships.                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

interface Shown {
  entry: Entry;
  art: GeneratedShipArt;
  holder: THREE.Group;
  tag: HTMLElement | null;
}

const shown: Shown[] = [];
const yaw = THREE.MathUtils.degToRad(num('yaw', 38));

function addMarkers(art: GeneratedShipArt): void {
  const s = art.radius * 0.025;
  const mark = (p: THREE.Vector3, color: number): void => {
    const o = new THREE.Mesh(new THREE.OctahedronGeometry(s), new THREE.MeshBasicMaterial({ color, wireframe: true }));
    o.position.copy(p);
    art.object.add(o);
  };
  for (const m of art.muzzles) mark(m, 0xff00ff);
  for (const n of art.nozzles) mark(n, 0x00ffff);
  const bound = new THREE.Mesh(
    new THREE.SphereGeometry(art.radius, 24, 12),
    new THREE.MeshBasicMaterial({ color: 0x44ff88, wireframe: true, transparent: true, opacity: 0.15 }),
  );
  art.object.add(bound);
}

function show(entry: Entry, position: THREE.Vector3, heading: number, withTag: boolean): Shown {
  const art = entry.make();
  const holder = new THREE.Group();
  holder.position.copy(position);
  holder.rotation.y = heading;
  holder.add(art.object);
  scene.add(holder);
  art.setThrottle(num('throttle', 0.7));
  art.setBoost(flag('boost'));
  art.setCruise(flag('cruise'));
  if (flag('shield')) art.flashShield(1);
  if (flag('markers')) addMarkers(art);
  let tag: HTMLElement | null = null;
  if (withTag && showLabels) {
    tag = document.createElement('div');
    tag.className = 'tag';
    const b = document.createElement('b');
    b.textContent = entry.title;
    const sub = document.createElement('span');
    // The grid rows are classes already; the maker is in the name.
    sub.textContent = matrixMode ? entry.sub : entry.sub.replace(/ · [^·]+ · /, ' · ');
    tag.append(b, document.createElement('br'), sub);
    labelsEl.appendChild(tag);
  }
  const s: Shown = { entry, art, holder, tag };
  shown.push(s);
  return s;
}

let target = new THREE.Vector3();
let defaultDist = 30;
let defaultAz = 215;
let defaultEl = 16;

if (gridMode) {
  // Rows by class (or fixed columns when filtered), true relative scale.
  const entries = matrixMode ? matrixEntries(Math.max(1, Math.min(5, Math.round(num('tier', 2)))) as Tier) : list.map(catalogEntry);
  const rows: Entry[][] = [];
  if (matrixMode || (!fClass && !fMaker && !fTier)) {
    for (const cls of classOrder) {
      const row = entries.filter((e) => e.cls === cls);
      if (row.length) rows.push(row);
    }
  } else {
    const cols = Math.max(1, Math.round(num('cols', Math.min(5, entries.length))));
    for (let i = 0; i < entries.length; i += cols) rows.push(entries.slice(i, i + cols));
  }
  const cellX = num('cell', Math.max(...entries.map((e) => e.radius)) * 2.3);
  const cellY = cellX * 0.8;
  // The grid is a wall facing the starting camera, so top and rear views work too; the ships keep
  // their own heading.
  defaultAz = 180;
  defaultEl = 24;
  const az0 = THREE.MathUtils.degToRad(num('az', defaultAz));
  const el0 = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(num('el', defaultEl), -89, 89));
  const forward = new THREE.Vector3(Math.sin(az0) * Math.cos(el0), Math.sin(el0), Math.cos(az0) * Math.cos(el0)).negate();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward);
  rows.forEach((row, i) => {
    row.forEach((entry, j) => {
      const pos = new THREE.Vector3()
        .addScaledVector(right, (j - (row.length - 1) / 2) * cellX)
        .addScaledVector(up, -(i - (rows.length - 1) / 2) * cellY);
      show(entry, pos, yaw, true);
    });
  });
  const widest = Math.max(...rows.map((r) => r.length));
  const aspect = window.innerWidth / window.innerHeight;
  const halfH = (rows.length * cellY) / 2 + cellY * 0.2;
  const halfW = (widest * cellX) / 2 + cellX * 0.1;
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  defaultDist = Math.max(halfH / tanV, halfW / (tanV * aspect)) * 1.02;
} else {
  const entry = catalogEntry(current);
  const s = show(entry, new THREE.Vector3(), 0, false);
  defaultDist = s.art.radius * 2.25;
  if (flag('compare')) {
    const kite = createPlayerShip(ctx);
    kite.object.position.set(-s.art.radius * 2.2, 0, 0);
    kite.setThrottle(num('throttle', 0.7));
    scene.add(kite.object);
    objects.push(kite);
    target = new THREE.Vector3(-s.art.radius * 1.1, 0, 0);
    defaultDist *= 1.7;
  }
  if (showLabels) {
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = entry.title;
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = entry.sub;
    const id = document.createElement('div');
    id.className = 'id';
    id.textContent = entry.id;
    titleEl.append(name, sub, id);
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Panel.                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

function setParam(key: string, value: string | null): void {
  const url = new URL(location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  history.replaceState(null, '', url);
}

function reloadWith(changes: Record<string, string | null>): void {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  location.href = url.toString();
}

function goTo(model: ShipModel): void {
  // Camera parameters belong to the previous view.
  reloadWith({ id: model.id, grid: null, matrix: null, dist: null, az: null, el: null });
}

function label(text: string): HTMLLabelElement {
  const l = document.createElement('label');
  l.textContent = text;
  panel.appendChild(l);
  return l;
}

function button(text: string, on: () => void, parent: HTMLElement = panel): void {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', on);
  parent.appendChild(b);
}

function check(text: string, value: boolean, on: (v: boolean) => void): void {
  const row = document.createElement('div');
  row.className = 'row';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.id = `c-${text.replace(/\W+/g, '-')}`;
  input.addEventListener('change', () => on(input.checked));
  const l = document.createElement('label');
  l.htmlFor = input.id;
  l.textContent = text;
  row.append(input, l);
  panel.appendChild(row);
}

function select(text: string, options: [string, string][], value: string, on: (v: string) => void): void {
  label(text);
  const sel = document.createElement('select');
  for (const [v, t] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t;
    sel.appendChild(o);
  }
  sel.value = value;
  sel.addEventListener('change', () => on(sel.value));
  panel.appendChild(sel);
}

const h1 = document.createElement('h1');
h1.textContent = 'Ship models (dev)';
panel.appendChild(h1);

label('Model');
const modelSelect = document.createElement('select');
for (const cls of classOrder) {
  const group = document.createElement('optgroup');
  group.label = className(cls);
  for (const s of allShips.filter((m) => m.class === cls)) {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = `${s.name} (Mk ${ROMAN[s.tier]})`;
    group.appendChild(o);
  }
  modelSelect.appendChild(group);
}
modelSelect.value = current.id;
modelSelect.addEventListener('change', () => goTo(allShips.find((s) => s.id === modelSelect.value)!));
panel.appendChild(modelSelect);

const step = (dir: number): void => {
  const i = list.indexOf(current);
  goTo(list[(i + dir + list.length) % list.length] ?? list[0]!);
};
const nav = document.createElement('div');
nav.className = 'row';
button('◀ Prev', () => step(-1), nav);
button('Next ▶', () => step(1), nav);
panel.appendChild(nav);
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') step(-1);
  if (e.key === 'ArrowRight' || e.key === 'PageDown') step(1);
});
select(
  'View',
  [
    ['single', 'One model'],
    ['grid', 'Catalogue grid'],
    ['matrix', 'Class × maker matrix'],
  ],
  matrixMode ? 'matrix' : gridMode ? 'grid' : 'single',
  (v) => reloadWith({ grid: v === 'grid' ? '1' : null, matrix: v === 'matrix' ? '1' : null, dist: null, az: null, el: null }),
);
select(
  'Class filter',
  [['', 'all'], ...RULES.classes.map((c) => [c.id, c.name] as [string, string])],
  fClass ?? '',
  (v) => reloadWith({ class: v || null, dist: null }),
);
select(
  'Maker filter',
  [['', 'all'], ...RULES.makers.map((m) => [m.id, m.short] as [string, string])],
  fMaker ?? '',
  (v) => reloadWith({ maker: v || null, dist: null }),
);
select(
  'Quality',
  (['low', 'medium', 'high'] as const).map((q) => [q, q] as [string, string]),
  quality,
  (v) => reloadWith({ quality: v }),
);

const throttleLabel = label(`Throttle: ${num('throttle', 0.7).toFixed(2)}`);
const throttle = document.createElement('input');
throttle.type = 'range';
throttle.min = '0';
throttle.max = '1';
throttle.step = '0.01';
throttle.value = String(num('throttle', 0.7));
throttle.addEventListener('input', () => {
  throttleLabel.textContent = `Throttle: ${Number(throttle.value).toFixed(2)}`;
  setParam('throttle', throttle.value);
  for (const s of shown) s.art.setThrottle(Number(throttle.value));
});
panel.appendChild(throttle);
check('Boost', flag('boost'), (v) => {
  setParam('boost', v ? '1' : null);
  for (const s of shown) s.art.setBoost(v);
});
check('Cruise', flag('cruise'), (v) => {
  setParam('cruise', v ? '1' : null);
  for (const s of shown) s.art.setCruise(v);
});
let spinning = flag('spin');
check('Turntable', spinning, (v) => {
  setParam('spin', v ? '1' : null);
  spinning = v;
});
check('Markers', flag('markers'), (v) => reloadWith({ markers: v ? '1' : null }));
check('Labels', showLabels, (v) => reloadWith({ labels: v ? null : '0' }));
check('Bloom', useBloom, (v) => reloadWith({ bloom: v ? '1' : '0' }));
check('Reduced motion', ctx.reducedMotion, (v) => reloadWith({ rm: v ? '1' : null }));
button('Flash shield', () => {
  for (const s of shown) s.art.flashShield(1);
});

const stats = document.createElement('div');
stats.id = 'stats';
panel.appendChild(stats);

/* ---------------------------------------------------------------------------------------------- */
/* Camera and loop.                                                                                */
/* ---------------------------------------------------------------------------------------------- */

controls.target.copy(target);
controls.maxDistance = defaultDist * 6;
const dist = num('dist', defaultDist);
const az = THREE.MathUtils.degToRad(num('az', defaultAz));
const el = THREE.MathUtils.degToRad(num('el', defaultEl));
camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(target);
camera.lookAt(target);
controls.update();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer?.setSize(window.innerWidth, window.innerHeight);
});

/** Draw calls and triangles of one ship as rendered (visible meshes and point sets). */
function shipCost(o: THREE.Object3D): { calls: number; tris: number } {
  let calls = 0;
  let tris = 0;
  o.traverseVisible((n) => {
    const m = n as THREE.Mesh;
    if (!(m.isMesh || (n as THREE.Points).isPoints) || !m.geometry) return;
    calls++;
    if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3;
  });
  return { calls, tris };
}

const tmp = new THREE.Vector3();
const screenUp = new THREE.Vector3();
function placeTags(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  screenUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  for (const s of shown) {
    if (!s.tag) continue;
    tmp.copy(s.holder.position).addScaledVector(screenUp, -s.art.radius * 0.72).project(camera);
    const visible = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
    s.tag.style.display = visible ? '' : 'none';
    s.tag.style.left = `${((tmp.x + 1) / 2) * w}px`;
    s.tag.style.top = `${((1 - tmp.y) / 2) * h}px`;
  }
}

let time = 0;
const freeze = flag('freeze');
function simulate(dt: number): void {
  time += dt;
  for (const s of shown) {
    if (spinning) s.holder.rotation.y += dt * 0.35;
    s.art.update?.(dt, time, camera);
  }
  for (const o of objects) o.update?.(dt, time, camera);
}

// Deterministic pre-roll for captures.
const preroll = num('t', 0);
const fixed = 1 / 30;
for (let s = 0; s < preroll - 1e-6; s += fixed) simulate(Math.min(fixed, preroll - s));
if (preroll === 0) simulate(0);

let last = performance.now();
let frames = 0;
let fpsAcc = 0;
let fps = 0;
let renderedFrames = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  controls.update();
  simulate(freeze ? 0 : dt);
  if (composer) composer.render();
  else renderer.render(scene, camera);
  placeTags();
  frames++;
  fpsAcc += dt;
  if (fpsAcc > 0.5) {
    fps = frames / fpsAcc;
    frames = 0;
    fpsAcc = 0;
  }
  const first = shown[0]!;
  const cost = shipCost(first.art.object);
  const cache = shipArtCacheStats();
  const info = renderer.info;
  stats.textContent =
    `${fps.toFixed(0)} fps · ${quality}${ctx.reducedMotion ? ' · rm' : ''} · ${shown.length} ship${shown.length > 1 ? 's' : ''}\n` +
    (gridMode
      ? ''
      : `ship: calls ${cost.calls} · tris ${cost.tris}\n` +
        `radius ${first.art.radius.toFixed(1)} · length ${first.art.length.toFixed(1)}\n` +
        `guns ${first.art.muzzles.length} · nozzles ${first.art.nozzles.length}\n`) +
    `frame: calls ${info.render.calls} · tris ${info.render.triangles}\n` +
    `cache: models ${cache.models} · ships ${cache.ships} · geo ${info.memory.geometries}`;
  renderedFrames++;
  if (renderedFrames === 3) {
    const w = window as unknown as { __shipsReady: boolean; __shipsInfo: unknown };
    w.__shipsInfo = gridMode
      ? { ships: shown.length }
      : { id: first.entry.id, calls: cost.calls, tris: cost.tris, radius: +first.art.radius.toFixed(2), length: +first.art.length.toFixed(2) };
    w.__shipsReady = true;
  }
  requestAnimationFrame(frame);
}
// Debug handle for scripted captures.
(window as unknown as { __ships: unknown }).__ships = { renderer, scene, camera, shown };
requestAnimationFrame(frame);
