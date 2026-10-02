/**
 * What is said of raids on the player's outpost (docs/PROCGEN.md §29): its watch over the radio, the
 * game's notices and the News. Fiction. Numbers and names are filled in ({outpost}, {ships},
 * {minutes}…); no line holds a number of its own, and none says he or she of anyone.
 */

/** The outpost's watch, over the radio (`{outpost} watch` speaks). */
export const RAID_WATCH = {
  warning: ['Raiders on the scope, {ships} of them, coming our way. About {minutes} minutes out.', 'We have company: {ships} raiders closing. Call it {minutes} minutes.'],
  probe: ['A raider is sniffing round the station. Probing our defences, we think. About {minutes} minutes out.'],
  struck: ['They’re here! Going for the stores!', 'Raiders in range! Turrets, open up!'],
  held: ['They’re breaking off. We held!', 'That’s the last of them. Stores are safe.'],
  lost: ['They got into the stores. We’re hurt, but we’re still here.', 'They’ve cracked the stores and gone. We’ll mend.'],
};

/** What the game says. */
export const RAID_NOTES = {
  warning: 'Raiders are coming for {outpost}: {ships} ships, in about {minutes} min. {odds}',
  held: 'Raiders struck {outpost} and were driven off.',
  lost: 'Raiders got into {outpost}’s stores: its income is cut for {hours} h and its market is short of {good}{took}.',
  turretDown: ' A turret is knocked out.',
  guardOnPost: '{guard} is on post at {outpost} from {from}.',
} as const;

/** The News of raids on the player's outpost: {outpost}, {system}. */
export const RAID_NEWS = {
  held: ['Raiders struck {outpost} in {system}, and its defenders drove them off.'],
  lost: ['Raiders got into the stores of {outpost} in {system}.'],
} as const;

export const RAID_FICTION = 'Fiction: the raids on your outpost, the raiders and the guards are invented for this game.';
