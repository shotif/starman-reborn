import * as THREE from 'three';
import { spectralClass } from '../../content/world/generate.ts';
import type { GeneratedStation, StationType } from '../../content/world/types.ts';
import { beltsOf, getComponent, getSystem, WORLD } from '../../data/systems.ts';
import type { BeltRecord, StellarComponent, SystemId } from '../../data/types.ts';
import { hashString, rng } from '../../content/random.ts';
import type { StarKind } from '../art/stars.ts';
import type { StationKind } from '../art/stations.ts';
import type { SceneBeltDef, SceneDustDef, SceneLaneDef, ScenePlanetDef, SceneStarDef, SceneStationDef, SystemSceneDef } from '../sceneTypes.ts';
import { confirmedPlanets, dirTo, polar, v } from './helpers.ts';
import { arcsecToAu, ORBIT_EPOCH_JD, orbitOf, pairAt, relativeVectorLy, type BinaryOrbit } from '../../data/orbits.ts';
import { equatorialToScene } from '../../data/coords.ts';

/**
 * Scenes for the catalogue systems, built from the observed stars and confirmed planets plus the
 * world generator's stations. Like the hand-made scenes, distances and sizes are schematic: stars
 * keep their catalogued colours and kinds, companions sit at compressed separations (wider real
 * pairs further apart), planets at compressed orbits from their catalogued semi-major axes.
 */

/** How each spectral class is drawn: photosphere radius, light and how far it reaches (schematic units). */
const STAR_LOOK: Record<string, { kind: StarKind; radius: number; light: number; range: number; activity: number; glow?: number; ambient: number }> = {
  O: { kind: 'main-sequence', radius: 6_000, light: 3.2, range: 180_000, activity: 0.3, ambient: 0.36 },
  B: { kind: 'main-sequence', radius: 6_000, light: 3.2, range: 180_000, activity: 0.3, ambient: 0.36 },
  A: { kind: 'main-sequence', radius: 5_200, light: 3, range: 160_000, activity: 0.35, glow: 1.3, ambient: 0.34 },
  F: { kind: 'main-sequence', radius: 4_200, light: 2.7, range: 120_000, activity: 0.45, ambient: 0.32 },
  G: { kind: 'main-sequence', radius: 3_600, light: 2.5, range: 110_000, activity: 0.5, ambient: 0.3 },
  K: { kind: 'main-sequence', radius: 2_800, light: 2.2, range: 90_000, activity: 0.6, ambient: 0.28 },
  M: { kind: 'red-dwarf', radius: 1_100, light: 1.4, range: 26_000, activity: 0.6, glow: 1.2, ambient: 0.23 },
  D: { kind: 'white-dwarf', radius: 170, light: 0.8, range: 14_000, activity: 0, glow: 3, ambient: 0.26 },
};

/** Exteriors are generated from each station's look; interiors borrow the closest hand-made style. */
const BORROWED_ART: Record<StationType, StationKind> = {
  'trade-port': 'earth-port',
  'customs-depot': 'mars-depot',
  shipyard: 'mars-depot',
  'mining-outpost': 'proxima-outpost',
  refinery: 'eridani-hub',
  factory: 'eridani-hub',
  'agri-station': 'sirius-platform',
  'research-station': 'sirius-platform',
  relay: 'barnard-relay',
  'military-base': 'mars-depot',
  freeport: 'earth-port',
  'pirate-den': 'proxima-outpost',
};

/** Which station ships arrive beside: the busiest open one. */
const ARRIVAL_PRIORITY: readonly StationType[] = ['trade-port', 'freeport', 'customs-depot', 'military-base', 'shipyard', 'factory', 'refinery', 'research-station', 'agri-station', 'relay', 'mining-outpost'];

const LY_TO_AU = 63_241;
const LANE_MIN_LENGTH = 26_000;

export function starLook(spectralType: string): (typeof STAR_LOOK)[string] {
  return STAR_LOOK[spectralClass(spectralType)] ?? STAR_LOOK.M!;
}

/** Projected separation of two components in AU (angle on the sky × distance; robust to parallax noise). */
function projectedSeparationAu(a: StellarComponent, b: StellarComponent): number {
  const rad = THREE.MathUtils.degToRad;
  const cos =
    Math.sin(rad(a.decDegrees)) * Math.sin(rad(b.decDegrees)) + Math.cos(rad(a.decDegrees)) * Math.cos(rad(b.decDegrees)) * Math.cos(rad(a.raDegrees - b.raDegrees));
  return Math.acos(Math.min(1, Math.max(-1, cos))) * a.distanceLightYears * LY_TO_AU;
}

/** A separation in AU as a compressed scene distance: wider real pairs further apart. */
export function compressedSeparation(au: number): number {
  return Math.min(110_000, Math.max(22_000, 12_000 * Math.log2(1 + au / 5)));
}

/**
 * Where a pair's secondary stands from its primary in a scene (docs/PROCGEN.md §44.3): its real
 * direction (on the sky and along the line of sight, in the scene's frame) when the orbits were
 * taken, at its true separation compressed like every companion's.
 */
export function orbitOffset(orbit: BinaryOrbit): THREE.Vector3 {
  const primary = getComponent(orbit.primary)!;
  const place = pairAt(orbit, ORBIT_EPOCH_JD);
  const [x, y, z] = equatorialToScene(relativeVectorLy(place, primary.raDegrees, primary.decDegrees, primary.distanceLightYears));
  const dir = new THREE.Vector3(x, y, z).normalize();
  return dir.multiplyScalar(compressedSeparation(arcsecToAu(place.radiusArcsec, primary.parallaxMas)));
}

const cache = new Map<SystemId, SystemSceneDef>();

export function catalogSceneDef(systemId: SystemId): SystemSceneDef {
  let def = cache.get(systemId);
  if (!def) {
    def = buildCatalogScene(systemId);
    cache.set(systemId, def);
  }
  return def;
}

/**
 * How far a pair's secondary must keep from what is not its own (docs/PROCGEN.md §44.3), beyond its
 * surface: the arrival point and beacons, other stations and planets, and the lanes. Placed by its
 * real direction, a companion that would crowd them is moved further out along that direction
 * (its distance is compressed and schematic anyway).
 */
export const COMPANION_CLEAR = { arrival: 12_000, station: 8_000, planet: 6_000, lane: 8_000 } as const;

/** The orbit-placed companions in a scene that crowd what is not their own, by id. */
export function crowdedCompanions(def: SystemSceneDef): string[] {
  const out: string[] = [];
  for (const star of def.stars) {
    const orbit = orbitOf(star.id);
    if (orbit?.secondary !== star.id) continue;
    const away = (p: THREE.Vector3) => p.distanceTo(star.position) - star.radius;
    const ownPlanets = new Set(def.planets.filter((p) => p.hostStarId === star.id).map((p) => p.id));
    const own = (locationId: string) => {
      const anchor = WORLD.stations.find((g) => g.id === locationId)?.anchorId;
      return anchor === star.id || (anchor !== undefined && ownPlanets.has(anchor));
    };
    const lane = (from: THREE.Vector3, to: THREE.Vector3) => new THREE.Line3(from, to).closestPointToPoint(star.position, true, new THREE.Vector3()).distanceTo(star.position) - star.radius;
    const crowded =
      away(def.arrival.position) < COMPANION_CLEAR.arrival ||
      def.beacons.some((b) => away(b.position) < COMPANION_CLEAR.arrival) ||
      def.stations.some((st) => !own(st.locationId) && away(st.position) < COMPANION_CLEAR.station) ||
      def.planets.some((p) => !ownPlanets.has(p.id) && away(p.position) - p.radius < COMPANION_CLEAR.planet) ||
      def.lanes.some((l) => lane(l.from, l.to) < COMPANION_CLEAR.lane);
    if (crowded) out.push(star.id);
  }
  return out;
}

/** A catalogue scene, its orbit-placed companions moved out along their real directions until clear. */
function buildCatalogScene(systemId: SystemId): SystemSceneDef {
  const stretch = new Map<string, number>();
  let def = layCatalogScene(systemId, stretch);
  for (let k = 0; k < 12; k++) {
    const crowded = crowdedCompanions(def);
    if (!crowded.length) break;
    for (const id of crowded) stretch.set(id, (stretch.get(id) ?? 1) * 1.15);
    def = layCatalogScene(systemId, stretch);
  }
  return def;
}

function layCatalogScene(systemId: SystemId, stretch: ReadonlyMap<string, number>): SystemSceneDef {
  const sys = getSystem(systemId);
  const r = rng(hashString(systemId), 'scene');
  const comps = sys.componentIds.map((id) => getComponent(id)).filter((c): c is StellarComponent => !!c);
  const primary = comps[0]!;

  // Stars: the primary at the centre, companions around their parents at compressed separations.
  const starPos = new Map<string, THREE.Vector3>([[primary.id, v(0, 0, 0)]]);
  const stars: SceneStarDef[] = [];
  const hostClass: Record<string, string> = {};
  comps.forEach((c, i) => {
    const look = starLook(c.spectralType);
    hostClass[c.id] = spectralClass(c.spectralType);
    if (i > 0) {
      const parent = comps.find((p) => p.id === c.parentId) ?? primary;
      const sepAu = projectedSeparationAu(parent, c);
      const angle = r.range(0, 360);
      const lift = r.range(-4_000, 4_000);
      // A pair with a catalogued orbit (docs/PROCGEN.md §44.3) stands as it did when the orbits were
      // taken: in its real direction from its primary, at its true separation (compressed alike).
      const orbit = orbitOf(c.id);
      const host = orbit?.secondary === c.id ? starPos.get(orbit.primary) : undefined;
      if (orbit && host) starPos.set(c.id, host.clone().add(orbitOffset(orbit).multiplyScalar(stretch.get(c.id) ?? 1)));
      else starPos.set(c.id, polar(starPos.get(parent.id) ?? v(0, 0, 0), compressedSeparation(sepAu), angle, lift));
    }
    stars.push({
      id: c.id,
      name: c.name,
      position: starPos.get(c.id)!,
      radius: look.radius,
      color: c.colorHex,
      kind: look.kind,
      activity: look.activity,
      ...(look.glow ? { glowScale: look.glow } : {}),
      light: i === 0 ? look.light : look.light * 0.7,
      lightRange: look.range,
    });
  });

  const planets = confirmedPlanets(systemId, Object.fromEntries(starPos), {}, { spectralClass: hostClass, radius: Object.fromEntries(stars.map((x) => [x.id, x.radius])) });
  const planetPos = new Map(planets.map((p) => [p.id, p.position]));
  const radiusOf = new Map<string, number>([...stars.map((s) => [s.id, s.radius] as const), ...planets.map((p) => [p.id, p.radius] as const)]);

  // Stations where the world generator put them: around their anchor, clear of its surface.
  const own = WORLD.stations.filter((s) => s.systemId === systemId);
  const placed = own.map((g) => {
    const anchor = starPos.get(g.anchorId) ?? planetPos.get(g.anchorId) ?? v(0, 0, 0);
    const position = polar(anchor, g.orbit.distance + (radiusOf.get(g.anchorId) ?? 0), g.orbit.angle, g.orbit.height);
    return { g, position, anchor };
  });
  const main = [...placed].filter((p) => p.g.dockable).sort((a, b) => ARRIVAL_PRIORITY.indexOf(a.g.type) - ARRIVAL_PRIORITY.indexOf(b.g.type))[0];
  const hub = main?.position ?? v(9_000, 800, 6_000);
  const outward = main ? dirTo(main.anchor, hub) : v(1, 0, 0);
  const side = new THREE.Vector3().crossVectors(outward, v(0, 1, 0)).normalize();
  const arrival = hub.clone().addScaledVector(outward, 9_000).addScaledVector(side, 3_500).add(v(0, 1_600, 0));
  // Belts ring the stations and the arrival point, so nobody arrives or docks in the rocks.
  const hostOf = (anchorId: string) => (starPos.has(anchorId) ? anchorId : planets.find((p) => p.id === anchorId)?.hostStarId);
  const rings = beltRings(systemId, starPos, stars, [
    ...planets.map((p) => ({ position: p.position, radius: p.radius, hostStarId: p.hostStarId })),
    ...placed.map((p) => ({ position: p.position, radius: 1_500, ...(hostOf(p.g.anchorId) ? { hostStarId: hostOf(p.g.anchorId)! } : {}) })),
    { position: arrival, radius: 1_500, ...(main && hostOf(main.g.anchorId) ? { hostStarId: hostOf(main.g.anchorId)! } : {}) },
  ]);

  const stations: SceneStationDef[] = placed.map(({ g, position, anchor }) => ({
    locationId: g.id,
    kind: BORROWED_ART[g.type],
    look: g.look,
    position,
    // Open stations face the arrival point (the main one) or away from what they orbit.
    approach: g === main?.g ? dirTo(position, arrival) : dirTo(anchor, position).add(v(0, 0.15, 0)).normalize(),
    ...(g.dockable ? {} : { hostile: true }),
  }));

  return {
    systemId,
    skybox: skyFor(systemId, primary.colorHex, WORLD.profiles.get(systemId)?.security ?? 0.5),
    ambient: { sky: `#${new THREE.Color(primary.colorHex).lerp(new THREE.Color('#9ab8e8'), 0.35).getHexString()}`, ground: '#0c0d14', intensity: starLook(primary.spectralType).ambient },
    stars,
    planets,
    stations,
    lanes: lanesFor(placed, stars),
    belts: rings.belts,
    dust: rings.dust,
    beacons: [{ id: `${systemId}-jump`, name: `${sys.displayName} jump beacon`, position: arrival.clone().add(v(220, -90, 280)), kind: 'jump' }],
    scanZones: [],
    encounters: [],
    arrival: { position: arrival, lookAt: hub },
    orbitLines: planets.length > 0,
    scaleNote: `${comps.length > 1 ? 'Star separations, planet orbits and sizes are compressed and schematic.' : 'Planet orbits, sizes and station distances are compressed and schematic.'}${rings.belts.length ? ' The belt is placed schematically.' : ''}`,
  };
}

/** Rock colour by what a belt is reported as (an artistic choice). */
const BELT_COLOR: Record<BeltRecord['kind'], { rock: string; dust: string }> = {
  'asteroid-belt': { rock: '#8c8174', dust: '#a09482' },
  'kuiper-belt': { rock: '#a9bccb', dust: '#9fb0c2' },
  'debris-disc': { rock: '#94857a', dust: '#b09080' },
};

/**
 * A ring for every belt or debris disc a cited source reports round one of the system's stars
 * (docs/PROCGEN.md §19). Where the source gives no extent, which is every catalogue system's, the
 * ring sits schematically beyond the host's compressed planet orbits and whatever else is placed
 * round it (`around`: planets of that host, stations, the arrival point), with dust, since debris
 * discs are seen by their dust.
 */
function beltRings(
  systemId: SystemId,
  starPos: ReadonlyMap<string, THREE.Vector3>,
  stars: readonly SceneStarDef[],
  around: readonly (Pick<ScenePlanetDef, 'position' | 'radius'> & { hostStarId?: string })[],
): { belts: SceneBeltDef[]; dust: SceneDustDef[] } {
  const belts: SceneBeltDef[] = [];
  const dust: SceneDustDef[] = [];
  for (const b of beltsOf(systemId)) {
    const star = stars.find((s) => s.id === b.hostId) ?? stars[0]!;
    const center = starPos.get(star.id) ?? v(0, 0, 0);
    const radial = (p: THREE.Vector3) => Math.hypot(p.x - center.x, p.z - center.z);
    const outermost = around.filter((p) => !p.hostStarId || p.hostStarId === star.id).reduce((m, p) => Math.max(m, radial(p.position) + p.radius), 0);
    const inner = Math.round(Math.max(18_000, star.radius * 6, outermost + 6_500) / 500) * 500;
    const outer = inner + 12_000;
    const seed = hashString(b.id) % 997;
    const look = BELT_COLOR[b.kind];
    belts.push({
      id: `${b.id}-ring`,
      beltId: b.id,
      center,
      shape: 'ring',
      innerRadius: inner,
      outerRadius: outer,
      thickness: 2_000,
      count: { low: 300, medium: 600, high: 1_000 },
      sizeMin: 14,
      sizeMax: 120,
      color: look.rock,
      seed,
    });
    dust.push({ center, innerRadius: inner - 2_500, outerRadius: outer + 2_500, color: look.dust, opacity: 0.14, seed: seed + 1 });
  }
  return { belts, dust };
}

/** A trade lane from the arrival station to each open station far away, unless it would graze a star. */
function lanesFor(placed: readonly { g: GeneratedStation; position: THREE.Vector3 }[], stars: readonly SceneStarDef[]): SceneLaneDef[] {
  const open = placed.filter((p) => p.g.dockable);
  const main = [...open].sort((a, b) => ARRIVAL_PRIORITY.indexOf(a.g.type) - ARRIVAL_PRIORITY.indexOf(b.g.type))[0];
  if (!main) return [];
  const lanes: SceneLaneDef[] = [];
  for (const other of open) {
    if (other === main || other.position.distanceTo(main.position) < LANE_MIN_LENGTH) continue;
    const dir = dirTo(main.position, other.position);
    const from = main.position.clone().addScaledVector(dir, 1_600);
    const to = other.position.clone().addScaledVector(dir, -3_200);
    const segment = new THREE.Line3(from, to);
    const grazes = stars.some((s) => segment.closestPointToPoint(s.position, true, new THREE.Vector3()).distanceTo(s.position) < s.radius * 2.5 + 2_500);
    if (grazes) continue;
    const a = main.g.name.split(' ')[0]!;
    const b = other.g.name.split(' ')[0]!;
    lanes.push({ id: `lane-${main.g.id}-${other.g.id}`, name: `${a}–${b} trade lane`, fromName: `Lane to ${other.g.name}`, toName: `Lane to ${main.g.name}`, from, to, ringSpacing: 2_000, speed: 2_600 });
  }
  return lanes;
}

/** An artistic sky tinted by the local star; lawless systems get a murkier, dustier one. */
function skyFor(systemId: SystemId, starColor: string, security: number): SystemSceneDef['skybox'] {
  const r = rng(hashString(systemId), 'sky');
  const tint = new THREE.Color(starColor);
  const hsl = { h: 0, s: 0, l: 0 };
  tint.getHSL(hsl);
  const shade = (dh: number, s: number, l: number) => `#${new THREE.Color().setHSL((hsl.h + dh + 1) % 1, s, l).getHexString()}`;
  const lawless = security < 0.35;
  return {
    seed: hashString(systemId) % 997,
    baseColor: `#${new THREE.Color('#020308').lerp(tint, 0.03).getHexString()}`,
    nebulaColors: [shade(r.range(-0.08, 0.08), 0.5, 0.2), shade(r.range(0.25, 0.45), 0.45, 0.16), shade(r.range(0.55, 0.75), 0.35, 0.14)],
    nebulaIntensity: Math.round((lawless ? r.range(0.35, 0.6) : r.range(0.2, 0.5)) * 100) / 100,
    starDensity: Math.round(r.range(0.55, 1) * 100) / 100,
    bandTilt: Math.round(r.range(-1.2, 1.2) * 100) / 100,
    dust: Math.round((lawless ? r.range(0.4, 0.6) : r.range(0.15, 0.4)) * 100) / 100,
  };
}
