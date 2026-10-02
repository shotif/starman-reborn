/**
 * What the News, the stations and the contract boards say while a far star dies (docs/PROCGEN.md
 * §25). The words are fiction; every number in them comes from the catalogue or the rules
 * ({distance}, {peak}, {years}…), never written here (the guardrails hold the pools to that).
 * Wherever they show, the game marks the event as fiction.
 */

export type SkyNewsKind = 'alert' | 'light' | 'fading' | 'remnant' | 'bh-alert' | 'bh-light' | 'bh-gone';

/** Headline and detail for each moment. {star}, {designation}, {distance} (light-years), {years}, {peak} (magnitude). */
export const SKY_NEWS: Record<SkyNewsKind, { headline: string; detail: string }> = {
  alert: {
    headline: 'Neutrino burst from {star}',
    detail:
      'Neutrino detectors at the research stations caught a burst from {star} ({designation}), a red supergiant {distance} light-years away. Neutrinos leave a collapsing star before its light, so astronomers expect it to brighten soon.',
  },
  light: {
    headline: '{star} has exploded',
    detail: 'Its light has been on its way for {years} years. {star} is now the brightest light in every sky, rising to magnitude {peak}.',
  },
  fading: {
    headline: '{star} is fading',
    detail: 'The supernova of {star} is past its brightest. The research stations are still paying for every observation of its light.',
  },
  remnant: {
    headline: 'The supernova of {star} has faded',
    detail: 'A faint glow is left where {star} shone: the cloud of its outer layers, still lit by the radioactive elements the explosion made.',
  },
  'bh-alert': {
    headline: 'A weak neutrino burst from {star}',
    detail: 'The detectors caught a fainter burst, from {star} ({designation}), another red supergiant, {distance} light-years away. Astronomers are watching it closely.',
  },
  'bh-light': {
    headline: '{star} flickers',
    detail: '{star} has brightened a little, but no explosion has followed. The research stations are asking pilots to watch it.',
  },
  'bh-gone': {
    headline: '{star} has gone dark',
    detail: '{star} has faded from the sky. Astronomers think its core collapsed into a black hole without exploding, swallowing most of the star.',
  },
};

/** Said over the stations' channel when a moment comes, in flight or docked. */
export const SKY_COMMS: Partial<Record<SkyNewsKind, string>> = {
  alert: 'Neutrino alert: a burst from the direction of {star}. Watch the sky.',
  light: '{star} has exploded. Look toward it: it outshines everything.',
  'bh-alert': 'A second neutrino burst, from {star}. Watch it.',
  'bh-gone': '{star} is gone. The research stations think it collapsed into a black hole.',
};

/** Who says it. */
export const SKY_SPEAKER = 'Research station network';

/** Observation contracts: title and briefing. {star}, {distance}, {baseline} (light-years), {shift} (degrees). */
export const OBSERVE_LINES = {
  first: {
    title: 'Catch the first light of {star}',
    briefing:
      'The research stations want {star} watched from open space as its light arrives and rises to its peak, when every reading counts most. Observe it in flight while the window is open, then bring the readings back here.',
  },
  fading: {
    title: 'Watch {star} fade',
    briefing: 'Every observation of the supernova as it fades refines what astronomers know of it. Observe {star} in flight while the window is open, then bring the readings back here.',
  },
  parallax: {
    title: 'Measure the distance to {star}',
    briefing:
      'Seen from two systems {baseline} light-years apart, {star} shifts against the far sky by about {shift} degrees: enough to measure its distance, as astronomers measure every star. Observe it from two systems at least that far apart while it shines, then bring both readings back here.',
  },
  vanish: {
    title: 'Watch {star} go out',
    briefing: '{star} is fading in a way no supernova does. The research stations want it watched until it is gone. Observe it in flight while the window is open, then bring the readings back here.',
  },
} as const;
