import type { Person } from '../../economy/people.ts';
import { h } from '../dom.ts';

/** A person's face in the bar (the portrait art, or their initials while it loads). */
export function personPortrait(person: Person, size: 'sm' | 'lg' = 'sm'): HTMLElement {
  const initials = person.name
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join('')
    .slice(0, 2);
  return h('span', { class: `face face-initials ${size} faction-${person.faction}`, role: 'img', 'aria-label': `Portrait of ${person.name}` }, initials);
}
