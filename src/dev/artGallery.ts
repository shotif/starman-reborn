/**
 * Dev-only art gallery (served by Vite at /dev/art.html; not part of the production build).
 * Query parameters make captures scriptable:
 *   item=<id> quality=low|medium|high rm=1 (reduced motion) panel=0 (hide UI) bloom=0|1
 *   dist=<camera distance> az=<deg> el=<deg> t=<seconds to pre-simulate> freeze=1 (stop the clock)
 *   plus item parameters (throttle, boost, cruise, shield, active, progress, intensity, markers).
 */
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

const ITEMS: Item[] = [
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
if (useBloom) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
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
if (hidden.length) scene.traverse((o) => {
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
  else renderer.render(scene, camera);
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
(window as unknown as { __art: unknown }).__art = { renderer, scene, camera, objects };
requestAnimationFrame(frame);
