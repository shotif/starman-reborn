import { getLocation, getSystem } from '../../data/systems.ts';
import { cargoUsed } from '../../economy/cargo.ts';
import { welcomeText } from '../../economy/dockText.ts';
import { hasOutfitter, hasShipyard } from '../../economy/equipment.ts';
import { FACTIONS, standingTier, TIER_LABEL } from '../../economy/factions.ts';
import { jobsAt } from '../../economy/jobs.ts';
import { cargoCapacity } from '../../economy/loadout.ts';
import { hasMarket } from '../../economy/markets.ts';
import type { RoomView } from '../../world/rooms/types.ts';
import { button, dataBadge } from '../components.ts';
import { formatCredits, h, replaceChildren, signed } from '../dom.ts';
import { glyph, type GlyphName } from '../glyphs.ts';
import { icon } from '../icons.ts';
import '../styles/dock.css';
import '../styles/station.css';
import { acceptLabel, jobBoardContent, jobsNeedAttention, newsContent } from './bar.ts';
import { choiceHere } from '../../economy/story.ts';
import type { StationContext } from './context.ts';
import { hasVoyage, journalContent, voyageReport } from './journal.ts';
import { outfitterContent, shipStatus } from './outfitter.ts';
import { shipyardContent } from './shipyard.ts';
import { traderContent } from './trader.ts';

export type StationWindow = 'trader' | 'outfitter' | 'shipyard' | 'jobs' | 'news' | 'journal' | 'arrival' | 'menu';

export interface StationOpen {
  room?: RoomView;
  /** Window to show first; omitted = the room's default window. */
  window?: StationWindow | null;
  /** Big station-name card on arrival. */
  titleCard?: boolean;
}

const ROOMS: Record<RoomView, { label: string; glyph: GlyphName }> = {
  deck: { label: 'Deck', glyph: 'deck' },
  bar: { label: 'Bar', glyph: 'bar' },
  trader: { label: 'Trader', glyph: 'trader' },
  outfitter: { label: 'Outfitter', glyph: 'outfitter' },
};

const ROOM_WINDOW: Record<RoomView, StationWindow | null> = {
  deck: null,
  bar: 'jobs',
  trader: 'trader',
  outfitter: 'outfitter',
};

const WINDOW_TITLE: Record<StationWindow, string> = {
  trader: 'Trader',
  outfitter: 'Outfitter',
  shipyard: 'Shipyard',
  jobs: 'Job board',
  news: 'Station news',
  journal: 'Journal',
  arrival: 'Arrival',
  menu: 'Menu',
};

/** Rooms a station offers, in rail order (also the rooms its 3D interior builds). */
export function stationRooms(locationId: string, access: 'full' | 'emergency' = 'full'): RoomView[] {
  const list: RoomView[] = ['deck', 'bar'];
  // Emergency docking: the deck (repairs) and the bar (the customs desk), nothing else.
  if (access === 'emergency') return list;
  if (hasMarket(locationId)) list.push('trader');
  if (hasOutfitter(locationId)) list.push('outfitter');
  return list;
}

/**
 * The docked station: a 3D room behind a thin layer of rails and framed windows. The room rail
 * (top centre) switches rooms; the tab hanging under it holds that room's actions and Launch;
 * the global rail holds the map, journal, science notes and menu.
 */
export class StationHub {
  readonly root: HTMLElement;
  private readonly ctx: StationContext;
  private room: RoomView;
  private win: StationWindow | null;
  private selectedJob: string | null = null;
  private selectedSlot: string | null = null;
  private readonly top: HTMLElement;
  private readonly roomRail: HTMLElement;
  private readonly actionTab: HTMLElement;
  private readonly globalRail: HTMLElement;
  private readonly idPanel: HTMLElement;
  private readonly deckPanel: HTMLElement;
  private readonly windowEl: HTMLElement;
  private readonly fade: HTMLElement;
  /** Toast container while docked (bottom right; above the menus rail on portrait phones). */
  readonly toastSlot: HTMLElement;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly onKey = (e: KeyboardEvent) => this.handleKey(e);

  constructor(parent: HTMLElement, ctx: StationContext, open: StationOpen = {}) {
    this.ctx = ctx;
    this.room = open.room && this.rooms().includes(open.room) ? open.room : 'deck';
    this.win = open.window === undefined ? ROOM_WINDOW[this.room] : open.window;
    this.roomRail = h('nav', { class: 'rail frame attach-top station-rooms', 'aria-label': 'Station rooms' });
    this.actionTab = h('div', { class: 'rail-tab frame attach-top station-actions', role: 'toolbar', 'aria-label': 'Room actions' });
    this.top = h('div', { class: 'station-top' }, this.roomRail, this.actionTab);
    this.globalRail = h(
      'nav',
      { class: 'rail frame attach-top attach-right station-global', 'aria-label': 'Menus' },
      this.globalButton('map', 'Star map', 'dock-map', () => ctx.openMap()),
      this.globalButton('journal', 'Journal', 'station-journal', () => this.openWindow(this.win === 'journal' ? null : 'journal')),
      this.globalButton('science', 'Science notes', 'station-science', () => ctx.openEncyclopedia()),
      this.globalButton('menu', 'Menu', 'station-menu', () => this.openWindow(this.win === 'menu' ? null : 'menu')),
    );
    this.idPanel = h('div', { class: 'station-id' });
    // Scrolls when short screens or large text leave too little room between the rails.
    this.deckPanel = h('section', { class: 'frame deck-panel scroll', 'aria-label': 'Ship status' });
    this.windowEl = h('section', { class: 'window frame station-window', tabindex: '-1' });
    this.fade = h('div', { class: 'station-fade', 'aria-hidden': 'true' });
    this.toastSlot = h('div', { class: 'toasts station-toasts', 'aria-live': 'polite' });
    const loc = getLocation(ctx.locationId);
    const faction = loc.factionId ? FACTIONS[loc.factionId] : null;
    const card = open.titleCard
      ? h(
          'div',
          { class: 'name-card animate station-title', 'aria-hidden': 'true' },
          h('span', { class: 'name-main' }, loc.name),
          h('span', { class: 'name-sub' }, [getSystem(loc.systemId).displayName, faction?.shortName].filter(Boolean).join(' · ')),
        )
      : null;
    this.root = h(
      'section',
      { class: 'station', 'aria-label': `Docked at ${loc.name}`, 'data-testid': 'dock-screen' },
      this.fade,
      card,
      this.idPanel,
      this.deckPanel,
      this.windowEl,
      this.top,
      this.globalRail,
      this.toastSlot,
    );
    card?.addEventListener('animationend', () => card.remove());
    parent.appendChild(this.root);
    this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.layout());
    this.resizeObserver?.observe(this.root);
    this.resizeObserver?.observe(this.top);
    window.addEventListener('keydown', this.onKey);
    this.ctx.setView(this.room);
    this.render();
    this.focusDefault();
  }

  /** Rooms this station offers, in rail order. */
  rooms(): RoomView[] {
    return stationRooms(this.ctx.locationId, this.ctx.access);
  }

  get currentRoom(): RoomView {
    return this.room;
  }

  openRoom(room: RoomView, win: StationWindow | null = ROOM_WINDOW[room]): void {
    if (!this.rooms().includes(room)) return;
    const changed = room !== this.room;
    this.room = room;
    this.win = win;
    if (changed) {
      const transition = this.ctx.setView(room);
      if (transition === 'cut') this.playFade();
      this.ctx.sfx('ui-click');
    }
    this.render();
    this.focusDefault();
  }

  openWindow(win: StationWindow | null): void {
    this.win = win;
    this.render();
    this.focusDefault();
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKey);
    this.resizeObserver?.disconnect();
    this.root.remove();
  }

  /** Re-renders rails, panels and the open window from the game state. */
  render(): void {
    const { ctx } = this;
    this.root.dataset.room = this.room;
    this.root.classList.toggle('has-window', this.win !== null);
    replaceChildren(
      this.roomRail,
      this.rooms().map((r) =>
        h(
          'button',
          {
            type: 'button',
            class: 'rail-btn',
            'aria-current': r === this.room ? 'page' : undefined,
            'aria-label': ROOMS[r].label,
            'data-testid': `room-${r}`,
            onClick: () => this.openRoom(r),
          },
          glyph(ROOMS[r].glyph),
          h('span', null, ROOMS[r].label),
          r === 'bar' && jobsNeedAttention(ctx) ? h('span', { class: 'rail-badge', 'aria-label': 'Jobs available' }, '!') : null,
        ),
      ),
    );
    replaceChildren(this.actionTab, this.actionsFor(this.room));
    this.renderId();
    this.renderDeckPanel();
    this.renderWindow();
    for (const b of this.globalRail.querySelectorAll<HTMLElement>('[data-window]')) {
      b.setAttribute('aria-pressed', String(b.dataset.window === this.win));
    }
    this.layout();
  }

  // ---------------------------------------------------------------- parts

  private globalButton(g: GlyphName, label: string, testId: string, onClick: () => void): HTMLElement {
    const win = testId === 'station-journal' ? 'journal' : testId === 'station-menu' ? 'menu' : undefined;
    return h(
      'button',
      { type: 'button', class: 'rail-btn rail-btn-sm', 'aria-label': label, title: label, 'data-testid': testId, 'data-window': win, onClick },
      glyph(g),
    );
  }

  private actionsFor(room: RoomView): HTMLElement[] {
    const act = (g: GlyphName, label: string, win: StationWindow, testId: string) =>
      h(
        'button',
        {
          type: 'button',
          class: 'rail-btn rail-btn-sm',
          'aria-pressed': String(this.win === win),
          'aria-label': label,
          'data-testid': testId,
          onClick: () => this.openWindow(this.win === win ? null : win),
        },
        glyph(g),
        h('span', null, label),
      );
    const items: HTMLElement[] = [];
    const full = this.ctx.access === 'full';
    if (room === 'deck' && full && hasShipyard(this.ctx.locationId)) items.push(act('shipyard', 'Ships', 'shipyard', 'station-ships'));
    if (room === 'bar') items.push(...(full ? [act('jobs', 'Jobs', 'jobs', 'station-jobs')] : []), act('news', 'News', 'news', 'station-news'));
    if (room === 'trader') items.push(act('trader', 'Trade', 'trader', 'station-trade'));
    if (room === 'outfitter') items.push(act('outfitter', 'Equip', 'outfitter', 'station-equip'));
    items.push(button('Launch', { icon: 'launch', variant: 'primary', onClick: () => this.ctx.launch(), testId: 'dock-launch' }));
    return items;
  }

  private renderId(): void {
    const { state, locationId } = this.ctx;
    const loc = getLocation(locationId);
    const faction = loc.factionId ? FACTIONS[loc.factionId] : null;
    const standing = loc.factionId ? state.reputation[loc.factionId] ?? 0 : 0;
    replaceChildren(
      this.idPanel,
      h(
        'div',
        { class: 'station-name-block' },
        h('h1', { class: 'station-name' }, loc.name),
        h(
          'div',
          { class: 'station-sub' },
          getSystem(loc.systemId).displayName,
          faction ? ` · ${faction.shortName} · ${TIER_LABEL[standingTier(standing)]} (${signed(standing)})` : '',
          ' ',
          dataBadge('fictional'),
        ),
      ),
      h(
        'div',
        { class: 'station-wallet' },
        h('span', { class: 'wallet-item' }, icon('credits'), h('strong', { class: 'num', 'data-testid': 'dock-credits' }, formatCredits(state.credits))),
        h('span', { class: 'wallet-item' }, icon('cargo'), h('span', { class: 'num' }, `${cargoUsed(state.ship.cargo)}/${cargoCapacity(state.ship)}`)),
      ),
    );
  }

  private renderDeckPanel(): void {
    const { state, locationId } = this.ctx;
    const show = this.room === 'deck' && this.win !== 'arrival' && this.win !== 'shipyard';
    this.deckPanel.hidden = !show;
    if (!show) return;
    const welcome = welcomeText(state, locationId);
    const clearance = locationId === 'mars-depot' && state.flags.clearance;
    replaceChildren(
      this.deckPanel,
      h('p', { class: `comm${welcome.improved ? ' improved' : ''}`, 'data-testid': 'dock-welcome' }, welcome.text),
      clearance ? h('p', { class: 'callout good' }, icon('jump'), 'Jump clearance granted. Open the star map in flight to jump.') : null,
      shipStatus(this.ctx, () => this.render(), { repair: true, compact: true }),
    );
  }

  private renderWindow(): void {
    const win = this.win;
    this.windowEl.hidden = win === null;
    if (win === null) {
      this.windowEl.removeAttribute('data-testid');
      return;
    }
    this.windowEl.dataset.testid = `${win}-window`;
    this.windowEl.setAttribute('aria-label', WINDOW_TITLE[win]);
    const loc = getLocation(this.ctx.locationId);
    const head = h(
      'header',
      { class: 'window-head' },
      h('h2', { class: 'window-title', tabindex: '-1' }, WINDOW_TITLE[win], h('small', null, loc.name)),
      button('', { icon: 'close', size: 'sm', ariaLabel: 'Close', testId: 'window-close', onClick: () => this.openWindow(null) }),
    );
    const foot = this.windowFoot(win);
    replaceChildren(this.windowEl, head, h('div', { class: 'window-body scroll' }, this.windowContent(win)), foot ? h('footer', { class: 'window-foot' }, foot) : null);
  }

  /** Primary actions that must stay visible without scrolling. */
  private windowFoot(win: StationWindow): HTMLElement | null {
    if (win !== 'jobs') return null;
    const { state, locationId } = this.ctx;
    const offers = jobsAt(state, locationId);
    const open = this.selectedJob ?? offers.find((o) => o.status === 'available')?.job.id ?? null;
    const offer = offers.find((o) => o.job.id === open && o.status === 'available');
    // A story choice waiting here (docs/PROCGEN.md §14).
    const choice = choiceHere(state, locationId);
    if (choice && (!offer || this.selectedJob === choice.job.id)) return button('Decide', { variant: 'primary', testId: 'story-decide', onClick: () => this.ctx.decide() });
    if (!offer) return null;
    return button(acceptLabel(offer.job), { variant: 'primary', testId: `accept-${offer.job.id}`, onClick: () => this.ctx.acceptJob(offer.job.id) });
  }

  private windowContent(win: StationWindow): HTMLElement {
    const refresh = () => this.render();
    const { ctx } = this;
    switch (win) {
      case 'trader':
        return traderContent(ctx, refresh);
      case 'outfitter':
        return outfitterContent(ctx, refresh, this.selectedSlot, (id) => {
          this.selectedSlot = id;
          this.render();
          // Single-column layouts: bring the offers for the chosen mount into view.
          const sale = this.windowEl.querySelector<HTMLElement>('.outfitter-sale');
          const mounts = this.windowEl.querySelector<HTMLElement>('.outfitter-mounts');
          if (sale && mounts && sale.offsetTop > mounts.offsetTop) sale.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
      case 'shipyard':
        return shipyardContent(ctx, refresh);
      case 'jobs':
        return jobBoardContent(
          ctx,
          this.selectedJob,
          (id) => {
            this.selectedJob = id;
            this.render();
          },
          refresh,
        );
      case 'news':
        return newsContent(ctx);
      case 'journal':
        return journalContent(ctx, refresh);
      case 'arrival':
        return this.arrivalContent();
      case 'menu':
        return h(
          'div',
          { class: 'stack menu-list' },
          button('Saves', { icon: 'save', testId: 'saves-open', onClick: () => ctx.openSaves() }),
          button('Settings', { icon: 'settings', testId: 'menu-settings', onClick: () => ctx.openSettings() }),
          button('Controls', { icon: 'help', testId: 'menu-controls', onClick: () => ctx.openControls() }),
          button('Save and quit to title', { icon: 'back', testId: 'menu-quit', onClick: () => ctx.quitToTitle() }),
        );
    }
  }

  /** Greeting, clearance news and the voyage report, shown once when you dock. */
  private arrivalContent(): HTMLElement {
    const { state, locationId } = this.ctx;
    const welcome = welcomeText(state, locationId);
    const clearance = locationId === 'mars-depot' && state.flags.clearance;
    return h(
      'div',
      { class: 'stack arrival' },
      h('p', { class: `comm${welcome.improved ? ' improved' : ''}`, 'data-testid': 'dock-welcome' }, welcome.text),
      clearance ? h('p', { class: 'callout good' }, icon('jump'), 'Jump clearance granted. Open the star map in flight to jump.') : null,
      hasVoyage(state) ? h('div', { class: 'list-head' }, h('span', null, 'Voyage report'), h('span', null, 'Since Halcyon Ring')) : null,
      voyageReport(state),
      h('div', { class: 'row wrap' }, button('Continue', { variant: 'primary', testId: 'arrival-ok', onClick: () => this.openWindow(null) })),
    );
  }

  // ---------------------------------------------------------------- behaviour

  private playFade(): void {
    if (document.documentElement.classList.contains('reduced-motion')) return;
    this.fade.classList.remove('run');
    void this.fade.offsetWidth;
    this.fade.classList.add('run');
  }

  private focusDefault(): void {
    const target = this.win ? this.windowEl.querySelector<HTMLElement>('.window-title') : this.roomRail.querySelector<HTMLElement>('[aria-current="page"]');
    target?.focus({ preventScroll: true });
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || this.root.hidden || !this.root.isConnected) return;
    if (document.querySelector('.modal-backdrop, .sheet-backdrop')) return;
    if (e.key === 'Escape' && this.win) {
      e.preventDefault();
      this.openWindow(null);
    }
  }

  /** Keeps windows between the rails whatever the text size or orientation. */
  private layout(): void {
    const root = this.root.getBoundingClientRect();
    if (!root.height) return;
    const topBottom = this.top.getBoundingClientRect().bottom - root.top;
    const globalRect = this.globalRail.getBoundingClientRect();
    const idRect = this.idPanel.getBoundingClientRect();
    const portrait = getComputedStyle(this.root).getPropertyValue('--station-layout').trim() === 'portrait';
    let bottomReserve = 8;
    if (portrait) bottomReserve = root.bottom - Math.min(globalRect.top, idRect.top) + 6;
    this.root.style.setProperty('--win-top', `${Math.round(topBottom + 8)}px`);
    this.root.style.setProperty('--win-bottom', `${Math.round(bottomReserve)}px`);
  }
}
