import type { GameState } from '../app/state.ts';
import { rivalName } from '../economy/rivals.ts';
import { rivalsWithStories, storyStatus } from '../economy/rivalStories.ts';
import { ROLE_WORD } from '../content/crew/lines.ts';
import { getLocation } from '../data/systems.ts';
import { crewAboard, gradeRole, moraleWord } from '../economy/crew.ts';
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

/** The journal's record of the crew (docs/PROCGEN.md §30): each aboard, their morale and how their story stands; and who left. */
export function crewRecord(state: GameState): HTMLElement | null {
  const crew = crewAboard(state);
  const former = state.aboard?.former ?? [];
  if (!crew.length && !former.length) return null;
  const story = (m: (typeof crew)[number]): string => {
    const s = m.story;
    if (s?.ended) return s.ended.how === 'done' ? 'their favour done' : s.ended.how === 'failed' ? 'their favour failed' : 'their favour let drop';
    if (s?.favour?.job) return 'a favour taken on';
    if (s?.favour) return 'a favour asked';
    if (s?.told !== undefined) return 'their story told';
    return 'no story told yet';
  };
  return h(
    'section',
    { class: 'rivals-record', 'aria-label': 'Your crew', 'data-testid': 'crew-record' },
    h('div', { class: 'list-head' }, h('span', null, 'Your crew'), h('span', null, dataBadge('fictional'))),
    crew.length ? h('ul', { class: 'plain small' }, crew.map((m) => h('li', { 'data-testid': `crew-record-${m.role}` }, h('strong', null, m.name), ` · ${gradeRole(m)} · morale ${moraleWord(m).toLowerCase()} · ${story(m)}`))) : null,
    former.length
      ? h(
          'p',
          { class: 'muted small', 'data-testid': 'crew-former' },
          `Left the ship: ${[...former]
            .reverse()
            .map((f) => `${f.name} (${ROLE_WORD[f.role].toLowerCase()}, ${f.why === 'unhappy' ? 'unhappy' : 'let go'} at ${getLocation(f.locationId).name})`)
            .join(', ')}.`,
        )
      : null,
  );
}
