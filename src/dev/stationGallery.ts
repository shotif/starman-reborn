/**
 * Dev-only gallery of the generated station exteriors (served by Vite at /dev/stations.html; not
 * part of the production build). One station with orbit controls and live controls, or a grid.
 * Query parameters make captures scriptable:
 *   type=<station type> owner=sta|frontier|hollow-wake|independent seed=<n> size=<0..1> wear=<0..1>
 *   star=<hex, no #> quality=low|medium|high rm=1 (reduced motion) bloom=0|1 panel=0 labels=0 sky=0
 *   grid=1 (every type x owner; with type= and/or owner= only those, seeds=<n> seeds per look)
 *   truescale=1 (grid at true relative size) markers=0|1 (dock point, approach corridor, bounds)
 *   dist=<m> az=<deg> el=<deg> la=<light azimuth deg> lel=<light elevation deg>
 *   t=<seconds to pre-simulate> freeze=1 (stop the clock) spin=1 (turntable)
 * Sets window.__stationsReady once drawn, and window.__stationsInfo with the costs.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createSkybox } from '../world/art/index.ts';
import type { ArtContext, ArtObject, QualityLevel, StationArt } from '../world/art/index.ts';
import {
  DOCK_CORRIDOR,
  MAX_STATION_MESHES,
  STATION_OWNERS,
  STATION_TYPES,
  STATION_TRIANGLE_BUDGET,
  createGeneratedStation,
  nominalStationRadius,
} from '../world/art/stationgen/index.ts';
import type { StationLook, StationOwner, StationType } from '../world/art/stationgen/index.ts';

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number): number => {
  const v = params.get(key);
  const n = v === null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const flag = (key: string, fallback = false): boolean => {
  const v = params.get(key);
  return v === null ? fallback : v === '1' || v === 'true';
};

const quality = (['low', 'medium', 'high'].includes(params.get('quality') ?? '') ? params.get('quality') : 'high') as QualityLevel;
const ctx: ArtContext = { quality, reducedMotion: flag('rm') };
const typeParam = STATION_TYPES.find((t) => t === params.get('type')) ?? null;
const ownerParam = STATION_OWNERS.find((o) => o === params.get('owner')) ?? null;
const gridMode = flag('grid');

const OWNER_NAME: Record<StationOwner, string> = {
  sta: 'Transit Authority',
  frontier: 'Frontier Co-op',
  'hollow-wake': 'Hollow Wake',
  independent: 'Independent',
};
const typeName = (t: StationType): string => t.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

const look: StationLook = {
  type: typeParam ?? 'trade-port',
  owner: ownerParam ?? 'sta',
  seed: Math.round(num('seed', 1)),
  starColor: `#${(params.get('star') ?? 'fff3e2').replace(/^#/, '')}`,
  size: THREE.MathUtils.clamp(num('size', 0.5), 0, 1),
  wear: THREE.MathUtils.clamp(num('wear', 0.2), 0, 1),
};

/* ---------------------------------------------------------------------------------------------- */
/* Renderer and scene.                                                                             */
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
// A long lens in the grid, so every station is seen from nearly the same angle.
const camera = new THREE.PerspectiveCamera(gridMode ? 18 : 55, window.innerWidth / window.innerHeight, 0.5, 2_000_000);
scene.add(camera);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

const sunLight = new THREE.DirectionalLight(new THREE.Color(look.starColor), 2.6);
scene.add(sunLight);
scene.add(sunLight.target);
const hemi = new THREE.HemisphereLight(0x9ab8e8, 0x1a1f2c, 0.32);
scene.add(hemi);
function placeSun(azDeg: number, elDeg: number): void {
  const az = THREE.MathUtils.degToRad(azDeg);
  const el = THREE.MathUtils.degToRad(elDeg);
  sunLight.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(1000);
}
placeSun(num('la', -35), num('lel', 35));

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
/* Stations.                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

interface Cost {
  meshes: number;
  lightSets: number;
  lights: number;
  triangles: number;
}

interface Shown {
  look: StationLook;
  art: StationArt;
  holder: THREE.Group;
  markers: THREE.Group | null;
  tag: HTMLElement | null;
  buildMs: number;
  cost: Cost;
}

const shown: Shown[] = [];
let markersOn = flag('markers', !gridMode);

function costOf(o: THREE.Object3D): Cost {
  const c: Cost = { meshes: 0, lightSets: 0, lights: 0, triangles: 0 };
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if ((n as THREE.Points).isPoints) {
      c.lightSets++;
      c.lights += (n as THREE.Points).geometry.attributes.position!.count;
    } else if (m.isMesh) {
      c.meshes++;
      const g = m.geometry;
      const tris = (g.index ? g.index.count : g.attributes.position!.count) / 3;
      c.triangles += tris * ((n as THREE.InstancedMesh).isInstancedMesh ? (n as THREE.InstancedMesh).count : 1);
    }
  });
  return c;
}

function makeMarkers(art: StationArt): THREE.Group {
  const g = new THREE.Group();
  g.name = 'markers';
  const green = 0x44ff88;
  const point = new THREE.Mesh(new THREE.OctahedronGeometry(4), new THREE.MeshBasicMaterial({ color: green, wireframe: true }));
  point.position.copy(art.dockPoint);
  g.add(point);
  const len = DOCK_CORRIDOR.length;
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(DOCK_CORRIDOR.radius, DOCK_CORRIDOR.radius, len, 20, 6, true),
    new THREE.MeshBasicMaterial({ color: green, wireframe: true, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), art.dockApproach);
  tube.position.copy(art.dockPoint).addScaledVector(art.dockApproach, len / 2);
  g.add(tube);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([art.dockPoint, art.dockPoint.clone().addScaledVector(art.dockApproach, len)]),
    new THREE.LineBasicMaterial({ color: green }),
  );
  g.add(line);
  const bound = new THREE.Mesh(
    new THREE.SphereGeometry(art.radius, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0x66aaff, wireframe: true, transparent: true, opacity: 0.07, depthWrite: false }),
  );
  g.add(bound);
  return g;
}

function disposeMarkers(g: THREE.Group): void {
  g.traverse((n) => {
    const m = n as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
  });
  g.removeFromParent();
}

function show(l: StationLook, position: THREE.Vector3, fit: number | null, withTag: boolean): Shown {
  const t0 = performance.now();
  const art = createGeneratedStation(l, ctx);
  const buildMs = performance.now() - t0;
  const holder = new THREE.Group();
  holder.position.copy(position);
  if (fit !== null) holder.scale.setScalar(fit / art.radius);
  holder.add(art.object);
  scene.add(holder);
  let markers: THREE.Group | null = null;
  if (markersOn) {
    markers = makeMarkers(art);
    holder.add(markers);
  }
  let tag: HTMLElement | null = null;
  if (withTag && showLabels) {
    tag = document.createElement('div');
    tag.className = 'tag';
    const b = document.createElement('b');
    b.textContent = typeName(l.type);
    const sub = document.createElement('span');
    sub.textContent = `${OWNER_NAME[l.owner]} · seed ${l.seed} · r ${art.radius}`;
    tag.append(b, document.createElement('br'), sub);
    labelsEl.appendChild(tag);
  }
  const s: Shown = { look: l, art, holder, markers, tag, buildMs, cost: costOf(art.object) };
  shown.push(s);
  return s;
}

function clearShown(): void {
  for (const s of shown.splice(0)) {
    if (s.markers) disposeMarkers(s.markers);
    s.holder.removeFromParent();
    s.art.dispose();
    s.tag?.remove();
  }
}

let target = new THREE.Vector3();
let defaultDist = 600;
let defaultAz = 35;
let defaultEl = 18;

if (gridMode) {
  // Rows and columns: owners x types by default, or the chosen type / owner with several seeds.
  const seeds = Math.max(1, Math.round(num('seeds', typeParam && ownerParam ? 6 : 1)));
  const rows: StationLook[][] = [];
  const base = { starColor: look.starColor, size: look.size, wear: look.wear };
  if (typeParam && ownerParam) {
    const row: StationLook[] = [];
    for (let s = 0; s < seeds; s++) row.push({ ...base, type: typeParam, owner: ownerParam, seed: look.seed + s });
    const cols = Math.ceil(Math.sqrt(seeds * 1.6));
    for (let i = 0; i < row.length; i += cols) rows.push(row.slice(i, i + cols));
  } else if (typeParam) {
    for (let s = 0; s < seeds; s++) rows.push(STATION_OWNERS.map((owner) => ({ ...base, type: typeParam, owner, seed: look.seed + s })));
  } else if (ownerParam) {
    const all = STATION_TYPES.map((type) => ({ ...base, type, owner: ownerParam, seed: look.seed }));
    for (let i = 0; i < all.length; i += 4) rows.push(all.slice(i, i + 4));
  } else {
    for (const owner of STATION_OWNERS) rows.push(STATION_TYPES.map((type) => ({ ...base, type, owner, seed: look.seed })));
  }
  const trueScale = flag('truescale');
  const maxR = Math.max(...rows.flat().map((l) => nominalStationRadius(l.type, l.size)));
  const cellR = trueScale ? maxR : 100;
  const cellX = cellR * 2.25;
  const cellY = cellR * 2.2;
  defaultAz = 35;
  defaultEl = 18;
  const az0 = THREE.MathUtils.degToRad(num('az', defaultAz));
  const el0 = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(num('el', defaultEl), -89, 89));
  // The grid is a wall facing the camera; every station keeps its own orientation.
  const forward = new THREE.Vector3(Math.sin(az0) * Math.cos(el0), Math.sin(el0), Math.cos(az0) * Math.cos(el0)).negate();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward);
  rows.forEach((row, i) => {
    row.forEach((l, j) => {
      const pos = new THREE.Vector3()
        .addScaledVector(right, (j - (row.length - 1) / 2) * cellX)
        .addScaledVector(up, -(i - (rows.length - 1) / 2) * cellY);
      show(l, pos, trueScale ? null : cellR, true);
    });
  });
  const widest = Math.max(...rows.map((r) => r.length));
  const aspect = window.innerWidth / window.innerHeight;
  const halfH = (rows.length * cellY) / 2 + cellY * 0.1;
  const halfW = (widest * cellX) / 2 + cellX * 0.05;
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  defaultDist = Math.max(halfH / tanV, halfW / (tanV * aspect)) * 1.02;
} else {
  const s = show(look, new THREE.Vector3(), null, false);
  defaultDist = s.art.radius * 2.7;
}

function updateTitle(): void {
  titleEl.textContent = '';
  if (gridMode || !showLabels || !shown[0]) return;
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = typeName(look.type);
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = `${OWNER_NAME[look.owner]} · seed ${look.seed} · size ${look.size.toFixed(2)} · wear ${look.wear.toFixed(2)}`;
  titleEl.append(name, sub);
}
updateTitle();

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

/** Rebuilds the single station after a look change (grid views reload instead). */
function rebuild(): void {
  if (gridMode) {
    reloadWith({ type: typeParam ? look.type : null, owner: ownerParam ? look.owner : null, seed: String(look.seed), size: String(look.size), wear: String(look.wear) });
    return;
  }
  clearShown();
  show(look, new THREE.Vector3(), null, false);
  updateTitle();
  setParam('type', look.type);
  setParam('owner', look.owner);
  setParam('seed', String(look.seed));
  setParam('size', look.size.toFixed(2));
  setParam('wear', look.wear.toFixed(2));
}

function label(text: string): HTMLLabelElement {
  const l = document.createElement('label');
  l.textContent = text;
  panel.appendChild(l);
  return l;
}

function button(text: string, on: () => void, parent: HTMLElement = panel): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', on);
  parent.appendChild(b);
  return b;
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

function select(text: string, options: [string, string][], value: string, on: (v: string) => void): HTMLSelectElement {
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
  return sel;
}

function slider(text: string, value: number, on: (v: number) => void): void {
  const l = label(`${text}: ${value.toFixed(2)}`);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.01';
  input.value = String(value);
  input.addEventListener('input', () => {
    l.textContent = `${text}: ${Number(input.value).toFixed(2)}`;
  });
  // Rebuilding is not free: apply when the slider is released.
  input.addEventListener('change', () => on(Number(input.value)));
  panel.appendChild(input);
}

const h1 = document.createElement('h1');
h1.textContent = 'Station exteriors (dev)';
panel.appendChild(h1);

select(
  'View',
  [
    ['single', 'One station'],
    ['grid', 'Grid (types x owners)'],
  ],
  gridMode ? 'grid' : 'single',
  (v) => reloadWith({ grid: v === 'grid' ? '1' : null, dist: null, az: null, el: null }),
);
select('Type', [...(gridMode ? [['', 'all'] as [string, string]] : []), ...STATION_TYPES.map((t) => [t, typeName(t)] as [string, string])], gridMode ? (typeParam ?? '') : look.type, (v) => {
  if (gridMode) return reloadWith({ type: v || null });
  look.type = v as StationType;
  rebuild();
});
select('Owner', [...(gridMode ? [['', 'all'] as [string, string]] : []), ...STATION_OWNERS.map((o) => [o, OWNER_NAME[o]] as [string, string])], gridMode ? (ownerParam ?? '') : look.owner, (v) => {
  if (gridMode) return reloadWith({ owner: v || null });
  look.owner = v as StationOwner;
  rebuild();
});
label('Seed');
const seedRow = document.createElement('div');
seedRow.className = 'row';
const seedInput = document.createElement('input');
seedInput.type = 'number';
seedInput.value = String(look.seed);
seedInput.addEventListener('change', () => {
  look.seed = Math.round(Number(seedInput.value) || 0);
  rebuild();
});
seedRow.appendChild(seedInput);
const stepSeed = (d: number): void => {
  look.seed += d;
  seedInput.value = String(look.seed);
  rebuild();
};
button('◀', () => stepSeed(-1), seedRow);
button('▶', () => stepSeed(1), seedRow);
panel.appendChild(seedRow);
slider('Size', look.size, (v) => {
  look.size = v;
  rebuild();
});
slider('Wear', look.wear, (v) => {
  look.wear = v;
  rebuild();
});
label('Star colour');
const starInput = document.createElement('input');
starInput.type = 'text';
starInput.value = look.starColor;
starInput.addEventListener('change', () => {
  const v = starInput.value.trim();
  if (!/^#?[0-9a-f]{6}$/i.test(v)) return;
  look.starColor = v.startsWith('#') ? v : `#${v}`;
  sunLight.color.set(look.starColor);
  setParam('star', look.starColor.slice(1));
  rebuild();
});
panel.appendChild(starInput);
select(
  'Quality',
  (['low', 'medium', 'high'] as const).map((q) => [q, q] as [string, string]),
  quality,
  (v) => reloadWith({ quality: v }),
);
label(`Light azimuth: ${num('la', -35)}°`);
const la = document.createElement('input');
la.type = 'range';
la.min = '-180';
la.max = '180';
la.step = '1';
la.value = String(num('la', -35));
la.addEventListener('input', () => {
  placeSun(Number(la.value), num('lel', 35));
  setParam('la', la.value);
  (la.previousElementSibling as HTMLElement).textContent = `Light azimuth: ${la.value}°`;
});
panel.appendChild(la);
check('Dock and corridor markers', markersOn, (v) => {
  markersOn = v;
  setParam('markers', v ? '1' : '0');
  for (const s of shown) {
    if (v && !s.markers) {
      s.markers = makeMarkers(s.art);
      s.holder.add(s.markers);
    } else if (!v && s.markers) {
      disposeMarkers(s.markers);
      s.markers = null;
    }
  }
});
let spinning = flag('spin');
check('Turntable', spinning, (v) => {
  spinning = v;
  setParam('spin', v ? '1' : null);
});
check('Labels', showLabels, (v) => reloadWith({ labels: v ? null : '0' }));
check('Bloom', useBloom, (v) => reloadWith({ bloom: v ? '1' : '0' }));
check('Reduced motion', ctx.reducedMotion, (v) => reloadWith({ rm: v ? '1' : null }));

const stats = document.createElement('div');
stats.id = 'stats';
panel.appendChild(stats);

/* ---------------------------------------------------------------------------------------------- */
/* Camera and loop.                                                                                */
/* ---------------------------------------------------------------------------------------------- */

controls.target.copy(target);
controls.maxDistance = defaultDist * 8;
const dist = num('dist', defaultDist);
const az = THREE.MathUtils.degToRad(num('az', defaultAz));
const el = THREE.MathUtils.degToRad(num('el', defaultEl));
camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(target);
camera.lookAt(target);
controls.update();
target = controls.target;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer?.setSize(window.innerWidth, window.innerHeight);
});

const tmp = new THREE.Vector3();
const screenUp = new THREE.Vector3();
function placeTags(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  screenUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  for (const s of shown) {
    if (!s.tag) continue;
    const r = s.art.radius * s.holder.scale.x;
    tmp.copy(s.holder.position).addScaledVector(screenUp, -r * 0.98).project(camera);
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
    if (spinning) s.holder.rotation.y += dt * 0.25;
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
  const info = renderer.info;
  const first = shown[0];
  const worst = shown.reduce((m, s) => Math.max(m, s.cost.triangles), 0);
  const worstMeshes = shown.reduce((m, s) => Math.max(m, s.cost.meshes), 0);
  stats.textContent =
    `${fps.toFixed(0)} fps · ${quality}${ctx.reducedMotion ? ' · rm' : ''} · ${shown.length} station${shown.length > 1 ? 's' : ''}\n` +
    (first && !gridMode
      ? `meshes ${first.cost.meshes}/${MAX_STATION_MESHES} · light sets ${first.cost.lightSets} (${first.cost.lights})\n` +
        `tris ${first.cost.triangles} / ${STATION_TRIANGLE_BUDGET[quality]}\n` +
        `radius ${first.art.radius} (nominal ${nominalStationRadius(first.look.type, first.look.size).toFixed(0)})\n` +
        `dock (${first.art.dockPoint.toArray().map((v) => v.toFixed(0)).join(', ')}) → (${first.art.dockApproach
          .toArray()
          .map((v) => v.toFixed(2))
          .join(', ')})\n` +
        `build ${first.buildMs.toFixed(1)} ms\n`
      : `worst: meshes ${worstMeshes} · tris ${worst}\n`) +
    `frame: calls ${info.render.calls} · tris ${info.render.triangles}`;
  renderedFrames++;
  if (renderedFrames === 3) {
    const w = window as unknown as { __stationsReady: boolean; __stationsInfo: unknown };
    w.__stationsInfo = shown.map((s) => ({
      type: s.look.type,
      owner: s.look.owner,
      seed: s.look.seed,
      radius: s.art.radius,
      buildMs: +s.buildMs.toFixed(1),
      ...s.cost,
    }));
    w.__stationsReady = true;
  }
  requestAnimationFrame(frame);
}
// Debug handle for scripted captures.
(window as unknown as { __stations: unknown }).__stations = { renderer, scene, camera, shown };
requestAnimationFrame(frame);
