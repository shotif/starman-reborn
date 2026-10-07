import { CRAFT_LINES, CRAFT_STORIES, SPACECRAFT, type CraftFact, type CraftSource, type CraftStory } from '../content/stellar/spacecraft.ts';
import { AU_KM } from '../data/asteroids.ts';
import { CRAFT_DATA, CRAFT_EPOCH_JD, LIGHT_KMS, arcOn, craftAt, craftFromEarth, craftLeaving, craftOn, craftSpeedKms, nextCraftPass, type CraftPass, type Spacecraft } from '../data/spacecraft.ts';
import { dateText, yearsText } from './binaries.ts';
import { passDistanceText } from './asteroids.ts';
import { hearsOfSol } from './comets.ts';

/**
 * Spacecraft out in Sol (docs/PROCGEN.md §49): what the game says of each craft on the game's date,
 * its mission's facts as its sources give them, and the News of a pass of Earth. Every number comes
 * from JPL Horizons' places and the date, or is quoted.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A fact's date, said: a day (`5 September 1977`) or, where its source gives only the month, the month (`January 2029`). */
export function factDateText(on: string): string {
  const [y, m, d] = on.split('-').map(Number) as [number, number, number?];
  return d === undefined ? `${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]} ${y}`;
}

/** The Julian date a fact's date begins (a month's first day where only the month is given). */
export function factJd(on: string): number {
  const [y, m, d] = on.split('-').map(Number) as [number, number, number?];
  return Date.UTC(y, m - 1, d ?? 1) / 86_400_000 + 2_440_587.5;
}

/** Fills a line about a craft (`{craft}`, and any given). */
export function fillCraft(text: string, craft: Spacecraft, extra: Record<string, string> = {}): string {
  const values: Record<string, string> = { craft: craft.name, ...extra };
  return text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
}

/** A distance from the Sun, said in AU: two decimals under 10, one under 100, whole beyond. */
export function craftAuText(au: number): string {
  return `${au < 10 ? au.toFixed(2) : au < 100 ? au.toFixed(1) : Math.round(au).toLocaleString('en-GB')} AU`;
}

/** A distance from Earth, said: in km under a million (to the thousand), in millions of km under 0.1 AU, else in AU. */
export function craftEarthText(au: number): string {
  const km = au * AU_KM;
  if (km < 1e6) return `${(Math.round(km / 1_000) * 1_000).toLocaleString('en-GB')} km`;
  return au < 0.1 ? `${(km / 1e6).toFixed(2)} million km` : craftAuText(au);
}

/** How long light takes to cross a distance (au), said: in seconds under two minutes, minutes under two hours, else hours and minutes. */
export function lightTimeText(au: number): string {
  const s = (au * AU_KM) / LIGHT_KMS;
  if (s < 120) return `${s < 10 ? s.toFixed(1) : Math.round(s)} seconds`;
  if (s < 7_200) return `${Math.round(s / 60)} minutes`;
  const minutes = Math.round(s / 60);
  return `${Math.floor(minutes / 60)} hours ${minutes % 60} minutes`;
}

/** How long a path takes round the Sun, said: in days under a year, else in years. */
function periodText(days: number): string {
  return days < 365.25 ? `${Math.round(days)} days` : `${yearsText(days / 365.25)} years`;
}

/** A pass of Earth, said: when, and how near its centre. */
export function craftPassText(craft: Spacecraft, pass: CraftPass): string {
  return fillCraft(CRAFT_LINES.pass, craft, { date: dateText(pass.jd), near: passDistanceText(pass.au) });
}

/** The story of a craft (every craft has one: the guardrails check it). */
export function storyOf(craft: Spacecraft): CraftStory {
  return CRAFT_STORIES[craft.id]!;
}

/** A source by name, as the card cites it. */
export function sourceName(source: CraftSource): string {
  return source === 'horizons' ? CRAFT_DATA.sources.horizons.label : 'NASA NSSDCA';
}

export interface CraftEvent {
  date: string;
  line: string;
  source: string;
}

export interface CraftFacts {
  craft: Spacecraft;
  /** `{craft} is {distance} from the Sun.`, or null where Horizons has no place for it on the date. */
  headline: string | null;
  kind: string;
  summary: string;
  launched: string;
  /** On the date: from the Sun and from Earth, how long light takes to Earth, how fast it goes, its path and its next pass of Earth. */
  fromSun: string | null;
  fromEarth: string | null;
  light: string | null;
  speed: string | null;
  path: string | null;
  nextPass: string | null;
  /** What it has done, and what was planned for it as of the snapshot. */
  done: CraftEvent[];
  planned: CraftEvent[];
  plannedHeading: string;
  notes: string[];
  away: string | null;
  scene: string;
  sources: string;
}

const eventOf = (f: CraftFact): CraftEvent => ({ date: factDateText(f.on!), line: f.line, source: sourceName(f.source) });

/** What is said of a craft on a date (a Julian date: the game's, or the snapshot's day). */
export function craftFacts(craft: Spacecraft, jd: number): CraftFacts {
  const story = storyOf(craft);
  const at = craftAt(craft, jd);
  const geo = craftFromEarth(craft, jd);
  const delta = geo ? Math.hypot(...geo) : null;
  const speed = craftSpeedKms(craft, jd);
  const el = arcOn(craft, jd);
  const pass = nextCraftPass(craft, jd);
  // Planned or done as of the snapshot: what the sources said then.
  const planned = (f: CraftFact) => factJd(f.on!) > CRAFT_EPOCH_JD;
  return {
    craft,
    headline: at ? fillCraft(CRAFT_LINES.headline, craft, { distance: craftAuText(at.r) }) : null,
    kind: `Spacecraft · ${story.agency.line}`,
    summary: story.summary.line,
    launched: factDateText(story.launched.on!),
    fromSun: at ? craftAuText(at.r) : null,
    fromEarth: delta !== null ? craftEarthText(delta) : null,
    light: delta !== null ? fillCraft(CRAFT_LINES.light, craft, { light: lightTimeText(delta) }) : null,
    speed: speed !== null ? `${speed.toFixed(1)} km/s, relative to the Sun` : null,
    path: !at ? null : craftLeaving(craft, jd) ? CRAFT_LINES.leaving : el ? fillCraft(CRAFT_LINES.bound, craft, { period: periodText(el.periodDays) }) : null,
    nextPass: pass && craftOn(craft, jd) ? craftPassText(craft, pass) : null,
    done: story.events.filter((f) => !planned(f)).map(eventOf),
    planned: story.events.filter(planned).map(eventOf),
    plannedHeading: fillCraft(CRAFT_LINES.planned, craft, { date: dateText(CRAFT_EPOCH_JD) }),
    notes: story.notes.map((f) => f.line),
    away: at ? null : CRAFT_LINES.away,
    scene: CRAFT_LINES.scene,
    sources: `${CRAFT_DATA.sources.horizons.label} (${craft.solution})${craft.nssdca ? `; NASA NSSDCA (${craft.cospar})` : ''}, ${CRAFT_DATA.retrieved}`,
  };
}

/** Every craft, said on a date. */
export function allCraftFacts(jd: number): CraftFacts[] {
  return CRAFT_DATA.spacecraft.map((c) => craftFacts(c, jd));
}

// ---------------------------------------------------------------- the News

/** Whether a station hears of a craft passing Earth: Sol's own, and research stations within reach (§49.4). */
export function hearsOfCraft(locationId: string): boolean {
  return hearsOfSol(locationId, SPACECRAFT.news.reach);
}

export interface CraftNews {
  craft: Spacecraft;
  pass: CraftPass;
  passed: boolean;
  line: string;
}

/** The craft passing Earth within the News's window of a date, nearest in time first (§49.4). */
export function craftNews(jd: number): CraftNews[] {
  return CRAFT_DATA.spacecraft
    .flatMap((craft) =>
      craft.passes
        .filter((p) => Math.abs(p.jd - jd) <= SPACECRAFT.news.days)
        .map((pass): CraftNews => {
          const passed = pass.jd <= jd;
          return { craft, pass, passed, line: fillCraft(passed ? CRAFT_LINES.newsPassed : CRAFT_LINES.news, craft, { date: dateText(pass.jd), near: passDistanceText(pass.au) }) };
        }),
    )
    .sort((a, b) => Math.abs(a.pass.jd - jd) - Math.abs(b.pass.jd - jd));
}
