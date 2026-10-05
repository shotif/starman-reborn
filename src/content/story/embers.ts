/**
 * Last Light at Pyre (docs/PROCGEN.md §42): the arc that Pyre's death waits for, and its lifeboats.
 * Pyre, its observatory, its people and their lifeboats are fiction (docs/PROCGEN.md §26).
 */
export const EMBERS = {
  /** The arc's first step: taking it holds Pyre's warning (§42.1). */
  first: 'arc.embers.1',
  /** The arc's choice: made, it starts Pyre's warning `warnAfter` seconds later. */
  choice: 'embers.reckoning',
  warnAfter: 60,
  /** The lifeboats leave the observatory this long after the warning (s); the collapse is 45 minutes after it. */
  launch: 1_500,
  /** Each drifts out on its own heading at this speed (m/s), from this far out at the launch (m). */
  drift: 3.5,
  start: 600,
  /** Flying within this of one takes it aboard (m). */
  pickup: 250,
  /** The lifeboats are drawn as this catalogue ship. */
  boat: 'ship.courier.1.halden',
} as const;

/** What is said of the lifeboats (fiction): `{n}` is how many, `{name}` a lifeboat's name. */
export const LIFEBOAT_LINES = {
  launch: 'Pyre Observatory: lifeboats away, {n} of them. The counters are past the scale. Come and get us.',
  aboard: '{name} aboard.',
  enough: 'Enough of them aboard: get clear through the lane before the collapse.',
  clear: 'Clear of Pyre with the lifeboats aboard.',
  lapsed: 'The collapse came with the lifeboats still out there.',
} as const;
