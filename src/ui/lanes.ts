import type { GameState } from '../app/state.ts';
import { laneChoices, laneWords, type LaneOffer } from '../economy/lanes.ts';
import { dataBadge, showModal } from './components.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';

/**
 * A lane encounter's card (docs/PROCGEN.md §27), shown when the pilot answers a hail; the game is
 * paused while it is open. Who calls and what is happening, the risk the rules name (never whether
 * this one is a trap), each choice with what it does or why this pilot cannot take it, and the
 * fiction line. A number key (1, 2, 3) chooses; Not now leaves the hail waiting. Resolves with the
 * choice's id, or null.
 */
export async function showLaneCard(state: GameState, offer: LaneOffer): Promise<string | null> {
  const words = laneWords(state, offer);
  const choices = laneChoices(state, offer);
  let onKey: ((e: KeyboardEvent) => void) | null = null;
  try {
    const value = await showModal({
      title: words.speaker,
      body: (close) => {
        onKey = (e: KeyboardEvent) => {
          const n = Number(e.key);
          const c = Number.isInteger(n) && n >= 1 ? choices[n - 1] : undefined;
          if (c && !c.lock) {
            e.preventDefault();
            close(c.id);
          }
        };
        document.addEventListener('keydown', onKey);
        return h(
          'div',
          { class: 'stack choice lane-card', 'data-testid': 'lane-card', 'data-kind': offer.kind },
          h('p', { class: 'dialogue-text' }, words.scene),
          words.risk ? h('p', { class: 'callout warn lane-risk', 'data-testid': 'lane-risk' }, icon('alert'), h('span', null, words.risk)) : null,
          h(
            'div',
            { class: 'choice-options', role: 'group', 'aria-label': 'Your answer' },
            choices.map((c, i) =>
              h(
                'button',
                { type: 'button', class: 'choice-option', 'data-testid': `lane-${c.id}`, disabled: !!c.lock, onClick: () => close(c.id) },
                h('span', { class: 'choice-label' }, h('kbd', { class: 'kbd lane-key' }, String(i + 1)), ' ', c.label),
                h('span', { class: 'choice-effects' }, c.lock ?? c.effects),
              ),
            ),
          ),
          h('p', { class: 'muted small' }, dataBadge('fictional'), ' ', words.fiction),
        );
      },
      actions: [{ label: 'Not now', value: '', testId: 'lane-later' }],
      dismissValue: '',
      testId: 'lane-dialog',
    });
    return value || null;
  } finally {
    if (onKey) document.removeEventListener('keydown', onKey);
  }
}
