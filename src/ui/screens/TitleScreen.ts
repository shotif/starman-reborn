import { button, dataBadge } from '../components.ts';
import { h, type Child } from '../dom.ts';
import { icon } from '../icons.ts';
import '../styles/screens.css';

export interface TitleOptions {
  /** How many systems the game has (the tagline counts them). */
  systemCount: number;
  /** Shows the "Pending verification" badge while any sky data is unchecked. */
  provisional: boolean;
  saveSummary: string | null;
  onPlay(): void;
  onContinue(): void;
  /** Save slots, export and import. */
  onSaves(): void;
  onControls(): void;
  onAbout(): void;
  onSettings(): void;
}

/** The four smaller actions under Play, in the order the title shows them. */
const MORE = [
  { label: 'Saves', icon: 'save', testId: 'saves-open' },
  { label: 'Controls', icon: 'help', testId: 'title-controls' },
  { label: 'About the science', icon: 'source', testId: 'title-about' },
  { label: 'Settings', icon: 'settings', testId: 'title-settings' },
] as const;

/**
 * The title's frame: logotype, tagline, notes and build. The loading title and the title proper
 * share it, so nothing moves when the game finishes loading except the buttons coming alive.
 */
function titleScreen(attrs: { testId: string; systemCount: number; provisional: boolean }, actions: Child): HTMLElement {
  return h(
    'section',
    // Scrolls only when it cannot fit (large text on a short screen).
    { class: 'screen title-screen scroll', 'aria-labelledby': 'title-heading', 'data-testid': attrs.testId },
    h(
      'div',
      { class: 'title-card' },
      h('h1', { id: 'title-heading', class: 'game-title' }, 'Starman', h('span', null, ' Reborn')),
      h('p', { class: 'eyebrow title-eyebrow' }, 'Among real nearby stars'),
      h(
        'p',
        { class: 'title-tagline' },
        `Fly, trade, mine and fight across ${attrs.systemCount} real star systems, from Sol out to the frontier.`,
      ),
      actions,
      h(
        'p',
        { class: 'title-note' },
        dataBadge('observed', 'Real stars'),
        ' ',
        dataBadge('fictional', 'Fictional stations and travel'),
        attrs.provisional ? [' ', dataBadge('provisional')] : null,
      ),
      h('p', { class: 'title-foot muted' }, 'Sound starts after your first tap or key press. Progress saves in this browser.'),
    ),
    h('p', { class: 'title-build', 'aria-label': `Build ${__BUILD_ID__}` }, `Prototype · build ${__BUILD_ID__}`),
  );
}

export function renderTitle(parent: HTMLElement, opts: TitleOptions): HTMLElement {
  const handlers = { 'saves-open': opts.onSaves, 'title-controls': opts.onControls, 'title-about': opts.onAbout, 'title-settings': opts.onSettings };
  const root = titleScreen(
    { testId: 'title-screen', systemCount: opts.systemCount, provisional: opts.provisional },
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
        MORE.map((m) => button(m.label, { icon: m.icon, testId: m.testId, onClick: handlers[m.testId] })),
      ),
    ),
  );
  parent.appendChild(root);
  return root;
}

export interface LoadingTitle {
  readonly element: HTMLElement;
  /** How much of the game has arrived, 0–1; null while that cannot be told (the bar sweeps). */
  progress(fraction: number | null): void;
  /** Everything has arrived and the game is starting up (a second or two on a phone). */
  starting(): void;
  /** The download failed: say so, and offer to try again. */
  failed(retry: () => void): void;
}

/**
 * The title as it first appears, before the game has arrived: the same frame, with a progress bar
 * where Play will be and the other actions waiting (docs/TEST_RECORD.md, the first load).
 */
export function renderLoadingTitle(parent: HTMLElement, opts: { systemCount: number }): LoadingTitle {
  const bar = h('span', { class: 'title-progress-bar' });
  const label = h('span', { class: 'title-progress-label' }, 'Loading');
  const value = h('span', { class: 'num title-progress-value' });
  const meter = h(
    'div',
    {
      class: 'btn btn-lg title-progress indeterminate',
      role: 'progressbar',
      'aria-label': 'Loading the game',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'data-testid': 'title-progress',
    },
    icon('play'),
    label,
    value,
    bar,
  );
  const more = MORE.map((m) => button(m.label, { icon: m.icon, disabled: true }));
  const status = h('p', { class: 'title-load-error', role: 'alert', hidden: true, 'data-testid': 'title-load-error' });
  const actions = h('div', { class: 'title-actions' }, meter, status, h('div', { class: 'title-more' }, more));
  const root = titleScreen({ testId: 'title-loading', systemCount: opts.systemCount, provisional: false }, actions);
  root.setAttribute('aria-busy', 'true');
  parent.appendChild(root);
  let started = false;
  return {
    element: root,
    progress(fraction) {
      // A late report must not take "Starting" back to a percentage.
      if (started) return;
      if (fraction === null) {
        meter.classList.add('indeterminate');
        meter.removeAttribute('aria-valuenow');
        value.textContent = '';
        return;
      }
      const pct = Math.max(0, Math.min(100, Math.floor(fraction * 100)));
      meter.classList.remove('indeterminate');
      meter.setAttribute('aria-valuenow', String(pct));
      bar.style.transform = `scaleX(${pct / 100})`;
      value.textContent = `${pct}%`;
    },
    starting() {
      started = true;
      meter.classList.remove('indeterminate');
      meter.setAttribute('aria-valuenow', '100');
      meter.setAttribute('aria-valuetext', 'Starting');
      bar.style.transform = 'scaleX(1)';
      label.textContent = 'Starting';
      value.textContent = '';
    },
    failed(retry) {
      root.removeAttribute('aria-busy');
      meter.hidden = true;
      status.hidden = false;
      status.replaceChildren(
        h('span', null, 'The game did not finish loading. Check your connection, then try again.'),
        button('Try again', { variant: 'primary', size: 'lg', icon: 'launch', testId: 'title-retry', onClick: retry }),
      );
      status.querySelector('button')?.focus();
    },
  };
}
