/**
 * Dev-only art gallery (served by Vite at /dev/art.html; not part of the production build).
 * Query parameters make captures scriptable:
 *   item=<id> quality=low|medium|high rm=1 (reduced motion) panel=0 (hide UI) bloom=0|1
 *   dist=<camera distance> az=<deg> el=<deg> t=<seconds to pre-simulate> freeze=1 (stop the clock)
 *   plus item parameters (throttle, boost, cruise, shield, active, progress, intensity, markers).
 */
import { SPACECRAFT, type CraftLook } from '../content/stellar/spacecraft.ts';
import { createSpacecraft } from '../world/art/spacecraft.ts';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  createAsteroidField,
  createCargoPod,
  createDustRing,
  createExplosion,
  createHaulerShip,
  createImpactSpark,
  createJumpBeacon,
  createJumpTunnel,
  createLaneRing,
  createMissileArt,
  createNavBuoy,
  createPirateShip,
  createPlanet,
  createPlayerShip,
  createProjectileRenderer,
  createSkybox,
  createSpeedStreaks,
  createStar,
  createStation,
} from '../world/art/index.ts';
import type {
  ArtContext,
  ArtObject,
  AsteroidHit,
  PlanetStyle,
  ProjectileKind,
  ProjectileView,
  QualityLevel,
  ShipArt,
  SkyboxOptions,
  StarKind,
  StationKind,
  TransientEffect,
} from '../world/art/index.ts';
import { ROOM_ORDER, STATION_OWNERS, STATION_TYPES, createStationInterior, generateInteriorStyle } from '../world/rooms/index.ts';
import type { RoomView, StationInterior, StationLook, StationOwner, StationType } from '../world/rooms/index.ts';
import { SCENE_DEFS } from '../world/systems/index.ts';
import { CHARACTERS } from '../content/story/arcs.ts';
import type { CharacterId } from '../content/story/types.ts';
import { PORTRAIT_AGES, PORTRAIT_FACTIONS, PORTRAIT_ROLES, STORY_PORTRAITS, portraitElement } from '../ui/portraits.ts';
import type { PortraitLook } from '../ui/portraits.ts';

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

/* ---------------------------------------------------------------------------------------------- */
/* Presets mirroring what the game passes.                                                         */
/* ---------------------------------------------------------------------------------------------- */

const SKIES: Record<string, SkyboxOptions> = {
  sol: { seed: 11, baseColor: '#02050b', nebulaColors: ['#1b5876', '#23827f', '#3a4a9c'], nebulaIntensity: 0.55, starDensity: 1, bandTilt: 0.5 },
  'alpha-centauri': {
    seed: 23,
    baseColor: '#070403',
    nebulaColors: ['#8c5418', '#c28c32', '#6b2b12'],
    nebulaIntensity: 0.6,
    starDensity: 0.9,
    bandTilt: 1.1,
  },
  barnard: { seed: 37, baseColor: '#030102', nebulaColors: ['#5c0e10', '#3a0716'], nebulaIntensity: 0.4, starDensity: 0.45, bandTilt: 0.2, dust: 0.55 },
  sirius: { seed: 41, baseColor: '#02030a', nebulaColors: ['#2f4fbf', '#6a46c4', '#9fd0ff'], nebulaIntensity: 0.6, starDensity: 1.15, bandTilt: 0.8 },
  'epsilon-eridani': {
    seed: 53,
    baseColor: '#050302',
    nebulaColors: ['#6b4128', '#b3663a', '#3b2a1f'],
    nebulaIntensity: 0.65,
    starDensity: 0.8,
    bandTilt: -0.3,
    dust: 0.8,
  },
};

interface StarPreset {
  radius: number;
  color: string;
  kind: StarKind;
  sky: string;
}

const STARS: Record<string, StarPreset> = {
  sun: { radius: 5000, color: '#fff3e2', kind: 'main-sequence', sky: 'sol' },
  'alpha-cen-a': { radius: 5500, color: '#fff3e2', kind: 'main-sequence', sky: 'alpha-centauri' },
  'alpha-cen-b': { radius: 4500, color: '#ffd6a8', kind: 'main-sequence', sky: 'alpha-centauri' },
  proxima: { radius: 900, color: '#ff8f66', kind: 'red-dwarf', sky: 'alpha-centauri' },
  barnard: { radius: 1000, color: '#ff9a6b', kind: 'red-dwarf', sky: 'barnard' },
  'sirius-a': { radius: 7000, color: '#d4e0ff', kind: 'main-sequence', sky: 'sirius' },
  'sirius-b': { radius: 150, color: '#eef2ff', kind: 'white-dwarf', sky: 'sirius' },
  'eps-eri': { radius: 4000, color: '#ffcb94', kind: 'main-sequence', sky: 'epsilon-eridani' },
};

interface PlanetPreset {
  radius: number;
  sky: string;
  light: string;
  tilt?: number;
  rings?: { inner: number; outer: number; color?: string; opacity?: number };
}

const PLANETS: Record<PlanetStyle, PlanetPreset> = {
  mercury: { radius: 500, sky: 'sol', light: '#fff3e2' },
  venus: { radius: 1400, sky: 'sol', light: '#fff3e2' },
  earth: { radius: 1600, sky: 'sol', light: '#fff3e2', tilt: 0.41 },
  moon: { radius: 450, sky: 'sol', light: '#fff3e2' },
  io: { radius: 450, sky: 'sol', light: '#fff3e2' },
  europa: { radius: 400, sky: 'sol', light: '#fff3e2' },
  ganymede: { radius: 650, sky: 'sol', light: '#fff3e2' },
  callisto: { radius: 600, sky: 'sol', light: '#fff3e2' },
  titan: { radius: 640, sky: 'sol', light: '#fff3e2' },
  mars: { radius: 900, sky: 'sol', light: '#fff3e2', tilt: 0.44 },
  jupiter: { radius: 6000, sky: 'sol', light: '#fff3e2', tilt: 0.05 },
  saturn: { radius: 5000, sky: 'sol', light: '#fff3e2', tilt: 0.47, rings: { inner: 6400, outer: 11500, color: '#d8c7a0' } },
  uranus: { radius: 2600, sky: 'sol', light: '#fff3e2', tilt: 1.7 },
  neptune: { radius: 2500, sky: 'sol', light: '#fff3e2', tilt: 0.49 },
  'exo-rocky-warm': { radius: 1300, sky: 'alpha-centauri', light: '#ff8f66' },
  'exo-scorched': { radius: 800, sky: 'barnard', light: '#ff9a6b' },
  'exo-rocky-cold': { radius: 1100, sky: 'sirius', light: '#d4e0ff' },
  'exo-gas-giant': { radius: 5200, sky: 'epsilon-eridani', light: '#ffcb94', tilt: 0.2 },
};

const STATION_KINDS: StationKind[] = ['earth-port', 'mars-depot', 'proxima-outpost', 'barnard-relay', 'sirius-platform', 'eridani-hub'];

/* ---------------------------------------------------------------------------------------------- */
/* Item registry.                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

interface Env {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  panel: HTMLElement;
  add(o: ArtObject, parent?: THREE.Object3D): void;
  slider(label: string, key: string, min: number, max: number, step: number, value: number, on: (v: number) => void): void;
  check(label: string, key: string, value: boolean, on: (v: boolean) => void): void;
  button(label: string, on: () => void): void;
  note(text: string): void;
}

interface Setup {
  /** Camera distance, azimuth/elevation in degrees, orbit target. */
  dist: number;
  az?: number;
  el?: number;
  target?: THREE.Vector3;
  minDist?: number;
  sky?: string | null;
  /** Direction towards the key light (star). */
  lightDir?: THREE.Vector3;
  lightColor?: string;
  tick?(dt: number, t: number): void;
  stats?(): string;
  /** Items that bring their own scene and camera (station interiors) render those instead. */
  scene?: THREE.Scene;
  camera?: THREE.PerspectiveCamera;
  resize?(width: number, height: number): void;
}

interface Item {
  id: string;
  group: string;
  label: string;
  build(env: Env): Setup;
}

const DEFAULT_LIGHT = new THREE.Vector3(-0.55, 0.45, -0.7).normalize();
const PLANET_LIGHT = new THREE.Vector3(-0.5, 0.25, 0.83).normalize();

function markerAt(pos: THREE.Vector3, color: number, size: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(size), new THREE.MeshBasicMaterial({ color, wireframe: true }));
  m.position.copy(pos);
  return m;
}

function shipItem(id: string, label: string, make: (c: ArtContext) => ShipArt, dist: number): Item {
  return {
    id,
    group: 'Ships',
    label,
    build(env) {
      const ship = make(ctx);
      env.add(ship);
      ship.setThrottle(num('throttle', 0.7));
      ship.setBoost(flag('boost'));
      ship.setCruise(flag('cruise'));
      env.slider('Throttle', 'throttle', 0, 1, 0.01, num('throttle', 0.7), (v) => ship.setThrottle(v));
      env.check('Boost', 'boost', flag('boost'), (v) => ship.setBoost(v));
      env.check('Cruise', 'cruise', flag('cruise'), (v) => ship.setCruise(v));
      env.button('Flash shield', () => ship.flashShield(1));
      if (flag('shield')) ship.flashShield(1);
      if (flag('markers')) {
        for (const m of ship.muzzles) ship.object.add(markerAt(m, 0xff00ff, 0.3));
        const bound = new THREE.Mesh(
          new THREE.SphereGeometry(ship.radius, 24, 12),
          new THREE.MeshBasicMaterial({ color: 0x44ff88, wireframe: true, transparent: true, opacity: 0.15 }),
        );
        ship.object.add(bound);
      }
      env.note(`radius ${ship.radius.toFixed(1)} · muzzles ${ship.muzzles.length}`);
      return { dist, az: 215, el: 16, minDist: dist * 0.2 };
    },
  };
}

function stationItem(kind: StationKind): Item {
  return {
    id: `station-${kind}`,
    group: 'Stations',
    label: kind,
    build(env) {
      const st = createStation(kind, ctx);
      env.add(st);
      if (flag('markers')) {
        st.object.add(markerAt(st.dockPoint, 0x00ff66, 4));
        const tip = st.dockPoint.clone().addScaledVector(st.dockApproach, 60);
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([st.dockPoint, tip]),
          new THREE.LineBasicMaterial({ color: 0x00ff66 }),
        );
        st.object.add(line);
        const bound = new THREE.Mesh(
          new THREE.SphereGeometry(st.radius, 32, 16),
          new THREE.MeshBasicMaterial({ color: 0x44ff88, wireframe: true, transparent: true, opacity: 0.08 }),
        );
        st.object.add(bound);
      }
      if (flag('ship')) {
        const ship = createPlayerShip(ctx);
        env.add(ship);
        ship.object.position.copy(st.dockPoint).addScaledVector(st.dockApproach, 40);
        ship.object.lookAt(st.dockPoint.clone().addScaledVector(st.dockApproach, 200));
        ship.setThrottle(0.3);
      }
      env.note(`radius ${st.radius.toFixed(0)} · dock (${st.dockPoint.toArray().map((v) => v.toFixed(0)).join(', ')})`);
      // The Horizon Platform's shield faces local +Z (towards its star).
      const lightDir = kind === 'sirius-platform' ? new THREE.Vector3(0.35, 0.3, 0.88).normalize() : undefined;
      return { dist: st.radius * 2.3, az: 35, el: 18, minDist: 20, lightDir, lightColor: kind === 'sirius-platform' ? '#dde6ff' : undefined };
    },
  };
}

function planetItem(style: PlanetStyle): Item {
  return {
    id: `planet-${style}`,
    group: 'Planets',
    label: style,
    build(env) {
      const p = PLANETS[style];
      const lightDir = PLANET_LIGHT.clone();
      const planet = createPlanet(
        {
          radius: p.radius,
          style,
          seed: num('seed', 1),
          lightPosition: lightDir.clone().multiplyScalar(1e6),
          lightColor: p.light,
          tilt: p.tilt ?? 0,
          rings: p.rings,
          spinSpeed: 0.01,
        },
        ctx,
      );
      env.add(planet);
      env.slider('Light angle', 'la', -180, 180, 1, num('la', 0), (deg) => {
        const d = PLANET_LIGHT.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));
        planet.setLightPosition(d.multiplyScalar(1e6));
      });
      const la = num('la', 0);
      if (la !== 0) {
        planet.setLightPosition(PLANET_LIGHT.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(la)).multiplyScalar(1e6));
      }
      const extent = p.rings ? p.rings.outer : p.radius;
      return { dist: extent * 3.1, az: 20, el: 12, minDist: p.radius * 1.05, sky: p.sky, lightDir, lightColor: p.light };
    },
  };
}

function starItem(id: string): Item {
  return {
    id: `star-${id}`,
    group: 'Stars',
    label: id,
    build(env) {
      const s = STARS[id]!;
      const star = createStar({ radius: s.radius, color: s.color, kind: s.kind, seed: 3 }, ctx);
      env.add(star);
      env.note('Use dist=400000 to check the far glow.');
      return { dist: s.radius * 7, az: 10, el: 5, minDist: s.radius * 1.2, sky: s.sky, lightColor: s.color };
    },
  };
}

function skyItem(id: string): Item {
  return {
    id: `sky-${id}`,
    group: 'Skyboxes',
    label: id,
    build() {
      return { dist: 1, az: 0, el: 0, sky: id };
    },
  };
}


/* Station interiors: item=interior&station=<kind>&view=deck|trader|outfitter|bar&rooms=deck,bar&hotspots=1 */
const INTERIOR_SYSTEMS: Record<StationKind, { system: keyof typeof SCENE_DEFS; star: number; rooms: RoomView[] }> = {
  'earth-port': { system: 'sol', star: 0, rooms: ['deck', 'trader', 'outfitter', 'bar'] },
  'mars-depot': { system: 'sol', star: 0, rooms: ['deck', 'trader', 'outfitter', 'bar'] },
  'proxima-outpost': { system: 'alpha-centauri', star: 2, rooms: ['deck', 'trader', 'outfitter', 'bar'] },
  'barnard-relay': { system: 'barnard', star: 0, rooms: ['deck', 'trader', 'bar'] },
  'sirius-platform': { system: 'sirius', star: 0, rooms: ['deck', 'trader', 'outfitter', 'bar'] },
  'eridani-hub': { system: 'epsilon-eridani', star: 0, rooms: ['deck', 'trader', 'outfitter', 'bar'] },
};

/*
 * Generated interiors: item=interior&gen=1&type=<station type>&owner=sta|frontier|hollow-wake|independent
 * &seed=<n>&size=0..1&wear=0..1&sky=<system id>&star=<hex, no #>. Keys [ and ] step through the
 * types, { and } through the owners.
 */
const GEN_SKIES = Object.keys(SCENE_DEFS) as (keyof typeof SCENE_DEFS)[];

function generatedLook(): { look: StationLook; system: keyof typeof SCENE_DEFS } {
  const typeParam = params.get('type') as StationType | null;
  const type: StationType = typeParam && STATION_TYPES.includes(typeParam) ? typeParam : 'trade-port';
  const ownerParam = params.get('owner') as StationOwner | null;
  const owner: StationOwner = ownerParam && STATION_OWNERS.includes(ownerParam) ? ownerParam : 'sta';
  const seed = Math.floor(num('seed', 1));
  const skyParam = params.get('sky');
  const system = skyParam && skyParam in SCENE_DEFS ? (skyParam as keyof typeof SCENE_DEFS) : GEN_SKIES[Math.abs(seed) % GEN_SKIES.length]!;
  const starParam = params.get('star');
  const starColor = starParam && /^[0-9a-f]{6}$/i.test(starParam) ? `#${starParam}` : SCENE_DEFS[system].stars[0]!.color;
  const unit = (key: string, fallback: number): number => Math.max(0, Math.min(1, num(key, fallback)));
  return { look: { type, owner, seed, starColor, size: unit('size', 0.6), wear: unit('wear', 0.3) }, system };
}

/** Panel controls for generated interiors: type and owner pickers, stepping, seed/size/wear. */
function generatedControls(env: Env, look: StationLook): void {
  const select = (label: string, key: string, values: readonly string[], value: string): void => {
    const l = document.createElement('label');
    l.textContent = label;
    const sel = document.createElement('select');
    for (const v of values) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    }
    sel.value = value;
    sel.addEventListener('change', () => reloadWith(key, sel.value));
    env.panel.append(l, sel);
  };
  const step = (key: 'type' | 'owner', list: readonly string[], current: string, by: number): void => {
    reloadWith(key, list[(list.indexOf(current) + by + list.length) % list.length]!);
  };
  select('Type', 'type', STATION_TYPES, look.type);
  select('Owner', 'owner', STATION_OWNERS, look.owner);
  env.button('◀ Prev type', () => step('type', STATION_TYPES, look.type, -1));
  env.button('Next type ▶', () => step('type', STATION_TYPES, look.type, 1));
  env.button('Next owner', () => step('owner', STATION_OWNERS, look.owner, 1));
  for (const [label, key, min, max, stepSize, value] of [
    ['Seed', 'seed', 0, 99, 1, look.seed],
    ['Size', 'size', 0, 1, 0.05, look.size],
    ['Wear', 'wear', 0, 1, 0.05, look.wear],
  ] as const) {
    const l = document.createElement('label');
    l.textContent = `${label}: ${value}`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(stepSize);
    input.value = String(value);
    input.addEventListener('input', () => (l.textContent = `${label}: ${input.value}`));
    input.addEventListener('change', () => reloadWith(key, input.value));
    env.panel.append(l, input);
  }
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === '[' || e.key === ']') step('type', STATION_TYPES, look.type, e.key === ']' ? 1 : -1);
    if (e.key === '{' || e.key === '}') step('owner', STATION_OWNERS, look.owner, e.key === '}' ? 1 : -1);
  });
}

function interiorItem(): Item {
  return {
    id: 'interior',
    group: 'Interiors',
    label: 'Station interior',
    build(env) {
      const gen = flag('gen');
      const stationParam = params.get('station') as StationKind | null;
      const station: StationKind = stationParam && STATION_KINDS.includes(stationParam) ? stationParam : 'earth-port';
      const preset = INTERIOR_SYSTEMS[station];
      const generated = gen ? generatedLook() : null;
      const def = SCENE_DEFS[generated ? generated.system : preset.system];
      const star = def.stars[Math.min(preset.star, def.stars.length - 1)]!;
      const roomParam = params.get('rooms');
      const rooms = roomParam
        ? (roomParam.split(',').filter((r) => (ROOM_ORDER as string[]).includes(r)) as RoomView[])
        : generated
          ? [...ROOM_ORDER]
          : preset.rooms;
      const t0 = performance.now();
      const interior: StationInterior = generated
        ? createStationInterior(
            { style: generateInteriorStyle(generated.look), skybox: def.skybox, starColor: generated.look.starColor, seed: generated.look.seed, rooms },
            ctx,
          )
        : createStationInterior(
            { station, skybox: def.skybox, starColor: star.color, seed: num('seed', STATION_KINDS.indexOf(station) * 11 + 5), rooms },
            ctx,
          );
      const buildMs = performance.now() - t0;
      const title = generated
        ? `${generated.look.type} · ${generated.look.owner} · seed ${generated.look.seed} · size ${generated.look.size} · wear ${generated.look.wear}`
        : station;
      // bench=1: time more builds now that shared caches (noise, textures, sky mesh) are warm, as
      // they are in the game after flying (each is built and disposed right away).
      let warm = '';
      if (flag('bench') && generated) {
        const times: number[] = [];
        for (const type of STATION_TYPES) {
          const t1 = performance.now();
          const look = { ...generated.look, type };
          const other = createStationInterior({ style: generateInteriorStyle(look), skybox: def.skybox, starColor: look.starColor, seed: look.seed, rooms }, ctx);
          times.push(performance.now() - t1);
          other.dispose();
        }
        warm = `\nwarm builds ${times.map((t) => t.toFixed(0)).join(' / ')} ms`;
        console.log(`[bench] cold ${buildMs.toFixed(0)} ms, warm ${times.map((t) => t.toFixed(0)).join(', ')}`);
      } else if (flag('bench')) {
        const times: number[] = [];
        for (const k of STATION_KINDS) {
          const p = INTERIOR_SYSTEMS[k];
          const d = SCENE_DEFS[p.system];
          const t1 = performance.now();
          const other = createStationInterior({ station: k, skybox: d.skybox, starColor: d.stars[0]!.color, seed: 3, rooms: p.rooms }, ctx);
          times.push(performance.now() - t1);
          other.dispose();
        }
        warm = `\nwarm builds ${times.map((t) => t.toFixed(0)).join(' / ')} ms`;
        console.log(`[bench] cold ${buildMs.toFixed(0)} ms, warm ${times.map((t) => t.toFixed(0)).join(', ')}`);
      }
      interior.resize(window.innerWidth, window.innerHeight);
      const want = params.get('view') as RoomView | null;
      if (want && interior.rooms.includes(want)) interior.setView(want, true);
      // Station picker (hand-built, or generated from a look) and view buttons.
      const l = document.createElement('label');
      l.textContent = 'Station';
      const sel = document.createElement('select');
      for (const k of [...STATION_KINDS, 'generated']) {
        const o = document.createElement('option');
        o.value = k;
        o.textContent = k === 'generated' ? 'generated (type × owner)' : k;
        sel.appendChild(o);
      }
      sel.value = generated ? 'generated' : station;
      sel.addEventListener('change', () => {
        if (sel.value === 'generated') {
          reloadWith('gen', '1');
        } else {
          setParam('gen', null);
          reloadWith('station', sel.value);
        }
      });
      env.panel.append(l, sel);
      if (generated) generatedControls(env, generated.look);
      let lastTransition = '';
      for (const v of interior.rooms) {
        env.button(`View: ${v}`, () => {
          lastTransition = `${interior.view} → ${v}: ${interior.setView(v)}`;
          setParam('view', v);
        });
      }
      // Hotspot overlay (dots with labels) for checking the projection.
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:11px system-ui;color:#fff';
      if (flag('hotspots')) document.body.appendChild(overlay);
      const drawHotspots = (): void => {
        if (!overlay.isConnected) return;
        overlay.replaceChildren(
          ...interior.hotspots().map((h) => {
            const d = document.createElement('div');
            d.style.cssText = `position:absolute;left:${h.x}px;top:${h.y}px;transform:translate(-50%,-50%);padding:1px 5px;border-radius:8px;background:${h.visible ? 'rgba(0,160,255,0.75)' : 'rgba(255,0,0,0.6)'}`;
            d.textContent = `${h.label}`;
            return d;
          }),
        );
      };
      // Debug: cam=x,y,z&look=x,y,z&fov=deg overrides the composed shot (to inspect details).
      const vec = (key: string): THREE.Vector3 | null => {
        const v = params.get(key)?.split(',').map(Number);
        return v && v.length === 3 && v.every(Number.isFinite) ? new THREE.Vector3(v[0], v[1], v[2]) : null;
      };
      const camOverride = vec('cam');
      const lookOverride = vec('look');
      return {
        dist: 1,
        sky: null,
        scene: interior.scene,
        camera: interior.camera,
        tick(dt) {
          interior.update(dt);
          if (camOverride && lookOverride) {
            interior.camera.position.copy(camOverride);
            interior.camera.lookAt(lookOverride);
            interior.camera.fov = num('fov', interior.camera.fov);
            interior.camera.updateProjectionMatrix();
            interior.camera.updateMatrixWorld();
          }
          drawHotspots();
        },
        resize(w, h) {
          interior.resize(w, h);
        },
        stats: () => `${title} · ${interior.view} · build ${buildMs.toFixed(0)} ms${warm}\nrooms ${interior.rooms.join(', ')}${lastTransition ? `\n${lastTransition}` : ''}`,
      };
    },
  };
}

/*
 * Portraits of the people in the bars (src/ui/portraits.ts): item=portraits&seed=<first seed>.
 * The six story characters, then 24 regulars across factions, roles and ages at 96 px, and the
 * same 24 at 56 px to check they still read small. The page is HTML over the (empty) canvas.
 */
const FACTION_SHORT: Record<PortraitLook['faction'], string> = { sta: 'Authority', frontier: 'Frontier', 'hollow-wake': 'Wake', independent: 'Independent' };

/** 24 looks: every faction six times, every role three or four times, every age eight times. */
function regularLooks(): PortraitLook[] {
  return Array.from({ length: 24 }, (_, i) => ({
    faction: PORTRAIT_FACTIONS[i % 4]!,
    role: PORTRAIT_ROLES[(i + Math.floor(i / 4)) % 7]!,
    age: PORTRAIT_AGES[Math.floor(i / 2) % 3]!,
  }));
}

function portraitItem(): Item {
  return {
    id: 'portraits',
    group: 'Portraits',
    label: 'Bar portraits',
    build(env) {
      // Portrait sizes are rem, as in the game (1rem = 16 px at 100% text size); this page uses 13 px.
      document.documentElement.style.fontSize = '16px';
      const layer = document.createElement('div');
      const left = params.get('panel') === '0' ? 16 : 276;
      layer.style.cssText = `position:fixed;inset:0;overflow:auto;background:#04060b;padding:10px 16px 24px ${left}px;box-sizing:border-box`;
      document.body.insertBefore(layer, panel);
      const heading = (text: string): HTMLElement => {
        const el = document.createElement('h2');
        el.textContent = text;
        el.style.cssText = 'font:600 13px/1.2 system-ui;letter-spacing:.06em;text-transform:uppercase;color:#a3b3cb;margin:14px 0 8px';
        return el;
      };
      const grid = (cards: HTMLElement[], gap: number): HTMLElement => {
        const el = document.createElement('div');
        el.style.cssText = `display:flex;flex-wrap:wrap;gap:${gap}px`;
        el.append(...cards);
        return el;
      };
      const card = (seed: number, look: PortraitLook, title: string, sub: string | null, size: 'sm' | 'lg'): HTMLElement => {
        const fig = document.createElement('figure');
        fig.style.cssText = `margin:0;width:${size === 'lg' ? 104 : 56}px;font:11px/1.25 system-ui;color:#7485a0`;
        fig.append(portraitElement(seed, look, { size, label: title }));
        if (sub !== null) {
          const cap = document.createElement('figcaption');
          cap.style.cssText = 'margin-top:4px';
          const name = document.createElement('strong');
          name.style.cssText = 'display:block;color:#e8eef8;font-weight:600';
          name.textContent = title;
          cap.append(name, sub);
          fig.append(cap);
        }
        return fig;
      };
      const draw = (first: number): void => {
        const looks = regularLooks();
        layer.replaceChildren(
          heading('Story characters'),
          grid(
            (Object.keys(STORY_PORTRAITS) as CharacterId[]).map((id) => {
              const p = STORY_PORTRAITS[id];
              return card(p.seed, p.look, CHARACTERS[id].name, `${FACTION_SHORT[p.look.faction]} · ${p.look.role} · ${p.look.age ?? '?'}`, 'lg');
            }),
            12,
          ),
          heading(`Regulars · seeds ${first}–${first + looks.length - 1}`),
          grid(looks.map((look, i) => card(first + i, look, `#${first + i}`, `${FACTION_SHORT[look.faction]} · ${look.role} · ${look.age}`, 'lg')), 12),
          heading('The same at 56 px'),
          grid(looks.map((look, i) => card(first + i, look, `#${first + i}`, null, 'sm')), 10),
        );
      };
      // The frame and sizes come from the game's stylesheets (frame.css, station.css).
      void Promise.all([import('../ui/styles/frame.css'), import('../ui/styles/station.css')]).then(() => draw(Math.floor(num('seed', 1))));
      env.slider('First seed', 'seed', 1, 1000, 1, num('seed', 1), (v) => draw(v));
      env.button('Next 24', () => reloadWith('seed', String(Math.floor(num('seed', 1)) + 24)));
      env.note('Every portrait is a pure function of its seed and look (faction, role, age).');
      return { dist: 1, sky: null };
    },
  };
}

/** Spacecraft in Sol (docs/PROCGEN.md §49.3): each schematic look, drawn at its size in flight. */
function craftItem(look: CraftLook): Item {
  return {
    id: `craft-${look}`,
    group: 'Spacecraft',
    label: `Spacecraft: ${look}`,
    build(env) {
      env.add(createSpacecraft({ look, radius: SPACECRAFT.size, seed: 1301 }, ctx));
      return { dist: SPACECRAFT.size * 4, az: 25, el: 15, minDist: SPACECRAFT.size * 1.5, sky: 'sol', lightDir: DEFAULT_LIGHT };
    },
  };
}

const ITEMS: Item[] = [
  interiorItem(),
  ...(['dish', 'shield', 'sunshield', 'discs', 'wings'] as CraftLook[]).map(craftItem),
  shipItem('ship-player', 'Kite courier (player)', createPlayerShip, 24),
  shipItem('ship-pirate', 'Pirate raider', createPirateShip, 20),
  shipItem('ship-hauler', 'Hauler', createHaulerShip, 70),
  ...STATION_KINDS.map(stationItem),
  ...(Object.keys(PLANETS) as PlanetStyle[]).map(planetItem),
  ...Object.keys(STARS).map(starItem),
  ...Object.keys(SKIES).map(skyItem),
  {
    id: 'asteroids-ring',
    group: 'Asteroids',
    label: 'Asteroid belt (ring)',
    build(env) {
      const field = createAsteroidField(
        { seed: 5, count: 900, shape: 'ring', innerRadius: 1400, outerRadius: 2400, thickness: 160, sizeMin: 3, sizeMax: 38, color: '#8b8076' },
        ctx,
      );
      env.add(field);
      const probe = new THREE.Mesh(new THREE.SphereGeometry(30, 16, 8), new THREE.MeshBasicMaterial({ color: 0x00ffaa, wireframe: true }));
      env.scene.add(probe);
      const hits: AsteroidHit[] = [];
      let n = 0;
      return {
        dist: 900,
        az: 0,
        el: 12,
        target: new THREE.Vector3(0, 0, 1900),
        sky: 'epsilon-eridani',
        lightDir: new THREE.Vector3(-0.5, 0.35, 0.8).normalize(),
        lightColor: '#ffcb94',
        tick(_dt, t) {
          probe.position.set(Math.sin(t * 0.3) * 400, 0, 1900 + Math.cos(t * 0.3) * 300);
          n = field.queryNear(probe.position, 30, hits);
        },
        stats: () => `queryNear hits: ${n}`,
      };
    },
  },
  {
    id: 'asteroids-cluster',
    group: 'Asteroids',
    label: 'Asteroid cluster',
    build(env) {
      const field = createAsteroidField(
        { seed: 9, count: 160, shape: 'cluster', innerRadius: 0, outerRadius: 420, thickness: 0, sizeMin: 4, sizeMax: 30, color: '#7d766f' },
        ctx,
      );
      env.add(field);
      return { dist: 1100, az: 30, el: 20, sky: 'barnard', lightDir: new THREE.Vector3(-0.3, 0.4, 0.85).normalize(), lightColor: '#ff9a6b' };
    },
  },
  {
    id: 'dust-ring',
    group: 'Asteroids',
    label: 'Dust ring',
    build(env) {
      env.add(createDustRing({ innerRadius: 3000, outerRadius: 6200, color: '#c9a27a', opacity: 0.5, seed: 3 }, ctx));
      env.add(
        createAsteroidField(
          { seed: 5, count: 500, shape: 'ring', innerRadius: 3600, outerRadius: 5200, thickness: 200, sizeMin: 6, sizeMax: 50, color: '#8b8076' },
          ctx,
        ),
      );
      return { dist: 11000, az: 0, el: 24, sky: 'epsilon-eridani', lightColor: '#ffcb94' };
    },
  },
  {
    id: 'lane-ring',
    group: 'Structures',
    label: 'Trade-lane ring',
    build(env) {
      const rings = [0, 1, 2].map((i) => {
        const r = createLaneRing(ctx);
        r.object.position.z = -i * 260;
        env.add(r);
        return r;
      });
      const active = flag('active', true);
      for (const r of rings) r.setActive(active);
      env.check('Active', 'active', active, (v) => rings.forEach((r) => r.setActive(v)));
      return { dist: 110, az: 30, el: 12 };
    },
  },
  {
    id: 'jump-beacon',
    group: 'Structures',
    label: 'Jump beacon',
    build(env) {
      env.add(createJumpBeacon(ctx));
      return { dist: 95, az: 25, el: 10, target: new THREE.Vector3(0, 8, 0) };
    },
  },
  {
    id: 'nav-buoy',
    group: 'Structures',
    label: 'Nav buoys',
    build(env) {
      const cols = ['#ffb347', '#4fd8c4', '#ff5f5f'];
      cols.forEach((c, i) => {
        const b = createNavBuoy(c, ctx);
        b.object.position.x = (i - 1) * 14;
        env.add(b);
      });
      return { dist: 38, az: 20, el: 10 };
    },
  },
  {
    id: 'projectiles',
    group: 'Effects',
    label: 'Projectiles',
    build(env) {
      const r = createProjectileRenderer(256, ctx);
      env.add(r);
      const kinds: ProjectileKind[] = ['player-pulse', 'player-pulse-mk2', 'enemy-pulse'];
      const list: ProjectileView[] = [];
      for (let i = 0; i < 60; i++) {
        list.push({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), kind: kinds[i % 3]! });
      }
      return {
        dist: 60,
        az: 60,
        el: 15,
        tick(_dt, t) {
          for (let i = 0; i < list.length; i++) {
            const p = list[i]!;
            const lane = i % 3;
            const phase = (t * 0.9 + (i / list.length) * 3) % 1;
            const dir = lane === 2 ? 1 : -1;
            p.velocity.set(0, 0, 700 * dir);
            p.position.set((lane - 1) * 6, 0, dir * (-120 + phase * 240));
          }
          r.render(list);
        },
      };
    },
  },
  {
    id: 'explosion',
    group: 'Effects',
    label: 'Explosion',
    build(env) {
      const fx: TransientEffect[] = [];
      const spawn = (): void => {
        const e = createExplosion(new THREE.Vector3(0, 0, 0), num('scale', 7), ctx);
        env.scene.add(e.object);
        fx.push(e);
      };
      spawn();
      let next = 2.6;
      env.button('Replay', spawn);
      return {
        dist: 60,
        az: 30,
        el: 10,
        tick(dt, t) {
          for (let i = fx.length - 1; i >= 0; i--) {
            const e = fx[i]!;
            e.update?.(dt, t, env.camera);
            if (e.finished) {
              env.scene.remove(e.object);
              e.dispose();
              fx.splice(i, 1);
            }
          }
          if (!flag('freeze') && t > next) {
            next = t + 2.6;
            spawn();
          }
        },
      };
    },
  },
  {
    id: 'impact-spark',
    group: 'Effects',
    label: 'Impact spark',
    build(env) {
      const fx: TransientEffect[] = [];
      const cols = ['#9fe8ff', '#ff7a4a', '#d9b8ff'];
      let k = 0;
      const spawn = (): void => {
        const e = createImpactSpark(new THREE.Vector3((k % 3) * 4 - 4, 0, 0), cols[k % 3]!, ctx);
        k++;
        env.scene.add(e.object);
        fx.push(e);
      };
      spawn();
      let next = 0.25;
      return {
        dist: 16,
        az: 20,
        el: 10,
        tick(dt, t) {
          for (let i = fx.length - 1; i >= 0; i--) {
            const e = fx[i]!;
            e.update?.(dt, t, env.camera);
            if (e.finished) {
              env.scene.remove(e.object);
              e.dispose();
              fx.splice(i, 1);
            }
          }
          if (!flag('freeze') && t > next) {
            next = t + 0.25;
            spawn();
          }
        },
      };
    },
  },
  {
    id: 'missile',
    group: 'Effects',
    label: 'Missile',
    build(env) {
      const m = createMissileArt(ctx);
      env.add(m);
      const tmp = new THREE.Vector3();
      return {
        dist: 42,
        az: 0,
        el: 40,
        tick(_dt, t) {
          const a = t * 1.8;
          m.object.position.set(Math.cos(a) * 12, Math.sin(t * 0.7) * 2, Math.sin(a) * 12);
          tmp.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(-1).add(m.object.position);
          // Missile faces -Z: look away from the travel direction.
          m.object.lookAt(tmp);
        },
      };
    },
  },
  {
    id: 'cargo-pod',
    group: 'Effects',
    label: 'Cargo pod',
    build(env) {
      env.add(createCargoPod(ctx));
      return { dist: 9, az: 30, el: 15 };
    },
  },
  {
    id: 'speed-streaks',
    group: 'Effects',
    label: 'Speed streaks',
    build(env) {
      const s = createSpeedStreaks(ctx);
      env.add(s, env.camera);
      s.setIntensity(num('intensity', 1));
      env.slider('Intensity', 'intensity', 0, 1, 0.01, num('intensity', 1), (v) => s.setIntensity(v));
      const ship = createPlayerShip(ctx);
      ship.setThrottle(1);
      ship.setCruise(true);
      env.add(ship);
      return { dist: 24, az: 180, el: 12 };
    },
  },
  {
    id: 'jump-tunnel',
    group: 'Effects',
    label: 'Jump tunnel',
    build(env) {
      const j = createJumpTunnel(ctx);
      env.add(j, env.camera);
      const fixed = params.get('progress');
      let manual = fixed !== null;
      let progress = num('progress', 0);
      env.slider('Progress', 'progress', 0, 1, 0.005, progress, (v) => {
        manual = true;
        progress = v;
      });
      env.button('Auto play', () => {
        manual = false;
      });
      const ship = createPlayerShip(ctx);
      ship.setThrottle(1);
      ship.setBoost(true);
      env.add(ship);
      return {
        dist: 24,
        az: 180,
        el: 12,
        tick(_dt, t) {
          if (!manual) progress = Math.min(1, (t % 4.5) / 3);
          j.setProgress(progress);
        },
      };
    },
  },
  portraitItem(),
];

/* ---------------------------------------------------------------------------------------------- */
/* Runtime.                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLElement;
if (params.get('panel') === '0') panel.classList.add('hidden');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'low' ? 1 : 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 2_000_000);
scene.add(camera);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxDistance = 1_200_000;

const sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
scene.add(sunLight);
scene.add(sunLight.target);
const hemi = new THREE.HemisphereLight(0x8fa3c8, 0x1c1612, 0.3);
scene.add(hemi);

const useBloom = params.has('bloom') ? flag('bloom') : quality === 'high';
let composer: EffectComposer | null = null;
let renderPass: RenderPass | null = null;
if (useBloom) {
  composer = new EffectComposer(renderer);
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.45, 0.85));
  composer.addPass(new OutputPass());
}

const itemId = params.get('item') ?? 'ship-player';
const item = ITEMS.find((i) => i.id === itemId) ?? ITEMS[0]!;
const objects: ArtObject[] = [];

function setParam(key: string, value: string | null): void {
  const url = new URL(location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  history.replaceState(null, '', url);
}

function reloadWith(key: string, value: string | null): void {
  setParam(key, value);
  location.reload();
}

// Panel: global controls.
const h1 = document.createElement('h1');
h1.textContent = 'Art gallery (dev)';
panel.appendChild(h1);
const itemLabel = document.createElement('label');
itemLabel.textContent = 'Item';
panel.appendChild(itemLabel);
const select = document.createElement('select');
const groups = new Map<string, HTMLOptGroupElement>();
for (const it of ITEMS) {
  let g = groups.get(it.group);
  if (!g) {
    g = document.createElement('optgroup');
    g.label = it.group;
    groups.set(it.group, g);
    select.appendChild(g);
  }
  const o = document.createElement('option');
  o.value = it.id;
  o.textContent = it.label;
  g.appendChild(o);
}
select.value = item.id;
select.addEventListener('change', () => {
  // Item-specific parameters do not carry over.
  const url = new URL(location.href);
  const keep = ['quality', 'rm', 'bloom', 'panel'];
  for (const k of [...url.searchParams.keys()]) if (!keep.includes(k)) url.searchParams.delete(k);
  url.searchParams.set('item', select.value);
  location.href = url.toString();
});
panel.appendChild(select);

const qLabel = document.createElement('label');
qLabel.textContent = 'Quality';
panel.appendChild(qLabel);
const qSelect = document.createElement('select');
for (const q of ['low', 'medium', 'high']) {
  const o = document.createElement('option');
  o.value = q;
  o.textContent = q;
  qSelect.appendChild(o);
}
qSelect.value = quality;
qSelect.addEventListener('change', () => reloadWith('quality', qSelect.value));
panel.appendChild(qSelect);

function addCheck(label: string, value: boolean, on: (v: boolean) => void): void {
  const row = document.createElement('div');
  row.className = 'row';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.id = `c-${label.replace(/\W+/g, '-')}`;
  input.addEventListener('change', () => on(input.checked));
  const l = document.createElement('label');
  l.htmlFor = input.id;
  l.textContent = label;
  row.append(input, l);
  panel.appendChild(row);
}
addCheck('Reduced motion', ctx.reducedMotion, (v) => reloadWith('rm', v ? '1' : null));
addCheck('Bloom', useBloom, (v) => reloadWith('bloom', v ? '1' : '0'));

const env: Env = {
  scene,
  camera,
  panel,
  add(o, parent) {
    (parent ?? scene).add(o.object);
    objects.push(o);
  },
  slider(label, key, min, max, step, value, on) {
    const l = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const text = (): string => `${label}: ${Number(input.value).toFixed(step < 1 ? 2 : 0)}`;
    l.textContent = text();
    input.addEventListener('input', () => {
      l.textContent = text();
      setParam(key, input.value);
      on(Number(input.value));
    });
    panel.append(l, input);
  },
  check(label, key, value, on) {
    addCheck(label, value, (v) => {
      setParam(key, v ? '1' : '0');
      on(v);
    });
  },
  button(label, on) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', on);
    panel.appendChild(b);
  },
  note(text) {
    const n = document.createElement('div');
    n.id = 'note';
    n.textContent = text;
    panel.appendChild(n);
  },
};

const setup = item.build(env);
// Items with their own scene and camera (interiors) render those; the orbit camera is unused then.
const renderScene: THREE.Scene = setup.scene ?? scene;
const renderCamera: THREE.PerspectiveCamera = setup.camera ?? camera;
if (renderPass) {
  renderPass.scene = renderScene;
  renderPass.camera = renderCamera;
}

const skyId = setup.sky === undefined ? 'sol' : setup.sky;
if (skyId) env.add(createSkybox(SKIES[skyId]!, ctx));

const lightDir = setup.lightDir ?? DEFAULT_LIGHT;
sunLight.position.copy(lightDir).multiplyScalar(1000);
sunLight.color.set(setup.lightColor ?? '#fff3e2');

const target = setup.target ?? new THREE.Vector3();
controls.target.copy(target);
controls.minDistance = setup.minDist ?? 0.01;
const dist = num('dist', setup.dist);
const az = THREE.MathUtils.degToRad(num('az', setup.az ?? 30));
const el = THREE.MathUtils.degToRad(num('el', setup.el ?? 15));
camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(target);
camera.lookAt(target);
controls.update();

// Debug: hide named sub-objects, e.g. hide=corona,far-glow
const hidden = (params.get('hide') ?? '').split(',').filter(Boolean);
if (hidden.length) renderScene.traverse((o) => {
  if (hidden.includes(o.name)) o.visible = false;
});

const stats = document.createElement('div');
stats.id = 'stats';
panel.appendChild(stats);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer?.setSize(window.innerWidth, window.innerHeight);
  setup.resize?.(window.innerWidth, window.innerHeight);
});

let time = 0;
const freeze = flag('freeze');
const step = 1 / 30;
function simulate(dt: number): void {
  time += dt;
  for (const o of objects) o.update?.(dt, time, camera);
  setup.tick?.(dt, time);
}

// Deterministic pre-roll for captures.
const preroll = num('t', 0);
for (let s = 0; s < preroll - 1e-6; s += step) simulate(Math.min(step, preroll - s));
if (preroll === 0) simulate(0);

let last = performance.now();
let frames = 0;
let fpsAcc = 0;
let fps = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  controls.update();
  simulate(freeze ? 0 : dt);
  if (composer) composer.render();
  else renderer.render(renderScene, renderCamera);
  frames++;
  fpsAcc += dt;
  if (fpsAcc > 0.5) {
    fps = frames / fpsAcc;
    frames = 0;
    fpsAcc = 0;
  }
  const info = renderer.info;
  stats.textContent =
    `${fps.toFixed(0)} fps · ${quality}${ctx.reducedMotion ? ' · rm' : ''}\n` +
    `calls ${info.render.calls} · tris ${info.render.triangles}\n` +
    `programs ${info.programs?.length ?? 0} · tex ${info.memory.textures} · geo ${info.memory.geometries}` +
    (setup.stats ? `\n${setup.stats()}` : '');
  renderedFrames++;
  if (renderedFrames === 3) (window as unknown as { __artReady: boolean }).__artReady = true;
  requestAnimationFrame(frame);
}
let renderedFrames = 0;
// Debug handle for scripted captures.
(window as unknown as { __art: unknown }).__art = { renderer, scene: renderScene, camera: renderCamera, objects };
requestAnimationFrame(frame);
