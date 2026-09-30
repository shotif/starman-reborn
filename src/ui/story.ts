import type { GameState } from '../app/state.ts';
import { CHARACTERS } from '../content/story/arcs.ts';
import type { Line, StoryOption } from '../content/story/types.ts';
import { getLocation, getSystem } from '../data/systems.ts';
import { FACTIONS } from '../economy/factions.ts';
import type { JobDef, Objective } from '../economy/jobs.ts';
import { arcStatuses, debriefFor, type ArcStatus } from '../economy/story.ts';
import { dataBadge, showModal } from './components.ts';
import { formatCredits, h, signed } from './dom.ts';
import { icon } from './icons.ts';

/**
 * Story UI (docs/PROCGEN.md §14): dialogue at the docks, story choices, and the journal's record
 * of each arc. The words are fiction and marked so.
 */

/** Lines of dialogue: each speaker's name and role, then what they say; scene lines in italics. */
export function dialogueBody(lines: readonly Line[]): HTMLElement {
  return h(
    'div',
    { class: 'dialogue stack' },
    lines.map((l) => {
      if (l.who === 'comm') return h('p', { class: 'dialogue-scene' }, l.text);
      const c = CHARACTERS[l.who];
      return h(
        'div',
        { class: 'dialogue-line' },
        h('p', { class: 'dialogue-who' }, h('strong', null, c.name), h('span', { class: 'muted small' }, ` · ${c.role}`)),
        h('p', { class: 'dialogue-text' }, `“${l.text.replace(/^“|”$/g, '')}”`),
      );
    }),
    h('p', { class: 'muted small' }, dataBadge('fictional'), ' People and events of the story are fiction.'),
  );
}

export async function showDialogue(title: string, lines: readonly Line[]): Promise<void> {
  await showModal({
    title,
    body: dialogueBody(lines),
    actions: [{ label: 'Continue', value: 'ok', variant: 'primary', testId: 'story-continue' }],
    dismissValue: 'ok',
    testId: 'story-dialog',
  });
}

/** What an option does to standing and credits, in short. */
export function optionEffects(option: StoryOption): string {
  const parts = (Object.entries(option.rep) as [keyof typeof FACTIONS, number][]).map(([f, d]) => `${FACTIONS[f].shortName} ${signed(d)}`);
  if (option.credits) parts.push(`+${formatCredits(option.credits)}`);
  if (option.pardon) parts.push('fines cleared');
  if (option.ends) parts.push('ends the story');
  return parts.join(' · ');
}

/** A story choice: the question and each way it can go. Resolves with the option id, or null to decide later. */
export async function showChoice(job: JobDef, o: Extract<Objective, { kind: 'choice' }>, briefing: string): Promise<string | null> {
  const speaker = job.story ? CHARACTERS[job.story.speaker] : null;
  const value = await showModal({
    title: job.title,
    body: (close) =>
      h(
        'div',
        { class: 'stack choice' },
        speaker ? h('p', { class: 'dialogue-who' }, h('strong', null, speaker.name), h('span', { class: 'muted small' }, ` · ${speaker.role}`)) : null,
        h('p', { class: 'dialogue-text' }, briefing),
        h('p', null, h('strong', null, o.prompt)),
        h(
          'div',
          { class: 'choice-options', role: 'group', 'aria-label': o.prompt },
          o.options.map((x) =>
            h(
              'button',
              { type: 'button', class: `choice-option${x.ends ? ' ends' : ''}`, 'data-testid': `choice-${x.id}`, onClick: () => close(x.id) },
              h('span', { class: 'choice-label' }, x.label),
              h('span', { class: 'choice-effects' }, optionEffects(x)),
            ),
          ),
        ),
      ),
    actions: [{ label: 'Decide later', value: '', testId: 'choice-later' }],
    dismissValue: '',
    testId: 'choice-dialog',
  });
  return value || null;
}

function phaseText(s: ArcStatus): string {
  const where = s.job ? getLocation(s.job.giverLocationId) : null;
  const who = s.job?.story ? CHARACTERS[s.job.story.speaker].name : '';
  switch (s.phase) {
    case 'complete':
      return 'Finished.';
    case 'ended':
      return `Ended at step ${s.step}: ${s.endedBy?.label.toLowerCase()}.`;
    case 'active':
      return `Step ${s.step} of ${s.of}: ${s.job!.title}.`;
    case 'available':
      return `Step ${s.step} of ${s.of}: ${who} has work for you at ${where!.name} (${getSystem(where!.systemId).displayName}).`;
    case 'locked':
      return s.step === 1 ? `Not started. ${s.lockReason ?? ''}`.trim() : `Step ${s.step} of ${s.of}: ${s.lockReason ?? 'not yet'}.`;
  }
}

/** The journal's story section: each arc, where it stands, the choices made, and the last words said. */
export function storyRecord(state: GameState): HTMLElement {
  const arcs = arcStatuses(state);
  return h(
    'section',
    { class: 'story-record', 'aria-label': 'Stories', 'data-testid': 'story-record' },
    h('div', { class: 'list-head' }, h('span', null, 'Stories'), h('span', null, `${arcs.filter((a) => a.phase === 'complete').length}/${arcs.length} finished`)),
    h(
      'ul',
      { class: 'plain story-arcs' },
      arcs.map((s) => {
        const last = s.phase === 'complete' && s.job ? debriefFor(state, s.job).at(-1) : null;
        return h(
          'li',
          { class: `story-arc ${s.phase}`, 'data-testid': `arc-${s.arc.id}` },
          h('p', null, icon(s.phase === 'complete' ? 'objective' : 'info'), ' ', h('strong', null, s.arc.title), h('span', { class: 'muted small' }, ` · ${FACTIONS[s.arc.factionId].shortName}`)),
          h('p', { class: 'small' }, phaseText(s)),
          s.choices.length ? h('ul', { class: 'plain small story-choices' }, s.choices.map((c) => h('li', null, `${c.prompt} `, h('strong', null, c.option.label), '.'))) : null,
          last && last.who !== 'comm' ? h('p', { class: 'muted small' }, `${CHARACTERS[last.who].name}: “${last.text}”`) : null,
        );
      }),
    ),
  );
}
