import { ECLIPSE_PLACES, LUNAR, LUNAR_LINES } from '../content/stellar/lunar.ts';
import { eclipsesFrom, LUNAR_DATA, moonPhase, moonPlace, nextPhase, type Eclipse, type MoonPhase } from '../data/lunar.ts';
import { dateText } from './binaries.ts';

/**
 * Earth's Moon (docs/PROCGEN.md §51): what the game says of it on the game's date (its phase, how much
 * of it is lit, how far it is, when it is next full and new) and of NASA's eclipses, and the News of
 * one coming. Every number comes from JPL Horizons' Moon and the date, or NASA's tables.
 */

/** Fills a line (`{name}` from the values given). */
export function fillLunar(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
}

export type PhaseWord = keyof typeof LUNAR_LINES.phases;

/** A phase's name: new, first quarter, full or last quarter within `LUNAR.namedWithinDeg` of it, else waxing or waning, crescent or gibbous. */
export function phaseWord(p: MoonPhase): PhaseWord {
  const e = p.elongationDeg;
  const near = (at: number) => Math.abs(((((e - at) % 360) + 540) % 360) - 180) <= LUNAR.namedWithinDeg;
  if (near(0)) return 'new';
  if (near(90)) return 'first quarter';
  if (near(180)) return 'full';
  if (near(270)) return 'last quarter';
  if (e < 90) return 'waxing crescent';
  if (e < 180) return 'waxing gibbous';
  if (e < 270) return 'waning gibbous';
  return 'waning crescent';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** An eclipse's date as NASA's table gives it, said: `2 August 2027`. */
export function eclipseDateText(e: Eclipse): string {
  const [y, m, d] = e.date.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** One of NASA's places, said in full: `w & s Asia` → `western and southern Asia`, `c US` → `the central United States`. */
export function placeText(nasa: string): string {
  let text = nasa.trim();
  const names = Object.entries(ECLIPSE_PLACES.names).sort((a, b) => b[0].length - a[0].length);
  // Whole names first, where they stand as words.
  for (const [short, full] of names) {
    const at = new RegExp(`(^|[\\s&])${short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s&])`, 'g');
    text = text.replace(at, (_, before: string) => `${before}${full}`);
  }
  const words = text.split(/\s+/);
  const sides: string[] = [];
  while (words.length > 1 && (words[0]! in ECLIPSE_PLACES.sides || words[0] === '&')) {
    const w = words.shift()!;
    sides.push(w === '&' ? 'and' : ECLIPSE_PLACES.sides[w as keyof typeof ECLIPSE_PLACES.sides]);
  }
  const place = words.join(' ').replace(/ & /g, ' and ');
  const the = (ECLIPSE_PLACES.withThe as readonly string[]).includes(place) ? 'the ' : '';
  return `${the}${[...sides, place].join(' ')}`;
}

/** A list of NASA's places, said: `Africa, Europe, Mid East, w & s Asia` → `Africa, Europe, the Middle East and western and southern Asia`. */
export function placesText(nasa: string): string {
  const items = nasa
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map(placeText);
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? '');
}

/** A central eclipse's path, said: `Total: Mexico, c US, e Canada` → `Mexico, the central United States and eastern Canada`. */
export function pathText(e: Eclipse): string | null {
  return e.path === null ? null : placesText(e.path.replace(/^[A-Za-z]+:\s*/, ''));
}

const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** A duration as NASA writes it, said: `06m23s` → `6 minutes 23 seconds`, `01h11m` → `1 hour 11 minutes`. */
export function durationText(nasa: string): string {
  const m = /^(\d+)([hm])(\d+)([ms])$/.exec(nasa.trim());
  if (!m) throw new Error(`A duration NASA's tables do not write so: ${nasa}`);
  const [big, small] = [Number(m[1]), Number(m[3])];
  const names = m[2] === 'h' ? (['hour', 'minute'] as const) : (['minute', 'second'] as const);
  return [big ? unit(big, names[0]) : '', small ? unit(small, names[1]) : ''].filter(Boolean).join(' ');
}

/** An eclipse, said in one line, in NASA's words spelled out. */
export function eclipseLine(e: Eclipse): string {
  const lines = LUNAR_LINES.eclipse[e.kind] as Record<string, string>;
  const line = lines[e.type];
  if (!line) throw new Error(`An eclipse of a kind the game does not say: ${e.kind} ${e.type}`);
  const [first, second] = (e.duration ?? '').split(' ');
  const values: Record<string, string> = { date: eclipseDateText(e), regions: placesText(e.regions), path: pathText(e) ?? '' };
  if (e.kind === 'solar' && first) values.duration = durationText(first);
  if (e.kind === 'lunar' && first) values.partial = durationText(first);
  if (e.kind === 'lunar' && second) values.total = durationText(second);
  return fillLunar(line, values);
}

export interface LunarFacts {
  phase: MoonPhase;
  word: PhaseWord;
  /** `The Moon is a waxing gibbous, 78% lit.` */
  headline: string;
  lit: string;
  distance: string;
  nextFull: string | null;
  nextNew: string | null;
  /** The next eclipse of the Sun and of the Moon, and every one within `LUNAR.cardDays`. */
  nextSolar: Eclipse | null;
  nextLunar: Eclipse | null;
  coming: Eclipse[];
  scene: string;
}

/** The percentage of the Moon lit, said: whole, but never 0 or 100 unless it is so to a tenth. */
export function litText(lit: number): string {
  const pct = lit * 100;
  const whole = Math.round(pct);
  if (whole === 0 && pct >= 0.05) return '1';
  if (whole === 100 && pct < 99.95) return '99';
  return String(whole);
}

/** The Moon on a date, said; null before Sol's sky has arrived or where it cannot be reckoned. */
export function lunarFacts(jd: number): LunarFacts | null {
  const phase = moonPhase(jd);
  const place = moonPlace(jd);
  if (!phase || !place) return null;
  const word = phaseWord(phase);
  const lit = litText(phase.lit);
  const full = nextPhase(jd, 'full');
  const fresh = nextPhase(jd, 'new');
  const coming = eclipsesFrom(jd).filter((e) => e.jd <= jd + LUNAR.cardDays);
  return {
    phase,
    word,
    headline: fillLunar(LUNAR_LINES.headline, { phase: LUNAR_LINES.phases[word], lit }),
    lit,
    distance: fillLunar(LUNAR_LINES.distance, { distance: (Math.round(place.distKm / 100) * 100).toLocaleString('en-GB') }),
    nextFull: full === null ? null : dateText(full),
    nextNew: fresh === null ? null : dateText(fresh),
    nextSolar: eclipsesFrom(jd, 'solar')[0] ?? null,
    nextLunar: eclipsesFrom(jd, 'lunar')[0] ?? null,
    coming,
    scene: LUNAR_LINES.scene,
  };
}

// ---------------------------------------------------------------- the News

export interface EclipseNews {
  eclipse: Eclipse;
  /** Whole days from the game's date to the eclipse's (0 on the day). */
  days: number;
  line: string;
  when: string;
}

/** The eclipses coming within `LUNAR.newsDays` of a date, soonest first, with the day itself (§51.4). */
export function eclipseNews(jd: number): EclipseNews[] {
  const today = Math.floor(jd - 0.5);
  return LUNAR_DATA.eclipses
    .map((eclipse) => ({ eclipse, days: Math.floor(eclipse.jd - 0.5) - today }))
    .filter(({ days }) => days >= 0 && days <= LUNAR.newsDays)
    .map(({ eclipse, days }) => ({
      eclipse,
      days,
      line: eclipseLine(eclipse),
      when: days === 0 ? LUNAR_LINES.when.today : days === 1 ? LUNAR_LINES.when.tomorrow : fillLunar(LUNAR_LINES.when.days, { n: String(days) }),
    }));
}
