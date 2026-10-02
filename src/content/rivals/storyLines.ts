import type { RivalVoice } from './rules.ts';

/**
 * What rival pilots say in their stories (docs/PROCGEN.md §28), by voice, and what the game says of
 * them: fiction. Amounts, places, ships and times are filled in from the story ({amount}, {dest},
 * {system}…); no line holds a number of its own, and none says he or she of anyone (the guardrails
 * hold the lines to that).
 */

export interface StoryVoice {
  /** At their table, a friend asks for a loan ({amount}; {back}: what comes back). */
  loanAsk: string;
  loanThanks: string;
  /** Over the radio when the loan comes back ({amount}). */
  repaid: string;
  /** At their table: fly escort on their next run ({dest}). */
  escortAsk: string;
  escortThanks: string;
  /** Over the radio: their drive has failed ({system}, {qty}). */
  distress: string;
  rescued: string;
  towed: string;
  /** Asked to fly on the player's wing. */
  allyYes: string;
  /** Over the radio as their hired guns strike. */
  ambush: string;
  /** Calling the player out ({system}). */
  challenge: string;
  duelStart: string;
  /** The player came to the duel with a damaged ship. */
  duelUnfit: string;
  /** They yield: the player has won. */
  yields: string;
  /** The player yielded: they have won. */
  wins: string;
  /** The player left the duel. */
  forfeit: string;
  /** The player never came. */
  noShow: string;
}

export const STORY: Record<RivalVoice, StoryVoice> = {
  brash: {
    loanAsk: 'Here’s the thing, flyer. A cargo’s going begging and my account isn’t. Lend me {amount} and you’ll have {back} the moment my next run docks. Word of a pilot.',
    loanThanks: 'You’re all right, you know that? I won’t forget it.',
    repaid: 'Told you I was good for it. {amount}, with my thanks.',
    escortAsk: 'Raiders have been sniffing round my runs. Fly with me to {dest}? I’ll make it worth your while.',
    escortThanks: 'Ha! Not a scratch on the cargo. We make a good team, flyer.',
    distress: 'Mayday, flyer, it’s me! My drive’s gone dead in {system}. I need {qty} ship components, or I’m drifting till the tow comes.',
    rescued: 'Engines are back! You’re a lifesaver, flyer.',
    towed: 'The tow’s here. Don’t bother coming now.',
    allyYes: 'Thought you’d never ask. Lead on, flyer.',
    ambush: 'Surprise, flyer. I told you I’d find you.',
    challenge: 'You and me, flyer. The beacon in {system}. One on one: no friends, no excuses.',
    duelStart: 'Let’s dance!',
    duelUnfit: 'Patch your ship up first. I don’t fight wrecks.',
    yields: 'Enough! Enough. You win, flyer. Fair and square.',
    wins: 'Ha! Knew it. Pay up and we’re square.',
    forfeit: 'Running away? I’ll take that as a win.',
    noShow: 'Waited all day at that beacon. Coward.',
  },
  dry: {
    loanAsk: 'I have a proposal. Lend me {amount}, and I repay {back} when my next run docks. I keep my accounts in order, as you may have noticed.',
    loanThanks: 'Thank you. It will be repaid, with interest.',
    repaid: '{amount}, as agreed. A pleasure doing business.',
    escortAsk: 'My next run, to {dest}, has drawn attention I would rather not have. An escort would be welcome. Paid, of course.',
    escortThanks: 'Well flown. I owe you.',
    distress: 'This is embarrassing. My drive has failed in {system}. {qty} ship components would get me home. I would rather it were you who brought them.',
    rescued: 'Drive restored. Thank you. Truly.',
    towed: 'The tow arrived. I had hoped it would be you.',
    allyYes: 'Gladly. Try to keep up.',
    ambush: 'I said this was not over.',
    challenge: 'I propose we settle this. The beacon in {system}, one on one. Do come.',
    duelStart: 'Begin.',
    duelUnfit: 'You are in no state to fight. Repair, then come back.',
    yields: 'I yield. Well fought.',
    wins: 'Your yield is accepted. The stake, please.',
    forfeit: 'Leaving? Then the duel is mine.',
    noShow: 'I waited. You did not come. Noted.',
  },
  warm: {
    loanAsk: 'I hate to ask, I really do. I’m {amount} short for my next run. You’d have {back} back the day it docks, I promise.',
    loanThanks: 'Oh, thank you! You’re a true friend.',
    repaid: 'There you go: {amount}, and a big thank you!',
    escortAsk: 'Would you fly with me to {dest}? I’d feel so much safer with you alongside.',
    escortThanks: 'We made it! I knew we would.',
    distress: 'Hello? It’s me. My drive’s just died in {system} and I’m adrift. Could you bring {qty} ship components? Please hurry!',
    rescued: 'You came! Oh, you wonderful pilot. Thank you!',
    towed: 'The tow came in the end. I waited for you.',
    allyYes: 'I’d love to! Where are we going?',
    ambush: 'I’m sorry it came to this. Really I am.',
    challenge: 'Let’s end this properly. Meet me at the beacon in {system}, just the two of us.',
    duelStart: 'Here we go. No hard feelings, whatever happens.',
    duelUnfit: 'You’re hurt already. Go and get mended; I’ll wait.',
    yields: 'I give up! You win. Shake hands?',
    wins: 'Thank you for a good fight. Let’s call it even now.',
    forfeit: 'Oh. You’re leaving. I suppose that’s that.',
    noShow: 'I waited for you. You never came.',
  },
};

/** What the game says of a story as it goes ({rival}: their name; amounts, places and times filled in). */
export const STORY_NOTES = {
  lent: 'You lent {rival} {amount}. It comes back with interest when their next run docks.',
  repaid: '{rival} paid back your loan: {amount}.',
  distress: 'Distress call from {rival}: the {ship}’s drive failed in {system}. Bring {qty} ship components before the tow gets there, {until}.',
  towed: '{rival} was towed home from {system}. Your help never came.',
  letDown: '{rival} gave up waiting for your escort and flew alone.',
  allyJoins: '{rival} joins your wing until you next dock.',
  allyLeaves: '{rival} leaves your wing at {station}.',
  tipoff: 'Customs were tipped off: {rival} told them to look you over.',
  ambush: 'Hired guns! {rival} paid them to find you.',
  challenge: '{rival} calls you out: a duel at the beacon in {system}, until {until}. One on one, each in their own ship as it is fitted, to a yield.',
  started: 'The duel is on: one on one, to a yield. Your wing holds its fire.',
  won: 'You won the duel: {rival} pays the {amount} purse. The feud is over.',
  lost: 'You yielded: {rival} takes the {amount} stake. The feud is over.',
  forfeit: 'You left the duel: {rival} takes the {amount} stake. The feud is over.',
  noShow: '{rival} waited at the beacon in {system}. You never came: the feud stands.',
  amends: 'Your amends end the feud with {rival}.',
} as const;

/** The News of rivals' stories (fiction): {rival}, {ship}, {system}. */
export const STORY_NEWS = {
  rescued: ['{rival}’s {ship} limped out of {system} after a drive failure: a friend brought parts.'],
  towed: ['{rival}’s {ship} was towed home from {system} after a drive failure.'],
  challenge: ['{rival} has called a pilot out to a duel at the beacon in {system}.'],
  rivalLost: ['{rival} lost a duel at the beacon in {system}, and paid the purse.'],
  rivalWon: ['{rival} won a duel at the beacon in {system}.'],
  noShow: ['{rival} waited at the beacon in {system} for a duel. Nobody came.'],
} as const;

export type StoryNewsKind = keyof typeof STORY_NEWS;
