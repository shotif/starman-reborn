import { SYSTEMS } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { button } from './components.ts';
import { h } from './dom.ts';

/** TEMPORARY stand-in; replaced by the full encyclopedia module. */
export function openEncyclopedia(
  root: HTMLElement,
  opts: { discoveredBodies: ReadonlySet<string>; initialSystemId?: SystemId; onClose: () => void },
): { close(): void } {
  const el = h(
    'section',
    { class: 'screen dim-backdrop', 'data-testid': 'encyclopedia' },
    h(
      'div',
      { class: 'panel panel-pad stack scroll', style: 'width:min(40rem,100%);max-height:100%' },
      h('h2', null, 'About the science'),
      SYSTEMS.map((s) => h('div', null, h('h3', null, s.displayName), h('p', null, s.summary))),
      button('Close', { onClick: () => close() }),
    ),
  );
  root.appendChild(el);
  function close() {
    el.remove();
    opts.onClose();
  }
  return { close };
}
