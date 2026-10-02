/**
 * The star map's two pickers: find a system by name, and the systems your active missions send
 * you to. Each is a modal dialog over the map; choosing a row hands its system back to the map,
 * which selects it and brings it to the centre.
 */
import { MAP_SYSTEMS, getSystem } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { h, type Child } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { laneTaker } from './jumpRules.ts';
import { MAP_STARS, formatLy } from './mapData.ts';
import { mapIcon } from './mapIcons.ts';
import { searchSystems, type SearchKind } from './mapSearch.ts';
import { findRoute } from './routing.ts';
import type { MapMission, MapState } from './types.ts';

export interface MapDialog {
  readonly el: HTMLElement;
  close(): void;
}

export interface PickerContext {
  /** The map layer the dialog lies over. */
  host: HTMLElement;
  state: MapState;
  /** Status marks for a system (you are here, objective, contract, news, visited). */
  marks(id: SystemId): Node[];
  /** A system was chosen (after the dialog has closed). */
  onPick(id: SystemId): void;
  /** The dialog closed, with or without a choice. */
  onClose(): void;
}

let uid = 0;

const STAR_COLORS = new Map<SystemId, string>();
for (const s of MAP_STARS) if (!STAR_COLORS.has(s.systemId)) STAR_COLORS.set(s.systemId, s.colorHex);

const KIND_WORDS: Record<Exclude<SearchKind, 'system'>, string> = {
  star: 'Star',
  planet: 'Planet',
  moon: 'Moon',
  station: 'Station',
  belt: 'Belt',
  catalogue: 'Also known as',
};

/** Systems nearest `from` (not counting it) when nothing has been typed yet. */
const NEAREST_COUNT = 8;

function dot(id: SystemId): HTMLElement {
  return h('span', { class: 'gmap-sys-dot', style: `--star: ${STAR_COLORS.get(id) ?? '#fff1d6'}`, 'aria-hidden': 'true' });
}

function lyBetween(a: SystemId, b: SystemId): number {
  const p = getSystem(a).positionLy;
  const q = getSystem(b).positionLy;
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

function fromHere(state: MapState, id: SystemId): string {
  return id === state.currentSystemId ? 'You are here' : `${formatLy(lyBetween(state.currentSystemId, id), 1)} from here`;
}

/** `text` with the matched part marked. */
function highlight(text: string, range: [number, number] | null): Child {
  if (!range || range[1] <= range[0]) return text;
  return [text.slice(0, range[0]), h('mark', null, text.slice(range[0], range[1])), text.slice(range[1])];
}

interface Shell {
  backdrop: HTMLElement;
  body: HTMLElement;
  titleId: string;
  finish(picked: SystemId | null): void;
}

/** Backdrop, dialog, title bar with a close button; Escape and a tap outside close it; Tab stays inside. */
function shell(ctx: PickerContext, title: string, testId: string): Shell {
  const id = `gmap-dialog-${++uid}`;
  const body = h('div', { class: 'gmap-dialog-body' });
  const closeButton = h(
    'button',
    { type: 'button', class: 'btn gmap-dialog-close', 'aria-label': 'Close', title: 'Close', 'data-testid': `${testId}-close` },
    icon('close'),
  );
  const dialog = h(
    'div',
    { class: 'gmap-dialog panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${id}-title` },
    h('header', { class: 'gmap-dialog-head' }, h('h2', { class: 'gmap-dialog-title', id: `${id}-title` }, title), closeButton),
    body,
  );
  const backdrop = h('div', { class: 'gmap-dialog-backdrop', 'data-testid': testId }, dialog);

  // Keep the dialog above an on-screen keyboard: fit the backdrop to the visual viewport.
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const fit = () => {
    if (!vv) return;
    const hostHeight = ctx.host.clientHeight;
    if (!(hostHeight > 0) || vv.height >= hostHeight - 1) {
      backdrop.style.removeProperty('top');
      backdrop.style.removeProperty('height');
      return;
    }
    backdrop.style.top = `${Math.max(0, vv.offsetTop)}px`;
    backdrop.style.height = `${vv.height}px`;
  };
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);

  let open = true;
  const finish = (picked: SystemId | null) => {
    if (!open) return;
    open = false;
    vv?.removeEventListener('resize', fit);
    vv?.removeEventListener('scroll', fit);
    backdrop.remove();
    ctx.onClose();
    if (picked) ctx.onPick(picked);
  };
  closeButton.addEventListener('click', () => finish(null));
  // A tap on the dimmed area closes it (only when the press also began there: not the end of a drag).
  let downOnBackdrop = false;
  backdrop.addEventListener('pointerdown', (e) => {
    downOnBackdrop = e.target === backdrop;
  });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && downOnBackdrop) finish(null);
    downOnBackdrop = false;
  });
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    } else if (e.key === 'Tab') {
      const focusables = [...dialog.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]:not([tabindex="-1"])')].filter(
        (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
      );
      if (!focusables.length) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  ctx.host.appendChild(backdrop);
  fit();
  return { backdrop, body, titleId: `${id}-title`, finish };
}

// ---------- Find a system ----------

export function openSearchDialog(ctx: PickerContext): MapDialog {
  const s = shell(ctx, 'Find a system', 'map-search-dialog');
  const listId = `${s.titleId}-list`;
  const input = h('input', {
    type: 'search',
    class: 'gmap-search-input',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'true',
    'aria-controls': listId,
    'aria-label': 'Name of a system, star, planet or station',
    placeholder: 'System, star, planet or station',
    autocomplete: 'off',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
    'data-testid': 'map-search-input',
  });
  const status = h('p', { class: 'gmap-dialog-note', role: 'status', 'aria-live': 'polite' });
  const list = h('ul', { class: 'gmap-results scroll', role: 'listbox', id: listId, 'aria-label': 'Systems' });
  s.body.append(h('label', { class: 'gmap-search-field' }, mapIcon('search'), input), status, list);

  let rows: { id: SystemId; el: HTMLElement }[] = [];
  let active = -1;
  const setActive = (i: number) => {
    active = i;
    rows.forEach((r, j) => r.el.setAttribute('aria-selected', j === i ? 'true' : 'false'));
    const row = rows[i];
    if (row) {
      input.setAttribute('aria-activedescendant', row.el.id);
      row.el.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };

  const render = () => {
    const query = input.value.trim();
    const state = ctx.state;
    const here = state.currentSystemId;
    const hits = query
      ? searchSystems(query, { near: here })
      : MAP_SYSTEMS.filter((sys) => sys.id !== here)
          .map((sys) => ({ sys, ly: lyBetween(here, sys.id) }))
          .sort((a, b) => a.ly - b.ly)
          .slice(0, NEAREST_COUNT)
          .map(({ sys }) => ({ systemId: sys.id, name: sys.displayName, kind: 'system' as const, range: null }));
    rows = hits.map((hit, i) => {
      const sys = getSystem(hit.systemId);
      const own = hit.kind === 'system';
      const el = h(
        'li',
        {
          id: `${listId}-${i}`,
          class: 'gmap-result',
          role: 'option',
          'aria-selected': 'false',
          'data-system-id': hit.systemId,
          'data-testid': `map-search-result-${hit.systemId}`,
        },
        dot(hit.systemId),
        h(
          'span',
          { class: 'gmap-result-text' },
          h('span', { class: 'gmap-result-name' }, own ? highlight(sys.displayName, hit.range) : sys.displayName),
          h(
            'span',
            { class: 'gmap-result-sub' },
            own ? null : [`${KIND_WORDS[hit.kind as Exclude<SearchKind, 'system'>]} `, h('span', { class: 'gmap-result-match' }, highlight(hit.name, hit.range)), ' · '],
            fromHere(state, hit.systemId),
          ),
        ),
        h('span', { class: 'gmap-result-marks' }, ctx.marks(hit.systemId)),
      );
      // Keep focus (and a phone's keyboard) on the field until the choice is made.
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('click', () => s.finish(hit.systemId));
      return { id: hit.systemId, el };
    });
    list.replaceChildren(...rows.map((r) => r.el));
    status.textContent = !query
      ? 'Nearest systems. Type to search every system, star, planet and station.'
      : rows.length
        ? `${rows.length === 1 ? '1 system' : `${rows.length} systems`} found.`
        : `Nothing called “${query}” on the map.`;
    setActive(query && rows.length ? 0 : -1);
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && rows.length) {
      e.preventDefault();
      setActive(Math.min(rows.length - 1, active + 1));
    } else if (e.key === 'ArrowUp' && rows.length) {
      e.preventDefault();
      setActive(Math.max(0, active - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[active];
      if (row) s.finish(row.id);
    }
  });
  render();
  input.focus({ preventScroll: true });
  return { el: s.backdrop, close: () => s.finish(null) };
}

// ---------- Missions ----------

export interface MissionSystem {
  systemId: SystemId;
  missions: MapMission[];
  /** Holds the objective the flight view tracks. */
  primary: boolean;
  /** Jumps from here over lanes the ship can take: 0 here, null when none leads there. */
  jumps: number | null;
}

/** The systems active missions send the player to: the tracked objective first, then the nearest by jumps. */
export function missionSystems(state: Pick<MapState, 'missions' | 'currentSystemId' | 'jumpReach'>): MissionSystem[] {
  const bySystem = new Map<SystemId, MissionSystem>();
  for (const m of state.missions ?? []) {
    let g = bySystem.get(m.systemId);
    if (!g) {
      const route = m.systemId === state.currentSystemId ? null : findRoute(MAP_SYSTEMS, state.currentSystemId, m.systemId, { canTake: laneTaker(state.jumpReach ?? 0) });
      g = { systemId: m.systemId, missions: [], primary: false, jumps: m.systemId === state.currentSystemId ? 0 : route && route.hops.length ? route.hops.length : null };
      bySystem.set(m.systemId, g);
    }
    g.missions.push(m);
    g.primary ||= m.primary;
  }
  const order = (g: MissionSystem) => (g.primary ? -1 : (g.jumps ?? 1e6));
  return [...bySystem.values()].sort((a, b) => order(a) - order(b) || getSystem(a.systemId).displayName.localeCompare(getSystem(b.systemId).displayName));
}

function jumpsText(state: MapState, g: MissionSystem): string {
  if (g.jumps === 0) return 'You are here';
  const ly = formatLy(lyBetween(state.currentSystemId, g.systemId), 1);
  if (g.jumps === null) return `${ly} · no route your drive can take`;
  return `${g.jumps === 1 ? '1 jump' : `${g.jumps} jumps`} · ${ly}`;
}

export function openMissionsDialog(ctx: PickerContext): MapDialog {
  const s = shell(ctx, 'Missions', 'map-missions-dialog');
  const groups = missionSystems(ctx.state);
  if (!groups.length) {
    s.body.append(
      h('p', { class: 'gmap-dialog-empty', 'data-testid': 'map-missions-empty' }, 'No active missions. Check the job board in a station bar.'),
    );
    s.backdrop.querySelector<HTMLElement>('.gmap-dialog-close')?.focus({ preventScroll: true });
    return { el: s.backdrop, close: () => s.finish(null) };
  }
  const buttons = groups.map((g) => {
    const sys = getSystem(g.systemId);
    return h(
      'li',
      null,
      h(
        'button',
        {
          type: 'button',
          class: `gmap-result gmap-mission-row${g.primary ? ' is-primary' : ''}`,
          'data-system-id': g.systemId,
          'data-testid': `map-mission-${g.systemId}`,
          onClick: () => s.finish(g.systemId),
        },
        dot(g.systemId),
        h(
          'span',
          { class: 'gmap-result-text' },
          h('span', { class: 'gmap-result-name' }, sys.displayName),
          h('span', { class: 'gmap-result-sub' }, jumpsText(ctx.state, g)),
          g.missions.map((m) =>
            h('span', { class: 'gmap-mission' }, h('span', { class: 'gmap-mission-title' }, m.primary ? icon('objective') : null, m.title), h('span', { class: 'gmap-mission-step' }, m.step)),
          ),
        ),
        h('span', { class: 'gmap-result-marks' }, ctx.marks(g.systemId)),
      ),
    );
  });
  s.body.append(
    h('p', { class: 'gmap-dialog-note' }, 'Where your missions send you next. Choose one to find it on the map.'),
    h('ul', { class: 'gmap-results scroll', 'data-testid': 'map-missions-list' }, buttons),
  );
  s.backdrop.querySelector<HTMLElement>('.gmap-mission-row')?.focus({ preventScroll: true });
  return { el: s.backdrop, close: () => s.finish(null) };
}
