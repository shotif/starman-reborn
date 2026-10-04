import type { GameState, Wingman } from '../app/state.ts';
import { shipModel } from '../content/catalog.ts';
import { COMBAT } from '../content/combat/rules.ts';
import { TRUST_NAMES, WING_FICTION } from '../content/wing/lines.ts';
import type { WingOrder } from '../content/wing/rules.ts';
import { rivalById } from '../economy/rivals.ts';
import { partWays } from '../economy/rivalStories.ts';
import { gradeName, isDown, isHired, isWingHurt, letWingmanGo, nextGrade, trustBand, trustOf, wingGrade, wingLine, wingTags, type WingTag } from '../economy/wing.ts';
import type { WingOption } from '../world/WingCommand.ts';
import { button, dataBadge, showModal, toast } from './components.ts';
import { formatCredits, h } from './dom.ts';
import { glyph } from './glyphs.ts';
import type { Refresh, StationContext } from './station/context.ts';

/**
 * Wing command (docs/PROCGEN.md §34): the order card in flight (paused, as a hail's card is), the
 * wing in the bar with each wingman's record and how they feel, and the journal's wing. Fiction.
 */

const TAG_WORDS: Record<WingTag, string> = { hurt: 'Hurt', down: 'Picked up', notice: 'Notice', loyal: 'Loyal', wary: 'Wary', owed: 'Owed' };

/** One line for a wingman: their grade, and hurt or down. */
function rosterLine(state: GameState, w: Wingman): string {
  if (!isHired(w)) return `${w.name} · your ally`;
  const hurt = isDown(w) ? ' · picked up, rejoining at your next dock' : isWingHurt(w, state.clock) ? ' · hurt, holding back' : '';
  return `${w.name} · ${gradeName(wingGrade(w))}${hurt}`;
}

/** The order card: the wing, and the six orders (keys 1–6), each with what it does or why not now. */
export async function showWingCard(state: GameState, options: readonly WingOption[]): Promise<WingOrder | null> {
  let onKey: ((e: KeyboardEvent) => void) | null = null;
  try {
    const value = await showModal({
      title: 'Wing orders',
      body: (close) => {
        onKey = (e: KeyboardEvent) => {
          const n = Number(e.key);
          const o = Number.isInteger(n) && n >= 1 ? options[n - 1] : undefined;
          if (o && !o.lock) {
            e.preventDefault();
            close(o.order);
          }
        };
        document.addEventListener('keydown', onKey);
        return h(
          'div',
          { class: 'stack choice wing-card', 'data-testid': 'wing-card' },
          h(
            'ul',
            { class: 'plain small wing-roster' },
            state.crew.filter((w) => !isDown(w)).map((w) => h('li', { 'data-testid': `wing-card-${w.id}` }, glyph('wing'), ' ', rosterLine(state, w))),
          ),
          h(
            'div',
            { class: 'choice-options', role: 'group', 'aria-label': 'Orders' },
            options.map((o, i) =>
              h(
                'button',
                { type: 'button', class: 'choice-option', 'data-testid': `wing-order-${o.order}`, disabled: !!o.lock, onClick: () => close(o.order) },
                h('span', { class: 'choice-label' }, h('kbd', { class: 'kbd lane-key' }, String(i + 1)), ' ', o.label),
                h('span', { class: 'choice-effects' }, o.lock ?? o.effect),
              ),
            ),
          ),
          h('p', { class: 'muted small' }, dataBadge('fictional'), ' ', WING_FICTION),
        );
      },
      actions: [{ label: 'Not now', value: '', testId: 'wing-later' }],
      dismissValue: '',
      testId: 'wing-orders',
    });
    return (value || null) as WingOrder | null;
  } finally {
    if (onKey) document.removeEventListener('keydown', onKey);
  }
}

/** The wing on the pilot's pay, in the bar: each wingman's grade, record, fee and how they feel, a word with them, and letting them go. */
export function wingSection(ctx: StationContext, refresh: Refresh): HTMLElement | null {
  const { state } = ctx;
  if (!state.crew.length) return null;
  return h(
    'section',
    { class: 'wing-section', 'aria-label': 'Your wing' },
    h('div', { class: 'list-head' }, h('span', null, 'Your wing'), h('span', null, `${state.crew.length}/${COMBAT.wingmen.max}`)),
    h(
      'ul',
      { class: 'list', 'data-testid': 'your-wing' },
      state.crew.map((w) => {
        const ally = w.ally ? rivalById(w.ally) : undefined;
        const tags = wingTags(state, w);
        const sub = ally
          ? `Your ally · ${shipModel(w.model).name} · flies free until you next dock`
          : `${gradeName(wingGrade(w))} · ${shipModel(w.model).name} · ${formatCredits(w.fee)} a jump`;
        // The tags on a line of their own, wrapping, so none is cut off on a narrow phone.
        const text = h(
          'span',
          { class: 'trade-text' },
          h('span', { class: 'row-name' }, w.name),
          h('span', { class: 'row-sub' }, sub),
          tags.length ? h('span', { class: 'person-tags' }, tags.map((t) => h('span', { class: `job-tag wing-tag ${t}`, 'data-testid': `wing-tag-${w.id}-${t}` }, TAG_WORDS[t]))) : null,
        );
        return h(
          'li',
          { class: 'trade-row', 'data-testid': `pilot-${w.id}` },
          glyph('gun'),
          ally ? text : h('button', { type: 'button', class: 'plain-button wing-talk', 'data-testid': `wing-talk-${w.id}`, onClick: () => void wingDialog(ctx, w, refresh) }, text),
          button(ally ? 'Part ways' : 'Dismiss', {
            size: 'sm',
            testId: `dismiss-${w.id}`,
            onClick: () => {
              const r = ally ? partWays(state, ally) : letWingmanGo(state, w.id);
              toast(r.message, r.ok ? 'good' : 'bad');
              ctx.save();
              refresh();
            },
          }),
        );
      }),
    ),
  );
}

/** A word with a wingman: what they say, their record, how far to their next grade, and how they feel about the pilot. */
async function wingDialog(ctx: StationContext, w: Wingman, refresh: Refresh): Promise<void> {
  const { state } = ctx;
  const next = nextGrade(w);
  const trust = trustOf(w);
  await showModal({
    title: w.name,
    testId: 'wing-dialog',
    body: h(
      'div',
      { class: 'stack' },
      h('p', { class: 'comm speech', 'data-testid': 'wing-says' }, wingLine(w)),
      h(
        'p',
        { class: 'small', 'data-testid': 'wing-grade' },
        `${gradeName(wingGrade(w))}: ${w.fights ?? 0} fights beside you, ${w.downs ?? 0} raiders downed.`,
        next ? ` ${next.points} more to ${next.name}.` : ' The top grade.',
      ),
      h(
        'div',
        { class: 'wing-trust', 'data-testid': 'wing-trust' },
        h('span', { class: 'muted small' }, `How they feel: ${TRUST_NAMES[trustBand(trust)]}`),
        h('span', { class: 'rating-bar', style: `--fill: ${trust / 100}` }),
      ),
      isWingHurt(w, state.clock) && !isDown(w) ? h('p', { class: 'muted small' }, 'Hurt: holding back from fights until they mend, or a medic at a dock that repairs ships sees to them.') : null,
      w.notice !== undefined ? h('p', { class: 'callout warn small' }, 'They have given notice: win them back, or they leave at your next dock.') : null,
      h('p', { class: 'muted small' }, dataBadge('fictional'), ' ', WING_FICTION),
    ),
    actions: [{ label: 'Back', value: 'ok', testId: 'wing-close' }],
    dismissValue: 'ok',
  });
  refresh();
}

/** The journal's wing: who flies with the pilot, their grade and record, and who has flown with them before. */
export function wingRecord(state: GameState): HTMLElement | null {
  const hired = state.crew.filter(isHired);
  const former = state.wingFormer ?? [];
  if (!hired.length && !former.length) return null;
  const why = { 'let-go': 'let go', unpaid: 'left unpaid', unhappy: 'left unhappy' } as const;
  return h(
    'section',
    { class: 'wing-record', 'aria-label': 'Your wing', 'data-testid': 'wing-record' },
    h('div', { class: 'list-head' }, h('span', null, 'Your wing'), h('span', null, dataBadge('fictional'))),
    h(
      'ul',
      { class: 'plain small' },
      hired.map((w) => h('li', null, h('strong', null, w.name), ` · ${gradeName(wingGrade(w))} · ${w.fights ?? 0} fights, ${w.downs ?? 0} downed · ${TRUST_NAMES[trustBand(trustOf(w))]}`)),
    ),
    former.length
      ? h(
          'ul',
          { class: 'plain small muted', 'data-testid': 'wing-former' },
          [...former].reverse().map((f) => h('li', null, `Flew with you: ${f.name} · ${gradeName(wingGrade(f))} · ${why[f.why]}`)),
        )
      : null,
  );
}
