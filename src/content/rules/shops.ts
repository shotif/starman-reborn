import type { ShopRule } from '../types.ts';

/**
 * What each station's outfitter and shipyard carry. A maker's home station sells its whole range;
 * the highest classes need standing with the station's faction (rules/balance.ts).
 */
export const SHOPS: readonly ShopRule[] = [
  { locationId: 'earth-port', makers: ['halden'], maxClass: 3, shipyard: ['courier', 'light-fighter', 'freighter'], maxShipTier: 2 },
  { locationId: 'mars-depot', makers: ['ares', 'halden'], maxClass: 5, shipyard: ['heavy-fighter', 'gunship', 'freighter', 'courier'], maxShipTier: 3 },
  { locationId: 'meridian-outpost', makers: ['toliman'], maxClass: 3, shipyard: ['surveyor', 'freighter', 'light-fighter'], maxShipTier: 3 },
  // A fuel and message relay: consumables only.
  { locationId: 'barnard-relay', makers: [], maxClass: 1, shipyard: [], maxShipTier: 1 },
  { locationId: 'sirius-platform', makers: ['horizon'], maxClass: 5, shipyard: ['light-fighter', 'heavy-fighter', 'courier', 'surveyor'], maxShipTier: 3 },
  {
    locationId: 'eridani-hub',
    makers: ['eridani', 'toliman', 'halden'],
    maxClass: 4,
    shipyard: ['freighter', 'courier', 'gunship', 'surveyor'],
    maxShipTier: 3,
  },
];
