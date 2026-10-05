/**
 * A stand in a belt (docs/PROCGEN.md §40.3): the crews' cutters at their rocks in a ring, and waves
 * of claim-jumpers coming for them out of the dark. The crews, their ships and the claim-jumpers are
 * fiction; the belt is a real, cited one, drawn schematically.
 */
export const STAND = {
  /** The stand begins when the pilot comes this close to the crews' spot (m). */
  range: 6_000,
  /** Each wave comes out of the dark this far from the spot, from the side away from the pilot (m). */
  from: 4_000,
  /** The crews' spot, and a rescue's ship drifting in a belt, keep this far from every station (m). */
  clear: 3_000,
  /** Seconds before a wave comes, once the stand begins or the wave before is down to one ship. */
  waveDelay: 8,
  /** How far apart the cutters work (m), each `standOff` off its own rock. */
  spacing: 260,
  standOff: 140,
  /** The crews' cutters fly this catalogue ship. */
  cutter: 'ship.freighter.1.halden',
} as const;

/** What is said in a stand (fiction): `{n}` is how many claim-jumpers come, `{lead}` the lead cutter's name. */
export const STAND_LINES = {
  begin: '{lead} to all ships: we see you. Cutters stay on the rock; let them come to us.',
  first: '{n} claim-jumpers out of the dark, making for the crews’ cutters!',
  next: 'Another wave: {n} more claim-jumpers!',
  won: 'The last claim-jumper is down. The crews’ beams never went off.',
  lost: 'Too many cutters lost: the crews pull back off the ice.',
} as const;
