import type { GameState } from '../app/state.ts';
import { LANE_LINES } from '../content/lanes/lines.ts';
import { getSystem } from '../data/systems.ts';
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

/** The journal's record of the lanes (docs/PROCGEN.md §27): the encounters met lately, newest first, and what came of each. */
export function lanesRecord(state: GameState): HTMLElement | null {
  const met = Object.values(state.world.lanes ?? {})
    .sort((a, b) => b.at - a.at)
    .slice(0, 12);
  if (!met.length) return null;
  const ago = (at: number) => {
    const m = Math.max(0, Math.round((state.clock - at) / 60));
    return m < 1 ? 'just now' : m < 120 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  };
  return h(
    'section',
    { class: 'lanes-record', 'aria-label': 'The lanes', 'data-testid': 'lanes-record' },
    h('div', { class: 'list-head' }, h('span', null, 'The lanes'), h('span', null, dataBadge('fictional'))),
    h(
      'ul',
      { class: 'plain small' },
      met.map((r) => {
        const lines = LANE_LINES[r.kind];
        const what = r.pick === undefined ? 'waiting for an answer' : r.pick === 'lapsed' ? 'let go' : (lines.options[r.pick]?.label.toLowerCase() ?? r.pick);
        return h('li', null, h('strong', null, lines.speaker), ` · ${getSystem(r.systemId).displayName} · ${ago(r.at)}: ${what}`);
      }),
    ),
  );
}
