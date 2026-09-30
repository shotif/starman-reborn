/**
 * Fixed layout of the hangar hall shared by the builders (metres): the hall is open to space at
 * the back (-Z, the bay mouth), the player's ship hovers over its pad in the middle, the trader's
 * cargo floor is on the right (+X) and the outfitter's workshop on the left (-X). The camera shots
 * are composed for this layout, so every station keeps it; styles change what fills it.
 */

export const HALL = { hw: 46, back: -30, front: 46, ceil: 25, wall: 4 };
export const PAD = { x: 0, z: -6, r: 8, moat: 10.4, depth: 4.5 };
