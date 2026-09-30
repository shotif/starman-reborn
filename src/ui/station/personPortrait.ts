import type { Person } from '../../economy/people.ts';
import { portraitElement, STORY_PORTRAITS } from '../portraits.ts';

/** A person's face in the bar: story characters have their own; everyone else is drawn from their seed. */
export function personPortrait(person: Person, size: 'sm' | 'lg' = 'sm'): HTMLElement {
  const story = person.story ? STORY_PORTRAITS[person.story] : undefined;
  // Story faces sit at seeds 1005–2636; a regular's seed is moved clear of them.
  const seed = story ? story.seed : person.seed >= 1000 && person.seed <= 3000 ? person.seed + 3000 : person.seed;
  const look = story ? story.look : { faction: person.faction, role: person.role, age: person.age };
  return portraitElement(seed, look, { label: `Portrait of ${person.name}`, size });
}
