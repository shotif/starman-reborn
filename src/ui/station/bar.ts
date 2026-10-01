import { findBelt, getLocation, getPlanet, getSystem, WORLD } from '../../data/systems.ts';
import { CONTRACTS, type ContractKind } from '../../content/contracts/rules.ts';
import { COMMODITIES } from '../../economy/commodities.ts';
import { welcomeText } from '../../economy/dockText.ts';
import { FACTIONS, standingTier, TIER_LABEL } from '../../economy/factions.ts';
import { canDeliver, describeObjective, jobsAt, type JobDef, type JobOffer } from '../../economy/jobs.ts';
import { ARCS, CHARACTERS } from '../../content/story/arcs.ts';
import { arcSteps, briefingFor, choiceHere, objectiveSystem } from '../../economy/story.ts';
import { jumpsFrom } from '../../content/world/network.ts';
import { button, dataBadge } from '../components.ts';
import { formatCredits, h, signed } from '../dom.ts';
import { glyph, type GlyphName } from '../glyphs.ts';
import { icon } from '../icons.ts';
import { borderNewsList, denNews, haulNews, markNews, newsList } from '../news.ts';
import { fineOwed, isLawful, pardonCost, payFines } from '../../economy/law.ts';
import { buysSurveys, sellSurvey, surveysForSale, surveyValue } from '../../economy/progress.ts';
import { toast } from '../components.ts';
import type { StationContext } from './context.ts';
import { sightById } from '../../content/passengers/sights.ts';
import { berths } from '../../economy/passengers.ts';

export function pips(level: number, of = 3): HTMLElement {
  return h('span', { class: 'pips', role: 'img', 'aria-label': `Difficulty ${level} of ${of}` }, Array.from({ length: of }, (_, i) => h('span', { class: i < level ? 'on' : '' })));
}

/** True when this dock has contracts to accept, cargo to deliver or a story choice waiting. */
export function jobsNeedAttention(ctx: StationContext): boolean {
  const { state, locationId } = ctx;
  return (
    jobsAt(state, locationId).some((o) => o.status === 'available') || Object.keys(state.jobs).some((id) => canDeliver(state, id, locationId)) || !!choiceHere(state, locationId)
  );
}

export function deliverableJobs(ctx: StationContext): string[] {
  const { state, locationId } = ctx;
  return Object.keys(state.jobs).filter((id) => canDeliver(state, id, locationId));
}

export type BoardFilter = 'all' | 'hauling' | 'combat' | 'other';
export type BoardSort = 'posted' | 'reward' | 'per-jump';

/** Remembered for the session: which contracts the board shows, and in what order. */
let boardFilter: BoardFilter = 'all';
let boardSort: BoardSort = 'posted';

const FILTER_LABEL: Record<BoardFilter, string> = { all: 'All', hauling: 'Hauling', combat: 'Combat', other: 'Other' };
const SORT_LABEL: Record<BoardSort, string> = { posted: 'As posted', reward: 'Reward', 'per-jump': 'Reward per jump' };
const CATEGORY: Record<ContractKind, BoardFilter> = {
  freight: 'hauling',
  parcel: 'hauling',
  supply: 'hauling',
  smuggle: 'hauling',
  bounty: 'combat',
  ace: 'combat',
  escort: 'combat',
  den: 'combat',
  piracy: 'combat',
  war: 'combat',
  survey: 'other',
  recovery: 'other',
  claim: 'other',
  rescue: 'other',
  passage: 'hauling',
  tour: 'other',
};

/** Jumps from a dock to where a job ends (0 in the same system). */
function jobJumps(from: string, job: JobDef): number {
  const at = getLocation(from).systemId;
  const to = job.destinationLocationId ? getLocation(job.destinationLocationId).systemId : (objectiveSystem(job.objectives[0]) ?? at);
  return jumpsFrom(WORLD.links, at).get(to) ?? 0;
}

/** The offers the board shows under its filter and sort (the Accept button follows the same list). */
export function visibleOffers(state: StationContext['state'], locationId: string): JobOffer[] {
  const offers = jobsAt(state, locationId).filter((o) => boardFilter === 'all' || (o.job.contract ? CATEGORY[o.job.contract.kind] === boardFilter : boardFilter === 'other'));
  if (boardSort === 'reward') return [...offers].sort((a, b) => b.job.reward - a.job.reward);
  if (boardSort === 'per-jump') {
    const per = (o: JobOffer) => o.job.reward / Math.max(1, jobJumps(locationId, o.job));
    return [...offers].sort((a, b) => per(b) - per(a));
  }
  return offers;
}

/** Filter and sort controls for the board. */
function boardTools(refresh: () => void): HTMLElement {
  return h(
    'div',
    { class: 'row wrap board-tools', role: 'toolbar', 'aria-label': 'Filter and sort contracts' },
    (Object.keys(FILTER_LABEL) as BoardFilter[]).map((f) =>
      button(FILTER_LABEL[f], {
        size: 'sm',
        variant: boardFilter === f ? 'primary' : 'ghost',
        testId: `board-filter-${f}`,
        onClick: () => {
          boardFilter = f;
          refresh();
        },
      }),
    ),
    h(
      'label',
      { class: 'board-sort' },
      h('span', { class: 'muted small' }, 'Sort'),
      h(
        'select',
        {
          'data-testid': 'board-sort',
          onChange: (e: Event) => {
            boardSort = (e.target as HTMLSelectElement).value as BoardSort;
            refresh();
          },
        },
        (Object.keys(SORT_LABEL) as BoardSort[]).map((k) => h('option', { value: k, selected: k === boardSort }, SORT_LABEL[k])),
      ),
    ),
  );
}

/** The job board: deliveries due here, posted contracts (one expanded) and your active contracts. */
export function jobBoardContent(ctx: StationContext, selected: string | null, onSelect: (id: string) => void, refresh: () => void = () => {}): HTMLElement {
  const { state, locationId } = ctx;
  const all = jobsAt(state, locationId);
  const offers = visibleOffers(state, locationId);
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
    all.length > 3 ? boardTools(refresh) : null,
    h('div', { class: 'list-head' }, h('span', null, 'Contracts posted here'), h('span', null, 'Reward')),
    offers.length
      ? h('ul', { class: 'list' }, offers.map((o) => jobCard(ctx, o, o.job.id === open, onSelect)))
      : h('p', { class: 'list-empty' }, all.length ? 'No contracts of that kind here.' : 'No contracts posted at this dock.'),
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

const KIND_GLYPH: Record<ContractKind, GlyphName> = {
  freight: 'trader',
  supply: 'trader',
  parcel: 'jobs',
  bounty: 'gun',
  survey: 'science',
  escort: 'shieldgen',
  ace: 'missile',
  recovery: 'tractor',
  smuggle: 'cargopod',
  piracy: 'weapons',
  den: 'missile',
  claim: 'mining-laser',
  war: 'gun',
  rescue: 'shipparts',
  passage: 'cabin',
  tour: 'science',
};
const KIND_LABEL: Record<ContractKind, string> = {
  freight: 'Freight',
  supply: 'Supply run',
  parcel: 'Courier',
  bounty: 'Bounty',
  survey: 'Survey',
  escort: 'Escort',
  ace: 'Ace hunt',
  recovery: 'Recovery',
  smuggle: 'Smuggling',
  piracy: 'Piracy',
  den: 'Den assault',
  claim: 'Mining claim',
  war: 'Border war',
  rescue: 'Rescue',
  passage: 'Passage',
  tour: 'Sightseers',
};

/** Where a job sends you, for the card's subtitle. */
function whereTo(job: JobDef): string {
  const o = job.objectives[0];
  if (o?.kind === 'choice') return 'a decision, here';
  // A story mission names its first stop.
  if (job.story && o && (o.kind === 'visit' || o.kind === 'dock')) {
    const first = getLocation(o.locationId);
    return `to ${first.name}, ${getSystem(first.systemId).displayName}`;
  }
  if (o?.kind === 'assault' || o?.kind === 'defend') return `at ${getLocation(o.locationId).name}, ${getSystem(o.systemId).displayName}`;
  if (o?.kind === 'scan' && job.contract) {
    const planet = getPlanet(o.bodyId);
    return `${planet?.displayName ?? o.bodyId}, ${getSystem(o.systemId).displayName}`;
  }
  if (job.contract?.kind === 'supply' && job.briefingPrices) {
    const source = getLocation(job.briefingPrices.locationId);
    return `buy at ${source.name}, ${getSystem(source.systemId).displayName}`;
  }
  if (o?.kind === 'escort') return `to ${getLocation(o.locationId).name}, this system`;
  if (o?.kind === 'piracy') return `in ${getSystem(o.systemId).displayName}`;
  if (o?.kind === 'mine') return `in the ${findBelt(o.beltId)?.name ?? 'belt'}, ${getSystem(o.systemId).displayName}`;
  if (o?.kind === 'sight') return `${sightById(o.sightId)?.name ?? o.sightId}, ${getSystem(o.systemId).displayName}`;
  const near = o?.kind === 'bounty' || o?.kind === 'recover';
  const loc = getLocation(near ? o.locationId : job.destinationLocationId);
  return `${near ? 'near' : 'to'} ${loc.name}, ${getSystem(loc.systemId).displayName}`;
}

/** The accept button's label: the reward, and the deposit when there is one. */
export function acceptLabel(job: JobDef): string {
  const deposit = job.contract?.deposit;
  if (!job.reward && !deposit) return 'Accept';
  return `Accept · ${formatCredits(job.reward)}${deposit ? ` (deposit ${formatCredits(deposit)})` : ''}`;
}

function jobCard(ctx: StationContext, o: JobOffer, expanded: boolean, onSelect: (id: string) => void): HTMLElement {
  const job = o.job;
  const story = job.story;
  const who = story ? CHARACTERS[story.speaker].name : job.factionId ? FACTIONS[job.factionId].shortName : 'Independent';
  const kind = job.contract?.kind;
  const cargo = job.contract?.cargo;
  const deliver = job.objectives.find((x) => x.kind === 'deliver');
  const urgent = job.contract?.urgent;
  const chain = job.contract?.chain;
  const party = job.contract?.party;
  const free = berths(ctx.state).free;
  const tags = [
    story ? h('span', { class: 'job-tag story' }, `${ARCS[story.arc].title} · ${story.step}/${arcSteps(story.arc)}`) : null,
    chain ? h('span', { class: 'job-tag chain' }, `Follow-up ${chain.step}/${CONTRACTS.chain.maxSteps}`) : null,
    urgent ? h('span', { class: 'job-tag urgent' }, `Urgent · ${urgent.seconds / 60} min`) : null,
    job.contract?.event ? h('span', { class: 'job-tag event' }, 'In the news') : null,
    job.contract?.decisive ? h('span', { class: 'job-tag story' }, 'Settles the front for good') : null,
  ].filter(Boolean);
  const head = h(
    'button',
    {
      type: 'button',
      class: 'list-row job-head',
      'aria-expanded': String(expanded),
      'aria-selected': String(expanded),
      onClick: () => onSelect(job.id),
    },
    glyph(kind ? KIND_GLYPH[kind] : 'jobs'),
    h(
      'span',
      null,
      h('span', { class: 'row-name' }, job.title),
      h('span', { class: 'row-sub' }, `${kind ? `${KIND_LABEL[kind]} · ` : story ? 'Story · ' : ''}${who} · ${whereTo(job)}`),
      tags.length ? h('span', { class: 'job-tags' }, tags) : null,
    ),
    h('span', { class: 'job-meta' }, h('span', { class: 'row-value num reward' }, job.reward ? formatCredits(job.reward) : 'Your call'), pips(job.difficulty)),
  );
  const status =
    o.status === 'available'
      ? null
      : o.status === 'locked'
        ? h('p', { class: 'blocked' }, icon('alert'), ` ${o.lockReason}`)
        : h('p', { class: 'muted' }, o.status === 'active' ? 'Accepted — in progress.' : o.status === 'abandoned' ? 'Abandoned.' : o.status === 'failed' ? 'Failed.' : 'Completed.');
  return h(
    'li',
    { class: `job-card ${o.status}${expanded ? ' open' : ''}`, 'data-testid': `job-${job.id}` },
    head,
    expanded
      ? h(
          'div',
          { class: 'job-detail stack' },
          story ? h('p', { class: 'dialogue-who' }, h('strong', null, CHARACTERS[story.speaker].name), h('span', { class: 'muted small' }, ` · ${CHARACTERS[story.speaker].role}`)) : null,
          h('p', { class: 'job-brief' }, briefingFor(ctx.state, job), ' ', dataBadge('fictional')),
          h(
            'dl',
            { class: 'kv' },
            h('dt', null, 'Difficulty'),
            h('dd', null, job.difficultyNote),
            deliver && deliver.kind === 'deliver' ? h('dt', null, 'Cargo') : null,
            deliver && deliver.kind === 'deliver'
              ? h('dd', null, `${deliver.qty} ${COMMODITIES[deliver.commodity].name.toLowerCase()} · ${deliver.qty * COMMODITIES[deliver.commodity].unitSize} hold units${cargo ? ', loaded here' : ''}`)
              : null,
            party ? h('dt', null, 'Passengers') : null,
            party ? h('dd', { 'data-testid': `job-party-${job.id}` }, `${party.join(', ')} · ${party.length} berth${party.length === 1 ? '' : 's'} (you have ${free} free)`) : null,
            job.contract?.deposit ? h('dt', null, 'Deposit') : null,
            job.contract?.deposit ? h('dd', null, `${formatCredits(job.contract.deposit)}, returned with the reward`) : null,
            urgent ? h('dt', null, 'Time limit') : null,
            urgent ? h('dd', null, `${urgent.seconds / 60} min from accepting for a bonus of ${formatCredits(urgent.bonus)}; late costs a little standing`) : null,
            chain ? h('dt', null, 'Chain') : null,
            chain ? h('dd', null, `Step ${chain.step} of up to ${CONTRACTS.chain.maxSteps}; the offer lapses if you leave it`) : null,
            h('dt', null, 'Objectives'),
            h('dd', null, h('ol', { class: 'objectives' }, job.objectives.map((x) => h('li', null, x.text)))),
          ),
          status,
        )
      : null,
  );
}

/** Station news: the dock's greeting, who runs it and how they see you, and what is happening nearby. */
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
    customsDesk(ctx),
    surveyOffice(ctx),
    h('div', { class: 'list-head' }, h('span', null, 'Local news'), h('span', null, 'within two jumps')),
    markNews(loc.systemId),
    borderNewsList(loc.systemId, state.clock),
    denNews(state, loc.systemId),
    newsList(loc.systemId, state.clock),
    haulNews(loc.systemId, state.clock),
  );
}

/** The customs desk at a lawful station: what you owe its owner, and a pardon for paying it. */
function customsDesk(ctx: StationContext): HTMLElement | null {
  const { state, locationId } = ctx;
  const faction = getLocation(locationId).factionId;
  if (!isLawful(faction)) return null;
  const owed = fineOwed(state, faction);
  const cost = pardonCost(state, faction);
  const name = FACTIONS[faction].name;
  const why = owed ? `You owe the ${name} ${formatCredits(owed)} in fines.` : `The ${name} counts you an enemy.`;
  return h(
    'section',
    { class: 'customs-desk', 'aria-label': 'Customs desk', 'data-testid': 'customs-desk' },
    h('div', { class: 'list-head' }, h('span', null, 'Customs desk'), h('span', null, cost ? 'Pardon' : 'Record')),
    cost
      ? h(
          'div',
          { class: 'callout warn customs-owed' },
          icon('alert'),
          h('span', { class: 'grow' }, `${why} Until you are pardoned, its patrols attack you on sight and its stations take you in for repairs only.`),
          button(`Pardon · ${formatCredits(cost)}`, {
            variant: 'primary',
            testId: 'pay-fines',
            disabled: state.credits < cost,
            onClick: () => {
              const r = payFines(state, faction);
              ctx.sfx(r.ok ? 'credits' : 'ui-error');
              toast(r.message, r.ok ? 'good' : 'bad');
              ctx.save();
              if (r.ok) ctx.reload();
            },
          }),
        )
      : h('p', { class: 'muted small' }, `Your record with the ${name} is clean.`),
  );
}

/** Research stations buy completed system surveys (every catalogued body scanned), once each. */
function surveyOffice(ctx: StationContext): HTMLElement | null {
  const { state, locationId } = ctx;
  if (!buysSurveys(locationId) || ctx.access !== 'full') return null;
  const ready = surveysForSale(state);
  return h(
    'section',
    { class: 'survey-office', 'aria-label': 'Survey office', 'data-testid': 'survey-office' },
    h('div', { class: 'list-head' }, h('span', null, 'Survey office'), h('span', null, 'complete systems')),
    ready.length
      ? h(
          'ul',
          { class: 'list' },
          ready.map((id) =>
            h(
              'li',
              { class: 'trade-row route' },
              glyph('science'),
              h('span', { class: 'trade-text' }, h('span', { class: 'row-name' }, getSystem(id).displayName), h('span', { class: 'row-sub' }, 'Every catalogued star and confirmed planet scanned')),
              button(`Sell · ${formatCredits(surveyValue(id))}`, {
                size: 'sm',
                testId: `sell-survey-${id}`,
                onClick: () => {
                  const r = sellSurvey(state, id, locationId);
                  ctx.sfx(r.ok ? 'credits' : 'ui-error');
                  toast(r.message, r.ok ? 'good' : 'bad');
                  ctx.save();
                  ctx.reload();
                },
              }),
            ),
          ),
        )
      : h('p', { class: 'muted small' }, 'Scan every catalogued star and confirmed planet of a system, and the survey office pays for the data.'),
  );
}
