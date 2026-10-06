import * as THREE from "three";
import { COMET_LINES, COMETS } from "../../content/stellar/comets.ts";
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
import { activity, fillComet } from "../../economy/comets.ts";
import type {
  SceneCometDef,
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
const KUIPER_BELT = { inner: orbitOf("neptune") + 14_000, outer: orbitOf("neptune") + 58_000 };

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
  // The comets where they stand on the game date (without one, on the day their elements were taken).
  def.comets = placeComets(def, jd ?? COMET_EPOCH_JD);
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
    a.orbit + ((b.orbit - a.orbit) * Math.log(au / a.au)) / Math.log(b.au / a.au)
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

/** What a comet of this size here would crowd that is not its own, if anything (§45.3). */
export function cometCrowds(
  def: SystemSceneDef,
  at: THREE.Vector3,
  size: number,
): string | null {
  const c = COMETS.clear;
  if (at.distanceTo(def.arrival.position) < size + c.arrival) return "arrival";
  for (const b of def.beacons)
    if (at.distanceTo(b.position) < size + c.arrival) return b.id;
  for (const s of def.stations)
    if (at.distanceTo(s.position) < size + c.station) return s.locationId;
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
        : `Planets and comets sit in their real directions from the Sun on the game date (JPL's elements); sizes and spacing are compressed, and the belts are placed schematically.${layout === "real-nudged" ? " Mars, behind the Sun, is drawn a little off its true place." : ""}`,
  };
}

/** The schematic layout (no date). */
export const SOL_SCENE: SystemSceneDef = solScene(null);
