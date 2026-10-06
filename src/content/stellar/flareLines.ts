import type { FlareKind } from './flares.ts';

/**
 * What is said of the flare stars (docs/PROCGEN.md §43). Every number comes from the rules and the
 * clock: `{star}` is the star, `{variable}` its variable-star name, `{system}` its system, `{Kind}` /
 * `{kind}` the kind of flare, `{shields}` and `{scanner}` its effects (percent), `{minutes}` how long
 * it has to go, `{giver}` the station posting work. When a star flares and what that does to ships
 * are fiction; that it flares is real.
 */

export const FLARE_SPEAKER = 'Flare watch';

export const FLARE_WORD: Record<FlareKind, string> = { flare: 'Flare', strong: 'Strong flare', superflare: 'Superflare' };

export const FLARE_NEWS = {
  headline: '{Kind} on {star}',
  /** While it lasts. */
  detail: '{star} has flared. Until it fades, shields in {system} recharge at {shields}% and scanners reach {scanner}% as far.',
  /** Over. */
  over: '{star} has settled after its {kind}: shields and scanners in {system} are back to normal.',
} as const;

export const FLARE_FICTION = 'Fiction: when {star} flares, and what it does to ships, is the game’s. {star} is a real flare star, the variable star {variable}.';

export const FLARE_COMMS = {
  /** It starts with the pilot in its system. */
  start: '{Kind} on {star}. Shields recharge at {shields}% and scanners reach {scanner}% for about {minutes} minutes.',
  /** The pilot arrives, or launches, with one under way. */
  under: '{star} is flaring: shields recharge at {shields}% and scanners reach {scanner}%, about {minutes} minutes to go.',
  /** It ends with the pilot in its system. */
  end: '{star} has settled. Shields and scanners are back to normal.',
} as const;

export const FLARE_HUD = '{Kind} on {star} · shields {shields}% · scanners {scanner}% · {minutes} min to go';

/** The star's target subtitle in flight. */
export const FLARE_TARGET = { quiet: 'Flare star · real object; appearance illustrated', flaring: 'Flare star · flaring now' } as const;

/** The star map's line on a flare-star system. */
export const FLARE_MAP = {
  star: 'Flare star: {star} ({variable})',
  flaring: '{Kind} under way, about {minutes} min to go',
  quiet: 'Quiet now',
} as const;

/** The science card's lines on a flare star (the first real, the second fiction while it flares). */
export const FLARE_CARD = {
  what: '{star} is a flare star, the variable star {variable}: a red dwarf whose magnetic field now and then lets go, brightening it within minutes, most of all in blue and ultraviolet light.',
  flaring: 'It is flaring now: a {kind}, about {minutes} minutes to go.',
} as const;

export const FLARE_WATCH = {
  title: 'Flare watch: {star}',
  briefing: '{star} in {system} is flaring, and {giver} wants readings while it lasts: get to {system}, scan the star before it settles, and bring the readings back. The flare cuts scanner reach there, so go in close.',
  objective: 'Scan {star} while it flares',
} as const;
