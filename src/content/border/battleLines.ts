import type { BattleKind, BattleSide } from './battles.ts';

/**
 * Words for the border in sight (docs/PROCGEN.md §35): the battle strip, the radio as a battle opens
 * and ends, the notes after it, and the News of a turning battle. Invented for this game. Fields in
 * braces are filled in by the game: {station} a station's name, {system} a system's, {payer} who pays,
 * {purse} the purse.
 */

/** The strip's title for each kind of battle. */
export const BATTLE_TITLES: Record<BattleKind, string> = {
  clash: 'Clash at the {system} beacon line',
  assault: 'The Wake assaults {station}',
  retake: 'Retaking {station}',
};

/** The short name of each side on the strip. */
export const SIDE_SHORT: Record<BattleSide, string> = { law: 'Law', wake: 'Wake' };

/** Who speaks for each side on the radio. */
export const BATTLE_VOICES: Record<BattleSide, string> = { law: '{payer} wing', wake: 'Wake raider' };

/** The radio as a battle opens, by kind and by the side that speaks (the pilot's own). */
export const BATTLE_OPEN: Record<BattleKind, Record<BattleSide, string>> = {
  clash: {
    law: 'Wake fighters on the beacon line. All wings, engage.',
    wake: 'Lawful wings on the beacon line. Take them apart.',
  },
  assault: {
    law: 'The Wake is coming for {station}. All ships, hold the approach.',
    wake: 'Now is our chance. {station} is ours if we break its guard.',
  },
  retake: {
    law: 'All wings: today we take {station} back.',
    wake: 'They want {station} back. Hold the approach.',
  },
};

/** The radio as a battle ends: by the winner (the speaker is the winner's voice), or both pulling back. */
export const BATTLE_END: Record<BattleKind, Record<BattleSide | 'draw', string>> = {
  clash: {
    law: 'They are breaking. Good flying, all wings.',
    wake: 'The line is ours. Let them run.',
    draw: 'Both sides are pulling back from the line.',
  },
  assault: {
    law: 'The assault is beaten off. The guard holds.',
    wake: 'The guard is broken. The station will not hold for long.',
    draw: 'The raiders are pulling back from the station.',
  },
  retake: {
    law: 'The holders are broken. The station is within our reach.',
    wake: 'They are falling back. The station stays ours.',
    draw: 'The lawful wings are pulling back from the station.',
  },
};

/** After a battle, as notes. */
export const BATTLE_NOTES = {
  won: 'Battle won: {payer} pays you {purse}.',
  moved: 'The front moves your side’s way.',
  held: '{station} holds for now.',
  freed: '{station} is the law’s again.',
  fallen: '{station} falls to the Wake.',
  lost: 'The battle is lost.',
  drawn: 'Both sides pulled back.',
  noPart: 'Your side won without you downing a ship of theirs: no purse.',
} as const;

/** The News of a turning battle the pilot fought in, by kind and winner. */
export const BATTLE_NEWS: Record<Exclude<BattleKind, 'clash'>, Record<BattleSide, { headline: string; detail: string }>> = {
  assault: {
    law: { headline: 'A pilot helps beat off the Wake’s assault on {station}', detail: 'Lawful wings and a pilot flying with them broke the raiders on the station’s approach.' },
    wake: { headline: 'The guard of {station} is broken', detail: 'Wake raiders, a pilot among them, broke the station’s guard. It cannot hold for long.' },
  },
  retake: {
    law: { headline: 'A pilot helps retake the approaches to {station}', detail: 'Lawful wings broke the Wake’s holders, a pilot flying with them.' },
    wake: { headline: 'The Wake keeps its hold on {station}', detail: 'The lawful push was beaten off, a pilot flying for the Wake.' },
  },
};

export const BATTLE_FICTION = 'Fiction: the border war, its battles and the words of both sides are invented for this game.';
