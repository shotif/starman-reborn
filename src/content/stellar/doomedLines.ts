/**
 * What the News and the stations say of Pyre, the invented star (docs/PROCGEN.md §26). Every number
 * comes from the rules or the map ({distance}, {brightness}, {peak}, {here}, {herePeak}, {ozoneNear},
 * {ozoneFar}), never written here. Wherever these show, the game marks them as fiction and says
 * there is no star called Pyre. News reaches every station "by relay through the lanes", faster than
 * light: that too is the game's fiction.
 */

export { SKY_SPEAKER as EDGE_SPEAKER } from './lines.ts';

export type EdgeNewsKind = 'warning' | 'collapse' | 'light' | 'fading' | 'lane' | 'station';

/** Headline and detail for each moment. {star}, {distance} (light-years from the Sun), {brightness} and {peak} (magnitudes from Earth), {anchor}, {system}, {here} (light-years from here), {herePeak}. */
export const EDGE_NEWS: Record<EdgeNewsKind, { headline: string; detail: string }> = {
  warning: {
    headline: 'Neutrino alarm at {star}',
    detail:
      'Detectors at {star} Observatory have caught the neutrinos a dying core gives off in its last hours: {star}, the red supergiant {distance} light-years from the Sun beyond {anchor}, is about to collapse. The observatory is evacuating, and the research stations are paying for every observation of the star while it lasts.',
  },
  collapse: {
    headline: 'The core of {star} has collapsed',
    detail: 'Word has come by relay through the lanes: the neutrino burst of the collapse has been caught, and the light of the explosion is minutes behind it. The lane from {anchor} is closed until the debris has thinned.',
  },
  light: {
    headline: 'The light of {star} reaches {system}',
    detail: '{star} has exploded. Its light, {here} light-years on its way, now outshines everything in this sky, and rises to magnitude {herePeak}.',
  },
  fading: {
    headline: '{star} is fading in this sky',
    detail: 'The supernova of {star} is past its brightest here. A glow will be left where it shone: the cloud of its outer layers, still lit by the radioactive elements the explosion made.',
  },
  lane: {
    headline: 'The lane to {star} is open again',
    detail: 'The debris has thinned enough for ships to jump from {anchor} to where {star} was. Its core has fallen in on itself: a black hole is all that is left of it.',
  },
  station: {
    headline: 'A station at the remnant of {star}',
    detail: '{star} Remnant Station has opened, well clear of the black hole where the star was. The research stations want the remnant charted.',
  },
};

/** Said over the stations' channel when a moment comes, in flight or docked. */
export const EDGE_COMMS: Partial<Record<EdgeNewsKind, string>> = {
  warning: '{star} Observatory is evacuating: its neutrino alarm says the star is about to collapse.',
  collapse: '{star} has collapsed. Its light is on its way.',
  light: 'The light of {star} has reached {system}. Look toward it.',
  lane: 'The lane from {anchor} to {star} is open again. There is a black hole where it was.',
};

/** Told at Sol's stations when the light of Pyre arrives. {distance}, {ozoneNear} and {ozoneFar} (light-years). */
export const EDGE_EARTH = {
  headline: 'What {star} would mean for Earth',
  detail:
    'Were {star} real, at {distance} light-years it would be close enough to matter: astronomers reckon a supernova could thin the ozone layer if it went off within somewhere from {ozoneNear} to {ozoneFar} light-years, through its radiation or the cosmic rays that follow it for centuries. Any harm would build over years to millennia, not hours.',
};

/** Said with every story of Pyre. */
export const EDGE_FICTION = 'Fiction: there is no star called {star}.';
