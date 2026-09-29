import { h } from '../ui/dom.ts';
import { detectWebGL2 } from './webgl.ts';

/** Temporary boot screen; replaced by the game controller as milestones land. */
export function boot(): void {
  const ui = document.getElementById('ui')!;
  const support = detectWebGL2();
  ui.appendChild(
    h(
      'div',
      { class: 'screen dim-backdrop' },
      h(
        'div',
        { class: 'panel panel-pad stack', style: 'max-width: 28rem' },
        h('h1', { style: 'margin:0' }, 'Starman Reborn'),
        h('p', { class: 'muted' }, support.webgl2 ? 'WebGL 2 available.' : `WebGL 2 unavailable: ${support.reason}`),
      ),
    ),
  );
}
