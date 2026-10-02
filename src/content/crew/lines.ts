import type { CrewGrade, CrewHeart, CrewRole, MoraleBand } from './rules.ts';

/**
 * What your crew say, and what the game says of them (docs/PROCGEN.md §30). Fiction: every name and
 * line is invented for this game. Names and places are filled in ({name}, {station}, {system}…);
 * no line holds a number of its own, names a star or planet, or says he or she of anyone.
 */

/** Crew names, clear of every other pool of names in the game. */
export const CREW_FIRST = [
  'Aurelie', 'Bodhan', 'Cressida', 'Dimitar', 'Elif', 'Fintan', 'Gisele', 'Hamish',
  'Ingrid', 'Jovan', 'Kirra', 'Lowen', 'Mirela', 'Niamh', 'Ottoline', 'Piet',
] as const;
export const CREW_LAST = [
  'Abernethy', 'Bellamy', 'Chukwu', 'Dragomir', 'Eriksen', 'Faulkner', 'Gallagher', 'Haddad',
  'Imrie', 'Jansen', 'Kowalczyk', 'Larkin', 'Mwangi', 'Nyberg', 'Ostrova', 'Penhallow',
] as const;

export const ROLE_WORD: Record<CrewRole, string> = { engineer: 'Engineer', gunner: 'Gunner', navigator: 'Navigator' };
export const GRADE_WORD: Record<CrewGrade, string> = { 1: 'Green', 2: 'Seasoned', 3: 'Veteran' };
export const HEART_WORD: Record<CrewHeart, string> = { 'soft-hearted': 'Soft-hearted', 'rule-bender': 'Rule-bender', 'ex-patrol': 'Ex-patrol' };
export const MORALE_WORD: Record<MoraleBand, string> = { low: 'Low', steady: 'Steady', high: 'High' };

/** What their heart likes and hates, in words. */
export const HEART_CARES: Record<CrewHeart, { likes: string; hates: string }> = {
  'soft-hearted': { likes: 'helping people in trouble', hates: 'leaving anyone adrift, and attacks on lawful ships' },
  'rule-bender': { likes: 'a profitable bit of smuggling', hates: 'losing cargo to the law, and attacks on lawful ships' },
  'ex-patrol': { likes: 'downing raiders', hates: 'paying off raiders or officers, and smuggling' },
};

/** Their greeting at the bar's tables, by heart. */
export const CREW_GREETING: Record<CrewHeart, readonly string[]> = {
  'soft-hearted': ['Looking for a berth on a ship that stops for people. Is yours one?', 'I sign on with pilots who pick up a mayday. Tell me you do.'],
  'rule-bender': ['I don’t ask what’s in the hold, and I’d rather you didn’t ask what I used to fly.', 'Need hands that don’t shake at a customs scan? Sit down.'],
  'ex-patrol': ['Used to fly with the patrols. I miss the work, not the paperwork.', 'If you hunt raiders, I want the seat behind the guns. Or the drives. Or the charts.'],
};

/** Over the radio in flight (the crew member speaks). */
export const CREW_RADIO = {
  hurt: ['I’m hit. Can’t work like this: get me to a medic when you can.', 'Took a knock in that one. I’m out of it for now.'],
  mended: ['That’s the worst of it patched. The rest wants a dock.', 'Systems are holding. I’ve done what I can out here.'],
};

/** What they say at a dock, in their dialog and the game's notices. */
export const CREW_SAYS = {
  hired: ['Right. Show me my bunk.', 'Good. I’ll stow my kit and get to work.'],
  notice: ['I’m done with this ship. I’ll stay until the next dock, unless something changes.'],
  stays: ['All right. I’ll stay on. For now.'],
  leaves: ['This is where I get off. No hard feelings. Well. Some.'],
  letGo: ['Fair enough. Good luck out there.'],
  treated: ['Much better. Back to work.'],
  round: ['Cheers. That’s more like it.'],
  unpaid: ['No pay again? I’m keeping count.'],
  shipLost: ['We lost the ship. I’m still shaking.'],
  steady: ['All quiet aboard.', 'Nothing to report. Fly on.'],
};

/** Each heart's story, in three beats (docs/PROCGEN.md §30.6): `{station}`, `{system}`, `{count}` filled in. */
export const CREW_STORY: Record<CrewHeart, { tale: string; ask: string; thanks: string; failed: string; lapsed: string }> = {
  'soft-hearted': {
    tale: 'My oldest friend crewed a hauler that never came home. Nobody ever said where it was lost. I still write, in case.',
    ask: 'The farm and relay crews keep lists of the lanes’ lost. Would you carry my letter to {station}? Someone there might know.',
    thanks: 'They found my friend on a list: alive, working a dome far out. Alive! I don’t know how to thank you.',
    failed: 'The letter never got there. Never mind. It was a long shot.',
    lapsed: 'Forget the letter. It was a silly idea.',
  },
  'rule-bender': {
    tale: 'I used to run the back lanes. I left owing people who don’t forget.',
    ask: 'There’s a sealed crate that squares my debt, if it reaches {station}. A scan will find it, mind. Will you run it?',
    thanks: 'The debt’s square. First time in years I can sleep without one eye open.',
    failed: 'The crate’s gone. So’s my chance to square things. Great.',
    lapsed: 'Leave it. The debt can wait. It always has.',
  },
  'ex-patrol': {
    tale: 'There’s a Wake pack my old wing never caught. They hit a convoy we were meant to keep safe.',
    ask: 'They’re lurking in {system}, {count} of them, near {station}. Will you go after them for me?',
    thanks: 'That’s them done. My old wing would have bought you a drink. I’ll buy it for them.',
    failed: 'They got away again. Of course they did.',
    lapsed: 'They’ll have moved on by now. Another time.',
  },
};

/** What the game says: notices and their dialog's words ({name}, {role}, {station}, {hours}…). */
export const CREW_NOTES = {
  hired: '{name} signs on as your {role}.',
  notice: '{name} has given notice: unhappy aboard, and leaving at the next dock unless things change.',
  stays: '{name} has taken back their notice.',
  leaves: '{name} has left the ship at {station}: too unhappy to stay.',
  letGo: '{name} has left the ship at {station}.',
  unpaid: 'You could not pay {name}’s wages. They are owed, and not pleased.',
  paid: 'Crew wages: {credits}.',
  hurt: '{name} is hurt and out of action until mended, or treated at a dock with repairs.',
  mended: '{name} is well again.',
  treated: '{name} is treated and back at work.',
  tale: '{name} has a story to tell: sit down with them in the bar.',
  favour: '{name} asks a favour of you: sit down with them in the bar.',
  done: '{name}’s favour is done.',
  graded: '{name} is now a {grade} {role}.',
  failed: '{name}’s favour failed.',
  lapsed: '{name} has let their favour drop.',
} as const;

export const CREW_FICTION = 'Fiction: your crew, their names and their stories are invented for this game.';
