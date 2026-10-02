/**
 * Info card for the selected system: observed data (with sources), fiction (stations, blurb) and
 * the fictional route with the Jump button. Desktop/landscape: side panel. Portrait: bottom sheet
 * whose details collapse; the header and the jump footer stay visible.
 */
import { beltsOf, getSystem, isInventedSystem, saveLocations } from '../data/systems.ts';
import { EDGE_FICTION } from '../content/stellar/doomedLines.ts';
import { DOOMED } from '../content/stellar/doomed.ts';
import type { SystemId } from '../data/types.ts';
import { dataBadge } from '../ui/components.ts';
import { formatCredits, h, replaceChildren } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { evaluateJump, type JumpEvaluation } from './jumpRules.ts';
import { mapIcon } from './mapIcons.ts';
import { formatLy } from './mapData.ts';
import { badgeHeading, beltBlock, componentList, factList, locationList, observedMark, planetBlock, positionList, securityNote } from './scienceBlocks.ts';
import type { MapState } from './types.ts';

export interface InfoCardHandlers {
  onJump(evaluation: JumpEvaluation): void;
  onEncyclopedia(systemId: SystemId): void;
  onCenter(systemId: SystemId): void;
}

let uid = 0;

function systemKindText(id: SystemId): string {
  const s = getSystem(id);
  if (id === 'sol') return 'Our Solar System';
  if (isInventedSystem(id)) return 'Invented star';
  const n = s.componentIds.length;
  return n === 1 ? 'Single star' : n === 2 ? 'Binary star system' : n === 3 ? 'Triple star system' : `${n} stars`;
}

function names(path: readonly SystemId[]): string {
  return path.map((id) => getSystem(id).displayName).join(' → ');
}

/** What the news says about a system (only what the player has heard: events within reach). */
function newsBlock(systemId: SystemId, state: MapState): HTMLElement | null {
  const items = (state.news ?? []).filter((n) => n.systemId === systemId);
  if (!items.length) return null;
  return h(
    'div',
    { class: 'gmap-news', 'data-testid': 'map-news' },
    h('h4', null, 'In the news'),
    h(
      'ul',
      { class: 'gmap-news-list' },
      items.map((n) => h('li', { class: `gmap-news-item kind-${n.kind}${n.active ? '' : ' over'}` }, h('strong', null, n.headline), n.active ? '' : ' (over)', h('span', { class: 'gmap-news-detail' }, n.detail))),
    ),
  );
}

export class InfoCard {
  readonly el: HTMLElement;
  private readonly handlers: InfoCardHandlers;
  private readonly ids = { title: `gmap-card-title-${++uid}`, body: `gmap-card-body-${uid}`, reasons: `gmap-card-reasons-${uid}` };
  private readonly toggle: HTMLButtonElement;
  private readonly toggleText: HTMLSpanElement;
  private readonly head: HTMLElement;
  private readonly body: HTMLElement;
  private readonly foot: HTMLElement;
  private expanded = false;
  private shownSystem: SystemId | null = null;
  private evaluation: JumpEvaluation | null = null;

  constructor(handlers: InfoCardHandlers) {
    this.handlers = handlers;
    this.toggleText = h('span', { class: 'gmap-sheet-toggle-text' }, 'Details');
    this.toggle = h(
      'button',
      {
        type: 'button',
        class: 'gmap-sheet-toggle',
        'aria-expanded': 'false',
        'aria-controls': this.ids.body,
        onClick: () => this.setExpanded(!this.expanded),
      },
      mapIcon('chevronUp'),
      this.toggleText,
    );
    this.head = h('header', { class: 'gmap-card-head' });
    this.body = h('div', { class: 'gmap-card-body', id: this.ids.body });
    this.foot = h('footer', { class: 'gmap-card-foot' });
    this.el = h(
      'aside',
      { class: 'gmap-card panel', 'aria-labelledby': this.ids.title, 'data-expanded': 'false' },
      h('span', { class: 'gmap-grabber', 'aria-hidden': 'true' }),
      this.head,
      this.body,
      this.foot,
    );
    this.enableSheetSwipe();
  }

  get isExpanded(): boolean {
    return this.expanded;
  }

  get jumpEvaluation(): JumpEvaluation | null {
    return this.evaluation;
  }

  /** Bottom-sheet expansion (portrait layouts; ignored by the side-panel layout). */
  setExpanded(on: boolean): void {
    this.expanded = on;
    this.el.dataset['expanded'] = on ? 'true' : 'false';
    this.toggle.setAttribute('aria-expanded', on ? 'true' : 'false');
    this.toggleText.textContent = on ? 'Less' : 'Details';
    replaceChildren(this.toggle, mapIcon(on ? 'chevronDown' : 'chevronUp'), this.toggleText);
  }

  /**
   * Swiping the grab handle up or down expands or collapses the sheet (the Details button does the
   * same). The handle is not scrollable, so it can claim the gesture (touch-action: none in CSS).
   */
  private enableSheetSwipe(): void {
    let startY = 0;
    let pointer = -1;
    const grab = this.el.querySelector<HTMLElement>('.gmap-grabber')!;
    grab.addEventListener('pointerdown', (e) => {
      pointer = e.pointerId;
      startY = e.clientY;
      grab.setPointerCapture?.(e.pointerId);
    });
    grab.addEventListener('pointerup', (e) => {
      if (e.pointerId !== pointer) return;
      pointer = -1;
      const dy = e.clientY - startY;
      if (dy < -20 && !this.expanded) this.setExpanded(true);
      else if (dy > 20 && this.expanded) this.setExpanded(false);
    });
    grab.addEventListener('pointercancel', () => (pointer = -1));
  }

  render(systemId: SystemId, state: MapState): void {
    const system = getSystem(systemId);
    const sameSystem = this.shownSystem === systemId;
    const scrollTop = this.el.scrollTop;
    this.shownSystem = systemId;
    const ev = evaluateJump(state, systemId);
    this.evaluation = ev;

    // Header
    const tags = h(
      'div',
      { class: 'gmap-card-tags' },
      state.currentSystemId === systemId ? h('span', { class: 'gmap-tag gmap-tag-current' }, icon('goto'), 'You are here') : null,
      state.objectiveSystemId === systemId ? h('span', { class: 'gmap-tag gmap-tag-objective' }, icon('objective'), 'Objective') : null,
      state.visited.has(systemId) && state.currentSystemId !== systemId
        ? h('span', { class: 'gmap-tag gmap-tag-visited' }, mapIcon('check'), 'Visited')
        : null,
    );
    replaceChildren(
      this.head,
      h(
        'div',
        { class: 'gmap-card-titles' },
        h('h2', { id: this.ids.title, class: 'gmap-card-title' }, system.displayName),
        h(
          'p',
          { class: 'gmap-card-sub' },
          systemId === 'sol'
            ? 'Map origin'
            : [h('span', { class: 'num' }, formatLy(system.distanceLightYears)), ' from Sol'],
          ' · ',
          systemKindText(systemId),
        ),
      ),
      this.toggle,
      tags.childElementCount ? tags : null,
    );

    // Body: observed, fiction, route. Pyre is invented (docs/PROCGEN.md §26): nothing about it is observed.
    const observed = isInventedSystem(systemId)
      ? h(
          'section',
          { class: 'gmap-sec gmap-sec-fiction', 'aria-labelledby': `${this.ids.title}-obs`, 'data-testid': 'gmap-invented' },
          badgeHeading('h3', 'Invented star', 'fictional', `${this.ids.title}-obs`),
          h('p', { class: 'gmap-summary' }, system.summary),
          h('p', null, h('strong', null, EDGE_FICTION.replace('{star}', DOOMED.star.name))),
          state.inventedNote ? h('p', { 'data-testid': 'gmap-invented-note' }, state.inventedNote) : null,
        )
      : h(
          'section',
          { class: 'gmap-sec gmap-sec-observed', 'aria-labelledby': `${this.ids.title}-obs` },
          badgeHeading('h3', 'Observed', 'observed', `${this.ids.title}-obs`, observedMark(system, 'all')),
          h('p', { class: 'gmap-summary' }, system.summary),
          positionList(system, 'compact'),
          h('h4', null, systemId === 'sol' ? 'Star' : 'Stars'),
          componentList(systemId, 'compact'),
          h('h4', null, systemId === 'sol' ? 'Planets' : 'Confirmed planets'),
          planetBlock(system, state.discoveredBodies, 'compact'),
          beltsOf(systemId).length ? [h('h4', null, 'Belts and debris discs'), beltBlock(systemId, 'compact')] : null,
          h('h4', null, 'Facts'),
          factList(system),
        );
    const fiction = h(
      'section',
      { class: 'gmap-sec gmap-sec-fiction', 'aria-labelledby': `${this.ids.title}-fic` },
      badgeHeading('h3', 'Fiction', 'fictional', `${this.ids.title}-fic`),
      h('p', { class: 'gmap-summary' }, system.fiction),
      securityNote(systemId),
      newsBlock(systemId, state),
      // The system's stations, and the player's own outpost there (docs/PROCGEN.md §22); at Pyre, the one there now.
      isInventedSystem(systemId) && state.inventedStations
        ? locationList(
            system.fictionalLocations.filter((l) => state.inventedStations!.some((x) => x.id === l.id)),
            'compact',
            new Map(state.inventedStations.flatMap((x) => (x.note ? [[x.id, x.note] as const] : []))),
          )
        : system.fictionalLocations.length
          ? locationList([...system.fictionalLocations, ...saveLocations(system.id)], 'compact')
          : null,
    );
    const links = h(
      'div',
      { class: 'gmap-card-links' },
      h(
        'button',
        { type: 'button', class: 'btn btn-sm', onClick: () => this.handlers.onEncyclopedia(systemId) },
        mapIcon('book'),
        'View in encyclopedia',
      ),
      h(
        'button',
        { type: 'button', class: 'btn btn-sm btn-ghost gmap-center-btn', onClick: () => this.handlers.onCenter(systemId) },
        icon('target'),
        'Center on map',
      ),
    );
    replaceChildren(this.body, observed, fiction, this.routeSection(ev, state), links);
    this.el.scrollTop = sameSystem ? scrollTop : 0;

    this.renderFoot(ev, state);
  }

  private routeSection(ev: JumpEvaluation, state: MapState): HTMLElement | null {
    if (!ev.route) return null;
    const r = ev.route;
    return h(
      'section',
      { class: 'gmap-sec gmap-sec-route', 'aria-labelledby': `${this.ids.title}-route` },
      badgeHeading('h3', 'Route', 'fictional', `${this.ids.title}-route`),
      h(
        'ol',
        { class: 'gmap-hops' },
        r.hops.map((hop) =>
          h(
            'li',
            null,
            h('span', { class: 'gmap-hop-path' }, names([hop.from, hop.to])),
            h(
              'span',
              { class: 'gmap-hop-meta num' },
              h('span', { title: 'Real distance between the star positions' }, formatLy(hop.distanceLy)),
              ' · ',
              formatCredits(hop.fee),
              ' · ',
              `${hop.transitDays.toFixed(1)} days`,
            ),
          ),
        ),
      ),
      r.hops.length > 1
        ? h(
            'p',
            { class: 'gmap-hop-total' },
            h('strong', null, 'Total '),
            h('span', { class: 'num' }, `${formatLy(r.totalDistanceLy)} · ${formatCredits(r.totalFee)} · ${r.totalTransitDays.toFixed(1)} days`),
          )
        : null,
      ev.covered
        ? h(
            'p',
            { class: 'gmap-coverage' },
            icon('credits'),
            h('span', null, `Fee covered: ${ev.coverageNote ?? ''} You pay ${formatCredits(0)} instead of ${formatCredits(ev.routeFee)}.`),
          )
        : null,
      h(
        'p',
        { class: 'sci-note' },
        'Distances are real, computed from the star positions. Jump links, fees and transit times are fiction. ',
        state.credits >= 0 ? `You have ${formatCredits(state.credits)}.` : null,
      ),
    );
  }

  private renderFoot(ev: JumpEvaluation, state: MapState): void {
    const system = getSystem(ev.destination);
    let summary: HTMLElement;
    if (ev.route) {
      summary = h(
        'p',
        { class: 'gmap-route-line' },
        h('span', { class: 'gmap-route-path' }, names(ev.route.path)),
        h(
          'span',
          { class: 'gmap-route-meta' },
          h('span', { class: 'num' }, ev.route.hops.length > 1 ? `${ev.route.hops.length} jumps · ` : ''),
          h('strong', { class: 'num' }, formatCredits(ev.fee)),
          ev.covered ? ' (covered)' : '',
          h('span', { class: 'num' }, ` · ${ev.route.totalTransitDays.toFixed(1)} days`),
          ' ',
          dataBadge('fictional'),
        ),
      );
    } else {
      summary = h(
        'p',
        { class: 'gmap-route-line' },
        h('span', { class: 'gmap-route-path' }, ev.destination === state.currentSystemId ? 'You are here' : 'No jump route'),
      );
    }
    const jump = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-primary gmap-jump',
        disabled: !ev.canJump,
        'aria-describedby': ev.reasons.length ? this.ids.reasons : undefined,
        'aria-label': ev.route ? `Jump to ${system.displayName}, fee ${formatCredits(ev.fee)}` : `Jump to ${system.displayName}`,
        'data-testid': 'map-jump',
        onClick: () => {
          if (this.evaluation?.canJump) this.handlers.onJump(this.evaluation);
        },
      },
      icon('jump'),
      'Jump',
    );
    replaceChildren(
      this.foot,
      h(
        'div',
        { class: 'gmap-foot-info' },
        summary,
        ev.reasons.length
          ? h(
              'ul',
              { class: 'gmap-jump-reasons', id: this.ids.reasons },
              ev.reasons.map((r) => h('li', null, icon('alert'), h('span', null, r))),
            )
          : null,
      ),
      jump,
    );
  }
}
