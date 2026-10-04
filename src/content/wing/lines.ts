import type { TrustBand, WingMemory, WingOrder } from './rules.ts';

/**
 * Words for wing command (docs/PROCGEN.md §34): the orders on the card, the HUD and the radio, the
 * grades, how a wingman feels about the pilot, and what they say in the bar. Invented for this game.
 * Fields in braces are filled in by the game.
 */

/** Each order: the card's label, a short label for the HUD and the touch chip, what it does, and the reply. */
export const ORDER_WORDS: Record<WingOrder, { label: string; short: string; effect: string; ack: string }> = {
  free: { label: 'Engage at will', short: 'At will', effect: 'Take on raiders near you.', ack: 'Copy. Engaging at will.' },
  attack: { label: 'Attack my target', short: 'Attack', effect: 'Go for the ship you have selected.', ack: 'Copy, going for your target.' },
  defend: { label: 'Defend my target', short: 'Defend', effect: 'Guard the friendly ship you have selected.', ack: 'Copy. Sticking with the {ward}.' },
  cover: { label: 'Cover the hauler', short: 'Cover', effect: 'Guard the hauler you are escorting or answering.', ack: 'Copy. Covering the {ward}.' },
  hold: { label: 'Hold here', short: 'Hold', effect: 'Stay here and fight only what comes close.', ack: 'Copy. Holding here.' },
  form: { label: 'Break off and form up', short: 'Form up', effect: 'Stop fighting and fly back to you.', ack: 'Copy. Breaking off, forming on you.' },
};

/** Why an order cannot be given now. */
export const ORDER_LOCKS = {
  noTarget: 'Select a ship first.',
  hostile: 'That one is hostile: use Attack my target.',
  noWard: 'Select a friendly ship first.',
  noHauler: 'No hauler here to cover.',
  nobody: 'Nobody is flying on your wing.',
} as const;

/** The radio when a guard or hold ends. */
export const WING_RADIO = {
  wardGone: 'The {ward} is gone. Forming up on you.',
  tooFar: 'You are a long way off. Coming back to you.',
  hurt: 'I am hit badly. Keeping out of it for now.',
  picked: '{name} ejected and has been picked up: they rejoin you at your next dock.',
} as const;

export const GRADE_NAMES = ['Steady hand', 'Sharp shot', 'Seasoned wing', 'Veteran wing'] as const;
export const TRUST_NAMES: Record<TrustBand, string> = { wary: 'Wary', easy: 'Easy', loyal: 'Loyal' };
/** Before a reply, by how a wingman feels about the pilot. */
export const TRUST_PREFIX: Record<TrustBand, string> = { wary: 'If you say so. ', easy: '', loyal: 'Right with you. ' };

/** What happens at a dock, told as notes. */
export const WING_NOTES = {
  treated: 'The medic sees to {name}.',
  mended: '{name} is fit to fly again.',
  rejoined: '{name} is back on your wing in a new ship from their insurers.',
  raise: '{name} is now a {grade}: their fee rises to {fee} a jump.',
  notice: '{name} is not happy flying for you and gives notice.',
  left: '{name} leaves your wing.',
  credit: '{name} flies this one on credit: {fee} owed at your next dock.',
  paid: 'You settle the {fee} you owed {name}.',
  unpaid: '{name} leaves your wing: you could not pay the {fee} fee.',
} as const;

/** What a wingman says when sat with in the bar, by what they remember last and how they feel. */
export const WING_SAYS: Record<WingMemory | 'new', Record<TrustBand, readonly string[]>> = {
  new: {
    wary: ['Let us see how this goes.'],
    easy: ['Glad of the work. Point me at the trouble.', 'Good to fly with you.'],
    loyal: ['Wherever you are going, I am coming.'],
  },
  fight: {
    wary: ['We came through. Just about.'],
    easy: ['That was a good scrap. You fly well.', 'Clean work out there.'],
    loyal: ['I would fly that one again with you any day.'],
  },
  treated: {
    wary: ['The medic did fine. Thanks, I suppose.'],
    easy: ['Thanks for seeing to me. Good as new.'],
    loyal: ['You looked after me. I will not forget it.'],
  },
  untreated: {
    wary: ['Still aching from that fight. Nobody seemed to mind.'],
    easy: ['I could do with a medic, when you have a moment.'],
    loyal: ['Sore, but I will mend. Do not worry about me.'],
  },
  down: {
    wary: ['I lost a ship out there. I hope it was worth it.'],
    easy: ['New ship, same pilot. Let us try that again.'],
    loyal: ['Lost the ship, not the nerve. I am still with you.'],
  },
  unpaid: {
    wary: ['Money first, next time.'],
    easy: ['Pay on time and we will get on fine.'],
    loyal: ['We are square. Let us leave it there.'],
  },
  raise: {
    wary: ['A better rate, at least.'],
    easy: ['I have earned the new rate, I think.'],
    loyal: ['Better pay, same loyalty.'],
  },
  credit: {
    wary: ['I flew that one on trust. Do not make a habit of it.'],
    easy: ['I flew on credit for you. Settle up when you can.'],
    loyal: ['I trust you to settle up.'],
  },
};

export const WING_FICTION = 'Fiction: the wingmen, their insurers and their words are invented for this game.';
