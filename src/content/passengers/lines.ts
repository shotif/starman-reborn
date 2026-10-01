import type { SightKind } from './rules.ts';

/**
 * What passengers and sightseers say over the radio (docs/PROCGEN.md §23): phrase pools, fiction.
 * A line about a sight names the catalogue fields it needs, and is only said when the archive has
 * them; every number in it is printed from the data ({period}, {mass}…), never written here (the
 * guardrails hold the pools to that: no digits).
 */

/** Fields of the real sky a line can print. */
export type SightField = 'period' | 'mass' | 'axis' | 'radius' | 'year' | 'method' | 'type' | 'distance' | 'source';

export interface SightLine {
  needs: readonly SightField[];
  text: string;
}

/** About the sight, when it is in view: {name} and {star} always, the rest as the line needs. */
export const SIGHT_LINES: Record<SightKind, readonly SightLine[]> = {
  planet: [
    { needs: ['period'], text: '{name} goes round {star} once every {period} days. A whole year in that!' },
    { needs: ['mass'], text: 'So that is {name}: {mass} the mass of the Earth, the archives say.' },
    { needs: ['axis'], text: '{name} is only {axis} AU from {star}. Imagine the sunrises.' },
    { needs: ['year', 'method'], text: 'They found {name} in {year}, by {method}. And here we are, looking at it.' },
    { needs: ['radius'], text: '{name}: {radius} the width of the Earth. Bigger than it looks from here.' },
    { needs: [], text: 'There it is: {name}, a real world round {star}. Nobody at home will believe this.' },
  ],
  giant: [
    { needs: ['mass'], text: '{name} is a giant: {mass} the mass of the Earth. Look at the size of it!' },
    { needs: ['period'], text: 'A giant like {name}, and it takes {period} days to go round {star}.' },
    { needs: ['year', 'method'], text: '{name}: found in {year}, by {method}. I read about it as a child.' },
    { needs: [], text: 'A giant world, {name}, round {star}. Worth every credit.' },
  ],
  'white-dwarf': [
    { needs: ['type'], text: '{name}, a white dwarf (spectral type {type}): what is left of a star that died. Smaller than a planet, they say.' },
    { needs: ['distance'], text: '{name} is {distance} light-years from the Sun, and it is the core of a dead star. I came all this way for it.' },
    { needs: [], text: 'A white dwarf, {name}: the ember of a star. I could look at it all day.' },
  ],
  'brown-dwarf': [
    { needs: ['type'], text: '{name}: a brown dwarf, type {type}. Too big for a planet, too small to shine like a star.' },
    { needs: [], text: '{name}, a brown dwarf: a star that never caught light. How dark it is!' },
  ],
  belt: [
    { needs: ['source'], text: 'The {name}. Astronomers saw this dust from Earth ({source}), and we are flying through it.' },
    { needs: [], text: 'All that rock: the {name}, round {star}. Look at it glitter.' },
  ],
};

/** The tour's other moments: boarding, arriving in the sight's system, a hit taken, and home. The party's first passenger speaks. */
export const TOUR_LINES = {
  arrive: ['Is that {star}? We are really here!', '{system} at last. Where is {sight}?', 'Look, everyone: {system}!'],
  fright: ['Was that us? Are we hit?', 'Captain, please, keep us out of this!', 'That was too close. Is this part of the tour?'],
  home: ['Thank you, captain. I will never forget {sight}.', 'Home again. What a trip!', 'Worth every credit. We will tell everyone.'],
} as const;

/** A passage's lines: a hit taken, and arriving. */
export const PASSAGE_LINES = {
  fright: ['Captain? Is everything all right back there?', 'I paid for a quiet trip!'],
  arrive: ['{dest}, at last. Thank you, captain.', 'Safe and sound. Thank you!'],
} as const;
