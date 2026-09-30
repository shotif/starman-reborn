import { getLocation, getSystem } from '../../data/systems.ts';
import { welcomeText } from '../../economy/dockText.ts';
import { FACTIONS, standingTier, TIER_LABEL } from '../../economy/factions.ts';
import { canDeliver, describeObjective, jobsAt, type JobOffer } from '../../economy/jobs.ts';
import { button, dataBadge } from '../components.ts';
import { formatCredits, h, signed } from '../dom.ts';
import { glyph } from '../glyphs.ts';
import { icon } from '../icons.ts';
import type { StationContext } from './context.ts';

export function pips(level: number, of = 3): HTMLElement {
  return h('span', { class: 'pips', role: 'img', 'aria-label': `Difficulty ${level} of ${of}` }, Array.from({ length: of }, (_, i) => h('span', { class: i < level ? 'on' : '' })));
}

/** True when this dock has contracts to accept or cargo to deliver. */
export function jobsNeedAttention(ctx: StationContext): boolean {
  const { state, locationId } = ctx;
  return jobsAt(state, locationId).some((o) => o.status === 'available') || Object.keys(state.jobs).some((id) => canDeliver(state, id, locationId));
}

export function deliverableJobs(ctx: StationContext): string[] {
  const { state, locationId } = ctx;
  return Object.keys(state.jobs).filter((id) => canDeliver(state, id, locationId));
}

/** The job board: deliveries due here, posted contracts (one expanded), your active contracts. */
export function jobBoardContent(ctx: StationContext, selected: string | null, onSelect: (id: string) => void): HTMLElement {
  const { state, locationId } = ctx;
  const offers = jobsAt(state, locationId);
  const deliverable = deliverableJobs(ctx);
  const open = selected ?? offers.find((o) => o.status === 'available')?.job.id ?? offers[0]?.job.id ?? null;
  const active = Object.entries(state.jobs)
    .filter(([, p]) => p.status === 'active')
    .map(([id]) => describeObjective(state, id))
    .filter((o): o is NonNullable<typeof o> => o !== null);
  return h(
    'div',
    { class: 'stack job-board' },
    deliverable.length
      ? h(
          'div',
          { class: 'callout good deliver-callout' },
          glyph('medical'),
          h('span', { class: 'grow' }, 'Cargo for an active contract can be delivered here.'),
          deliverable.map((id) => button('Deliver', { variant: 'primary', testId: `deliver-${id}`, onClick: () => ctx.deliverJob(id) })),
        )
      : null,
    h('div', { class: 'list-head' }, h('span', null, 'Contracts posted here'), h('span', null, 'Reward')),
    offers.length ? h('ul', { class: 'list' }, offers.map((o) => jobCard(o, o.job.id === open, onSelect))) : h('p', { class: 'list-empty' }, 'No contracts posted at this dock.'),
    active.length
      ? h(
          'section',
          { 'aria-label': 'Your active contracts' },
          h('div', { class: 'list-head' }, h('span', null, 'Your active contracts'), h('span', null, '')),
          h('ul', { class: 'plain active-jobs' }, active.map((o) => h('li', null, icon('objective'), h('strong', null, ` ${o.jobTitle}: `), o.text))),
        )
      : null,
  );
}

function jobCard(o: JobOffer, expanded: boolean, onSelect: (id: string) => void): HTMLElement {
  const job = o.job;
  const dest = getLocation(job.destinationLocationId);
  const faction = FACTIONS[job.factionId];
  const head = h(
    'button',
    {
      type: 'button',
      class: 'list-row job-head',
      'aria-expanded': String(expanded),
      'aria-selected': String(expanded),
      onClick: () => onSelect(job.id),
    },
    glyph('jobs'),
    h('span', null, h('span', { class: 'row-name' }, job.title), h('span', { class: 'row-sub' }, `${faction.shortName} · to ${dest.name}, ${getSystem(dest.systemId).displayName}`)),
    h('span', { class: 'job-meta' }, h('span', { class: 'row-value num reward' }, formatCredits(job.reward)), pips(job.difficulty)),
  );
  const status =
    o.status === 'available'
      ? null
      : o.status === 'locked'
        ? h('p', { class: 'blocked' }, icon('alert'), ` ${o.lockReason}`)
        : h('p', { class: 'muted' }, o.status === 'active' ? 'Accepted — in progress.' : 'Completed.');
  return h(
    'li',
    { class: `job-card ${o.status}${expanded ? ' open' : ''}`, 'data-testid': `job-${job.id}` },
    head,
    expanded
      ? h(
          'div',
          { class: 'job-detail stack' },
          h('p', { class: 'job-brief' }, job.briefing, ' ', dataBadge('fictional')),
          h(
            'dl',
            { class: 'kv' },
            h('dt', null, 'Difficulty'),
            h('dd', null, job.difficultyNote),
            h('dt', null, 'Objectives'),
            h('dd', null, h('ol', { class: 'objectives' }, job.objectives.map((x) => h('li', null, x.text)))),
          ),
          status,
        )
      : null,
  );
}

/** Station news: the dock's greeting, who runs it and how they see you. */
export function newsContent(ctx: StationContext): HTMLElement {
  const { state, locationId } = ctx;
  const loc = getLocation(locationId);
  const welcome = welcomeText(state, locationId);
  const faction = loc.factionId ? FACTIONS[loc.factionId] : null;
  const standing = loc.factionId ? state.reputation[loc.factionId] ?? 0 : 0;
  return h(
    'div',
    { class: 'stack news' },
    h('p', { class: 'comm' }, icon('info'), ' ', welcome.text),
    h('p', { class: 'muted' }, loc.description, ' ', dataBadge('fictional')),
    faction ? h('p', null, h('strong', null, faction.name), ` runs this dock. Your standing: ${TIER_LABEL[standingTier(standing)]} (${signed(standing)}).`) : null,
  );
}
