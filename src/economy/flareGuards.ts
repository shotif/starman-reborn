import { FLARE_CARD, FLARE_COMMS, FLARE_FICTION, FLARE_HUD, FLARE_MAP, FLARE_NEWS, FLARE_TARGET, FLARE_WATCH, FLARE_WORD } from '../content/stellar/flareLines.ts';
import { FLARE_STARS, FLARES, type FlareKind, type FlareStar } from '../content/stellar/flares.ts';
import type { Issue } from '../content/validate.ts';
import { ALL_LOCATIONS, getComponent, SYSTEM_IDS, WORLD } from '../data/systems.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { CONTRACTS } from '../content/contracts/rules.ts';
import { MAX_REWARD } from './contractGuards.ts';

/** The rules a guardrail checks (the real ones, or a broken copy in the tests). */
export type FlareRules = typeof FLARES;

/** A variable-star name as the catalogue gives it: letters (R to Z, or two of them) or V and a number, then a constellation. */
const VARIABLE_NAME = /^(?:[A-Z]{1,2}|V\d{3,4}) [A-Z][A-Za-z]{2}$/;

/**
 * Flare-star guardrails (docs/PROCGEN.md §43.7): the stars are red dwarfs of the archives in systems
 * on the map, each listed once with a variable-star name of the catalogue's form; stronger flares are
 * rarer, last longer and hurt more; every effect is a share between none and all; a flare fits its
 * window; the work pays sensibly, within reach of a young pilot, for at least half the stars; and no
 * line holds a number of its own or a field it cannot fill.
 */
export function validateFlares(rules: FlareRules = FLARES, stars: readonly FlareStar[] = FLARE_STARS): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });

  // The stars.
  const seen = new Set<string>();
  for (const s of stars) {
    if (seen.has(s.star)) report('stars', s.star, 'listed twice');
    seen.add(s.star);
    const c = getComponent(s.star);
    if (!c) {
      report('stars', s.star, 'not a star of the archives');
      continue;
    }
    if (!/^d?M/.test(c.spectralType)) report('stars', s.star, `spectral type ${c.spectralType}: not a red dwarf`);
    if (!SYSTEM_IDS.includes(c.systemId)) report('stars', s.star, `${c.systemId} is not a system on the map`);
    if (!c.catalogIds.gaiaDr3) report('stars', s.star, 'no Gaia DR3 source to find it by in SIMBAD');
    if (!VARIABLE_NAME.test(s.variable)) report('stars', s.star, `“${s.variable}” is not a variable-star name`);
  }
  if (new Set(stars.map((s) => s.variable)).size !== stars.length) report('stars', 'variable', 'two stars with one variable-star name');

  // The kinds: shares adding up to one, stronger ones rarer, longer and harder on ships.
  const kinds = Object.keys(rules.kinds) as FlareKind[];
  const total = kinds.reduce((a, k) => a + rules.kinds[k].share, 0);
  if (Math.abs(total - 1) > 1e-9) report('kinds', 'share', `shares adding up to ${total}, not one`);
  for (const k of kinds) {
    const x = rules.kinds[k];
    if (!(x.share > 0)) report('kinds', k, 'a kind that never comes');
    if (!(x.lasts[0] > rules.rise && x.lasts[1] >= x.lasts[0])) report('kinds', k, 'lasting no longer than its rise, or a range that runs backwards');
    for (const [what, v] of [['shields', x.shields], ['scanner', x.scanner], ['glow', x.glow]] as const) if (!(v > 0 && v <= 1)) report('kinds', k, `${what} ${v}: not a share between none and all`);
  }
  for (let i = 1; i < kinds.length; i++) {
    const [a, b] = [rules.kinds[kinds[i - 1]!], rules.kinds[kinds[i]!]];
    const k = kinds[i]!;
    if (!(b.share < a.share)) report('kinds', k, 'not rarer than the kind before');
    if (!(b.lasts[0] >= a.lasts[1])) report('kinds', k, 'not lasting longer than the kind before');
    if (!(b.shields < a.shields && b.scanner < a.scanner)) report('kinds', k, 'not harder on ships than the kind before');
    if (!(b.glow > a.glow)) report('kinds', k, 'not brighter than the kind before');
    if (!(rules.watch.reward[k] > rules.watch.reward[kinds[i - 1]!])) report('watch', k, 'paying no more than a weaker flare');
  }

  // The windows.
  const longest = Math.max(...kinds.map((k) => rules.kinds[k].lasts[1]));
  if (!(rules.window > longest)) report('window', 'window', `a window of ${rules.window} s, no longer than the longest flare`);
  if (rules.window % 60 !== 0) report('window', 'window', 'a window not of whole minutes');
  if (!(rules.odds > 0 && rules.odds < 1)) report('window', 'odds', `odds of ${rules.odds}: not between none and all`);
  if (!(rules.quietUntil >= 0 && rules.quietUntil < rules.window)) report('window', 'quietUntil', 'a quiet start longer than a window');
  if (!(rules.rise > 0)) report('window', 'rise', 'a flare that does not rise');

  // Flare watch: pay within what any contract pays, near enough, posted for at least half the stars.
  for (const k of kinds) {
    const most = rules.watch.reward[k] + rules.watch.perJump * rules.watch.reach;
    if (!(rules.watch.reward[k] > 0 && most <= MAX_REWARD)) report('watch', k, `pay of ${rules.watch.reward[k]} (${most} at the farthest): not positive, or above the ${MAX_REWARD} any contract may pay`);
  }
  if (!(rules.watch.perJump >= 0)) report('watch', 'perJump', 'less pay for going farther');
  if (!(rules.watch.reach >= 0 && rules.watch.reach <= CONTRACTS.maxJumps.observe)) report('watch', 'reach', `${rules.watch.reach} jumps: beyond the ${CONTRACTS.maxJumps.observe} an observation may send a pilot`);
  const research = ALL_LOCATIONS.filter((l) => l.stationType === 'research-station' && l.status === 'functional' && l.dockable !== false);
  const watched = stars.filter((s) => {
    const c = getComponent(s.star);
    if (!c) return false;
    const jumps = jumpsFrom(WORLD.links, c.systemId);
    return research.some((l) => (jumps.get(l.systemId) ?? Infinity) <= rules.watch.reach);
  });
  if (watched.length * 2 < stars.length) report('watch', 'stations', `only ${watched.length} of ${stars.length} flare stars have a research station within reach`);

  // The lines: no digits; placeholders the line can fill.
  const check = (subject: string, text: string, allowed: readonly string[]) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(key!)) report('lines', subject, `{${key}} it cannot fill`);
  };
  const star = ['star', 'variable', 'system'];
  const flare = [...star, 'Kind', 'kind', 'shields', 'scanner', 'minutes'];
  for (const [k, line] of Object.entries(FLARE_NEWS)) check(`news.${k}`, line, flare);
  check('fiction', FLARE_FICTION, star);
  for (const [k, line] of Object.entries(FLARE_COMMS)) check(`comms.${k}`, line, flare);
  check('hud', FLARE_HUD, flare);
  for (const [k, line] of Object.entries(FLARE_TARGET)) check(`target.${k}`, line, []);
  check('map.star', FLARE_MAP.star, star);
  check('map.flaring', FLARE_MAP.flaring, flare);
  check('map.quiet', FLARE_MAP.quiet, []);
  check('card.what', FLARE_CARD.what, star);
  check('card.flaring', FLARE_CARD.flaring, flare);
  for (const [k, line] of Object.entries(FLARE_WATCH)) check(`watch.${k}`, line, [...flare, 'giver']);
  for (const [k, word] of Object.entries(FLARE_WORD)) check(`word.${k}`, word, []);
  return issues;
}
