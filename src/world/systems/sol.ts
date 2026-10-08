import * as THREE from "three";
import { ASTEROID_LINES, ASTEROIDS } from "../../content/stellar/asteroids.ts";
import { COMET_LINES, COMETS } from "../../content/stellar/comets.ts";
import { outpostSites } from "../../content/outposts/sites.ts";
import { MOON_LINES, MOONS } from "../../content/stellar/moons.ts";
import { CRAFT_LINES, SPACECRAFT } from "../../content/stellar/spacecraft.ts";
import { LUNAR, LUNAR_LINES } from "../../content/stellar/lunar.ts";
import { LUNAR_DATA, moonPlace } from "../../data/lunar.ts";
import { CRAFT_DATA, craftAt, craftOnPath } from "../../data/spacecraft.ts";
import { skyVersion } from "../../data/sky.ts";
import {
  MOON_EPOCH_JD,
  MOON_RADIUS_KM,
  moonAt,
  moonsOf,
  planetPole,
  type Moon,
} from "../../data/moons.ts";
import type { PlanetStyle } from "../art/planets.ts";
import {
  ASTEROID_DATA,
  asteroidAt,
  AU_KM,
  EARTH_RADIUS_KM,
  geocentricOnPath,
  MOON_DISTANCE_KM,
  type Asteroid,
} from "../../data/asteroids.ts";
import {
  COMET_DATA,
  COMET_EPOCH_JD,
  cometAt,
  cometHeading,
  type Comet,
} from "../../data/comets.ts";
import {
  eclipticLongitude,
  hasSolarElements,
  SOLAR,
  type SolarPlanetId,
} from "../../data/solar.ts";
import { fillAsteroid } from "../../economy/asteroids.ts";
import { activity, fillComet } from "../../economy/comets.ts";
import { siteDock } from "../siteDock.ts";
import type {
  SceneAsteroidDef,
  SceneCometDef,
  SceneCraftDef,
  ScenePlanetDef,
  SystemSceneDef,
} from "../sceneTypes.ts";
import { dirTo, polar, v } from "./helpers.ts";

const SUN = v(0, 0, 0);

interface SolPlanet {
  id: string;
  name: string;
  subtitle: string;
  orbit: number;
  angle: number;
  radius: number;
  style: ScenePlanetDef["style"];
  rings?: ScenePlanetDef["rings"];
  tilt?: number;
}

// Schematic layout: order and relative size are real, spacing and scale are compressed for play.
const PLANETS: SolPlanet[] = [
  {
    id: "mercury",
    name: "Mercury",
    subtitle: "Terrestrial planet · 1st from the Sun",
    orbit: 18_000,
    angle: 200,
    radius: 600,
    style: "mercury",
  },
  {
    id: "venus",
    name: "Venus",
    subtitle: "Terrestrial planet · 2nd from the Sun",
    orbit: 27_000,
    angle: 140,
    radius: 1_300,
    style: "venus",
  },
  {
    id: "earth",
    name: "Earth",
    subtitle: "Terrestrial planet · 3rd from the Sun",
    orbit: 42_000,
    angle: 32,
    radius: 1_600,
    style: "earth",
    tilt: 0.41,
  },
  {
    id: "mars",
    name: "Mars",
    subtitle: "Terrestrial planet · 4th from the Sun",
    orbit: 56_000,
    angle: 58,
    radius: 900,
    style: "mars",
    tilt: 0.44,
  },
  {
    id: "jupiter",
    name: "Jupiter",
    subtitle: "Gas giant · 5th from the Sun",
    orbit: 88_000,
    angle: 110,
    radius: 5_200,
    style: "jupiter",
    tilt: 0.05,
  },
  {
    id: "saturn",
    name: "Saturn",
    subtitle: "Gas giant · 6th from the Sun",
    orbit: 118_000,
    angle: 250,
    radius: 4_400,
    style: "saturn",
    tilt: 0.47,
    rings: { inner: 5_600, outer: 9_800, color: "#d9c7a0", opacity: 0.75 },
  },
  {
    id: "uranus",
    name: "Uranus",
    subtitle: "Ice giant · 7th from the Sun",
    orbit: 142_000,
    angle: 320,
    radius: 2_400,
    style: "uranus",
    tilt: 1.7,
  },
  {
    id: "neptune",
    name: "Neptune",
    subtitle: "Ice giant · 8th from the Sun",
    orbit: 164_000,
    angle: 12,
    radius: 2_300,
    style: "neptune",
    tilt: 0.49,
  },
];

const orbitOf = (id: string): number => PLANETS.find((p) => p.id === id)!.orbit;

/**
 * NASA's two belts (src/data/generated/belts.json): the main belt between the orbits of Mars and
 * Jupiter, and the Kuiper Belt beyond Neptune. Their extents in au only order them; in flight they
 * sit schematically between the compressed orbits (circles round the Sun, so any date keeps them).
 */
const MAIN_BELT = {
  inner: orbitOf("mars") + (orbitOf("jupiter") - orbitOf("mars")) * 0.25,
  outer: orbitOf("mars") + (orbitOf("jupiter") - orbitOf("mars")) * 0.75,
};
const KUIPER_BELT = {
  inner: orbitOf("neptune") + 14_000,
  outer: orbitOf("neptune") + 58_000,
};

/** Mars is drawn at most this far round from Earth, so the Earth–Mars lane never runs through the Sun. */
const MARS_MAX_APART = 140;

/**
 * The planets' directions from the Sun on a date (JPL's elements): scene angle = −longitude, so
 * seen from above they turn anticlockwise, as from the ecliptic's north. Null keeps the schematic
 * angles (no elements, or a date outside 1800–2050).
 */
function anglesFor(
  jd: number | null,
): { angles: Record<string, number>; marsNudged: boolean } | null {
  if (jd === null || !hasSolarElements(jd)) return null;
  const angles: Record<string, number> = {};
  for (const p of PLANETS)
    angles[p.id] = -eclipticLongitude(p.id as SolarPlanetId, jd);
  const apart = ((angles.mars! - angles.earth! + 540) % 360) - 180;
  const marsNudged = Math.abs(apart) > MARS_MAX_APART;
  if (marsNudged)
    angles.mars = angles.earth! + Math.sign(apart) * MARS_MAX_APART;
  return { angles, marsNudged };
}

/** Sol's scene: on the real date when one is given (the game date), schematic otherwise. */
export function solScene(jd: number | null): SystemSceneDef {
  const real = anglesFor(jd);
  const positions = Object.fromEntries(
    PLANETS.map((p) => [
      p.id,
      polar(SUN, p.orbit, real?.angles[p.id] ?? p.angle),
    ]),
  ) as Record<string, THREE.Vector3>;
  const def = buildSolScene(
    positions,
    real ? (real.marsNudged ? "real-nudged" : "real") : "schematic",
  );
  // Earth's Moon where it really is round Earth (§51), the giant planets' large moons round them on
  // the game date (§48), then the comets, asteroids and spacecraft where they stand (without a date,
  // on the snapshot's day), clear of them all.
  placeLuna(def, jd ?? LUNAR_DATA.epochJd);
  addMoons(def, jd ?? MOON_EPOCH_JD);
  def.comets = placeComets(def, jd ?? COMET_EPOCH_JD);
  def.asteroids = placeAsteroids(def, jd ?? ASTEROID_DATA.epochJd);
  def.craft = placeCraft(def, jd ?? CRAFT_DATA.epochJd);
  return def;
}

// ---------------------------------------------------------------- comets (docs/PROCGEN.md §45.3)

/** The planets' mean distances from the Sun (JPL's elements, au) against their orbits in flight. */
let scale: { au: number; orbit: number }[] | null | undefined;
function solScale(): { au: number; orbit: number }[] | null {
  if (scale !== undefined) return scale;
  const el = SOLAR.elements;
  scale = el
    ? PLANETS.map((p) => ({
        au: el[p.id as SolarPlanetId].a[0],
        orbit: p.orbit,
      })).sort((a, b) => a.au - b.au)
    : null;
  return scale;
}

/**
 * A distance from the Sun (au) on the planets' compressed scale: between two planets' orbits as it
 * lies between their distances, by the logarithm; inside Mercury's, in proportion (never nearer than
 * `COMETS.nearest`); beyond Neptune's, on at the rate between Uranus and Neptune.
 */
export function compressedSolDistance(au: number): number | null {
  const s = solScale();
  if (!s || !(au > 0) || !Number.isFinite(au)) return null;
  const first = s[0]!;
  const last = s.at(-1)!;
  const before = s.at(-2)!;
  if (au <= first.au)
    return Math.max(COMETS.nearest, (first.orbit * au) / first.au);
  if (au >= last.au)
    return (
      last.orbit +
      ((last.orbit - before.orbit) / Math.log(last.au / before.au)) *
        Math.log(au / last.au)
    );
  const i = s.findIndex((x) => x.au >= au);
  const a = s[i - 1]!;
  const b = s[i]!;
  return (
    a.orbit +
    ((b.orbit - a.orbit) * Math.log(au / a.au)) / Math.log(b.au / a.au)
  );
}

/** The J2000 ecliptic in the scene's frame: x toward the equinox, the ecliptic's north up. */
export function eclipticToScene([x, y, z]: readonly [
  number,
  number,
  number,
]): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}

/** A comet's nucleus as drawn: larger than life, larger for a larger nucleus. */
export function nucleusRadius(comet: Comet): number {
  const n = COMETS.nucleus;
  return n.base + n.perRootKm * Math.sqrt(comet.diameterKm ?? n.unknownKm);
}

const STRETCH = 1.05;
const STRETCH_TRIES = 24;

/** Where the outposts of Sol's sites would stand (the belts' sites), whether or not a pilot has one there. */
function solSiteDocks(
  def: SystemSceneDef,
): { id: string; position: THREE.Vector3 }[] {
  return outpostSites()
    .filter((s) => s.systemId === "sol")
    .flatMap((s) => {
      const dock = siteDock(def, s);
      return dock ? [{ id: s.id, position: dock.position }] : [];
    });
}

/** What a comet (or, with its clearances, an asteroid) of this size here would crowd that is not its own, if anything (§45.3, §47.3). */
export function cometCrowds(
  def: SystemSceneDef,
  at: THREE.Vector3,
  size: number,
  c: {
    arrival: number;
    station: number;
    planet: number;
    lane: number;
  } = COMETS.clear,
): string | null {
  if (at.distanceTo(def.arrival.position) < size + c.arrival) return "arrival";
  for (const b of def.beacons)
    if (at.distanceTo(b.position) < size + c.arrival) return b.id;
  for (const s of def.stations)
    if (at.distanceTo(s.position) < size + c.station) return s.locationId;
  if (def.systemId === "sol")
    for (const s of solSiteDocks(def))
      if (at.distanceTo(s.position) < size + c.station) return s.id;
  for (const p of def.planets)
    if (at.distanceTo(p.position) < size + p.radius + c.planet) return p.id;
  for (const st of def.stars)
    if (at.distanceTo(st.position) < size + st.radius + c.planet) return st.id;
  const near = new THREE.Vector3();
  for (const l of def.lanes) {
    new THREE.Line3(l.from, l.to).closestPointToPoint(at, true, near);
    if (near.distanceTo(at) < size + c.lane) return l.id;
  }
  return null;
}

/** The comets in Sol's scene on a date, each moved out along its direction while it crowds anything. */
function placeComets(def: SystemSceneDef, jd: number): SceneCometDef[] {
  return COMET_DATA.comets.flatMap((comet): SceneCometDef[] => {
    const at = cometAt(comet, jd);
    let d = compressedSolDistance(at.r);
    if (d === null) return [];
    const dir = eclipticToScene(at.xyz).normalize();
    const k = activity(at.r);
    const radius = nucleusRadius(comet);
    const coma = radius * COMETS.activity.coma * k;
    for (
      let i = 0;
      i < STRETCH_TRIES &&
      cometCrowds(def, dir.clone().multiplyScalar(d), radius + coma);
      i++
    )
      d *= STRETCH;
    const heading = eclipticToScene(cometHeading(comet, jd)).normalize();
    return [
      {
        id: comet.id,
        name: comet.name,
        subtitle: fillComet(COMET_LINES.target, comet),
        position: dir.clone().multiplyScalar(d),
        radius,
        coma,
        tail: COMETS.activity.tail * k,
        gasDir: dir.clone(),
        dustDir: dir
          .clone()
          .addScaledVector(heading, -COMETS.activity.dustBend)
          .normalize(),
        scanRange: COMETS.scanRange,
      },
    ];
  });
}

// ---------------------------------------------------------------- Earth's Moon (docs/PROCGEN.md §51.3)

/** What the Moon here would crowd that is not its own, if anything: as a comet would (§45.3), and the practice range. */
export function lunaCrowds(def: SystemSceneDef, at: THREE.Vector3, size: number): string | null {
  const others = { ...def, planets: def.planets.filter((p) => p.id !== "moon") };
  const hit = cometCrowds(others, at, size, LUNAR.clear);
  if (hit) return hit;
  const p = def.practice;
  return p && at.distanceTo(p.center) < size + p.radius + LUNAR.clear.practice ? "practice" : null;
}

/**
 * Earth's Moon in Sol's scene on a date: in its real direction from Earth's centre, `LUNAR.drawn`
 * out at its mean distance and nearer or farther as it really is; moved out along its direction
 * while it crowds anything, and if that is not enough (the lane to Mars runs out that way), turned
 * along its orbit the least it needs, which the scene's note then says. Before Sol's sky has arrived,
 * it stays where the scene first put it.
 */
function placeLuna(def: SystemSceneDef, jd: number): void {
  const earth = def.planets.find((p) => p.id === "earth");
  const moon = def.planets.find((p) => p.id === "moon");
  const place = moonPlace(jd);
  if (!earth || !moon || !place) return;
  const base = (LUNAR.drawn.distance * place.distKm) / MOON_DISTANCE_KM;
  const at = (dir: THREE.Vector3, d: number) => earth.position.clone().addScaledVector(dir, d);
  let dir = eclipticToScene(place.xyz).normalize();
  let d = base;
  for (let i = 0; i < LUNAR.stretches && lunaCrowds(def, at(dir, d), moon.radius); i++) d *= LUNAR.stretch;
  if (lunaCrowds(def, at(dir, d), moon.radius)) {
    const up = new THREE.Vector3(0, 1, 0);
    const turned = Array.from({ length: LUNAR.turnDeg }, (_, k) => k + 1)
      .flatMap((k) => [k, -k])
      .map((k) => dir.clone().applyAxisAngle(up, (k * Math.PI) / 180))
      .find((t) => !lunaCrowds(def, at(t, base), moon.radius));
    if (turned) {
      dir = turned;
      d = base;
      def.scaleNote = `${def.scaleNote} ${LUNAR_LINES.turned}`;
    }
  }
  moon.position = at(dir, d);
  moon.subtitle = LUNAR_LINES.target;
}

// ---------------------------------------------------------------- moons (docs/PROCGEN.md §48.3)

/** A moon's name and its planet's, filled into a line. */
export function fillMoon(text: string, moon: Moon): string {
  const planet = moon.planet.charAt(0).toUpperCase() + moon.planet.slice(1);
  return text.replace(/\{moon\}/g, moon.name).replace(/\{planet\}/g, planet);
}

/** How far out from its planet's drawn centre a moon is drawn: the planet's drawn radius × (distance in the planet's radii) ^ spread. */
export function moonDistance(planetRadius: number, moon: Moon): number {
  return (
    planetRadius *
    (moon.motion.aKm / moon.planetRadiusKm) ** MOONS.spread[moon.planet]
  );
}

/** A moon's drawn radius: on the scale Earth's Moon is drawn. */
export function moonRadius(moonDrawn: number, moon: Moon): number {
  return (moonDrawn * moon.radiusKm) / MOON_RADIUS_KM;
}

/**
 * The giant planets' large moons in Sol's scene on a date: each in its real direction from its
 * planet, at its compressed distance; and the planet turned to the axis its moons orbit round, so its
 * rings and its moons agree.
 */
function addMoons(def: SystemSceneDef, jd: number): void {
  const earthsMoon = def.planets.find((p) => p.id === "moon");
  if (!earthsMoon) return;
  for (const planet of [...def.planets]) {
    const moons = moonsOf(planet.id);
    const pole = planetPole(planet.id);
    if (!moons.length || !pole) continue;
    planet.pole = eclipticToScene(pole).normalize();
    for (const moon of moons) {
      const radius = moonRadius(earthsMoon.radius, moon);
      def.planets.push({
        id: moon.id,
        name: moon.name,
        subtitle: fillMoon(MOON_LINES.target, moon),
        position: planet.position
          .clone()
          .addScaledVector(
            eclipticToScene(moonAt(moon, jd)).normalize(),
            moonDistance(planet.radius, moon),
          ),
        radius,
        style: moon.id as PlanetStyle,
        hostStarId: "sun",
        spinSpeed: 0.004,
        scannable: true,
        scanRange: Math.max(9_000, radius * 4),
      });
    }
  }
}

// ---------------------------------------------------------------- asteroids (docs/PROCGEN.md §47.3)

/** An asteroid's drawn radius (its longest axis): larger than life, larger for a larger asteroid. */
export function asteroidRadius(asteroid: Asteroid): number {
  const s = ASTEROIDS.size;
  return s.base + s.perRootKm * Math.sqrt(asteroid.diameterKm ?? s.unknownKm);
}

/** Its drawn shape: each axis as a share of the longest, in proportion to its measured extent (none thinner than `flattest`). */
export function asteroidShape(asteroid: Asteroid): [number, number, number] {
  const axes = (asteroid.extentKm ?? "")
    .split("×")
    .map((x) => Number(x.trim()))
    .filter((x) => x > 0);
  if (!axes.length) return [1, 1, 1];
  while (axes.length < 3) axes.push(axes.at(-1)!);
  const longest = Math.max(...axes);
  const share = (x: number) => Math.max(ASTEROIDS.size.flattest, x / longest);
  return [share(axes[0]!), share(axes[2]!), share(axes[1]!)];
}

/** Its turning speed as drawn (radians a second): its own, `spinFaster` times over. */
export function asteroidSpin(asteroid: Asteroid): number {
  return asteroid.rotationHours
    ? ((2 * Math.PI) / (asteroid.rotationHours * 3_600)) * ASTEROIDS.spinFaster
    : 0;
}

/** Its colour as drawn: by its spectral type, lighter for a higher albedo. */
const TYPE_TINT: Record<string, string> = {
  C: "#5a5550",
  B: "#5a5550",
  G: "#5a5550",
  F: "#5a5550",
  S: "#8f7d68",
  Q: "#8f7d68",
  V: "#968c84",
  M: "#8c8d92",
  X: "#8c8d92",
};
export function asteroidColor(asteroid: Asteroid): string {
  const type = (
    asteroid.spectral.tholen ??
    asteroid.spectral.smass ??
    ""
  ).charAt(0);
  const light = Math.min(1.35, 0.75 + (asteroid.albedo ?? 0.15) * 1.4);
  return `#${new THREE.Color(TYPE_TINT[type] ?? "#7a736b").multiplyScalar(light).getHexString()}`;
}

/**
 * How far from Earth's centre a pass is drawn (§47.3): by the logarithm of its distance, from Earth's
 * surface (drawn at Earth's radius) to the Moon's mean distance (drawn where the Moon is drawn at
 * it, §51.3), and on at that rate beyond.
 */
export function nearEarthDistance(
  def: SystemSceneDef,
  km: number,
): number | null {
  const earth = def.planets.find((p) => p.id === "earth");
  if (!earth || !(km > 0)) return null;
  const f =
    Math.log(Math.max(km, EARTH_RADIUS_KM) / EARTH_RADIUS_KM) /
    Math.log(MOON_DISTANCE_KM / EARTH_RADIUS_KM);
  return earth.radius + (LUNAR.drawn.distance - earth.radius) * f;
}

/**
 * The asteroids in Sol's scene on a date: each in its real direction from the Sun, at its distance
 * compressed onto the planets' scale; while a pass's path from Earth covers the date, from Earth in
 * its real direction, nearer the nearer it is. Each is moved out along its direction while it crowds
 * anything.
 */
function placeAsteroids(def: SystemSceneDef, jd: number): SceneAsteroidDef[] {
  const earth = def.planets.find((p) => p.id === "earth")?.position;
  const placed: SceneAsteroidDef[] = [];
  for (const asteroid of ASTEROID_DATA.asteroids) {
    const radius = asteroidRadius(asteroid);
    const geo = geocentricOnPath(asteroid, jd);
    const nearKm = geo ? Math.hypot(...geo) * AU_KM : null;
    let d =
      geo && nearKm !== null && earth
        ? nearEarthDistance(def, nearKm)
        : compressedSolDistance(asteroidAt(asteroid, jd).r);
    if (d === null) continue;
    const near = geo !== null && earth !== undefined;
    const from = near ? earth.clone() : SUN.clone();
    const dir = eclipticToScene(
      near ? geo : asteroidAt(asteroid, jd).xyz,
    ).normalize();
    const at = () => from.clone().addScaledVector(dir, d!);
    for (
      let i = 0;
      i < STRETCH_TRIES &&
      (cometCrowds(def, at(), radius, ASTEROIDS.clear) ||
        smallBodyCrowds(def, placed, at(), radius));
      i++
    )
      d *= STRETCH;
    placed.push({
      id: asteroid.id,
      name: asteroid.name,
      subtitle: fillAsteroid(ASTEROID_LINES.target, asteroid, {}, jd),
      position: at(),
      radius,
      shape: asteroidShape(asteroid),
      spin: asteroidSpin(asteroid),
      color: asteroidColor(asteroid),
      near,
      scanRange: ASTEROIDS.scanRange,
    });
  }
  return placed;
}

// ---------------------------------------------------------------- spacecraft (docs/PROCGEN.md §49.3)

/**
 * The spacecraft in Sol's scene on a date: each where JPL Horizons has it, in its real direction from
 * the Sun at its distance compressed onto the planets' scale; while its path from Earth covers the
 * date, from Earth in its real direction, nearer the nearer it is. Each is moved out along its
 * direction while it crowds anything (the comets and asteroids, and the craft placed before it). One
 * Horizons has no place for on the date is not drawn.
 */
function placeCraft(def: SystemSceneDef, jd: number): SceneCraftDef[] {
  const earth = def.planets.find((p) => p.id === "earth")?.position;
  const placed: SceneCraftDef[] = [];
  const radius = SPACECRAFT.size;
  for (const craft of CRAFT_DATA.spacecraft) {
    const geo = craftOnPath(craft, jd);
    const near = geo !== null && earth !== undefined;
    const helio = near ? null : craftAt(craft, jd);
    if (!near && !helio) continue;
    let d = near
      ? nearEarthDistance(def, Math.hypot(...geo!) * AU_KM)
      : compressedSolDistance(helio!.r);
    if (d === null) continue;
    const from = near ? earth!.clone() : SUN.clone();
    const dir = eclipticToScene(near ? geo! : helio!.xyz).normalize();
    const at = () => from.clone().addScaledVector(dir, d!);
    for (
      let i = 0;
      i < STRETCH_TRIES && craftCrowds(def, placed, at(), radius);
      i++
    )
      d *= STRETCH;
    placed.push({
      id: craft.id,
      name: craft.name,
      subtitle: CRAFT_LINES.target,
      position: at(),
      radius,
      look: SPACECRAFT.look[craft.id] ?? "dish",
      near,
      scanRange: SPACECRAFT.scanRange,
    });
  }
  return placed;
}

/** What a spacecraft of this size here would crowd, if anything: what a comet would (with a craft's clearances), a comet or asteroid, or another craft. */
export function craftCrowds(
  def: SystemSceneDef,
  craft: readonly SceneCraftDef[],
  at: THREE.Vector3,
  size: number,
  self?: string,
): string | null {
  const hit =
    cometCrowds(def, at, size, SPACECRAFT.clear) ??
    smallBodyCrowds(def, def.asteroids ?? [], at, size);
  if (hit) return hit;
  for (const c of craft)
    if (
      c.id !== self &&
      at.distanceTo(c.position) < size + c.radius + SPACECRAFT.clear.planet
    )
      return c.id;
  return null;
}

/** The comet or asteroid (other than itself) an asteroid of this size here would crowd, if any (§47.3). */
export function smallBodyCrowds(
  def: SystemSceneDef,
  asteroids: readonly SceneAsteroidDef[],
  at: THREE.Vector3,
  size: number,
  self?: string,
): string | null {
  const clear = ASTEROIDS.clear.planet;
  for (const c of def.comets ?? [])
    if (at.distanceTo(c.position) < size + c.radius + c.coma + clear)
      return c.id;
  for (const a of asteroids)
    if (a.id !== self && at.distanceTo(a.position) < size + a.radius + clear)
      return a.id;
  return null;
}

function buildSolScene(
  positions: Record<string, THREE.Vector3>,
  layout: "real" | "real-nudged" | "schematic",
): SystemSceneDef {
  const earth = positions.earth!;
  const mars = positions.mars!;
  const earthToMars = dirTo(earth, mars);
  const earthPort = earth
    .clone()
    .addScaledVector(earthToMars, 2_900)
    .add(v(0, 600, 0));
  const marsDepot = mars
    .clone()
    .addScaledVector(earthToMars, -2_000)
    .add(v(0, 350, 0));
  const laneFrom = earthPort.clone().addScaledVector(earthToMars, 1_200);
  const laneTo = marsDepot.clone().addScaledVector(earthToMars, -3_200);
  const moon = earth.clone().add(v(3_600, 500, -2_200));
  const arrival = marsDepot.clone().add(v(4_200, 1_300, 5_600));

  return {
    systemId: "sol",
    skybox: {
      seed: 11,
      baseColor: "#03060d",
      nebulaColors: ["#1d4a6e", "#12304f", "#3a2f63"],
      nebulaIntensity: 0.45,
      starDensity: 0.8,
      bandTilt: 0.5,
    },
    ambient: { sky: "#9ab8e8", ground: "#1a1f2c", intensity: 0.32 },
    stars: [
      {
        id: "sun",
        name: "Sun",
        position: SUN,
        radius: 4_000,
        color: "#fff1d6",
        kind: "main-sequence",
        activity: 0.5,
        light: 2.6,
        lightRange: 400_000,
      },
    ],
    planets: [
      ...PLANETS.map<ScenePlanetDef>((p) => ({
        id: p.id,
        name: p.name,
        subtitle: `${p.subtitle} · schematic size and orbit`,
        position: positions[p.id]!,
        radius: p.radius,
        style: p.style,
        hostStarId: "sun",
        ...(p.rings ? { rings: p.rings } : {}),
        ...(p.tilt !== undefined ? { tilt: p.tilt } : {}),
        spinSpeed: 0.004,
        orbitCenter: SUN,
        scannable: true,
        scanRange: Math.max(9_000, p.radius * 4),
      })),
      {
        id: "moon",
        name: "Moon",
        subtitle: "Earth’s natural satellite · schematic size and distance",
        position: moon,
        radius: 430,
        style: "moon",
        hostStarId: "sun",
        scannable: true,
      },
    ],
    stations: [
      {
        locationId: "earth-port",
        kind: "earth-port",
        position: earthPort,
        approach: earthToMars.clone(),
      },
      {
        locationId: "mars-depot",
        kind: "mars-depot",
        position: marsDepot,
        approach: earthToMars.clone().negate(),
      },
    ],
    lanes: [
      {
        id: "sol-earth-mars",
        name: "Earth–Mars trade lane",
        fromName: "Lane to Mars",
        toName: "Lane to Earth",
        from: laneFrom,
        to: laneTo,
        ringSpacing: 2_000,
        speed: 2_600,
      },
    ],
    belts: [
      {
        id: "sol-main-belt",
        beltId: "sol-main-belt",
        center: SUN,
        shape: "ring",
        innerRadius: MAIN_BELT.inner,
        outerRadius: MAIN_BELT.outer,
        thickness: 2_400,
        count: { low: 500, medium: 1_000, high: 1_600 },
        sizeMin: 16,
        sizeMax: 130,
        color: "#8c8174",
        seed: 21,
      },
      {
        id: "sol-kuiper-belt",
        beltId: "sol-kuiper-belt",
        center: SUN,
        shape: "ring",
        innerRadius: KUIPER_BELT.inner,
        outerRadius: KUIPER_BELT.outer,
        thickness: 6_000,
        count: { low: 300, medium: 600, high: 1_000 },
        sizeMin: 30,
        sizeMax: 220,
        color: "#a9bccb",
        seed: 23,
      },
    ],
    dust: [
      {
        center: SUN,
        innerRadius: MAIN_BELT.inner - 2_000,
        outerRadius: MAIN_BELT.outer + 2_000,
        color: "#a09482",
        opacity: 0.1,
        seed: 7,
      },
      {
        center: SUN,
        innerRadius: KUIPER_BELT.inner - 4_000,
        outerRadius: KUIPER_BELT.outer + 4_000,
        color: "#9fb0c2",
        opacity: 0.08,
        seed: 8,
      },
    ],
    beacons: [
      {
        id: "sol-jump",
        name: "Sol jump beacon",
        position: arrival.clone().add(v(0, 0, 300)),
        kind: "jump",
      },
    ],
    scanZones: [],
    encounters: [
      {
        id: "mars-raider",
        center: marsDepot,
        radius: 7_500,
        spawnAhead: 1_300,
        bounty: 220,
      },
    ],
    practice: {
      center: earthPort
        .clone()
        .addScaledVector(earthToMars, 1_100)
        .add(v(-500, 350, 300)),
      count: 3,
      radius: 160,
    },
    arrival: { position: arrival, lookAt: marsDepot },
    orbitLines: true,
    scaleNote:
      layout === "schematic"
        ? "Planet sizes, spacing and positions are schematic, not today’s sky; the belts are placed schematically."
        : `Planets, comets, asteroids and spacecraft sit in their real directions from the Sun on the game date (JPL's data), and the Moon in its real direction from Earth; sizes and spacing are compressed, and the belts are placed schematically.${layout === "real-nudged" ? " Mars, behind the Sun, is drawn a little off its true place." : ""}`,
  };
}

let undated: { sky: number; def: SystemSceneDef } | null = null;

/**
 * The schematic layout (no date; its sky on the snapshot's day): worked out when first asked for,
 * and again once Sol's sky is in (docs/PROCGEN.md §50), so it is never kept without it.
 */
export function solSceneUndated(): SystemSceneDef {
  if (undated?.sky !== skyVersion()) undated = { sky: skyVersion(), def: solScene(null) };
  return undated.def;
}
