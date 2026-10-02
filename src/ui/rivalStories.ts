import type { GameState } from '../app/state.ts';
import { rivalName } from '../economy/rivals.ts';
import { rivalsWithStories, storyStatus } from '../economy/rivalStories.ts';
import { dataBadge } from './components.ts';
import { h } from './dom.ts';

/** The journal's record of rivals' stories (docs/PROCGEN.md §28): each rival with one, and how it stands. */
export function rivalsRecord(state: GameState): HTMLElement | null {
  const rivals = rivalsWithStories(state);
  if (!rivals.length) return null;
  return h(
    'section',
    { class: 'rivals-record', 'aria-label': 'Rival pilots', 'data-testid': 'rivals-record' },
    h('div', { class: 'list-head' }, h('span', null, 'Rival pilots'), h('span', null, dataBadge('fictional'))),
    h(
      'ul',
      { class: 'plain small' },
      rivals.map((r) => h('li', { 'data-testid': `rival-record-${r.id}` }, h('strong', null, rivalName(r)), ` · ${storyStatus(state, r) ?? ''}`)),
    ),
  );
}
