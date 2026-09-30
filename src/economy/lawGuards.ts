import { CONTRACTS, DEN_BOARD_KINDS } from '../content/contracts/rules.ts';
import { LAW } from '../content/law/rules.ts';
import type { Issue } from '../content/validate.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, SYSTEMS, WORLD } from '../data/systems.ts';
import { boardFor } from './contracts.ts';
import { standingTier } from './factions.ts';
import { JOBS } from './jobs.ts';
import { lawIn, scansOnDocking } from './law.ts';
import { marketTables } from './markets.ts';

/**
 * Law guardrails (docs/PROCGEN.md §12.4): no choice is a dead end, smuggling is possible but
 * risky, the dens are worth reaching, and the story never asks for a crime.
 */
export function validateLaw(): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const markets = marketTables();

  // A way back: a pardon clears the hunt, and a hunted pilot can always get repairs somewhere near.
  if (standingTier(LAW.pardonFloor) === 'hostile') report('pardon', 'LAW', 'a pardon must lift standing above Hostile');
  const repairs = new Set(ALL_LOCATIONS.filter((l) => l.status === 'functional' && l.dockable !== false && l.services.includes('repair')).map((l) => l.systemId));
  for (const s of SYSTEMS) {
    const jumps = jumpsFrom(WORLD.links, s.id);
    const near = [...repairs].some((id) => (jumps.get(id) ?? 99) <= 1);
    if (!near) report('repairs', s.id, 'no station with repairs within one jump');
  }

  // Contraband: sold somewhere, wanted in claimed space within reach at a dock without customs.
  for (const c of LAW.contraband) {
    const makers = [...markets.values()].filter((m) => m.entries.get(c)?.role === 'produce');
    if (!makers.length) report('contraband', c, 'nobody sells it');
    const routes = makers.some((m) => {
      const jumps = jumpsFrom(WORLD.links, m.systemId);
      return [...markets.values()].some(
        (d) => d.entries.get(c) && d.entries.get(c)!.role !== 'produce' && lawIn(d.systemId) && !scansOnDocking(d.locationId) && (jumps.get(d.systemId) ?? 99) <= CONTRACTS.maxJumps.smuggle,
      );
    });
    if (!routes) report('contraband', c, 'no smuggling route into claimed space');
  }
  // Customs somewhere, so the risk is real.
  if (!ALL_LOCATIONS.some((l) => scansOnDocking(l.id))) report('customs', 'world', 'no customs depot or military base scans ships');

  // Dens: black markets and work for pilots the Wake trusts.
  for (const den of ALL_LOCATIONS.filter((l) => l.stationType === 'pirate-den' && l.status === 'functional')) {
    if (!markets.has(den.id)) report('dens', den.id, 'no black market');
    let posted = 0;
    for (let epoch = 0; epoch < 10; epoch++) posted += boardFor(den.id, epoch).length;
    if (!posted) report('dens', den.id, 'posts no work');
  }
  if (!Object.keys(DEN_BOARD_KINDS).length) report('dens', 'rules', 'dens have no kinds of work');

  // The story never asks for a crime.
  for (const job of JOBS) {
    if (job.contract?.kind === 'smuggle' || job.contract?.kind === 'piracy' || job.objectives.some((o) => o.kind === 'piracy')) report('story', job.id, 'a story job asks for a crime');
  }
  return issues;
}
