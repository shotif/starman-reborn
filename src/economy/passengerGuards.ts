import { CONTRACTS } from '../content/contracts/rules.ts';
import { getCatalog } from '../content/catalog.ts';
import { PASSAGE_LINES, SIGHT_LINES, TOUR_LINES, type SightLine } from '../content/passengers/lines.ts';
import { PASSENGERS } from '../content/passengers/rules.ts';
import { allSights, sightFacts, type Sight } from '../content/passengers/sights.ts';
import type { Issue } from '../content/validate.ts';
import { spectralClass } from '../content/world/generate.ts';
import { BELTS, getComponent, getSystem } from '../data/systems.ts';
import { inViewFromGates, tourSights } from '../world/sightseeing.ts';
import { sceneDefFor } from '../world/systems/index.ts';

/**
 * Passenger guardrails (docs/PROCGEN.md §23.4): the rules make sense (parties a cabin can carry,
 * reach as the contract boards say, fares that pay, a fright that cuts but never wipes out a fare);
 * every sight is a record of the real sky with a target in its system's scene; tours go out to a
 * sight, never to one in view from a jump beacon; and no line a
 * passenger says holds a number of its own or a field it does not have.
 */
export function validatePassengers(sights: readonly Sight[] = allSights()): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const P = PASSENGERS;

  // The rules.
  const most = Math.max(...getCatalog().gear.filter((g) => g.stats.slot === 'utility' && g.stats.utility.kind === 'cabin').map((g) => (g.stats.slot === 'utility' ? g.stats.utility.amount : 0)));
  for (const kind of ['passage', 'tour'] as const) {
    const r = P[kind];
    if (r.party[0] < 1 || r.party[1] < r.party[0] || r.party[1] > most) report('rules', kind, `a party of ${r.party.join('–')}: more than the largest cabin's ${most} berths`);
    if (r.maxJumps !== CONTRACTS.maxJumps[kind]) report('rules', kind, 'reach differs from the contract boards’');
    if (Object.values(r.reward).some((x) => x <= 0)) report('rules', kind, 'a fare part that is not positive');
  }
  if (P.fright.perHull <= 0 || P.fright.floor <= 0 || P.fright.floor >= 1) report('rules', 'fright', 'a fright that never cuts a fare, or wipes it out');
  if (Object.values(P.interest).some((x) => x < 1 || x > 2)) report('rules', 'interest', 'an interest out of 1–2');
  if (P.sightRange <= 0) report('rules', 'sightRange', 'not positive');

  // The lines: no digits (numbers come from the data); placeholders the line can fill.
  const check = (subject: string, text: string, allowed: readonly string[]) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(key!)) report('lines', subject, `{${key}} it cannot fill`);
  };
  for (const [kind, lines] of Object.entries(SIGHT_LINES) as [Sight['kind'], readonly SightLine[]][]) {
    if (!lines.some((l) => !l.needs.length)) report('lines', kind, 'no line for a sight the archive says little about');
    for (const l of lines) check(kind, l.text, ['name', 'star', ...l.needs]);
  }
  for (const t of TOUR_LINES.arrive) check('arrive', t, ['star', 'system', 'sight']);
  for (const t of TOUR_LINES.home) check('home', t, ['sight']);
  for (const t of [...TOUR_LINES.fright, ...PASSAGE_LINES.fright]) check('fright', t, []);
  for (const t of PASSAGE_LINES.arrive) check('arrive', t, ['dest']);

  // The sights.
  const ids = new Set<string>();
  for (const s of sights) {
    if (ids.has(s.id)) report('sights', s.id, 'twice');
    ids.add(s.id);
    const sys = getSystem(s.systemId);
    const real =
      s.kind === 'planet' || s.kind === 'giant'
        ? sys.confirmedBodies.some((p) => p.id === s.id && p.status === 'confirmed')
        : s.kind === 'belt'
          ? BELTS.some((b) => b.id === s.id && b.systemId === s.systemId)
          : sys.componentIds.includes(s.id) && (s.kind === 'white-dwarf' ? spectralClass(getComponent(s.id)?.spectralType ?? '') === 'D' : ['L', 'T', 'Y'].includes(spectralClass(getComponent(s.id)?.spectralType ?? '')));
    if (!real) report('sights', s.id, `not a ${s.kind} the catalogue lists in ${s.systemId}`);
    const def = sceneDefFor(s.systemId);
    const inScene = s.targetId.startsWith('planet:')
      ? def.planets.some((p) => `planet:${p.id}` === s.targetId)
      : s.targetId.startsWith('star:')
        ? def.stars.some((x) => `star:${x.id}` === s.targetId)
        : def.belts.some((b) => `belt:${b.beltId}` === s.targetId);
    if (!inScene) report('sights', s.id, `${s.targetId} is not in ${s.systemId}’s scene`);
    const facts = sightFacts(s);
    if (Object.values(facts).some((v) => !v || /NaN|undefined/.test(v))) report('sights', s.id, 'a fact the record does not have');
  }

  // Tours: a trip out, never to a sight in view from a jump beacon; and those few stay few.
  const tours = tourSights();
  for (const s of tours) if (inViewFromGates(s)) report('tours', s.id, 'in view from the arrival point or a jump beacon');
  if (tours.length < allSights().length * 0.9) report('tours', 'tourSights', `only ${tours.length} of ${allSights().length} sights are a trip out from a jump beacon`);
  return issues;
}
