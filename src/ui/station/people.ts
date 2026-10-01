import { COMBAT } from '../../content/combat/rules.ts';
import { PEOPLE } from '../../content/people/rules.ts';
import { shipModel } from '../../content/catalog.ts';
import { dismissWingman, hireWingman } from '../../economy/combat.ts';
import { buyDrink, peopleAt, storyLine, type Person } from '../../economy/people.ts';
import { FACTIONS } from '../../economy/factions.ts';
import { button, dataBadge, showModal, toast } from '../components.ts';
import { formatCredits, h, replaceChildren, signed } from '../dom.ts';
import { glyph } from '../glyphs.ts';
import type { StationContext } from './context.ts';
import { personPortrait } from './personPortrait.ts';
import { hashString } from '../../content/random.ts';
import type { RivalTier } from '../../content/rivals/lines.ts';
import { RIVALS, STYLE_LABEL, type RivalDef } from '../../content/rivals/rules.ts';
import { buyRivalRound, makeAmends, rivalGreeting, rivalName, rivalsDockedAt, rivalTier, roundBlock, standingWith } from '../../economy/rivals.ts';
import { portraitElement } from '../portraits.ts';

type Refresh = () => void;

const FACTION_WORD = (f: Person['faction']) => (f === 'independent' ? 'Independent' : FACTIONS[f].shortName);

/**
 * The people in the bar (docs/PROCGEN.md §16): story characters at home here, regulars with
 * something to tell for a round, and pilots for hire. Sit down with anyone to talk.
 */
export function peopleContent(ctx: StationContext, refresh: Refresh, openJob: (jobId: string) => void): HTMLElement {
  const { state, locationId } = ctx;
  const people = peopleAt(state, locationId);
  return h(
    'div',
    { class: 'stack people' },
    h('p', { class: 'muted small' }, `A round (${PEOPLE.drink} cr) buys what someone knows this shift: always true, sometimes worth a fortune.`),
    people.length
      ? h(
          'ul',
          { class: 'people-list' },
          people.map((p) =>
            h(
              'li',
              null,
              h(
                'button',
                { type: 'button', class: `person-card${p.story ? ' story' : ''}`, 'data-testid': `person-${p.id}`, onClick: () => void talkTo(ctx, p, refresh, openJob) },
                personPortrait(p),
                h(
                  'span',
                  { class: 'person-text' },
                  h('span', { class: 'row-name' }, p.name),
                  h('span', { class: 'row-sub' }, p.title),
                  h('span', { class: 'person-tags' }, p.story ? h('span', { class: 'tag story-tag' }, 'Story') : null, p.pilot ? h('span', { class: 'tag' }, `For hire · ${formatCredits(p.pilot.fee)}/jump`) : null, h('span', { class: 'tag muted' }, FACTION_WORD(p.faction))),
                ),
              ),
            ),
          ),
        )
      : h('p', { class: 'list-empty' }, 'The bar is quiet.'),
    rivalList(ctx, refresh),
    wingList(ctx, refresh),
  );
}

const TIER_TAG: Record<RivalTier, string> = { hostile: 'Hostile', wary: 'Wary', neutral: 'Neutral', friendly: 'Friendly' };

/** A rival's face: an independent pilot's, seeded from its id, clear of the regulars' and story faces. */
function rivalPortrait(r: RivalDef, size: 'sm' | 'lg' = 'sm'): HTMLElement {
  return portraitElement(5_000 + (hashString(r.id) % 1_000), { faction: 'independent', role: 'pilot' }, { label: `Portrait of ${rivalName(r)}`, size });
}

/** Rival pilots sitting in this bar now (docs/PROCGEN.md §24). */
function rivalList(ctx: StationContext, refresh: Refresh): HTMLElement | null {
  const { state, locationId } = ctx;
  const here = rivalsDockedAt(locationId, state.clock);
  if (!here.length) return null;
  return h(
    'section',
    { class: 'rival-section', 'aria-label': 'Rival pilots' },
    h('div', { class: 'list-head' }, h('span', null, 'Rival pilots'), dataBadge('fictional')),
    h(
      'ul',
      { class: 'people-list', 'data-testid': 'rivals-here' },
      here.map((r) => {
        const tier = rivalTier(state, r.id);
        return h(
          'li',
          null,
          h(
            'button',
            { type: 'button', class: 'person-card rival', 'data-testid': `rival-${r.id}`, onClick: () => void sitWithRival(ctx, r, refresh) },
            rivalPortrait(r),
            h(
              'span',
              { class: 'person-text' },
              h('span', { class: 'row-name' }, rivalName(r)),
              h('span', { class: 'row-sub' }, `${STYLE_LABEL[r.style]} · the ${r.shipName}`),
              h('span', { class: 'person-tags' }, h('span', { class: 'tag rival-tag' }, 'Rival'), h('span', { class: `tag tier-${tier}` }, TIER_TAG[tier])),
            ),
          ),
        );
      }),
    ),
  );
}

/** Sitting down with a rival: what they say (and, friendly, what they do next), a round, or amends. */
async function sitWithRival(ctx: StationContext, r: RivalDef, refresh: Refresh): Promise<void> {
  const { state } = ctx;
  const greeting = rivalGreeting(state, r);
  const speech = h('p', { class: 'comm speech', 'data-testid': 'rival-speech' }, greeting.text);
  const tip = h('p', { class: 'comm speech told', 'data-testid': 'rival-tip', hidden: !greeting.tip }, greeting.tip ?? '');
  const standing = h('span', { class: 'row-sub', 'data-testid': 'rival-standing' });
  const actions = h('div', { class: 'row wrap person-actions' });
  const render = () => {
    const tier = rivalTier(state, r.id);
    standing.textContent = `Standing: ${TIER_TAG[tier]} (${signed(standingWith(state, r.id))})`;
    const items: HTMLElement[] = [];
    const block = roundBlock(state, r);
    items.push(
      button(`Buy a round · ${formatCredits(PEOPLE.drink)}`, {
        variant: 'primary',
        testId: 'rival-drink',
        disabled: !!block && tier !== 'hostile',
        onClick: () => {
          const res = buyRivalRound(state, r);
          if (res.line) speech.textContent = res.line;
          ctx.sfx(res.ok ? 'ui-confirm' : 'ui-error');
          toast(res.message, res.ok ? 'good' : 'bad', 3000);
          const next = rivalGreeting(state, r).tip;
          if (next) {
            tip.textContent = next;
            tip.hidden = false;
          }
          ctx.save();
          refresh();
          render();
        },
      }),
    );
    if (tier === 'hostile') {
      items.push(
        button(`Make amends · ${formatCredits(RIVALS.standing.amends)}`, {
          testId: 'rival-amends',
          disabled: state.credits < RIVALS.standing.amends,
          onClick: () => {
            const res = makeAmends(state, r);
            if (res.line) speech.textContent = res.line;
            ctx.sfx(res.ok ? 'ui-confirm' : 'ui-error');
            toast(res.message, res.ok ? 'good' : 'bad', 3000);
            ctx.save();
            refresh();
            render();
          },
        }),
      );
    }
    replaceChildren(actions, items);
  };
  render();
  await showModal({
    title: rivalName(r),
    body: () =>
      h(
        'div',
        { class: 'person-dialog' },
        h('div', { class: 'person-head' }, rivalPortrait(r, 'lg'), h('div', { class: 'stack-tight' }, h('span', { class: 'row-sub' }, `${STYLE_LABEL[r.style]} · rival pilot`), h('span', { class: 'row-sub muted' }, `The ${r.shipName}, ${shipModel(r.ship).name}`), standing)),
        speech,
        tip,
        actions,
      ),
    actions: [{ label: 'Leave the table', value: 'close', testId: 'rival-close' }],
    dismissValue: 'close',
    testId: 'rival-dialog',
  });
}

/** The wing already on the player's pay, with a way to let them go. */
function wingList(ctx: StationContext, refresh: Refresh): HTMLElement | null {
  const { state } = ctx;
  if (!state.crew.length) return null;
  return h(
    'section',
    { class: 'wing-section', 'aria-label': 'Your wing' },
    h('div', { class: 'list-head' }, h('span', null, 'Your wing'), h('span', null, `${state.crew.length}/${COMBAT.wingmen.max}`)),
    h(
      'ul',
      { class: 'list', 'data-testid': 'your-wing' },
      state.crew.map((w) =>
        h(
          'li',
          { class: 'trade-row', 'data-testid': `pilot-${w.id}` },
          glyph('gun'),
          h('span', { class: 'trade-text' }, h('span', { class: 'row-name' }, w.name), h('span', { class: 'row-sub' }, `${shipModel(w.model).name} · ${formatCredits(w.fee)} a jump`)),
          button('Dismiss', {
            size: 'sm',
            testId: `dismiss-${w.id}`,
            onClick: () => {
              const r = dismissWingman(state, w.id);
              toast(r.message, r.ok ? 'good' : 'bad');
              ctx.save();
              refresh();
            },
          }),
        ),
      ),
    ),
  );
}

/** Sitting down with someone: what they say, a round for what they know, and their business. */
async function talkTo(ctx: StationContext, person: Person, refresh: Refresh, openJob: (jobId: string) => void): Promise<void> {
  const { state, locationId } = ctx;
  const story = person.story ? storyLine(state, person.story) : null;
  const speech = h('p', { class: 'comm speech', 'data-testid': 'person-speech' }, story ? story.text : person.greeting);
  const actions = h('div', { class: 'row wrap person-actions' });
  let goToJob: string | null = null;
  const render = (close: (v: string) => void) => {
    const items: HTMLElement[] = [];
    if (!person.story) {
      items.push(
        button(`Buy a round · ${formatCredits(PEOPLE.drink)}`, {
          variant: 'primary',
          testId: 'person-drink',
          disabled: state.credits < PEOPLE.drink,
          onClick: () => {
            const r = buyDrink(state, locationId, person.id);
            speech.textContent = r.text;
            speech.classList.add('told');
            ctx.sfx(r.ok && r.cost ? 'ui-confirm' : 'ui-click');
            if (r.ok && r.rumour) toast(r.rumour.kind === 'price' ? 'Price noted in your trade computer.' : 'Noted in your journal.', 'info', 3000);
            ctx.save();
            refresh();
            render(close);
          },
        }),
      );
    }
    if (person.pilot) {
      const p = person.pilot;
      items.push(
        button(`Hire · ${formatCredits(p.fee)}`, {
          testId: `hire-${p.id}`,
          disabled: state.crew.length >= COMBAT.wingmen.max || state.credits < p.fee,
          onClick: () => {
            const r = hireWingman(state, locationId, p.id);
            ctx.sfx(r.ok ? 'ui-confirm' : 'ui-error');
            toast(r.message, r.ok ? 'good' : 'bad');
            ctx.save();
            refresh();
            if (r.ok) close('hired');
          },
        }),
      );
    }
    if (story?.jobId) {
      items.push(
        button('See the job', {
          variant: 'primary',
          testId: 'person-job',
          onClick: () => {
            goToJob = story.jobId;
            close('job');
          },
        }),
      );
    }
    replaceChildren(actions, items);
  };
  const choice = await showModal({
    title: person.name,
    body: (close) => {
      render(close);
      return h(
        'div',
        { class: 'person-dialog' },
        h('div', { class: 'person-head' }, personPortrait(person, 'lg'), h('div', { class: 'stack-tight' }, h('span', { class: 'row-sub' }, person.title), h('span', { class: 'row-sub muted' }, FACTION_WORD(person.faction)), person.pilot ? h('span', { class: 'row-sub' }, `${shipModel(person.pilot.model).name} · ${person.pilot.skill === 'sharp' ? 'sharp shot' : 'steady hand'}`) : null)),
        speech,
        actions,
      );
    },
    actions: [{ label: 'Leave the table', value: 'close', testId: 'person-close' }],
    dismissValue: 'close',
    testId: 'person-dialog',
  });
  if (choice === 'job' && goToJob) openJob(goToJob);
}
