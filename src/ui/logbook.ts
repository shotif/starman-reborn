import type { GameState } from '../app/state.ts';
import { LOG_BESTS, LOG_FILTERS } from '../content/progress/logbook.ts';
import { gameJulianDate } from '../data/solar.ts';
import { logBests, logbookOf, logText, placeName } from '../economy/logbook.ts';
import { button } from './components.ts';
import { h, replaceChildren } from './dom.ts';
import { sheet } from './screens/panels.ts';
import './styles/logbook.css';

/**
 * The pilot's logbook (docs/PROCGEN.md §46.4), loaded the first time it opens: the bests, then every
 * entry, newest first, under the game's month and year, each with its day and place; buttons filter
 * it by kind.
 */
export function openLogbook(parent: HTMLElement, state: GameState, onClose: () => void): { close(): void } {
  const book = logbookOf(state);
  let filter: string | null = null;
  const list = h('div', { class: 'logbook-entries', 'data-testid': 'logbook-entries' });
  const chips = h('div', { class: 'row wrap segmented logbook-filters', role: 'group', 'aria-label': 'Show' });

  const day = (at: number) => {
    const jd = gameJulianDate(state.createdAt, at);
    return jd === null ? null : new Date((jd - 2_440_587.5) * 86_400_000);
  };
  const render = () => {
    replaceChildren(
      chips,
      [{ id: 'all', label: 'All' }, ...LOG_FILTERS].map((f) =>
        button(f.label, {
          size: 'sm',
          variant: (filter ?? 'all') === f.id ? 'primary' : 'ghost',
          testId: `logbook-filter-${f.id}`,
          onClick: () => {
            filter = f.id === 'all' ? null : f.id;
            render();
          },
        }),
      ),
    );
    const kinds = filter ? LOG_FILTERS.find((f) => f.id === filter)?.kinds : null;
    const shown = book.entries.filter((e) => !kinds || kinds.includes(e.kind)).reverse();
    // Under the game's month and year, newest first.
    const months = new Map<string, HTMLElement[]>();
    for (const e of shown) {
      const d = day(e.at);
      const month = d ? d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
      const place = placeName(e.where);
      const when = d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
      const rows = months.get(month) ?? months.set(month, []).get(month)!;
      rows.push(h('li', { class: 'logbook-entry', 'data-testid': 'logbook-entry', 'data-kind': e.kind }, h('span', { class: 'logbook-when muted small' }, [when, place].filter(Boolean).join(' · ')), h('span', null, logText(e))));
    }
    replaceChildren(
      list,
      shown.length
        ? [...months].map(([month, rows]) => h('section', { class: 'logbook-month' }, h('h3', { class: 'logbook-month-head' }, month), h('ul', { class: 'plain' }, rows)))
        : h('p', { class: 'list-empty' }, 'Nothing of that kind written yet.'),
    );
  };
  render();

  const bests = logBests(state);
  const s = sheet(
    parent,
    'Logbook',
    h(
      'div',
      { class: 'stack logbook', 'data-testid': 'logbook' },
      h('dl', { class: 'kv logbook-bests', 'data-testid': 'logbook-bests' }, bests.flatMap((b) => [h('dt', null, LOG_BESTS[b.key as keyof typeof LOG_BESTS]), h('dd', null, b.value, b.note ? h('span', { class: 'muted small' }, ` ${b.note}`) : null)])),
      chips,
      list,
    ),
    onClose,
    'logbook-sheet',
  );
  return s;
}
