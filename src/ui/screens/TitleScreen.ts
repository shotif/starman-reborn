import { hasProvisionalData } from '../../data/systems.ts';
import { button, dataBadge } from '../components.ts';
import { h } from '../dom.ts';
import '../styles/screens.css';

export interface TitleOptions {
  saveSummary: string | null;
  onPlay(): void;
  onContinue(): void;
  onControls(): void;
  onAbout(): void;
  onSettings(): void;
}

export function renderTitle(parent: HTMLElement, opts: TitleOptions): HTMLElement {
  const root = h(
    'section',
    { class: 'screen title-screen', 'aria-labelledby': 'title-heading', 'data-testid': 'title-screen' },
    h(
      'div',
      { class: 'title-card' },
      h('p', { class: 'eyebrow' }, 'A prototype among real nearby stars'),
      h('h1', { id: 'title-heading', class: 'game-title' }, 'Starman', h('span', null, ' Reborn')),
      h(
        'p',
        { class: 'title-tagline' },
        'Fly, trade and fight across Sol, Alpha Centauri, Barnard’s Star, Sirius and Epsilon Eridani.',
      ),
      h(
        'div',
        { class: 'title-actions' },
        opts.saveSummary
          ? button(h('span', { class: 'stack-tight' }, 'Continue', h('small', null, opts.saveSummary)), {
              variant: 'primary',
              size: 'lg',
              icon: 'play',
              testId: 'title-continue',
              onClick: opts.onContinue,
            })
          : null,
        button(opts.saveSummary ? 'New game' : 'Play', {
          variant: opts.saveSummary ? undefined : 'primary',
          size: 'lg',
          icon: opts.saveSummary ? 'launch' : 'play',
          testId: 'title-play',
          onClick: opts.onPlay,
        }),
        button('Controls', { icon: 'help', testId: 'title-controls', onClick: opts.onControls }),
        button('About the science', { icon: 'source', testId: 'title-about', onClick: opts.onAbout }),
        button('Settings', { icon: 'settings', testId: 'title-settings', onClick: opts.onSettings }),
      ),
      h(
        'p',
        { class: 'title-note' },
        dataBadge('observed', 'Real stars'),
        ' ',
        dataBadge('fictional', 'Fictional stations and travel'),
        hasProvisionalData() ? [' ', dataBadge('provisional')] : null,
      ),
      h('p', { class: 'title-foot muted' }, 'Sound starts after your first tap or key press. Progress saves in this browser only.'),
    ),
  );
  parent.appendChild(root);
  return root;
}
