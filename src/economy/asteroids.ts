import { ASTEROID_CLASSES, ASTEROID_LINES, ASTEROID_TYPES, ASTEROIDS } from '../content/stellar/asteroids.ts';
import { rng } from '../content/random.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import {
  ASTEROID_DATA,
  ASTEROID_EPOCH_JD,
  AU_KM,
  asteroidAt,
  asteroidDistanceFromEarth,
  asteroidMagnitude,
  elementsOn,
  geocentricOnPath,
  nearEarthClass,
  nextApproach,
  orbitClassOn,
  type Asteroid,
  type CloseApproach,
} from '../data/asteroids.ts';
import { dateText, yearsText } from './binaries.ts';
import { gameJulianDate } from '../data/solar.ts';
import { COMET_SURE_DAYS, hearsOfSol, researchJumps, sightOf } from './comets.ts';

/**
 * Named asteroids in Sol (docs/PROCGEN.md §47): what the game says of JPL's asteroids on the game's
 * date, the News of a pass of Earth, and the tracking research stations near Sol post. Every number
 * comes from JPL's records and the date.
 */

/** An orbit class in words (JPL's code). */
export function className(code: string): string {
  return ASTEROID_CLASSES[code as keyof typeof ASTEROID_CLASSES] ?? code;
}

/** How near a pass comes, said: in km within 0.01 AU (to the hundred), else in AU. */
export function passDistanceText(au: number): string {
  return au < 0.01 ? `${(Math.round((au * AU_KM) / 100) * 100).toLocaleString('en-GB')} km` : `${au.toFixed(3)} AU`;
}

/** Fills a line about an asteroid (`{asteroid}`, `{class}`, `{period}`, `{moid}`, and any given). */
export function fillAsteroid(text: string, asteroid: Asteroid, extra: Record<string, string> = {}, jd = ASTEROID_EPOCH_JD): string {
  const values: Record<string, string> = {
    asteroid: asteroid.name,
    class: className(orbitClassOn(asteroid, jd)),
    period: yearsText(elementsOn(asteroid, jd).periodDays / 365.25),
    moid: String(ASTEROIDS.hazard.moidAu),
    ...extra,
  };
  return text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
}

/** A pass of Earth, said: its date, how near and how fast. */
export function passText(asteroid: Asteroid, pass: CloseApproach): string {
  return fillAsteroid(ASTEROID_LINES.pass, asteroid, { date: dateText(pass.jd), distance: passDistanceText(pass.distAu), speed: pass.vRelKms.toFixed(1) });
}

/** A size, said: in metres under a kilometre. */
function kmText(km: number): string {
  return km < 1 ? `${Math.round(km * 1_000)} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString('en-GB')} km`;
}

/** Its spectral type and what it says, from the first letter (Tholen's where given, else SMASSII's). */
export function spectralText(asteroid: Asteroid): string | null {
  const type = asteroid.spectral.tholen ?? asteroid.spectral.smass;
  if (!type) return null;
  const words = ASTEROID_TYPES[type.charAt(0) as keyof typeof ASTEROID_TYPES];
  return words ? `Type ${type}: ${words}` : `Type ${type}`;
}

/** How bright it looks from Earth, said. */
export function asteroidBrightnessText(asteroid: Asteroid, jd: number): string | null {
  const m = asteroidMagnitude(asteroid, jd);
  if (m === null) return null;
  const sight = sightOf(m);
  return fillAsteroid(sight === sightOf(99) ? ASTEROID_LINES.faint : ASTEROID_LINES.bright, asteroid, { magnitude: String(Math.round(m)), sight }, jd);
}

const au = (x: number) => (x < 10 ? x.toFixed(2) : x.toFixed(1));

export interface AsteroidFacts {
  asteroid: Asteroid;
  /** `{asteroid} goes round the Sun once every {period} years.` */
  headline: string;
  orbitClass: string;
  hazardous: string | null;
  period: string;
  perihelion: string;
  aphelion: string;
  eccentricity: string;
  inclination: string;
  size: string | null;
  shape: string | null;
  rotation: string | null;
  albedo: string | null;
  spectral: string | null;
  /** On the date: how far from the Sun and from Earth. */
  now: string;
  fromSun: string;
  brightness: string | null;
  /** Its next pass of Earth within 0.05 AU, if JPL lists one. */
  nextPass: string | null;
  /** A pass that changed, or will change, its orbit. */
  change: string | null;
  unsure: string | null;
  scene: string;
}

/** What is said of an asteroid on a date (a Julian date: the game's, or the elements' day). */
export function asteroidFacts(asteroid: Asteroid, jd: number): AsteroidFacts {
  const el = elementsOn(asteroid, jd);
  const at = asteroidAt(asteroid, jd);
  const delta = asteroidDistanceFromEarth(asteroid, jd);
  const fromSun = `${au(at.r)} AU from the Sun`;
  const pass = nextApproach(asteroid, jd);
  const done = asteroid.later.filter((l) => l.fromJd <= jd).at(-1);
  const coming = asteroid.later.find((l) => l.fromJd > jd);
  const change = done
    ? fillAsteroid(ASTEROID_LINES.changed, asteroid, { date: dateText(done.fromJd) }, jd)
    : coming
      ? fillAsteroid(ASTEROID_LINES.willChange, asteroid, { date: dateText(coming.fromJd), class: className(nearEarthClass(coming.elements) ?? asteroid.orbitClass.code) }, jd)
      : null;
  return {
    asteroid,
    headline: fillAsteroid(ASTEROID_LINES.headline, asteroid, {}, jd),
    orbitClass: className(orbitClassOn(asteroid, jd)),
    hazardous: asteroid.pha ? fillAsteroid(ASTEROID_LINES.hazardous, asteroid, {}, jd) : null,
    period: `${yearsText(el.periodDays / 365.25)} years`,
    perihelion: `${el.qAu.toFixed(2)} AU from the Sun`,
    aphelion: `${au(el.aAu * (1 + el.e))} AU from the Sun`,
    eccentricity: el.e.toFixed(3),
    inclination: `${el.inclinationDeg.toFixed(1)}°`,
    size: asteroid.diameterKm !== null ? `About ${kmText(asteroid.diameterKm)} across` : null,
    shape: asteroid.extentKm ? `${asteroid.extentKm} km` : null,
    rotation: asteroid.rotationHours !== null ? `Once every ${asteroid.rotationHours < 10 ? asteroid.rotationHours.toFixed(1) : Math.round(asteroid.rotationHours)} hours` : null,
    albedo: asteroid.albedo !== null ? `Reflects ${Math.round(asteroid.albedo * 100)}% of the light that falls on it` : null,
    spectral: spectralText(asteroid),
    now: delta !== null ? `${fromSun}; ${delta < 0.01 ? passDistanceText(delta) : `${au(delta)} AU`} from Earth` : fromSun,
    fromSun,
    brightness: asteroidBrightnessText(asteroid, jd),
    nextPass: pass ? passText(asteroid, pass) : null,
    change,
    // Unsure far from when the elements in use were taken, unless a pass's own path gives where it is.
    unsure: geocentricOnPath(asteroid, jd) === null && Math.abs(jd - (done?.fromJd ?? ASTEROID_EPOCH_JD)) > COMET_SURE_DAYS ? ASTEROID_LINES.unsure : null,
    scene: ASTEROID_LINES.scene,
  };
}

/** Every asteroid, said on a date. */
export function allAsteroidFacts(jd: number): AsteroidFacts[] {
  return ASTEROID_DATA.asteroids.map((a) => asteroidFacts(a, jd));
}

// ---------------------------------------------------------------- the News

/** Whether a station hears of passes of Earth: Sol's own, and research stations within reach (§47.4). */
export function hearsOfAsteroids(locationId: string): boolean {
  return hearsOfSol(locationId, ASTEROIDS.news.reach);
}

export interface AsteroidNews {
  asteroid: Asteroid;
  pass: CloseApproach;
  passed: boolean;
  headline: string;
  detail: string;
  brightness: string | null;
}

/** The passes of Earth within the News's window of a date, nearest first (§47.4). */
export function asteroidNews(jd: number): AsteroidNews[] {
  const days = ASTEROIDS.news.days;
  return ASTEROID_DATA.asteroids
    .flatMap((asteroid) =>
      asteroid.approaches
        .filter((p) => Math.abs(p.jd - jd) <= days)
        .map((pass): AsteroidNews => {
          const passed = pass.jd <= jd;
          const values = { date: dateText(pass.jd), distance: passDistanceText(pass.distAu), speed: pass.vRelKms.toFixed(1) };
          return {
            asteroid,
            pass,
            passed,
            headline: fillAsteroid(passed ? ASTEROID_LINES.news.passed : ASTEROID_LINES.news.coming, asteroid, {}, jd),
            detail: fillAsteroid(passed ? ASTEROID_LINES.news.passedDetail : ASTEROID_LINES.news.comingDetail, asteroid, values, jd),
            brightness: asteroidBrightnessText(asteroid, jd),
          };
        }),
    )
    .sort((a, b) => Math.abs(a.pass.jd - jd) - Math.abs(b.pass.jd - jd));
}

// ---------------------------------------------------------------- tracking

/** The near-Earth asteroids, which stations want tracked (§47.5). */
export const TRACKED = ASTEROID_DATA.asteroids.filter((a) => a.neo);

/** How many jumps from Sol a station is, if it is a research station that could post tracking (§47.5). */
export function trackingJumps(locationId: string): number | null {
  const jumps = researchJumps(locationId);
  return jumps !== null && jumps <= ASTEROIDS.track.reach ? jumps : null;
}

/** When the save the game points at began (its calendar's first day), for the boards; null before one is set. */
let gameStart: string | null = null;
export function useGameStart(createdAt: string | null): void {
  gameStart = createdAt;
}
/** The boards' key for it. */
export const gameStartKey = (): string => gameStart ?? '';

/** The game's date at a clock time in the save the game points at (null before one is set). */
export function boardDate(clock: number): number | null {
  return gameStart === null ? null : gameJulianDate(gameStart, clock);
}

/** The near-Earth asteroid passing Earth within `passDays` of a date, nearest first, if any. */
export function passingAsteroid(jd: number): { asteroid: Asteroid; pass: CloseApproach } | null {
  const near = TRACKED.flatMap((asteroid) => asteroid.approaches.filter((p) => Math.abs(p.jd - jd) <= ASTEROIDS.track.passDays).map((pass) => ({ asteroid, pass })));
  return near.sort((a, b) => Math.abs(a.pass.jd - jd) - Math.abs(b.pass.jd - jd))[0] ?? null;
}

/**
 * The asteroid a station wants tracked in a time slot, if any: from its own random stream; within
 * `passDays` of a pass of Earth (on the slot's game date), the one passing.
 */
export function trackOffer(locationId: string, epoch: number, jd: number | null): { asteroid: Asteroid; jumps: number; pass: CloseApproach | null } | null {
  const jumps = trackingJumps(locationId);
  if (jumps === null) return null;
  const r = rng(WORLD_SEED, 'asteroids', 'track', locationId, epoch);
  if (r.next() >= ASTEROIDS.track.odds) return null;
  const passing = jd === null ? null : passingAsteroid(jd);
  return passing ? { asteroid: passing.asteroid, jumps, pass: passing.pass } : { asteroid: r.pick(TRACKED), jumps, pass: null };
}

/** What tracking pays, so many jumps off. */
export function trackReward(jumps: number): number {
  return ASTEROIDS.track.reward + ASTEROIDS.track.perJump * jumps;
}
