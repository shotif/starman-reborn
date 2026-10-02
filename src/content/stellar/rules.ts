import type { CommodityId } from '../economy/goods.ts';

/**
 * Stellar death, as fiction (docs/PROCGEN.md §25): two real red supergiants far beyond the map die
 * in the game's sky, an exception to the rule that real astronomy is never invented, chosen by the
 * owner. Betelgeuse explodes as a supernova; later Antares collapses quietly into a black hole and
 * vanishes. The stars, their places, distances and brightness are the catalogue's (src/data/
 * generated/far-stars.json); that they die, and when, is fiction, labelled as such wherever it
 * shows, and never written into the real sky's data. Each save has its own timeline, set when the
 * opening delivery is done; every time below is in game seconds.
 */
export const STELLAR = {
  /** When the first neutrino alert comes: this long after the opening delivery, or after loading a save that is past it. */
  alertAfterOpening: 5_400,
  alertAfterLoad: 1_800,
  supernova: {
    star: 'betelgeuse',
    /**
     * A typical Type II-P supernova's peak, absolute B magnitude (Richardson et al. 2014, the mean of
     * their sample): with the star's real distance it gives how bright the supernova gets.
     */
    peakAbsoluteMagnitude: -16.75,
    /**
     * Neutrinos leave a collapsing star before its light: SN 1987A's were caught some three hours
     * ahead of it. Here the lead, like the rest, is compressed.
     */
    lightAfterAlert: 900,
    /** Rising to the peak, staying near it, then fading to `remnantMagnitude`, where it stays. */
    rise: 600,
    plateau: 3_600,
    fade: 14_400,
    remnantMagnitude: 4.5,
    /** Its colour at the peak and as a remnant: artistic, like the rest of the event. */
    peakColour: '#e2ebff',
    remnantColour: '#ffb3a6',
  },
  blackHole: {
    star: 'antares',
    /** This long after Betelgeuse's light, a weaker neutrino burst comes from Antares. */
    alertAfterSupernova: 10_800,
    lightAfterAlert: 600,
    /** It brightens a little (magnitudes), holds, then fades out of sight: a failed supernova, as some astronomers think one can end. */
    brighten: 1,
    hold: 600,
    fade: 2_700,
  },
  /** The faintest a star shows in the game's sky (about the naked-eye limit). */
  nakedEye: 6.5,
  /**
   * Observation contracts at research stations while a star dies: watch its first light and peak,
   * its fading, or Antares going out; or measure Betelgeuse's distance by parallax, from two systems
   * at least `baselineLy` apart. Rewards in credits, never above what any contract may pay.
   */
  observe: {
    reward: { first: 2_200, fading: 1_200, parallax: 4_200, vanish: 1_600 },
    baselineLy: 20,
  },
  /** At research stations, from the first alert until a star has done dying, these goods sell dearer. */
  market: { goods: ['data-cores', 'electronics'] as readonly CommodityId[], price: 1.3 },
} as const;
