import type { GameState } from '../app/state.ts';
import { BATTLE_FICTION, SIDE_SHORT } from '../content/border/battleLines.ts';
import { battlesSeen } from '../economy/battles.ts';
import { dataBadge } from './components.ts';
import { h } from './dom.ts';

/**
 * The border in sight (docs/PROCGEN.md §35) in the journal: the battles the pilot saw to an end, the
 * newest first, how each went for their side and whether they took part. Fiction.
 */

/** At most this many in the journal (each front keeps its last six). */
const SHOWN = 8;

export function battlesRecord(state: GameState): HTMLElement | null {
  const seen = battlesSeen(state).slice(0, SHOWN);
  if (!seen.length) return null;
  const outcome = (r: (typeof seen)[number]['record']) =>
    r.winner === 'draw' ? 'both sides pulled back' : r.winner === r.side ? (r.part ? 'won, with your part' : 'won without you') : 'lost';
  return h(
    'section',
    { class: 'battles-record', 'aria-label': 'Border battles', 'data-testid': 'battles-record' },
    h('div', { class: 'list-head' }, h('span', null, 'Border battles'), h('span', null, dataBadge('fictional'))),
    h(
      'ul',
      { class: 'plain small' },
      seen.map(({ title, record }) => h('li', null, h('strong', null, title), ` · ${outcome(record)} · your side: ${SIDE_SHORT[record.side]}`)),
    ),
    h('p', { class: 'muted small' }, BATTLE_FICTION),
  );
}
