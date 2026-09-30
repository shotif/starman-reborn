/**
 * Radio chatter in a fight (docs/PROCGEN.md §15): short lines from small phrase pools, picked at
 * random. The rules decide who speaks and when; only the wording varies. Invented for this game.
 */
export type ChatterKind = 'raider-spot' | 'raider-flee' | 'raider-down' | 'patrol-engage' | 'wing-kill' | 'wing-hurt' | 'wing-join' | 'den-alert' | 'missile';

export const CHATTER: Record<ChatterKind, readonly string[]> = {
  'raider-spot': ['Fresh cargo on the lane. Take it.', 'Light them up, Wake!', 'Mark the hauler. Nobody leaves.', 'One ship, all alone. Easy pickings.'],
  'raider-flee': ['I’m burning! Breaking off!', 'Too hot. Pulling out!', 'Drive’s failing, I’m out of here!'],
  'raider-down': ['We lost one! Keep at it!', 'They got Vesk! Pay them back!', 'Scatter and come round again!'],
  'patrol-engage': ['Patrol to all ships: raiders engaged.', 'Weapons free. Keep clear of our fire.', 'Authority patrol moving in.'],
  'wing-kill': ['Target down.', 'Splash one.', 'That one won’t be back.', 'Got it. Next?'],
  'wing-hurt': ['Taking fire, shields gone!', 'I’m hit! Still with you.', 'Hull breach, I can hold.'],
  'wing-join': ['On your wing.', 'Formed up. Lead the way.', 'With you, boss.'],
  'den-alert': ['Unmarked ship, you are on our guns. Turn back or burn.', 'Nobody invited you. Turrets are live.'],
  missile: ['Seeker away!', 'Missile launched. Let’s see you dance.'],
};
