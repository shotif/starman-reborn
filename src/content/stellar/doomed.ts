import type { CommodityId } from '../economy/goods.ts';

/**
 * Stellar death II, a doomed star at the edge (docs/PROCGEN.md §26): Pyre, a red supergiant that
 * does not exist, just beyond the edge of the map, explodes as a supernova and leaves a black hole
 * the player can fly to. It is the one star the game invents, an exception chosen by the owner: it
 * is held here only, never written into the real sky's data or given a source, and labelled as
 * fiction wherever it shows. Its place is beyond the archives' census of the Sun's neighbourhood
 * (everything with a parallax of at least 120 mas, out to 27.18 light-years), so the map never
 * claims a star the census lacks. How bright it is, how big, and what its black hole is like are
 * worked out from the values below with the real physics. Every time is in game seconds.
 */
export const DOOMED = {
  star: {
    id: 'pyre',
    name: 'Pyre',
    spectralType: 'M2 Iab',
    /** Its invented place, in the map's frame (ICRS): toward Phoenix, 33 light-years from the Sun. */
    raDegrees: 357.5,
    decDegrees: -45.5,
    distanceLy: 33,
    /** The real system its one lane joins: the nearest to it, a frontier system at the map's edge. */
    anchor: 'gj-915',
    /**
     * A red supergiant of about 25 solar masses at birth: its luminosity (log L/L☉), surface
     * temperature and bolometric correction in V (typical of an M2 supergiant), from which its
     * brightness and size follow.
     */
    massSolar: 25,
    logLuminosity: 5.35,
    temperatureK: 3_650,
    bolometricCorrectionV: -1.6,
    colorHex: '#ff8a5c',
  },
  /** Its observatory while it lives, and the station built after it has gone (fiction, like every station). */
  stations: {
    observatory: { id: 'pyre-observatory', name: 'Pyre Observatory' },
    remnant: { id: 'pyre-remnant-station', name: 'Pyre Remnant Station' },
  },
  /**
   * When its warning comes in a save: an hour after Antares has gone out (docs/PROCGEN.md §25) and
   * two hours after the player first reached the frontier, so a pilot can get there; or half an hour
   * after loading a save already past both.
   */
  schedule: { afterAntares: 3_600, afterFrontier: 7_200, afterLoad: 1_800 },
  timeline: {
    /** Neutrinos from the last days of its core warn of the collapse, compressed here to 45 minutes. */
    collapseAfterWarning: 2_700,
    /** The shock takes a while to break out of the star's surface: the light leaves then. */
    breakoutAfterCollapse: 300,
    /** Its light crosses a light-year in this many game seconds (a year, in reality). */
    secondsPerLy: 60,
    /** The lane opens again once the debris has thinned; a station opens once the remnant's radioactivity has faded. */
    laneOpensAfterBreakout: 4_200,
    stationOpensAfterBreakout: 18_600,
    /** The glow of what is left once the supernova has faded (absolute magnitude, an estimate). */
    remnantAbsoluteMagnitude: -1,
  },
  /** The black hole its core leaves (in this game: the less certain way such a star may end). */
  blackHole: {
    massSolar: 10,
    /** Tides would pull a ship this long apart, end to end, at this many g. */
    tides: { shipLengthM: 10, limitG: 10 },
  },
  /**
   * How close a supernova would have to be to harm Earth's ozone layer, in parsecs: about 8 through
   * its radiation (Gehrels et al. 2003, ApJ 585, 1169), and as far as about 20 through the cosmic
   * rays that follow it for centuries (Fields et al. 2020, PNAS 117, 21008). Estimates, told as such.
   */
  earth: { ozoneNearPc: 8, ozoneFarPc: 20 },
  /** Research stations pay more for these goods from the warning until Pyre has faded in their own sky. */
  market: { goods: ['data-cores', 'electronics'] as readonly CommodityId[], price: 1.3 },
} as const;

export type DoomedRules = typeof DOOMED;
