import type { LaneKind } from './rules.ts';

/**
 * What lane encounters say (docs/PROCGEN.md §27): the hail on the HUD, the scene on the card, the
 * risk the card names (with odds from the rules, never whether this one is a trap), each choice and
 * what came of it. Fiction, like the people and ships in them. Every number comes from the rules or
 * the world through a field, never written here: {ship}, {name}, {station}, {system}, {owner},
 * {credits}, {good}, {qty}, {toll}, {fine}, {bribe}, {sting}, {odds}, {sight}, {fare}, {body}.
 */

export interface LaneOptionLines {
  label: string;
  /** What came of it (`trap`: when it was a trap). */
  outcome: string;
  trap?: string;
}

export interface LaneLines {
  speaker: string;
  /** On the HUD's banner. */
  hail: string;
  /** On the card. */
  scene: string;
  /** The risk the card names, when there is one here. */
  risk?: string;
  options: Record<string, LaneOptionLines>;
  /** What happens when the hail lapses unanswered. */
  lapse: string;
}

export const LANE_LINES: Record<LaneKind, LaneLines> = {
  mayday: {
    speaker: 'Mayday',
    hail: 'Mayday, mayday: the {ship}, drive failing, life support on reserve. Anyone on this channel?',
    scene: 'The {ship} is adrift out here, running lights flickering. Their pilot, {name}, asks for a jump start and will pay {credits} for the trouble.',
    risk: 'Maydays out here are sometimes bait: {odds}.',
    options: {
      help: { label: 'Go to them', outcome: 'The {ship} is marked on your HUD: fly alongside to help.' },
      pass: { label: 'Fly on', outcome: 'You leave the {ship} to someone else.' },
    },
    lapse: 'The mayday from the {ship} falls silent.',
  },
  lifepod: {
    speaker: 'Lifepod beacon',
    hail: 'A lifepod beacon: a survivor of the {ship}, lost to raiders here, is calling for a pickup.',
    scene: '{name}, who crewed the {ship} until the raiders came, is alive in a lifepod with a day of air. They ask to be taken to {station}.',
    options: {
      aboard: { label: 'Take them aboard', outcome: 'The lifepod is marked on your HUD: tractor it in, and {name} will pay {fare} at {station}.' },
      call: { label: 'Call it in', outcome: 'You pass the pod’s position to the {owner}. Someone will fetch {name}, in time.' },
      leave: { label: 'Leave the pod', outcome: 'You leave the pod to its beacon.' },
    },
    lapse: 'The lifepod’s beacon calls on, unanswered.',
  },
  toll: {
    speaker: 'Hollow Wake',
    hail: 'Hollow Wake to the ship by the beacon: this lane has a toll. Pay it, or we take it out of your hull.',
    scene: 'A Hollow Wake pack holds the jump beacon. Pay {toll} and they will let you be here until you dock or jump, unless you fire on them.',
    risk: 'Refuse, or say nothing, and they attack.',
    options: {
      pay: { label: 'Pay the toll', outcome: 'You pay {toll}. The pack lets you be, for now.' },
      refuse: { label: 'Refuse', outcome: 'You refuse. The pack comes for you.' },
    },
    lapse: 'The Wake take your silence as a no. The pack comes for you.',
  },
  customs: {
    speaker: 'Customs patrol',
    hail: 'This is the {owner} customs patrol. Hold course and declare your cargo.',
    scene: 'A {owner} patrol has you on its scanners, and you have contraband aboard. Declare it and pay half the fine ({fine}), offer the officer {bribe} to look away, or dump it before they scan.',
    risk: 'A bribe is sometimes a sting: {odds}.',
    options: {
      declare: { label: 'Declare it', outcome: 'You declare it. The patrol takes it and fines you {fine}.' },
      bribe: { label: 'Offer a bribe', outcome: 'The officer takes your {bribe} and looks the other way.', trap: 'The officer was waiting for a bribe: it is a sting. Your contraband is taken, and you are fined {sting} for the bribe.' },
      dump: { label: 'Dump it', outcome: 'You dump it out of the hold. The patrol saw, and the {owner} will remember.' },
    },
    lapse: 'You say nothing, so the patrol scans you anyway.',
  },
  scientist: {
    speaker: 'Stranded scientist',
    hail: '{name} here, a survey scientist stranded out by {sight}. My shuttle’s dead. Can anyone help?',
    scene: '{name} came out to study {sight} and their shuttle failed. They ask for a berth to {station}, and will pay {fare} there, with a data core from their survey.',
    options: {
      berth: { label: 'Give them a berth', outcome: '{name} is aboard, bound for {station}, with a data core for you.' },
      fuel: { label: 'Spare some fuel', outcome: 'You spare them fuel for their shuttle; they pay {credits} and fly home.' },
      tow: { label: 'Call them a tow', outcome: 'You call {station}. A tow is on its way for {name}.' },
    },
    lapse: '{name} stops calling; someone else will hear them.',
  },
  cargo: {
    speaker: 'Cargo beacon',
    hail: 'A cargo beacon: {qty} units of {good} adrift, lost by a hauler bound for {station}.',
    scene: 'Cargo pods tumble somewhere out here: {qty} units of {good}, tagged for {station}. Return them and the owners will pay {credits}; or keep them.',
    risk: 'Cargo left adrift out here is sometimes bait: {odds}.',
    options: {
      return: { label: 'Return it', outcome: 'The pods are marked on your HUD: tractor them in, then deliver them to {station} for {credits}.' },
      keep: { label: 'Keep it', outcome: 'The pods are marked on your HUD: tractor them in, and they are yours.' },
      leave: { label: 'Leave it', outcome: 'You leave the pods to drift.' },
    },
    lapse: 'The cargo beacon drifts out of range.',
  },
  trader: {
    speaker: 'Lost trader',
    hail: 'The {ship} here: our charts are out of date and we are lost. Anyone know these lanes?',
    scene: '{name} of the {ship} is lost, with old charts. Share yours and they will tell you a price they know; or sell them a fix for {credits}.',
    options: {
      charts: { label: 'Share your charts', outcome: '{name} thanks you, and tells you what they know of the markets.' },
      sell: { label: 'Sell them a fix', outcome: '{name} pays {credits} for a fix and flies on.' },
      ignore: { label: 'Ignore them', outcome: 'You let the {ship} find its own way.' },
    },
    lapse: 'The {ship} stops calling.',
  },
  wreck: {
    speaker: 'Wreck beacon',
    hail: 'An automatic beacon: the {ship} broke up out here. Salvage rights are open to anyone who comes.',
    scene: 'The wreck of the {ship} is tumbling somewhere out here, its beacon still calling. Whatever is left in its hold and its log is yours if you go and get it.',
    risk: 'Raiders pick over wrecks out here: {odds}.',
    options: {
      go: { label: 'Mark it and go', outcome: 'The wreck of the {ship} is marked on your HUD: scan its log and tractor in its pods.' },
      call: { label: 'Log it for the salvors', outcome: 'You log the wreck for the {owner} salvors.' },
      leave: { label: 'Leave it', outcome: 'You leave the wreck to its beacon.' },
    },
    lapse: 'The wreck’s beacon fades out of range.',
  },
  derelict: {
    speaker: 'Old beacon',
    hail: 'A carrier tone on a band nobody uses any more: an old hulk, the {ship}, adrift near {body}.',
    scene: 'The {ship} has not answered a call in a very long time. It drifts near {body}, dark. Board it and see what is left aboard.',
    risk: 'Hulks out here sometimes hide raiders lying dark: {odds}.',
    options: {
      go: { label: 'Mark it and go', outcome: 'The {ship} is marked on your HUD: hold steady alongside to board it.' },
      report: { label: 'Report it', outcome: 'You report the {ship} to the {owner}.' },
      leave: { label: 'Leave it', outcome: 'You leave the old hulk to its silence.' },
    },
    lapse: 'The old beacon fades.',
  },
};

/** On every card. */
export const LANE_FICTION = 'Fiction: the people, ships and events of the lanes are fiction.';
