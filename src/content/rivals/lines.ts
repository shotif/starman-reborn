import type { RivalVoice } from './rules.ts';

/**
 * What rival pilots say (docs/PROCGEN.md §24): phrase pools, fiction. Places, goods and ships are
 * filled in from the world ({dest}, {doing}…); no line holds a number of its own (the guardrails
 * hold the pools to that).
 */

export type RivalTier = 'hostile' | 'wary' | 'neutral' | 'friendly';

/** In a bar, by how they stand with the player. */
export const GREET: Record<RivalVoice, Record<RivalTier, readonly string[]>> = {
  brash: {
    hostile: ['You. Walk on, before I forget where I am.', 'Look who it is. Got nothing to say to you.'],
    wary: ['Oh, it is you. Mind your own lanes.', 'Keep your hands where I can see them, flyer.'],
    neutral: ['Another flyer. Pull up a stool, if you can keep up.', 'Busy day on the lanes. You keeping up?'],
    friendly: ['Well, if it isn’t my favourite flyer! Sit down, sit down.', 'My toughest competition. What are you drinking?'],
  },
  dry: {
    hostile: ['No.', 'I would rather drink alone. Today and every day.'],
    wary: ['Hm. You again.', 'I have heard about you. Not all of it good.'],
    neutral: ['Evening.', 'Quiet in here. I like it that way.'],
    friendly: ['Ah. Good. Someone worth talking to.', 'Sit. The tea here is terrible, but sit.'],
  },
  warm: {
    hostile: ['I wanted to like you. I really did.', 'Please, just leave me be.'],
    wary: ['Oh. Hello. Things have been a bit awkward, haven’t they?', 'We got off on the wrong foot, you and me.'],
    neutral: ['Hello there! Long day?', 'Another face from the lanes. Welcome!'],
    friendly: ['There you are! I saved you a seat.', 'Oh, good, a friend. Tell me everything.'],
  },
};

/** Thanks for a round. */
export const ROUND: Record<RivalVoice, readonly string[]> = {
  brash: ['Now you are talking. Cheers!', 'I will drink to that. Doesn’t mean I’ll go easy on you.'],
  dry: ['Thank you. That was unexpected.', 'Kind of you. Noted.'],
  warm: ['Oh, you shouldn’t have! Cheers!', 'That is lovely of you. Next one’s on me.'],
};

/** A hostile rival refusing a round. */
export const REFUSE: Record<RivalVoice, readonly string[]> = {
  brash: ['Keep your money. I don’t drink with people who shoot at me.'],
  dry: ['No, thank you. Not after what you did.'],
  warm: ['I can’t. Not after that.'],
};

/** A friendly rival's tip: what they are doing next ({doing}, built from their run). */
export const TIP: Record<RivalVoice, readonly string[]> = {
  brash: ['Next up for me: {doing}. Try and beat me to it.', 'Between us? {doing}. Don’t tell anyone.'],
  dry: ['If you must know: {doing}.', '{doing}. Now you know.'],
  warm: ['I’m off soon: {doing}. Wish me luck!', 'Since you asked so nicely: {doing}.'],
};

/** Amends accepted. */
export const AMENDS: Record<RivalVoice, readonly string[]> = {
  brash: ['Fine. We’re square. For now.'],
  dry: ['Accepted. Do not make me regret it.'],
  warm: ['Thank you. Let’s start again, shall we?'],
};

/** Over the radio, met in flight. */
export const RADIO: Record<RivalVoice, { hello: readonly string[]; friend: readonly string[]; threat: readonly string[]; shot: readonly string[]; down: readonly string[] }> = {
  brash: {
    hello: ['Out of my way, flyer, I’ve got a schedule.', 'Nice ship. Mine’s faster.'],
    friend: ['Look who it is! Fly safe out there.', 'Ha! Fancy meeting you here.'],
    threat: ['Should have stayed home. You’re mine.', 'I’ve been looking for you.'],
    shot: ['Hey! Watch your fire!', 'You did not just do that.'],
    down: ['I’m out, I’m out! You’ll pay for this!'],
  },
  dry: {
    hello: ['Keep your distance, please.', 'Passing through. Nothing to see.'],
    friend: ['Good to see you. Clear lanes.', 'Hello again. Mind the raiders.'],
    threat: ['This is far enough.', 'No patrols out here. Just us.'],
    shot: ['That was a mistake.', 'Stop that at once.'],
    down: ['Ejecting. This is not over.'],
  },
  warm: {
    hello: ['Hello there! Lovely day for it.', 'Wave if you can see me!'],
    friend: ['There’s my friend! Safe flying!', 'Oh, hello! See you in the bar later?'],
    threat: ['I didn’t want it to come to this.', 'You left me no choice.'],
    shot: ['Ow! What was that for?', 'Please stop shooting at me!'],
    down: ['I’m ejecting! Why would you do that?'],
  },
};

/** The News: {rival}, and the places and goods of the run. */
export const NEWS = {
  trade: ['{rival} ran {good} from {from} to {to}.', '{rival} brought {good} into {to}, from {from}.'],
  tradeOn: ['{rival} is running {good} from {from} to {to}.'],
  hunt: ['{rival} took the bounty on {target}, posted at {where}.'],
  race: ['{rival} is racing {good} to the shortage at {to}.'],
  raced: ['{rival} brought {good} to the shortage at {to}.'],
  beaten: ['{rival} raced {good} to the shortage at {to}, and found it already over.'],
  down: ['{rival}’s {ship} was destroyed in {system}. Word is they are refitting at {home}.'],
} as const;
