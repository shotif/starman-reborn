import type { MysteryId } from './mysteries.ts';
import type { PodWhat, SiteKind } from './rules.ts';

/**
 * What wrecks, derelicts and their mysteries say (docs/PROCGEN.md §31.7). Fiction: every ship,
 * person and log is invented. Names and places are filled in ({ship}, {sister}, {body}, {system},
 * {station}, {what}, {until}, {why}…); no line holds a number of its own, writes a star's name or
 * says he or she of anyone, and a line that names a real body ({body}) only says the site drifts
 * near it, never anything about the body itself.
 */

/** Ships of wrecks and derelicts (fiction), clear of every other pool of ships' names and every place. */
export const WRECK_NAMES: readonly string[] = [
  'Quiet Hours', 'Lantern Moth', 'Sedge Warbler', 'Patient Grey', 'Second Morning', 'Ember Drift',
  'Hollin', 'Brambling', 'Harebell', 'Quillwort', 'Ostler', 'Stitchwort',
];

/** What the site's target says under its name. */
export const SITE_SUBTITLES: Record<SiteKind, string> = {
  ship: 'Adrift · drive failure · fly alongside to help',
  pod: 'Adrift · fly close to tractor it in',
  wreck: 'Wreck · scan its log, tractor in its pods',
  derelict: 'Derelict · near {body} · hold steady alongside to board',
};

/** A site's name on the HUD, by kind (a pod site by what its first pod is). */
export const SITE_NAMES = {
  ship: '{ship} (adrift)',
  wreck: 'Wreck of the {ship}',
  derelict: '{ship} (derelict)',
  lifepod: 'Lifepod of the {ship}',
  cargo: 'Cargo adrift ({ship})',
  recorder: 'Lifeboat of the {ship}',
  decoy: 'Decoy · Hollow Wake bait',
} as const;

/** Under a pod's name: what it holds (filled in), then this. */
export const POD_SUBTITLE = 'fly close to tractor it in';

/** A pod's name on the HUD. */
export const POD_NAMES: Record<PodWhat, string> = {
  salvage: 'Salvage pod',
  cargo: 'Cargo pod',
  lifepod: 'Lifepod',
  recorder: 'Lifeboat recorder',
  strongbox: 'Strongbox',
};

/** Over the radio as the pilot draws near, or as something happens. */
export const SITE_RADIO = {
  wreck: 'Automatic beacon of the {ship}. No one aboard. Salvage rights are open.',
  derelict: 'Only a carrier tone on the {ship}’s band, as there has been for a very long time.',
  reached: 'That’s our drive back. Thank you: we can make the nearest dock from here.',
  sprung: 'Kind of you to stop. Now hold still.',
  friend: 'Oh, it’s you. Fly on, friend.',
} as const;

/** The last entries of a wreck's log, read by a scan. */
export const WRECK_LOGS: readonly string[] = [
  'The last entry: raiders on the scope, closing fast. The crew dumped the cargo pods and ran for it.',
  'The log stops mid-word. Before that, a long complaint about a coolant pump nobody would replace.',
  'The crew logged a hull breach, sealed the bulkheads and abandoned ship in good order. Then nothing.',
  'Pages of dull cargo manifests, and at the very end: they had a passenger nobody had told the pilot about.',
];

/** What is found aboard a derelict, read as it is boarded. */
export const DERELICT_LOGS: readonly string[] = [
  'The bridge is cold and tidy. Someone switched everything off, carefully, and left.',
  'Frost on the inside of the viewports, and a mug still clipped to the pilot’s seat.',
  'The holds are empty and swept clean. Only the charts are left, older than any in your computer.',
  'A handwritten note on the hatch: back soon. It has been a very long time.',
];

/** What the game says (notices, cards): {ship}, {body}, {system}, {until}, {why}, {what}, {kind}. */
export const SITE_NOTES = {
  marked: 'The {ship} is marked on your HUD. It waits until {until}.',
  found: 'Your scan picked up a faint return near {body}: {kind}. Marked on your HUD.',
  revealed: 'Your scan shows raiders lying dark by the {ship}. They are coming out.',
  sprung: 'Raiders come out of the dark by the {ship}!',
  bait: 'The {ship} was bait, a Hollow Wake decoy.',
  boarding: 'Boarding the {ship}: hold steady',
  broken: 'Boarding broken off: {why}.',
  why: { range: 'you drifted out of range', speed: 'you pulled away', hostile: 'hostile contact', stopped: 'you called it off', gone: 'the hulk is gone' },
  clear: 'Your scan of the {ship} shows nothing lying dark nearby.',
  boarded: 'You board the {ship}: {what}.',
  salvaged: 'Salvage from the {ship}: {what}.',
  reached: 'You reach the {ship}: its drive is back.',
  noBerth: 'No free berth for the survivor: fit a passenger cabin.',
  full: 'No room in the hold for the data core: it stays aboard.',
  done: 'The {ship} is done: nothing more to find there.',
  lapsed: {
    ship: 'The {ship} has been helped by someone else.',
    pod: 'Another ship picked up what was adrift near the {ship}.',
    wreck: 'Another salvor got to the wreck of the {ship} first.',
    derelict: 'Someone towed the {ship} away.',
  } as Record<SiteKind, string>,
} as const;

/** What kind of find, in words. */
export const KIND_WORDS: Record<SiteKind, string> = {
  ship: 'a ship in distress',
  pod: 'something adrift',
  wreck: 'the wreck of a hauler',
  derelict: 'an old derelict',
};

/**
 * Each mystery's words: its title, the lead, the find's words, what is found there, the ending, and
 * how it ends ({ship}: the starting site's ship; {sister}; {body}; {system}: the find's;
 * {station}: the ending's; {fence}: the fence's).
 */
export const MYSTERY_LINES: Record<MysteryId, { title: string; lead: string; find: string; found: string; end: string; solved: string; cold: string; fence?: string; choose?: string }> = {
  tender: {
    title: 'The lifeboat of the {ship}',
    lead: 'The log’s last page: the crew took to their lifeboat and made for {system}. Nobody logged them arriving.',
    find: 'Find the lifeboat of the {ship} in {system}',
    found: 'The lifeboat’s recorder: a passing hauler took the crew aboard, bound for {station}.',
    end: 'Ask after the crew of the {ship} at {station}',
    solved: 'The crew of the {ship} are safe at {station}, and buy you a round for coming all that way.',
    cold: 'The trail of the {ship}’s crew has gone cold.',
  },
  strongbox: {
    title: 'The {ship}’s strongbox',
    lead: 'Raiders cut the {ship}’s strongbox out of its hold. Its tracker still pings, faintly, from {system}.',
    find: 'Take the {ship}’s strongbox back from the raiders in {system}',
    found: 'The strongbox is aboard, its seals unbroken.',
    end: 'Return the {ship}’s strongbox to its insurers at {station}',
    fence: 'Sell the {ship}’s strongbox to a fence at {fence}',
    choose: 'Its insurers at {station} will pay for its return. A fence at {fence} would pay more, and the Hollow Wake would remember it.',
    solved: 'The {ship}’s strongbox is off your hands.',
    cold: 'The {ship}’s strongbox has gone where nobody will find it.',
  },
  silence: {
    title: 'The sister of the {ship}',
    lead: 'The charts aboard mark one entry twice: the {ship}’s sister, the {sister}, last logged near {body} in {system}.',
    find: 'Find the {sister} near {body} in {system}',
    found: 'The {sister}’s data vault is whole: a company’s own logs and letters, never sent.',
    end: 'Bring the {sister}’s vault to {station}',
    solved: 'The vault of the {sister} is home at {station}, and its letters will be read at last.',
    cold: 'The {sister} has drifted beyond anyone’s charts.',
  },
};

/** The card's buttons. */
export const SITE_CHOICES = {
  follow: 'Follow the trail',
  leave: 'Leave it',
  insurer: 'Return it to its insurers',
  fence: 'Take it to a fence',
} as const;

export const SITE_FICTION = 'Fiction: wrecks, derelicts, their ships, people and logs are invented for this game.';
