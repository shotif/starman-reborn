import { CREW } from '../../content/crew/rules.ts';
import { CREW_FICTION, GRADE_WORD, HEART_CARES, HEART_WORD, ROLE_WORD } from '../../content/crew/lines.ts';
import { hashString } from '../../content/random.ts';
import type { CrewMember } from '../../app/state.ts';
import {
  buyCrewRound,
  crewAboard,
  crewOffers,
  crewTags,
  effectWords,
  favourOffer,
  gradeRole,
  hireBlock,
  hireCrew,
  isHurt,
  letGo,
  moraleBand,
  moraleWord,
  roundBlock,
  takeFavour,
  treatCrew,
  treatQuote,
  advanceAfterFavour,
  type CrewAct,
  type CrewOffer,
} from '../../economy/crew.ts';
import { quartersOf } from '../../economy/crewQuarters.ts';
import type { PersonRole } from '../../content/people/rules.ts';
import { portraitElement } from '../portraits.ts';
import { button, dataBadge, showModal, toast } from '../components.ts';
import { formatCredits, h, replaceChildren } from '../dom.ts';
import type { StationContext } from './context.ts';

type Refresh = () => void;

/** A crew member's look: an engineer's goggles, a gunner's tabs, a navigator's headset; seeded from the offer, clear of the other faces. */
const LOOK: Record<CrewMember['role'], PersonRole> = { engineer: 'miner', gunner: 'officer', navigator: 'pilot' };
const AGES = ['young', 'middle', 'middle', 'old'] as const;
function crewPortrait(c: { id: string; name: string; role: CrewMember['role'] }, size: 'sm' | 'lg' = 'sm'): HTMLElement {
  const seed = hashString(c.id);
  return portraitElement(7_000 + (seed % 1_000), { faction: 'independent', role: LOOK[c.role], age: AGES[seed % AGES.length]! }, { label: `Portrait of ${c.name}`, size });
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
const MORALE_TAG = { low: 'tier-hostile', steady: '', high: 'tier-friendly' } as const;

/**
 * Hands looking for a berth at the bar's tables (docs/PROCGEN.md §30.1): sit down with one to hear
 * what they do, what they care about, and their wage, and to sign them on.
 */
export function crewHands(ctx: StationContext, refresh: Refresh): HTMLElement | null {
  const { state, locationId } = ctx;
  const hands = crewOffers(state, locationId);
  if (!hands.length) return null;
  return h(
    'section',
    { class: 'stack-tight', 'aria-label': 'Looking for a berth' },
    h('div', { class: 'list-head' }, h('span', null, 'Looking for a berth'), h('span', null, `Quarters ${crewAboard(state).length}/${quartersOf(state.ship.model)}`)),
    h(
      'ul',
      { class: 'people-list', 'data-testid': 'crew-hands' },
      hands.map((o) =>
        h(
          'li',
          null,
          h(
            'button',
            { type: 'button', class: 'person-card', 'data-testid': `hand-${o.id}`, onClick: () => void sitWithHand(ctx, o, refresh) },
            crewPortrait(o),
            h(
              'span',
              { class: 'person-text' },
              h('span', { class: 'row-name' }, o.name),
              h('span', { class: 'row-sub' }, `Crew · ${ROLE_WORD[o.role]} · ${GRADE_WORD[o.grade]}`),
              h('span', { class: 'person-tags' }, h('span', { class: 'tag' }, `${formatCredits(o.wage)}/h`), h('span', { class: 'tag muted' }, HEART_WORD[o.heart])),
            ),
          ),
        ),
      ),
    ),
  );
}

async function sitWithHand(ctx: StationContext, o: CrewOffer, refresh: Refresh): Promise<void> {
  const { state, locationId } = ctx;
  const speech = h('p', { class: 'comm speech', 'data-testid': 'hand-speech' }, o.greeting);
  const block = hireBlock(state, locationId, o);
  const cares = HEART_CARES[o.heart];
  await showModal({
    title: o.name,
    testId: 'hand-dialog',
    body: (close) =>
      h(
        'div',
        { class: 'person-dialog' },
        h('div', { class: 'person-head' }, crewPortrait(o, 'lg'), h('div', { class: 'stack-tight' }, h('span', { class: 'row-sub' }, `${GRADE_WORD[o.grade]} ${ROLE_WORD[o.role].toLowerCase()} · looking for a berth`), h('span', { class: 'row-sub muted' }, `${HEART_WORD[o.heart]} · ${formatCredits(o.wage)} an hour`), dataBadge('fictional'))),
        speech,
        h('p', { 'data-testid': 'hand-does' }, effectWords(o)),
        h('p', { class: 'muted small' }, `Likes ${cares.likes}; hates ${cares.hates}.`),
        h('p', { class: 'muted small', 'data-testid': 'hand-terms' }, `${formatCredits(o.wage)} an hour of flight, paid at each dock; signing on costs ${formatCredits(o.fee)}. Your ship has crew quarters for ${quartersOf(state.ship.model)}, never shared with passengers.`),
        block ? h('p', { class: 'muted small', 'data-testid': 'hand-block' }, block) : null,
        h(
          'div',
          { class: 'row wrap person-actions' },
          button(`Sign on · ${formatCredits(o.fee)}`, {
            variant: 'primary',
            testId: 'hand-hire',
            disabled: !!block,
            onClick: () => {
              const r = hireCrew(state, locationId, o.id);
              ctx.sfx(r.ok ? 'ui-confirm' : 'ui-error');
              toast(r.message, r.ok ? 'good' : 'bad');
              if (r.line) speech.textContent = r.line;
              ctx.save();
              refresh();
              if (r.ok) close('hired');
            },
          }),
        ),
        h('p', { class: 'muted small' }, CREW_FICTION),
      ),
    actions: [{ label: 'Leave the table', value: 'close', testId: 'hand-close' }],
    dismissValue: 'close',
  });
}

/** The crew aboard (docs/PROCGEN.md §30): who, their morale, hurts, notice and stories; each opens their dialog. */
export function crewSection(ctx: StationContext, refresh: Refresh, openJob: (jobId: string) => void): HTMLElement | null {
  const { state } = ctx;
  const crew = crewAboard(state);
  if (!crew.length) return null;
  return h(
    'section',
    { class: 'wing-section', 'aria-label': 'Your crew' },
    h('div', { class: 'list-head' }, h('span', null, 'Your crew'), h('span', null, `${crew.length}/${Math.min(CREW.max, quartersOf(state.ship.model))}`)),
    h(
      'ul',
      { class: 'people-list', 'data-testid': 'your-crew' },
      crew.map((m) =>
        h(
          'li',
          null,
          h(
            'button',
            { type: 'button', class: 'person-card', 'data-testid': `crew-${m.role}`, onClick: () => void crewDialog(ctx, m.id, refresh, openJob) },
            crewPortrait(m),
            h(
              'span',
              { class: 'person-text' },
              h('span', { class: 'row-name' }, m.name),
              h('span', { class: 'row-sub' }, gradeRole(m)),
              h(
                'span',
                { class: 'person-tags' },
                h('span', { class: `tag ${MORALE_TAG[moraleBand(m.morale)]}`, 'data-testid': `crew-morale-${m.role}` }, `Morale: ${moraleWord(m)}`),
                crewTags(state, m).map((t) => h('span', { class: `tag ${t === 'Hurt' || t === 'Notice' ? 'tier-hostile' : 'story-tag'}`, 'data-testid': `crew-tag-${m.role}-${t.toLowerCase()}` }, t)),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/** Sitting down with someone of the crew: what they said last, their work now, their favour; treatment, a round, letting them go. */
async function crewDialog(ctx: StationContext, memberId: string, refresh: Refresh, openJob: (jobId: string) => void): Promise<void> {
  const { state, locationId } = ctx;
  const find = () => crewAboard(state).find((x) => x.id === memberId);
  const first = find();
  if (!first) return;
  const speech = h('p', { class: 'comm speech', 'data-testid': 'crew-speech' }, first.said ?? '');
  const body = h('div', { class: 'stack-tight' });
  const actions = h('div', { class: 'row wrap person-actions' });
  let goTo: string | null = null;
  let closeDialog: ((v: string) => void) | null = null;
  const act = (r: CrewAct, after?: () => void) => {
    ctx.sfx(r.ok ? 'ui-confirm' : 'ui-error');
    toast(r.message, r.ok ? 'good' : 'bad', 4000);
    if (r.line) speech.textContent = r.line;
    ctx.save();
    refresh();
    after?.();
    render();
  };
  const render = () => {
    const m = find();
    if (!m) {
      replaceChildren(body, [h('p', { class: 'muted' }, 'They have left the ship.')]);
      replaceChildren(actions, []);
      return;
    }
    const band = moraleBand(m.morale);
    const hurt = isHurt(m, state.clock);
    const offer = favourOffer(state, m);
    const job = m.story?.favour?.job;
    const jobActive = !!job && state.jobs[job]?.status === 'active';
    replaceChildren(body, [
      h('p', { 'data-testid': 'crew-does' }, hurt ? `Hurt, and out of action until mended (in about ${Math.max(1, Math.ceil((m.hurt!.until - state.clock) / 3_600))} h of flight), or treated at a dock with repairs.` : effectWords(m, band)),
      h(
        'div',
        { class: 'odds-bar', role: 'img', 'aria-label': `Morale: ${moraleWord(m)} (${m.morale} of 100)`, 'data-testid': 'crew-morale' },
        h('span', { class: 'odds-fill', style: `--fill: ${m.morale / 100}` }),
      ),
      h('p', { class: 'muted small' }, `Morale: ${moraleWord(m)}${m.notice !== undefined ? ' · has given notice' : ''}. Likes ${HEART_CARES[m.heart].likes}; hates ${HEART_CARES[m.heart].hates}.`),
      offer
        ? h(
            'div',
            { class: 'callout story-callout stack-tight', 'data-testid': 'crew-favour', 'data-kind': offer.kind },
            h('p', null, offer.ask),
            h('p', { class: 'muted small' }, `Pays ${formatCredits(offer.pay)} when done.`),
            offer.lock ? h('p', { class: 'muted small', 'data-testid': 'crew-favour-lock' }, offer.lock) : null,
            h(
              'div',
              { class: 'row wrap' },
              button('Take it on', {
                variant: 'primary',
                testId: 'crew-favour-take',
                disabled: !!offer.lock,
                onClick: () => {
                  const r = takeFavour(state, m.id);
                  act(r, () => {
                    for (const e of advanceAfterFavour(state)) toast(e.text, 'info', 4000);
                    if (r.jobId) goTo = r.jobId;
                  });
                },
              }),
              button('Not now', { testId: 'crew-favour-later', onClick: () => closeDialog?.('close') }),
            ),
          )
        : jobActive
          ? h('p', { class: 'muted small', 'data-testid': 'crew-favour-taken' }, `You have taken on their favour: ${state.contracts[job!]!.title}.`)
          : null,
    ]);
    const items: HTMLElement[] = [];
    const treat = treatQuote(state, locationId);
    if (hurt && treat > 0) items.push(button(`Treat the hurt · ${formatCredits(treat)}`, { variant: 'primary', testId: 'crew-treat', disabled: state.credits < treat, onClick: () => act(treatCrew(state, locationId)) }));
    const round = roundBlock(state);
    items.push(button(`A round for the crew · ${formatCredits(crewAboard(state).length * CREW.morale.round.price)}`, { testId: 'crew-round', disabled: !!round, title: round ?? undefined, onClick: () => act(buyCrewRound(state)) }));
    if (goTo || jobActive) items.push(button('See the job', { testId: 'crew-job', onClick: () => ((goTo ??= job ?? null), closeDialog?.('job')) }));
    items.push(
      button('Let go', {
        testId: 'crew-let-go',
        onClick: () => {
          const r = letGo(state, m.id);
          act(r, () => {
            for (const e of r.events) toast(e.text, 'bad', 4000);
          });
        },
      }),
    );
    replaceChildren(actions, items);
  };
  render();
  const choice = await showModal({
    title: first.name,
    testId: 'crew-dialog',
    body: (close) => {
      closeDialog = close;
      return h(
        'div',
        { class: 'person-dialog' },
        h('div', { class: 'person-head' }, crewPortrait(first, 'lg'), h('div', { class: 'stack-tight' }, h('span', { class: 'row-sub' }, `${gradeRole(first)} · ${article(HEART_WORD[first.heart])} ${HEART_WORD[first.heart].toLowerCase()} sort`), h('span', { class: 'row-sub muted' }, `${formatCredits(CREW.wage[first.grade])} an hour`), dataBadge('fictional'))),
        speech,
        body,
        actions,
        h('p', { class: 'muted small' }, CREW_FICTION),
      );
    },
    actions: [{ label: 'Back to the bar', value: 'close', testId: 'crew-close' }],
    dismissValue: 'close',
  });
  if (choice === 'job' && goTo) openJob(goTo);
}
