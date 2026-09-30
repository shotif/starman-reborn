import type { StationOwner } from '../../../content/world/types.ts';

/**
 * The look generated station exteriors are built from is the world generator's own descriptor
 * (src/content/world/types.ts): type, owner, seed, star colour, size and wear.
 */
export { STATION_TYPES, type StationLook, type StationOwner, type StationType } from '../../../content/world/types.ts';

export const STATION_OWNERS: readonly StationOwner[] = ['sta', 'frontier', 'hollow-wake', 'independent'];
