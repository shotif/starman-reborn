/**
 * Finding a system on the star map by name (pure, no DOM): systems, their stars, planets, stations
 * and belts, the Solar System's own bodies, the common catalogue names of the stars, and the pilot's
 * own outposts (docs/PROCGEN.md §38.4). Matching
 * ignores case, accents and punctuation, takes Greek letters spelled out, and forgives a typo or two
 * in longer words. One hit per system, best first.
 */
import { BELTS, MAP_SYSTEMS, SOLAR_BODIES, componentsOf } from '../data/systems.ts';
import type { StarSystemRecord, SystemId } from '../data/types.ts';

export type SearchKind = 'system' | 'star' | 'planet' | 'moon' | 'station' | 'outpost' | 'belt' | 'catalogue';

export interface SearchEntry {
  systemId: SystemId;
  kind: SearchKind;
  /** The name as shown. */
  name: string;
  /** Another name for something already listed (an archive's planet name, a catalogue variant): ranks after the shown names. */
  alias: boolean;
  norm: string;
  /** Index in `name` of the character behind each character of `norm` (for highlighting). */
  map: number[];
  /** Start of each word in `norm`. */
  starts: number[];
}

export interface SearchHit {
  systemId: SystemId;
  /** The name that matched best: the system's own, or a star, planet, station or belt in it. */
  name: string;
  kind: SearchKind;
  /** The matched part of `name` ([start, end)), for highlighting; null for a fuzzy match. */
  range: [number, number] | null;
}

export interface SearchOptions {
  /** Most systems returned (default 30). */
  limit?: number;
  /** Ties go to the systems nearest this one (default: nearest Sol). */
  near?: SystemId;
}

const GREEK: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu',
  ν: 'nu', ξ: 'xi', ο: 'omicron', π: 'pi', ρ: 'rho', σ: 'sigma', ς: 'sigma', τ: 'tau', υ: 'upsilon', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
};

/** Apostrophes and dots vanish ("Barnard's" → "barnards"); any other non-alphanumeric run is a space. */
const DROP = /['’‘`.]/;

/** Lower case, no accents or punctuation, Greek letters spelled out, single spaces between words. */
export function normalizeName(text: string): string {
  return normalizeWithMap(text).norm;
}

function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let space = true;
  let i = 0;
  for (const ch of text) {
    const at = i;
    i += ch.length;
    if (DROP.test(ch)) continue;
    const lower = ch.toLowerCase();
    const plain = GREEK[lower] ?? lower.normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const c of plain) {
      if (/[a-z0-9]/.test(c)) {
        if (space && norm.length > 0) {
          norm += ' ';
          map.push(at);
        }
        norm += c;
        map.push(at);
        space = false;
      } else {
        space = true;
      }
    }
  }
  return { norm, map };
}

function entry(systemId: SystemId, kind: SearchKind, name: string, alias: boolean): SearchEntry {
  const { norm, map } = normalizeWithMap(name);
  const starts: number[] = [];
  for (let i = 0; i < norm.length; i++) if (norm[i] !== ' ' && (i === 0 || norm[i - 1] === ' ')) starts.push(i);
  return { systemId, kind, name, alias, norm, map, starts };
}

/** A catalogue name worth matching (Gliese, Hipparcos, Luyten…), not a 19-digit Gaia id or an internal slug. */
function usefulCatalogue(id: string | undefined): id is string {
  return !!id && !/^(gaia|\d+$)/i.test(id) && !/^[a-z0-9]+(-[a-z0-9]+)+$/.test(id);
}

/** SIMBAD's main identifier without its type prefix ("NAME Barnard's star", "* alf Cen A", "V* V645 Cen"). */
function simbadName(id: string | undefined): string | undefined {
  return id?.replace(/^(NAME|\*\*|\*|V\*)\s+/, '');
}

/** Gliese numbers go by three spellings: "Gliese 699", "GJ 699" and "Gl 699". */
function glieseVariants(name: string): string[] {
  const m = /^(gliese|gj|gl)\s*(\d.*)$/i.exec(name.trim());
  return m ? [`Gliese ${m[2]}`, `GJ ${m[2]}`, `Gl ${m[2]}`] : [];
}

export function buildSearchIndex(systems: readonly StarSystemRecord[] = MAP_SYSTEMS): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const s of systems) {
    const seen = new Set<string>();
    const add = (kind: SearchKind, name: string | undefined, alias = false) => {
      if (!name) return;
      const e = entry(s.id, kind, name, alias);
      if (!e.norm || seen.has(e.norm)) return;
      seen.add(e.norm);
      out.push(e);
    };
    const stars = componentsOf(s.id);
    add('system', s.displayName);
    if (s.id === 'sol') {
      for (const b of SOLAR_BODIES) add(b.kind === 'star' ? 'star' : b.kind === 'moon' ? 'moon' : 'planet', b.name);
    }
    for (const c of stars) add('star', c.name);
    for (const p of s.confirmedBodies) add('planet', p.displayName);
    for (const l of s.fictionalLocations) add('station', l.name);
    for (const b of BELTS) if (b.systemId === s.id) add('belt', b.name);
    // Other names: the archives' planet names, catalogue numbers and their other spellings.
    for (const p of s.confirmedBodies) add('planet', p.archiveName, true);
    const catalogue = [s.catalogId, ...stars.flatMap((c) => [c.catalogIds.gliese, c.catalogIds.hip, simbadName(c.catalogIds.simbad)])].filter(usefulCatalogue);
    for (const id of catalogue) add('catalogue', id, true);
    for (const name of [s.displayName, ...stars.map((c) => c.name), ...catalogue]) {
      for (const v of glieseVariants(name)) add('catalogue', v, true);
    }
  }
  return out;
}

/** The pilot's own outposts as search entries (a save's own, so never in the shared index). */
export function outpostEntries(outposts: readonly { systemId: SystemId; name: string }[]): SearchEntry[] {
  return outposts.map((o) => entry(o.systemId, 'outpost', o.name, false)).filter((e) => e.norm);
}

let defaultIndex: SearchEntry[] | null = null;

/** The index over every system on the map (built on first use). */
export function searchIndex(): SearchEntry[] {
  defaultIndex ??= buildSearchIndex();
  return defaultIndex;
}

const KIND_RANK: Record<SearchKind, number> = { system: 0, star: 1, station: 2, outpost: 2, planet: 3, moon: 3, belt: 4, catalogue: 5 };

/** Optimal-string-alignment distance from `a` to the closest prefix of `b` (typos while typing). */
export function prefixDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  let prev2: number[] = new Array<number>(m + 1).fill(0);
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  let best = n === 0 ? 0 : Infinity;
  for (let i = 1; i <= n; i++) {
    const cur: number[] = new Array<number>(m + 1);
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur[j] = v;
    }
    prev2 = prev;
    prev = cur;
  }
  for (let j = 0; j <= m; j++) best = Math.min(best, prev[j]!);
  return best;
}

/** Typos forgiven in a query word of this length. */
function allowedTypos(len: number): number {
  return len >= 7 ? 2 : len >= 4 ? 1 : 0;
}

interface Scored {
  e: SearchEntry;
  /** 0 the whole name, 1 the start of a word (or every query word starts one), 2 inside a word, 3 with typos. */
  tier: number;
  pos: number;
  range: [number, number] | null;
}

function score(e: SearchEntry, q: string, words: readonly string[]): Scored | null {
  const at = e.norm.indexOf(q);
  if (at === 0 && e.norm.length === q.length) return { e, tier: 0, pos: 0, range: [0, q.length] };
  if (at === 0 || (at > 0 && e.norm[at - 1] === ' ')) return { e, tier: 1, pos: at, range: [at, at + q.length] };
  // Every query word starts a different word of the name, in any order ("proxima b").
  if (words.length > 1) {
    const used = new Set<number>();
    for (const w of words) {
      const st = e.starts.find((i) => !used.has(i) && e.norm.startsWith(w, i));
      if (st === undefined) break;
      used.add(st);
    }
    if (used.size === words.length) return { e, tier: 1, pos: Math.min(...used), range: null };
  }
  // Inside a word only from two letters on: one letter is in nearly every name.
  if (at > 0 && q.length >= 2) return { e, tier: 2, pos: at, range: [at, at + q.length] };
  return null;
}

/** With typos: every query word close to the start of some word of the name. */
function scoreTypos(e: SearchEntry, words: readonly string[]): Scored | null {
  const nameWords = e.norm.split(' ');
  for (const w of words) {
    const allowed = allowedTypos(w.length);
    if (!nameWords.some((nw) => (allowed === 0 ? nw.startsWith(w) : prefixDistance(w, nw) <= allowed))) return null;
  }
  return { e, tier: 3, pos: 0, range: null };
}

/**
 * Ranks two matches: tier, then kind (a system's own name first). Within one system, the shown
 * name before another name for the same thing, and the earlier, closer match.
 */
function compare(a: Scored, b: Scored, sameSystem: boolean): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (sameSystem && a.e.alias !== b.e.alias) return a.e.alias ? 1 : -1;
  const kind = KIND_RANK[a.e.kind] - KIND_RANK[b.e.kind];
  if (kind !== 0 || !sameSystem) return kind;
  return a.pos - b.pos || a.e.norm.length - b.e.norm.length;
}

function distanceBetween(a: StarSystemRecord, b: StarSystemRecord): number {
  return Math.hypot(a.positionLy[0] - b.positionLy[0], a.positionLy[1] - b.positionLy[1], a.positionLy[2] - b.positionLy[2]);
}

/** Systems matching `query`, best first (one hit each, under the name that matched best). */
export function searchSystems(query: string, opts: SearchOptions = {}, index: readonly SearchEntry[] = searchIndex()): SearchHit[] {
  const q = normalizeName(query);
  if (!q) return [];
  const words = q.split(' ');
  const best = new Map<SystemId, Scored>();
  const keep = (s: Scored | null) => {
    if (!s) return;
    const prev = best.get(s.e.systemId);
    if (!prev || compare(s, prev, true) < 0) best.set(s.e.systemId, s);
  };
  for (const e of index) keep(score(e, q, words));
  // Typos are forgiven only when nothing matches as typed.
  if (best.size === 0) for (const e of index) keep(scoreTypos(e, words));
  const hits = [...best.values()];
  const byId = new Map(MAP_SYSTEMS.map((s) => [s.id, s]));
  const from = byId.get(opts.near ?? 'sol') ?? byId.get('sol');
  const dist = (id: SystemId) => {
    const s = byId.get(id);
    return s && from ? distanceBetween(s, from) : 0;
  };
  // Across systems, the nearer of two equally good matches comes first.
  hits.sort((a, b) => compare(a, b, false) || dist(a.e.systemId) - dist(b.e.systemId) || a.e.name.localeCompare(b.e.name));
  return hits.slice(0, opts.limit ?? 30).map((h) => ({
    systemId: h.e.systemId,
    name: h.e.name,
    kind: h.e.kind,
    range: h.range ? [h.e.map[h.range[0]]!, endIndex(h.e, h.range[1])] : null,
  }));
}

/** Index in the name just past the character behind `norm[end - 1]`. */
function endIndex(e: SearchEntry, end: number): number {
  const at = e.map[end - 1]!;
  const cp = e.name.codePointAt(at)!;
  return at + (cp > 0xffff ? 2 : 1);
}
