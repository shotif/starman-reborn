import type { CommodityId } from '../economy/goods.ts';
import type { PersonRole } from '../people/rules.ts';
import type { StationType } from '../world/types.ts';

/**
 * People at your outposts (docs/PROCGEN.md §41): a quartermaster from the day an outpost opens and
 * residents as it grows; now and then one asks the pilot for something, and done, each ask leaves
 * the outpost changed for good; a spirit that remembers what the pilot does and nudges the income.
 * Worked out from the game clock with the fleet (src/economy/folk.ts): nothing runs in the
 * background. The people, their names, their asks and what they make are fiction.
 */

export type FolkTrade = 'quartermaster' | 'engineer' | 'grower' | 'medic' | 'broker';
export type AskKind = 'goods' | 'fetch' | 'scan';
export type SpiritBand = 'low' | 'steady' | 'glad';

/** What a person's work leaves, for good (§41.2). */
export type FolkWork =
  /** The outpost's income, so much more. */
  | { kind: 'income'; income: number }
  /** Hull repairs there cost so much less. */
  | { kind: 'repair'; cut: number }
  /** A good its market trades (the first of `goods` it trades), or one it makes (`made`), cheaper and fuller. */
  | { kind: 'market'; goods?: readonly CommodityId[]; made?: true; price: number; stock: number }
  /** Its spirit falls only so fast while the pilot is away. */
  | { kind: 'steady'; drift: number };

export interface TradeRules {
  /** The portrait's look (the bars' roles, §16). */
  look: PersonRole;
  /** The kinds of ask the trade makes. */
  asks: readonly AskKind[];
  /** What a goods ask of theirs may want. */
  goods: readonly CommodityId[];
  work: FolkWork;
  /** Outposts of these kinds draw the trade `FOLK.likeWeight` times as often. */
  likes: readonly StationType[];
}

const HOUR = 3_600;

export const FOLK = {
  /** People there by the stages done (frame, station, port): the quartermaster first. */
  people: [1, 2, 4] as const,
  trades: {
    quartermaster: { look: 'officer', asks: ['goods', 'fetch'], goods: ['electronics', 'consumer-goods', 'medical', 'machinery'], work: { kind: 'income', income: 0.05 }, likes: [] },
    engineer: { look: 'miner', asks: ['goods', 'scan'], goods: ['machinery', 'electronics', 'fabricators', 'ship-parts'], work: { kind: 'repair', cut: 0.25 }, likes: ['refinery', 'mining-outpost', 'factory'] },
    grower: { look: 'colonist', asks: ['goods', 'scan'], goods: ['water', 'gases', 'polymers', 'machinery'], work: { kind: 'market', goods: ['fine-food', 'food'], price: 0.85, stock: 1.6 }, likes: ['agri-station'] },
    medic: { look: 'scientist', asks: ['goods', 'fetch'], goods: ['medical', 'electronics', 'fine-food'], work: { kind: 'steady', drift: 0.5 }, likes: ['research-station'] },
    broker: { look: 'trader', asks: ['goods', 'fetch'], goods: ['luxuries', 'consumer-goods', 'electronics'], work: { kind: 'market', made: true, price: 0.9, stock: 1.5 }, likes: ['trade-port', 'freeport', 'relay'] },
  } as const satisfies Record<FolkTrade, TradeRules>,
  /** The residents' trades, drawn without repeats after the quartermaster. */
  residents: ['engineer', 'grower', 'medic', 'broker'] as const satisfies readonly FolkTrade[],
  likeWeight: 3,
  asks: {
    /** The first ask, this long after the outpost opens (or after its people first come). */
    first: 6 * HOUR,
    /** Each next ask, this long (drawn) after the last ended. */
    gap: [12 * HOUR, 36 * HOUR] as const,
    /** An ask not done by then lapses. */
    lasts: 48 * HOUR,
    /** Asks in each person's story. */
    story: 2,
    /** A goods ask is worth about this much at galaxy base prices, in so many units. */
    value: [1_000, 2_500] as const,
    qty: [4, 20] as const,
    /** A goods ask's good is made within this many jumps of the outpost. */
    jumps: 2,
    /** The one fetched waits this many jumps away (at least, at most). */
    fetch: [1, 2] as const,
  },
  /** Each person's first ask done: the income so much more, for good. */
  firstIncome: 0.02,
  spirit: {
    start: 50,
    done: 10,
    supplies: 6,
    lapsed: -8,
    held: 6,
    lost: -10,
    /** Away: after `grace`, it falls by `by` every `step`. */
    away: { grace: 24 * HOUR, step: 6 * HOUR, by: 1 },
    /** The hour's income is multiplied from the first at 0 to the second at 100. */
    income: [0.95, 1.05] as const,
    /** Under `low` it is low; from `glad` glad; steady between. */
    bands: { low: 35, glad: 70 },
  },
  /** Lines said on docking, at most. */
  greet: { max: 3 },
  /** Asks made or lapsed at an outpost told in one settle, at most (the latest). */
  reports: 3,
} as const;

// ---------------------------------------------------------------- words (fiction)

/** Names for the people at the outposts, clear of every other pool of names in the game. */
export const FOLK_FIRST = [
  'Agnieszka', 'Barnaby', 'Celeste', 'Desmond', 'Edda', 'Florian', 'Greta', 'Horatio', 'Isolde', 'Jasper',
  'Katarina', 'Leopold', 'Marisol', 'Nikolai', 'Oona', 'Perpetua', 'Quentin', 'Rosalind', 'Severin', 'Theodora',
] as const;
export const FOLK_LAST = [
  'Ambrose', 'Blackwood', 'Carrow', 'Delacroix', 'Everly', 'Fairweather', 'Greenhalgh', 'Hawthorne', 'Ingleby', 'Jessop',
  'Lockwood', 'Merriweather', 'Northcott', 'Oakhurst', 'Pemberton', 'Quarrington', 'Rowntree', 'Sallowby', 'Thistlewood', 'Underhill',
] as const;

/** Who a fetch ask brings home. */
export const FOLK_RELATIONS = ['sister', 'brother', 'cousin', 'old colleague', 'apprentice', 'partner'] as const;

export const TRADE_WORD: Record<FolkTrade, string> = { quartermaster: 'Quartermaster', engineer: 'Engineer', grower: 'Grower', medic: 'Medic', broker: 'Broker' };
export const BAND_WORD: Record<SpiritBand, string> = { low: 'Low', steady: 'Steady', glad: 'Glad' };

/** What each person's work is called, and what it is, in a few words. */
export const WORK_WORDS: Record<FolkTrade, { name: string; what: string }> = {
  quartermaster: { name: 'Proper stores', what: 'a ledger kept and a night shift on the docks' },
  engineer: { name: 'The workshop', what: 'a bay where hulls are patched at cost' },
  grower: { name: 'The green bay', what: 'tanks and lamps growing food for the whole outpost' },
  medic: { name: 'The clinic', what: 'a clinic that keeps people well while you are away' },
  broker: { name: 'The trading desk', what: 'a desk that sells what the outpost makes, and sells it well' },
};

/**
 * What a person says when they ask (placeholders: {good}, {who}, {relation}, {station}, {system},
 * {body}, {outpost}; a goods ask's amount is shown beside it, never written into the line). `first`
 * is their story's first ask, `work` the one that builds their work, `supplies` the quartermaster's
 * asks once every story is told.
 */
export const ASK_LINES: Record<FolkTrade, Partial<Record<AskKind, { first: string; work: string }>>> & { supplies: string } = {
  quartermaster: {
    goods: { first: 'We’re short of {good} already, and the haulers bring what pays them, not what we need. Could you bring some in?', work: 'Give me enough {good} and I’ll set up proper stores here: a ledger, a night shift, nothing going missing.' },
    fetch: { first: 'My {relation} {who} is stuck at {station}, in {system}, with no passage out. Would you bring them here?', work: '{who}, my {relation}, kept the books at {station} for years. Bring them here and we’ll run this place properly.' },
  },
  engineer: {
    goods: { first: 'Half my tools are improvised. Some {good} would keep the pumps running.', work: 'Bring me {good} and I’ll build a proper workshop: your hull patched here at cost.' },
    scan: { first: 'Something odd in my readings off {body}. Would you scan it close for me?', work: 'If you scan {body} for me, I’ll know where to set the workshop’s array. Then it’s building time.' },
  },
  grower: {
    goods: { first: 'The tanks need {good} to get going. Could you bring some?', work: 'One more load of {good} and the green bay is ours: food grown here, for everyone.' },
    scan: { first: 'I want to know what {body} is made of before I plan the tanks. Would you scan it?', work: 'Scan {body} for me once more, and I’ll know how to light the green bay.' },
  },
  medic: {
    goods: { first: 'We’re out of {good}, and someone always gets hurt. Could you bring some?', work: 'With enough {good} I can open a proper clinic. People stay well, even when you’re gone.' },
    fetch: { first: 'My {relation} {who} is at {station}, in {system}, and not well. Would you bring them here to me?', work: '{who}, my {relation}, is a nurse at {station}. Bring them, and we’ll open a clinic together.' },
  },
  broker: {
    goods: { first: 'Buyers want to see {good} on the shelves before they trust us. Would you bring some?', work: 'Bring me {good} for samples and I’ll open a trading desk that sells what we make, and sells it well.' },
    fetch: { first: 'My {relation} {who} is at {station}, in {system}, with contacts I need. Would you bring them here?', work: '{who}, my {relation}, knows every buyer at {station}. Bring them and the trading desk opens.' },
  },
  supplies: 'Running low on {good} again. Could you bring some in when you’re passing?',
};

/** What a person says when an ask of theirs is done: their story's first, their work, or supplies. */
export const DONE_LINES: Record<FolkTrade, { first: string; work: string }> & { supplies: string } = {
  quartermaster: { first: 'That will see us through. People noticed you came.', work: 'Proper stores at last. Nothing goes missing now, and the haulers pay on time.' },
  engineer: { first: 'Pumps running, and I can stop holding them together with tape. Thank you.', work: 'The workshop is open. Bring your ship in when it’s scratched: patched at cost.' },
  grower: { first: 'The first shoots are up. Come and see them before you go.', work: 'The green bay is growing. Fresh food on the market here, and cheaper than anyone’s.' },
  medic: { first: 'That will keep people on their feet. I’m grateful.', work: 'The clinic is open. People here stay well, even when you’re away for a while.' },
  broker: { first: 'Buyers are asking questions now. Good questions.', work: 'The trading desk is open. What we make here sells, and sells well.' },
  supplies: 'Stocked up again. Thank you for thinking of us.',
};

/** What a person says when an ask of theirs lapsed. */
export const LAPSE_LINES = [
  'I asked, and nobody came. We managed, somehow.',
  'It doesn’t matter now. We found another way, a worse one.',
  'I waited a long time for that. Never mind.',
] as const;

/** What the people say, by the outpost's spirit. */
export const SPIRIT_LINES: Record<SpiritBand, readonly string[]> = {
  glad: ['Good to see you. This place is getting somewhere.', 'Things are going well here. People are staying on.', 'We’ve done well by you, and you by us.'],
  steady: ['We get by. Come round more often.', 'All steady here. Could be better, could be worse.', 'Quiet days. Work gets done.'],
  low: ['People are talking about leaving. Where have you been?', 'It’s hard out here when nobody comes.', 'We feel forgotten, if you want the truth.'],
};

/** Toasts and reports (placeholders: {name}, {outpost}, {who}, {station}, {body}, {ask}). */
export const FOLK_SAYS = {
  asked: 'At {outpost}, {name} asks: {ask}.',
  lapsed: 'At {outpost}, {name}’s ask has lapsed: {ask}.',
  aboard: '{who} comes aboard for {outpost}.',
  scanned: 'Scanned {body} for {name}: tell them at {outpost}.',
} as const;
