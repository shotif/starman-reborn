import { hasProvisionalData, SYSTEMS } from '../../data/systems.ts';
import { button, dataBadge } from '../components.ts';
import { h } from '../dom.ts';
import '../styles/screens.css';

export interface TitleOptions {
  saveSummary: string | null;
  onPlay(): void;
  onContinue(): void;
  /** Save slots, export and import. */
  onSaves(): void;
  onControls(): void;
  onAbout(): void;
  onSettings(): void;
}

export function renderTitle(parent: HTMLElement, opts: TitleOptions): HTMLElement {
  const root = h(
    'section',
    // Scrolls only when it cannot fit (large text on a short screen).
    { class: 'screen title-screen scroll', 'aria-labelledby': 'title-heading', 'data-testid': 'title-screen' },
    h(
      'div',
      { class: 'title-card' },
      h('h1', { id: 'title-heading', class: 'game-title' }, 'Starman', h('span', null, ' Reborn')),
      h('p', { class: 'eyebrow title-eyebrow' }, 'Among real nearby stars'),
      h(
        'p',
        { class: 'title-tagline' },
        `Fly, trade, mine and fight across ${SYSTEMS.length} real star systems, from Sol out to the frontier.`,
      ),
      h(
        'div',
        { class: `title-actions${opts.saveSummary ? ' has-save' : ''}` },
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
        // The rest, smaller and two by two, so the title fits short screens.
        h(
          'div',
          { class: 'title-more' },
          button('Saves', { icon: 'save', testId: 'saves-open', onClick: opts.onSaves }),
          button('Controls', { icon: 'help', testId: 'title-controls', onClick: opts.onControls }),
          button('About the science', { icon: 'source', testId: 'title-about', onClick: opts.onAbout }),
          button('Settings', { icon: 'settings', testId: 'title-settings', onClick: opts.onSettings }),
        ),
      ),
      h(
        'p',
        { class: 'title-note' },
        dataBadge('observed', 'Real stars'),
        ' ',
        dataBadge('fictional', 'Fictional stations and travel'),
        hasProvisionalData() ? [' ', dataBadge('provisional')] : null,
      ),
      h('p', { class: 'title-foot muted' }, 'Sound starts after your first tap or key press. Progress saves in this browser.'),
    ),
    h('p', { class: 'title-build', 'aria-label': `Build ${__BUILD_ID__}` }, `Prototype · build ${__BUILD_ID__}`),
  );
  parent.appendChild(root);
  return root;
}
