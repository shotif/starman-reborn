import type { GameState } from '../app/state.ts';
import { SITE_CHOICES, SITE_FICTION } from '../content/wrecks/lines.ts';
import { getSystem } from '../data/systems.ts';
import { clockWords } from '../economy/rivalStories.ts';
import { mysteryStatus, siteSpec, siteUntil, type SiteCard } from '../economy/wrecks.ts';
import { dataBadge, showModal } from './components.ts';
import { h } from './dom.ts';

export type SitePick = 'follow' | 'leave' | 'insurer' | 'fence';

/**
 * What a wreck's log, a derelict's hold or a mystery's find holds (docs/PROCGEN.md §31), shown as
 * it is read; the game is paused while it is open. A lead offers its trail (Follow the trail or
 * Leave it); the strongbox offers its two endings. A number key chooses; Close leaves a lead, and
 * leaves the strongbox with its insurers. Resolves with the choice, or null.
 */
export async function showSiteCard(card: SiteCard): Promise<SitePick | null> {
  const choices: { id: SitePick; label: string }[] = card.lead
    ? [
        { id: 'follow', label: SITE_CHOICES.follow },
        { id: 'leave', label: SITE_CHOICES.leave },
      ]
    : card.choose
      ? [
          { id: 'insurer', label: SITE_CHOICES.insurer },
          { id: 'fence', label: SITE_CHOICES.fence },
        ]
      : [];
  let onKey: ((e: KeyboardEvent) => void) | null = null;
  try {
    const value = await showModal({
      title: card.title,
      body: (close) => {
        onKey = (e: KeyboardEvent) => {
          const n = Number(e.key);
          const c = Number.isInteger(n) && n >= 1 ? choices[n - 1] : undefined;
          if (c) {
            e.preventDefault();
            close(c.id);
          }
        };
        document.addEventListener('keydown', onKey);
        return h(
          'div',
          { class: 'stack choice site-card', 'data-testid': 'site-card' },
          h('p', { class: 'dialogue-text', 'data-testid': 'site-log' }, card.text),
          card.found ? h('p', { 'data-testid': 'site-found' }, card.found) : null,
          card.lead ? h('div', { class: 'callout site-lead', 'data-testid': 'site-lead' }, h('strong', null, card.lead.title), h('p', null, card.lead.text)) : null,
          card.choose ? h('p', { class: 'callout site-choose', 'data-testid': 'site-choose' }, card.choose.text) : null,
          choices.length
            ? h(
                'div',
                { class: 'choice-options', role: 'group', 'aria-label': 'Your choice' },
                choices.map((c, i) =>
                  h(
                    'button',
                    { type: 'button', class: 'choice-option', 'data-testid': `site-${c.id}`, onClick: () => close(c.id) },
                    h('span', { class: 'choice-label' }, h('kbd', { class: 'kbd lane-key' }, String(i + 1)), ' ', c.label),
                  ),
                ),
              )
            : null,
          h('p', { class: 'muted small' }, dataBadge('fictional'), ' ', SITE_FICTION),
        );
      },
      actions: [{ label: 'Close', value: '', testId: 'site-close' }],
      dismissValue: '',
      testId: 'site-dialog',
    });
    return (value as SitePick) || null;
  } finally {
    if (onKey) document.removeEventListener('keydown', onKey);
  }
}

const HOW: Record<string, string> = { done: 'done', bait: 'bait', lapsed: 'gone', dropped: 'dropped', lost: 'lost' };

/**
 * The journal's record of wrecks and their trails (docs/PROCGEN.md §31): the mystery under way (or
 * the last one) and where it stands, then the newest sites marked, what each was and how it ended.
 */
export function wrecksRecord(state: GameState): HTMLElement | null {
  const log = state.world.wrecks;
  const sites = Object.entries(log?.sites ?? {})
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 8);
  const mystery = mysteryStatus(state);
  if (!sites.length && !mystery) return null;
  return h(
    'section',
    { class: 'wrecks-record', 'aria-label': 'Wrecks and trails', 'data-testid': 'wrecks-record' },
    h('div', { class: 'list-head' }, h('span', null, 'Wrecks and trails'), h('span', null, dataBadge('fictional'))),
    mystery
      ? h(
          'div',
          { class: 'mystery small', 'data-testid': `mystery-${mystery.id}` },
          h('strong', null, mystery.title),
          h('div', { class: mystery.ended ? 'muted' : '' }, mystery.ended ?? mystery.step),
        )
      : null,
    sites.length
      ? h(
          'ul',
          { class: 'plain small' },
          sites.map(([id, r]) => {
            const s = siteSpec(id, state);
            const status = r.ended ? HOW[r.ended.how] : `waits until ${clockWords(siteUntil(state, id))}`;
            return h('li', null, h('strong', null, s?.ship ?? 'A site'), ` · ${getSystem(r.systemId).displayName} · ${status}`);
          }),
        )
      : null,
  );
}
