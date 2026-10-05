import type { CommodityId, GameState, OutpostRecord } from '../../app/state.ts';
import { BAND_WORD, FOLK, TRADE_WORD, WORK_WORDS, type FolkTrade } from '../../content/outposts/folk.ts';
import { cargoCount } from '../../economy/cargo.ts';
import { COMMODITIES } from '../../economy/commodities.ts';
import { askLine, askNeeds, askShort, bandOf, folkPeople, handOverAsk, spiritAt, spiritFactor, spiritLine, worksIncome, type FolkLine, type FolkPerson } from '../../economy/folk.ts';
import { button, dataBadge, showModal, toast } from '../components.ts';
import { h } from '../dom.ts';
import { portraitElement } from '../portraits.ts';
import type { Refresh, StationContext } from './context.ts';

/**
 * People at your outposts (docs/PROCGEN.md §41.4): the Outpost window's People (each person, the
 * spirit, the ask open with a Hand over button for goods, and what they have made), the line in the
 * Fleet window's list, and what they say as the pilot docks. The people and their words are fiction.
 */

const FICTION = 'The people at your outposts, their asks and what they make are fiction.';
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))}%`;

function folkPortrait(seed: number, trade: FolkTrade, age: FolkPerson['age'], name: string, size: 'sm' | 'md' = 'sm'): HTMLElement {
  return portraitElement(seed, { faction: 'independent', role: FOLK.trades[trade].look, age }, { label: `Portrait of ${name}`, size });
}

/** What a work does, in a line. */
function workEffect(trade: FolkTrade, good?: CommodityId): string {
  const w = FOLK.trades[trade].work;
  if (w.kind === 'income') return `Income ${pct(w.income)} for good.`;
  if (w.kind === 'repair') return `Hull repairs here cost ${Math.round(w.cut * 100)}% less.`;
  if (w.kind === 'steady') return `Its spirit falls ${w.drift === 0.5 ? 'half' : `${Math.round(w.drift * 100)}%`} as fast while you are away.`;
  const name = good ? COMMODITIES[good].name : 'A good';
  return `${name} cheaper and more plentiful in its market, for good.`;
}

/** How far a person's story has gone. */
function storyLine(o: OutpostRecord, p: FolkPerson): string {
  const f = o.folk;
  const done = f?.steps[p.slot] ?? 0;
  const work = f?.works.find((w) => w.slot === p.slot);
  if (work) return `Made ${WORK_WORDS[p.trade].name.replace(/^The /, 'the ').replace(/^Proper/, 'proper')}`;
  return done === 0 ? 'No asks done yet' : `${done} of ${FOLK.asks.story} asks done`;
}

/** The spirit and what it and the works do to the income, in a line. */
export function spiritWords(o: OutpostRecord, clock: number): string {
  const s = spiritAt(o, clock);
  const spirit = spiritFactor(s) - 1;
  const works = worksIncome(o) - 1;
  return `Spirit ${BAND_WORD[bandOf(s)].toLowerCase()} (${Math.round(s)}): income ${pct(spirit)}${works > 0 ? `, and ${pct(works)} from what they have made` : ''}.`;
}

/** The Fleet window's line for an outpost: its spirit, and any ask open. */
export function folkSummary(state: GameState, o: OutpostRecord): string | null {
  if (!o.folk || o.stage <= 0) return null;
  const s = spiritAt(o, state.clock);
  const ask = o.folk.ask;
  return `People: spirit ${BAND_WORD[bandOf(s)].toLowerCase()}${ask ? ` · asking for ${askShort(ask, o)}` : ''}`;
}

/** The Outpost window's People: who lives there, the spirit, the ask open and what they have made. */
export function peopleSection(ctx: StationContext, o: OutpostRecord, refresh: Refresh): HTMLElement {
  const { state } = ctx;
  const people = folkPeople(state, o);
  const f = o.folk;
  const ask = f?.ask;
  const asker = ask ? people.find((p) => p.slot === ask.slot) : undefined;
  const band = bandOf(spiritAt(o, state.clock));
  const can = ask?.kind === 'goods' && ask.good && ask.qty ? cargoCount(state.ship.cargo, ask.good) >= ask.qty : false;
  return h(
    'section',
    { 'aria-label': 'People', 'data-testid': 'outpost-people' },
    h('div', { class: 'list-head' }, h('span', null, 'People'), h('span', { 'data-testid': 'folk-band' }, BAND_WORD[band])),
    h('p', { class: 'muted small', 'data-testid': 'folk-spirit' }, spiritWords(o, state.clock)),
    ask && asker
      ? h(
          'div',
          { class: 'folk-ask', 'data-testid': 'folk-ask' },
          h('div', { class: 'person-head' }, folkPortrait(asker.seed, asker.trade, asker.age, asker.name), h('div', { class: 'stack-tight' }, h('span', { class: 'row-name' }, `${asker.name} asks`), h('span', { class: 'row-sub' }, TRADE_WORD[asker.trade]))),
          h('p', { class: 'comm speech', 'data-testid': 'folk-ask-line' }, `“${askLine(state, o, ask).text}”`),
          h('p', { class: 'muted small', 'data-testid': 'folk-ask-needs' }, askNeeds(state, o, ask)),
          ask.kind === 'goods'
            ? h(
                'div',
                { class: 'row wrap' },
                button(`Hand over ${ask.qty} ${COMMODITIES[ask.good!].name.toLowerCase()}`, {
                  size: 'sm',
                  testId: 'folk-hand-over',
                  disabled: !can,
                  title: can ? undefined : 'Not enough in your hold',
                  onClick: () => {
                    const r = handOverAsk(state);
                    ctx.sfx(r.ok ? 'ui-confirm' : 'ui-error');
                    ctx.save();
                    if (!r.ok || !r.line) {
                      toast(r.message, r.ok ? 'good' : 'bad', 5000);
                      refresh();
                      return;
                    }
                    void showFolkWords(state, o, [r.line], r.work ? WORK_WORDS[r.work.trade].name : null).then(() => (r.work ? ctx.reload('outpost') : refresh()));
                  },
                }),
              )
            : null,
        )
      : h('p', { class: 'muted small', 'data-testid': 'folk-no-ask' }, 'Nobody is asking for anything just now.'),
    h(
      'div',
      { class: 'people-list', 'data-testid': 'folk-people' },
      people.map((p) =>
        h(
          'div',
          { class: 'person-card', 'data-testid': `folk-person-${p.slot}` },
          folkPortrait(p.seed, p.trade, p.age, p.name),
          h(
            'span',
            { class: 'person-text' },
            h('span', { class: 'row-name' }, p.name),
            h('span', { class: 'row-sub' }, `${TRADE_WORD[p.trade]} · ${storyLine(o, p)}`),
            h('span', { class: 'row-sub muted' }, `“${spiritLine(o, p.slot, band)}”`),
          ),
        ),
      ),
    ),
    f?.works.length
      ? h(
          'div',
          { class: 'stack-tight', 'data-testid': 'folk-works' },
          h('div', { class: 'list-head' }, h('span', null, 'What they have made')),
          h(
            'ul',
            { class: 'plain small' },
            f.works.map((w) => h('li', { 'data-testid': `folk-work-${w.trade}` }, h('strong', null, WORK_WORDS[w.trade].name), `: ${WORK_WORDS[w.trade].what}. ${workEffect(w.trade, w.good)}`)),
          ),
        )
      : null,
    h('p', { class: 'muted small' }, dataBadge('fictional'), ` ${FICTION}`),
  );
}

/** What the people say: as the pilot docks, or as an ask is done. With a work built, its name heads the dialogue. */
export async function showFolkWords(state: GameState, o: OutpostRecord, lines: readonly FolkLine[], built: string | null = null): Promise<void> {
  const people = folkPeople(state, o);
  await showModal({
    title: built ? `${o.name}: ${built}` : `At ${o.name}`,
    body: h(
      'div',
      { class: 'dialogue stack' },
      lines.map((l) => {
        const p = people.find((x) => x.slot === l.slot);
        return h(
          'div',
          { class: 'dialogue-line person-head', 'data-testid': `folk-line-${l.slot}` },
          p ? folkPortrait(p.seed, p.trade, p.age, p.name) : null,
          h('div', { class: 'stack-tight' }, h('p', { class: 'dialogue-who' }, h('strong', null, l.name), h('span', { class: 'muted small' }, ` · ${TRADE_WORD[l.trade]}`)), h('p', { class: 'dialogue-text' }, `“${l.text}”`)),
        );
      }),
      h('p', { class: 'muted small' }, dataBadge('fictional'), ` ${FICTION}`),
    ),
    actions: [{ label: 'Continue', value: 'ok', variant: 'primary', testId: 'folk-continue' }],
    dismissValue: 'ok',
    testId: 'folk-dialog',
  });
}
