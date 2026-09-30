import type { FactionId } from '../../data/types.ts';
import type { CommodityId } from '../economy/goods.ts';

/**
 * Story arcs (docs/PROCGEN.md §14): three hand-written arcs, one per faction, and a fourth on the
 * border where they meet (§20), built from contract objectives plus scripted beats. Everything
 * here is fiction.
 */

export type ArcId = 'sta' | 'frontier' | 'wake' | 'border';

export type CharacterId = 'castell' | 'kettering' | 'quist' | 'brandt' | 'ansari' | 'salt';

export interface Character {
  id: CharacterId;
  name: string;
  /** Who they are, in a few words. */
  role: string;
  factionId: FactionId | null;
  /** Where the player finds them. */
  locationId: string;
}

/** A line of dialogue or comm chatter: from a character, or from the scene itself (`comm`). */
export interface Line {
  who: CharacterId | 'comm';
  text: string;
}

/** One answer to a story choice: what it does to standing and credits, and whether it ends the arc. */
export interface StoryOption {
  id: string;
  label: string;
  /** What happens, told once the choice is made. */
  outcome: string;
  rep: Partial<Record<FactionId, number>>;
  credits?: number;
  /** Clears every fine and lifts lawful standing to Wary (a deal with the law). */
  pardon?: boolean;
  /** The arc ends here: later missions never come. */
  ends?: boolean;
  /** Offered only to a pilot with this standing (another option is always open). */
  requires?: { minRep: { faction: FactionId; value: number } };
}

/** Story data carried by a mission (a JobDef with `story`). */
export interface StoryMeta {
  arc: ArcId;
  /** 1-based step within the arc. */
  step: number;
  /** Who gives the mission (their words are the briefing). */
  speaker: CharacterId;
  finale?: boolean;
  /** Said when objective `after` is done (at its dock, or over comms in flight). */
  beats?: readonly { after: number; lines: readonly Line[] }[];
  /** Comms when the player is in the system of objective `at` while it is current. */
  comms?: readonly { at: number; lines: readonly Line[] }[];
  /** Said when the mission is complete. */
  debrief?: readonly Line[];
  /** Loaded into the hold on accepting (it must fit). */
  cargo?: { commodity: CommodityId; qty: number };
  /** Words that follow an earlier choice: the briefing and debrief for each of its options. */
  variant?: { choiceId: string; briefing: Readonly<Record<string, string>>; debrief: Readonly<Record<string, readonly Line[]>> };
  /** Words that follow choices made in other arcs, said after the briefing for each one made. */
  echoes?: readonly { choiceId: string; said: Readonly<Record<string, string>> }[];
  /** Done, the mission settles a border front for good (economy/border.ts). */
  settles?: { front: string; ending: 'law' | 'wake' | 'truce' };
}

export interface Arc {
  id: ArcId;
  title: string;
  /** Whose arc it is (null: nobody's; its giver is independent). */
  factionId: FactionId | null;
  /** Who starts it. */
  giver: CharacterId;
  summary: string;
  /** A one-line hook in the bar while the first mission waits. */
  hook: string;
}
