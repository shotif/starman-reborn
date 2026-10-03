import type { FactionId } from '../../data/types.ts';

/**
 * What ranks say (docs/PROCGEN.md §32.5). Fiction: the ranks, their names and ceremonies are
 * invented, like the factions. Names and numbers are filled in ({rank}, {faction}, {station},
 * {now}, {percent}); no line holds a number of its own or says he or she of anyone.
 */

export const RANK_LINES: Record<FactionId, { ceremony: string; greet: string; cover: string; headline: string; news: string; work: { title: string; brief: string } }> = {
  sta: {
    ceremony: 'A clerk of the Transit Authority stamps your papers twice and shakes your hand: from today you are a {rank}. Their lanes and their yards will know it.',
    greet: 'Welcome back, {rank}.',
    cover: '{station} traffic: we have you, {rank}. Come straight in.',
    headline: 'The Transit Authority names a new {rank}',
    news: 'The Sol Transit Authority has named a new {rank}, for steady work on its lanes.',
    work: { title: 'Authority commission', brief: 'Posted for the Authority’s own ranks.' },
  },
  frontier: {
    ceremony: 'A Co-op organiser reads your name out to a half-empty hall, and everyone there claps anyway: you are a {rank} of the Frontier Cooperative now.',
    greet: 'Good to see you, {rank}.',
    cover: '{station} control: berth’s yours, {rank}. We’ll keep them busy.',
    headline: 'The Frontier Co-op welcomes a new {rank}',
    news: 'The Frontier Cooperative has a new {rank}, voted in by its members for work done out past the edge.',
    work: { title: 'Co-op call', brief: 'For the Co-op’s own, by rank.' },
  },
  'hollow-wake': {
    ceremony: 'Nobody says much. Someone hands you a scorched pack badge and a drink, and the den goes back to its business: you run with the Wake as a {rank} now.',
    greet: 'The Wake sees you, {rank}.',
    cover: '{station}: in you come, {rank}.',
    headline: 'Word in the dens: a new {rank}',
    news: 'Word in the dens is that the Hollow Wake has a new {rank}. Nobody will say who.',
    work: { title: 'Crew job', brief: 'Wake work, for its own ranks.' },
  },
};

/** The card and notices. */
export const RANK_NOTES = {
  title: '{rank} of the {faction}',
  opens: 'What it opens',
  fell: 'The {faction} no longer counts you a {rank}. {now}',
  fellTo: 'You are a {now}.',
  fellOut: 'You hold no rank with them now.',
  paused: 'Its perks wait while the {faction} hunts you.',
  locked: 'For a {rank} of the {faction} or above',
  tag: '{rank} and up',
  yard: '{rank} of the {faction}: {percent} off ships and equipment here.',
  yardWake: '{rank} of the Hollow Wake: {percent} off Wake Salvage gear and hulls here.',
} as const;

/** What each perk does, in words ({percent}: the yard discount). */
export const PERK_WORDS = {
  work: 'Commissions on their boards, for their ranks only',
  workWake: 'Crew jobs on den boards',
  yard: '{percent} off ships and equipment at their yards',
  yardWake: '{percent} off Wake Salvage gear and hulls at free ports and dens',
  cover: 'Their docks clear you in even with raiders near',
  outpost: 'Raids on your outpost come half as often',
  extra: 'One more contract in progress at once',
  news: 'Your rank in the News',
} as const;

export const RANK_FICTION = 'Fiction: the factions, their ranks and ceremonies are invented for this game.';
