import type { PersonRole } from './rules.ts';

/**
 * Words for the people in the bars (docs/PROCGEN.md §16): names and phrase pools, picked at
 * random. The rules decide who sits where and what they know; only the wording varies here.
 * Invented for this game.
 */

export const FIRST_NAMES = [
  'Ilya', 'Maren', 'Tobin', 'Esra', 'Kaito', 'Ruth', 'Anouk', 'Dario', 'Signe', 'Obi', 'Lenka', 'Farid',
  'Noor', 'Teodor', 'Yara', 'Bram', 'Suvi', 'Kwame', 'Ines', 'Jonah', 'Mei', 'Osric', 'Priya', 'Ansel',
  'Talia', 'Rafe', 'Zuzana', 'Emeka', 'Liesl', 'Oren', 'Paz', 'Hollis', 'Wren', 'Idris', 'Solveig', 'Tamsin',
] as const;

export const LAST_NAMES = [
  'Vance', 'Okoro', 'Lindqvist', 'Sato', 'Mercer', 'Adeyemi', 'Kovac', 'Reyes', 'Brandvold', 'Achebe', 'Moreau', 'Halloran',
  'Nakamura', 'Duarte', 'Varga', 'Osei', 'Petrov', 'Castellan', 'Mbeki', 'Lund', 'Iqbal', 'Fontaine', 'Rourke', 'Tanaka',
  'Serrano', 'Ekwueme', 'Holt', 'Marchetti', 'Aziz', 'Novak', 'Quill', 'Strand', 'Abara', 'Vey', 'Kalnins', 'Dunmore',
] as const;

/** A word for the role, shown under the name. */
export const ROLE_TITLE: Record<PersonRole, readonly string[]> = {
  trader: ['Independent trader', 'Freight broker', 'Hauler between contracts', 'Commodity buyer'],
  pilot: ['Freelance pilot', 'Escort pilot', 'Courier pilot', 'Test pilot, off duty'],
  fixer: ['Fixer', 'Deal-maker', 'Knows people', 'Broker of favours'],
  officer: ['Patrol officer, off duty', 'Customs officer', 'Flight lieutenant', 'Traffic controller'],
  miner: ['Ice miner', 'Ore prospector', 'Rig foreman', 'Drill operator'],
  scientist: ['Survey astronomer', 'Planetary scientist', 'Lab technician', 'Instrument engineer'],
  colonist: ['Colonist, passing through', 'Hydroponics hand', 'Settler', 'Relief worker'],
};

export const GREETINGS: Record<PersonRole, readonly string[]> = {
  trader: [
    'Margins are thin and the lanes are long. Sit down.',
    'Buying or selling? Either way, the first round is yours.',
    'I watch prices the way pilots watch their six.',
    'You look like someone with an empty hold and a full tank.',
  ],
  pilot: [
    'Nice landing. Mostly.',
    'If you fly the edge, fly it with company. I would know.',
    'Pull up a stool. The coffee here is worse than the drinks.',
    'Heard your drive on approach. Somebody should look at that coupling.',
  ],
  fixer: [
    'Everybody wants something. Let us talk about what you want.',
    'I do not sell secrets. I sell introductions.',
    'Keep your voice down and your credits handy.',
    'You have a trustworthy face. That is useful to both of us.',
  ],
  officer: [
    'Off duty. Mostly. What can I do for you, pilot?',
    'Keep your transponder on and we will get along fine.',
    'The lanes are safer than they were. Not safe. Safer.',
    'Sit down. Just do not ask me about the budget.',
  ],
  miner: [
    'Rock does not care who you are. Neither do I. Welcome.',
    'Twelve hours on the drill. Buy me a drink and I will tell you anything.',
    'Mind the dust on the seat. It gets everywhere.',
    'Ice or ore, it all pays the same: not enough.',
  ],
  scientist: [
    'Did you know the star outside has been measured to a fraction of a percent? Sit, I will explain.',
    'Forgive the notes. I think better with a drink.',
    'Real data, real sky. That is why I came out here.',
    'Pilots see more of the neighbourhood than any telescope. What have you seen?',
  ],
  colonist: [
    'First time this far out? It gets easier.',
    'We came for the land. We stayed for the stubbornness.',
    'Sit, sit. News from the lanes is worth more than coin out here.',
    'Everyone here has a story. Mine starts with a broken greenhouse.',
  ],
};

/** When a drink buys nothing worth telling (the drink is on the house then). */
export const NOTHING_TO_TELL = [
  'Quiet shift. Keep your credits; nothing worth telling today.',
  'I have heard nothing you could use. Next time.',
  'Ask me again when the lanes are busier.',
] as const;

/** When the player has already heard what this person knows. */
export const ALREADY_TOLD = ['That is all I know for now. Come back when the board changes.', 'I told you everything already. Fly safe.'] as const;

export const TELL = {
  priceSell: ['{station} in {system} is paying {price} cr for {good}. Saw the board myself.', 'Word is {station} ({system}) buys {good} at {price} cr right now.'],
  priceBuy: ['{good} is going cheap at {station} in {system}: {price} cr.', 'If you are hauling {good}, buy it at {station}, {system}. {price} cr last I saw.'],
  event: ['Keep this quiet: {what} at {where}, within the hour.', 'Friend on the lanes says {what} at {where}, soon. The news will have it later.'],
  denAwake: ['{den} in {system} still has its guns: turrets, mines, and crews who shoot first.', 'Stay clear of {den} in {system} unless you brought friends. Its guns are awake.'],
  denDark: ['{den} went dark {hours} ago. {system} is quiet for now.', 'Somebody knocked out {den} in {system}. The Wake will rebuild; until then, the lanes are calm.'],
  ace: ['There is an ace working {system}. {giver} posts {reward} cr for them.', 'An ace has been hitting haulers in {system}. {giver} wants them gone: {reward} cr.'],
  wreck: ['A wreck near {site} still holds its {item}. {giver} pays for it.', 'Nobody has salvaged the wreck by {site} yet. {giver} wants the {item} back.'],
  story: ['Someone at {station} is asking for a pilot who can keep quiet.', 'If you want work that matters, go and see {name} at {station}.'],
  front: ['Out on {line}, {what}.', 'A patrol pilot told me: on {line}, {what}.', 'Everybody on {line} says the same: {what}.'],
  frontNext: ['Give it a few hours and {next}.', 'The way it is going, soon {next}.'],
} as const;

/** Fills a template's {placeholders}. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));
}

/** What the poster's dispatcher says when a contract pays ({amount} in credits). */
export const PAYMENT: Record<'sta' | 'frontier' | 'hollow-wake' | 'independent', readonly string[]> = {
  sta: ['Payment of {amount} cleared. The Authority thanks you, pilot.', 'Transfer complete: {amount}. Clean work, clean books.'],
  frontier: ['{amount} sent. The Cooperative will not forget it.', 'Paid in full: {amount}. Fly safe out there.'],
  'hollow-wake': ['{amount} in your account. You never heard it from us.', 'Credits moved: {amount}. The Wake pays its debts.'],
  independent: ['Transfer done: {amount}. Pleasure doing business.', '{amount} on its way. Come back when you want more work.'],
};
