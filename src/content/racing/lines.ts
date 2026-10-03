import type { RivalVoice } from '../rivals/rules.ts';

/**
 * Words for races on the lanes (docs/PROCGEN.md §33): the clubs' names, the courses', what the
 * marshals and racers say, the cards and the News. Invented for this game; club racers' names come
 * from the bars' own name pools. Fields in braces are filled in by the game.
 */

/** Clubs, given to venues in order. */
export const CLUB_NAMES = [
  'Tailwind Club',
  'Copperline Flyers',
  'Swiftmere Racing Club',
  'Gatehouse Club',
  'Longbow Flyers',
  'Brightwater Club',
  'Slipstream Society',
  'Quicksilver Club',
  'Swiftwing Flyers',
  'Windrush Club',
  'Hareline Racing Club',
  'Kingfisher Flyers',
  'Spindle Club',
  'Whitethroat Flyers',
  'Halfmoon Racing Club',
  'Highflyer Society',
  'Tidewater Club',
  'Wrenfield Flyers',
  'Blue Ribbon Club',
  'Goldcrest Racing Club',
  'Featherweight Club',
  'Sandpiper Flyers',
] as const;

/** A course's name: a Sprint round its body, a Run from its host (to the far dock, or out and back). */
export const COURSE_NAMES = {
  sprint: '{body} Loop',
  run: '{from} to {to}',
  out: '{from} Run',
} as const;

export const CLASS_NAMES = { light: 'Light', heavy: 'Heavy' } as const;
export const CLASS_HULLS = { light: 'couriers, light fighters and surveyors', heavy: 'heavy fighters, gunships and freighters' } as const;
export const KIND_NAMES = { sprint: 'Sprint', run: 'Run' } as const;
export const KIND_NOTES = { sprint: 'Sublight: no cruise.', run: 'Cruise allowed.' } as const;

/** What the pilot is told in flight. */
export const RACE_LINES = {
  objective: {
    approach: '{course}: fly to the start line',
    ready: '{course}: in the box, press Start',
    on: '{course}: gate {n} of {of}',
    finish: '{course}: the finish line',
  },
  start: 'Start',
  retire: 'Retire',
  countdown: ['Three', 'Two', 'One', 'Go'],
  marshal: 'Marshal',
  marshalStart: 'Racers, take your marks.',
  falseStart: 'False start: back behind the line.',
  missed: 'Missed gate {n}: turn back for it.',
  sealedGuns: 'Guns are sealed in a race.',
  sealedCruise: 'No cruise on a Sprint.',
  ownWay: 'Fly the course yourself.',
  noDock: 'Finish the race first.',
  finished: 'Across the line in {time}.',
  cutoff: 'The marshals have closed the course.',
  retired: 'You have retired from the race.',
  lapsed: 'The heat closed before you started: your entry has lapsed.',
  voided: 'Your entry was for a {class} hull: it has lapsed.',
  wrongClass: 'This heat is for {class} hulls.',
} as const;

/** A rival on the line, by voice. */
export const RIVAL_START: Record<RivalVoice, readonly string[]> = {
  brash: ['Try to keep up.', 'Hope you like the view of my exhaust.', 'Last one round buys the round.'],
  dry: ['Good luck. You may need it.', 'Mind the gates. They do not move.', 'Fly clean.'],
  warm: ['Have a good one out there.', 'See you at the line, friend.', 'Race you round.'],
};

/** The cards, the board and the journal. */
export const RACE_CARD = {
  title: 'Results: {course}',
  win: 'You win the heat.',
  placed: 'You finish {place}.',
  out: 'You did not finish.',
  prize: 'Prize: {prize}',
  record: 'A new course record: the club pays {prize} more.',
  best: 'A personal best.',
  points: 'Racing rating: +{points}',
  field: 'The field',
  board: 'Record board',
  yourBest: 'Your best',
  courseRecord: 'Course record',
  noBest: 'Not raced yet',
  heat: 'Heat',
  enter: 'Enter',
  entered: 'Entered',
  par: 'Your par',
  fee: 'Fee',
  purse: 'Purse',
  level: ['Novice club', 'Club', 'Fast club'],
  lockOpening: 'The clubs take entries once you have flown your first delivery.',
  lockFee: 'You cannot cover the fee.',
  lockFines: 'Settle your fines with the {faction} first.',
  lockStanding: 'The club will not take a pilot the {faction} is wary of.',
  lockRaced: 'You have raced this heat already.',
  lockEntered: 'You have an entry already.',
  lockClass: 'Your ship is not a racing hull.',
} as const;

/** The News: a heat the pilot raced and won, or a record they set. */
export const RACE_NEWS = {
  won: { headline: 'A win at the {club}', text: 'You won the {course} heat at {station}, in {time}.' },
  record: { headline: 'A new course record at the {club}', text: 'Your {time} on the {course} is the new record in the {class} class.' },
} as const;

export const RACING_FICTION =
  'Fiction: the racing clubs, their gates, racers and records are invented for this game; the planets, moons and stars the courses round are real, drawn at their schematic places.';
