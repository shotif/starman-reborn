import type { GameState } from '../app/state.ts';
import { shipModel } from '../content/catalog.ts';
import { CLASS_HULLS, CLASS_NAMES, KIND_NAMES, KIND_NOTES, RACE_CARD, RACING_FICTION } from '../content/racing/lines.ts';
import { COURSE_KINDS, RACE_CLASSES, RACING } from '../content/racing/rules.ts';
import { getLocation } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { minutes } from '../economy/events.ts';
import {
  boardRecord,
  clubTimesKnown,
  courseById,
  courseKey,
  courseName,
  entryBlock,
  enterRace,
  entryHeat,
  feeOf,
  heatStart,
  lineUp,
  ownPar,
  prizeFor,
  raceClass,
  raceTime,
  racingLog,
  racingNews,
  venueAt,
  warmClubTimes,
  type RaceCard,
  type Venue,
} from '../economy/racing.ts';
import { button, dataBadge, showModal, toast } from './components.ts';
import { formatCredits, h } from './dom.ts';
import { glyph } from './glyphs.ts';
import type { StationContext } from './station/context.ts';

/**
 * Races on the lanes (docs/PROCGEN.md §33): a club's window in the bar (its two courses, this heat's
 * field in the pilot's class, the fee and purse, par and records, the record board), the result card,
 * the journal's racing record and the News. Fiction, and labelled so.
 */

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
const DASH = '…';

/** Whether a station has a racing club (its bar shows Races). */
export const hasRaces = (locationId: string): boolean => !!venueAt(locationId);

/** A club's window. */
export function racesContent(ctx: StationContext, refresh: () => void): HTMLElement {
  const { state, locationId } = ctx;
  const venue = venueAt(locationId)!;
  const cls = raceClass(state.ship.model);
  const heat = entryHeat(state.clock);
  const entry = racingLog(state)?.entry;
  const known = clubTimesKnown(venue, state.ship);
  if (!known) warmClubTimes(venue, state.ship, refresh);
  const when = `closes in ${Math.max(1, minutes(heatStart(heat + 1) - state.clock))} min`;
  const enteredHere = entry ? courseById(entry.course) : undefined;
  return h(
    'div',
    { class: 'stack races', 'data-testid': 'races' },
    h('div', { class: 'list-head' }, h('span', null, venue.club, ' ', dataBadge('fictional')), h('span', { 'data-testid': 'race-level' }, RACE_CARD.level[venue.level - 1])),
    h('p', { class: 'small', 'data-testid': 'race-class' }, `This heat ${when}. You race in the ${CLASS_NAMES[cls].toLowerCase()} class (${CLASS_HULLS[cls]}).`),
    entry && enteredHere
      ? h(
          'p',
          { class: 'callout good', 'data-testid': 'race-entry' },
          glyph('thruster'),
          ` ${RACE_CARD.entered}: ${courseName(enteredHere.line)}, ${CLASS_NAMES[entry.cls].toLowerCase()} class. ${enteredHere.venue.locationId === locationId ? 'Launch and fly to the start line.' : `At ${getLocation(enteredHere.venue.locationId).name}.`}`,
        )
      : null,
    ...COURSE_KINDS.map((kind) => courseCard(ctx, venue, kind, cls, heat, known, refresh)),
    h('div', { class: 'list-head' }, h('span', null, RACE_CARD.board), h('span', null, dataBadge('fictional'))),
    board(state, venue, known),
    h('p', { class: 'muted small' }, dataBadge('fictional'), ' ', RACING_FICTION),
  );
}

function courseCard(ctx: StationContext, venue: Venue, kind: (typeof COURSE_KINDS)[number], cls: (typeof RACE_CLASSES)[number], heat: number, known: boolean, refresh: () => void): HTMLElement {
  const { state } = ctx;
  const line = venue.courses[kind];
  const field = lineUp(state, line.id, cls, heat);
  const par = known ? ownPar(line, state.ship) : null;
  const record = known ? boardRecord(state, line.id, cls) : null;
  const best = racingLog(state)?.courses[courseKey(line.id, cls)]?.best;
  const block = entryBlock(state, line.id);
  const prizes = RACING.pay.places.map((_, i) => formatCredits(prizeFor(venue, kind, i + 1))).join(' · ');
  return h(
    'section',
    { class: 'race-course', 'data-testid': `race-course-${kind}` },
    h('div', { class: 'race-course-head' }, h('strong', null, courseName(line)), h('span', { class: 'muted small' }, ` ${KIND_NAMES[kind]} · ${KIND_NOTES[kind]}`)),
    h('p', { class: 'small' }, `${(line.length / 1000).toFixed(1)} km · ${line.gates.length - 2} gates · ${RACE_CARD.fee} ${formatCredits(feeOf(venue, kind))} · ${RACE_CARD.purse} ${prizes}`),
    h(
      'p',
      { class: 'small race-times' },
      h('span', { 'data-testid': `race-par-${kind}` }, `${RACE_CARD.par}: ${par === null ? DASH : raceTime(par)}`),
      ' · ',
      h('span', { 'data-testid': `race-record-${kind}` }, `${RACE_CARD.courseRecord}: ${record ? `${raceTime(record.time)} (${record.holder})` : DASH}`),
      ' · ',
      h('span', null, `${RACE_CARD.yourBest}: ${best ? raceTime(best.raw) : RACE_CARD.noBest}`),
    ),
    h('div', { class: 'list-head' }, h('span', null, `${RACE_CARD.field}: ${CLASS_NAMES[cls].toLowerCase()} class`), h('span', null, `${field.length} racers`)),
    h(
      'ul',
      { class: 'plain small race-field', 'data-testid': `race-field-${kind}` },
      field.map((r) => h('li', null, h('strong', null, r.name), ` · ${shipModel(r.model).name}`, r.rival ? h('span', { class: 'job-tag' }, 'Rival pilot') : null)),
    ),
    block
      ? h('p', { class: 'muted small', 'data-testid': `race-lock-${kind}` }, block)
      : button(`${RACE_CARD.enter} · ${formatCredits(feeOf(venue, kind))}`, {
          variant: 'primary',
          testId: `race-enter-${kind}`,
          onClick: () => {
            const r = enterRace(state, line.id);
            ctx.sfx(r.ok ? 'ui-confirm' : 'ui-error');
            toast(r.message, r.ok ? 'good' : 'bad', 4000);
            ctx.save();
            refresh();
          },
        }),
  );
}

/** The record board: each course and class, its record, the pilot's best, and how they have done there. */
function board(state: GameState, venue: Venue, known: boolean): HTMLElement {
  return h(
    'ul',
    { class: 'plain small race-board', 'data-testid': 'race-board' },
    COURSE_KINDS.flatMap((kind) =>
      RACE_CLASSES.map((cls) => {
        const line = venue.courses[kind];
        const record = known ? boardRecord(state, line.id, cls) : null;
        const c = racingLog(state)?.courses[courseKey(line.id, cls)];
        return h(
          'li',
          { 'data-testid': `race-board-${kind}-${cls}` },
          h('strong', null, `${courseName(line)} · ${CLASS_NAMES[cls]}`),
          `: ${RACE_CARD.courseRecord.toLowerCase()} ${record ? `${raceTime(record.time)} (${record.holder})` : DASH}`,
          c?.best ? ` · ${RACE_CARD.yourBest.toLowerCase()} ${raceTime(c.best.raw)} in the ${shipModel(c.best.ship).name}` : '',
          c ? ` · ${c.runs} raced, ${c.podiums} on the podium, ${c.wins} won` : '',
        );
      }),
    ),
  );
}

/** The result card at the finish line. */
export async function showRaceResult(card: RaceCard): Promise<void> {
  await showModal({
    title: RACE_CARD.title.replace('{course}', card.name),
    testId: 'race-dialog',
    body: h(
      'div',
      { class: 'stack race-card' },
      h('p', { class: 'dialogue-text', 'data-testid': 'race-place' }, card.place === 1 ? RACE_CARD.win : RACE_CARD.placed.replace('{place}', `${ordinal(card.place)} of ${card.of}`), ` ${raceTime(card.raw)}.`),
      card.prize ? h('p', { class: 'good' }, RACE_CARD.prize.replace('{prize}', formatCredits(card.prize))) : null,
      card.recordPrize ? h('p', { class: 'good', 'data-testid': 'race-record-prize' }, RACE_CARD.record.replace('{prize}', formatCredits(card.recordPrize))) : null,
      card.best ? h('p', { class: 'small' }, RACE_CARD.best) : null,
      h('p', { class: 'small', 'data-testid': 'race-points' }, RACE_CARD.points.replace('{points}', String(card.points))),
      h('div', { class: 'list-head' }, h('span', null, RACE_CARD.field), h('span', null, `${CLASS_NAMES[card.cls]} class`)),
      h(
        'ol',
        { class: 'small race-rows', 'data-testid': 'race-rows' },
        card.rows.map((r) => h('li', r.you ? { class: 'you' } : null, h('strong', null, r.name), ` · ${shipModel(r.model).name} · `, r.time === null ? RACE_CARD.out : raceTime(r.time))),
      ),
      h('p', { class: 'muted small' }, dataBadge('fictional'), ' ', RACING_FICTION),
    ),
    actions: [{ label: 'Continue', value: 'ok', variant: 'primary', testId: 'race-continue' }],
    dismissValue: 'ok',
  });
}

/** The journal's racing record: each course and class raced, the best, and the results. */
export function racingRecord(state: GameState): HTMLElement | null {
  const log = racingLog(state);
  if (!log || !Object.keys(log.courses).length) return null;
  return h(
    'section',
    { class: 'races-record', 'aria-label': 'Racing', 'data-testid': 'races-record' },
    h('div', { class: 'list-head' }, h('span', null, 'Racing'), h('span', null, dataBadge('fictional'))),
    h(
      'ul',
      { class: 'plain small' },
      Object.entries(log.courses).map(([key, c]) => {
        const course = courseById(key.replace(/\.(light|heavy)$/, ''));
        const cls = key.endsWith('.heavy') ? 'heavy' : 'light';
        if (!course) return null;
        return h(
          'li',
          null,
          h('strong', null, `${courseName(course.line)} · ${CLASS_NAMES[cls]}`),
          ` (${course.venue.club}): `,
          c.best ? `best ${raceTime(c.best.raw)}` : 'no finish yet',
          ` · ${c.runs} raced, ${c.podiums} on the podium, ${c.wins} won${c.record ? ' · course record' : ''}`,
        );
      }),
    ),
  );
}

/** The pilot's wins and records in the News here. */
export function racingNewsList(state: GameState, systemId: SystemId): HTMLElement | null {
  const items = racingNews(state, systemId, state.clock);
  if (!items.length) return null;
  return h(
    'ul',
    { class: 'list news-list', 'data-testid': 'racing-news' },
    items.map((n) =>
      h(
        'li',
        { class: 'news-item kind-race' },
        glyph('thruster'),
        h(
          'span',
          { class: 'news-text' },
          h('span', { class: 'row-name' }, n.headline, ' ', dataBadge('fictional')),
          h('span', { class: 'row-sub' }, state.clock - n.at < 60 ? 'just now' : `${minutes(state.clock - n.at)} min ago`),
          h('span', { class: 'news-detail' }, n.text),
        ),
      ),
    ),
  );
}
