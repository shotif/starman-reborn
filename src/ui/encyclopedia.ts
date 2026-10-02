/**
 * "About the science": a full-screen, keyboard-accessible reference panel that explains what in
 * the game is observed, illustrated or fictional, per star system, with sources and data status.
 * Pure DOM (usable from the title screen, in flight and without WebGL).
 */
import './styles/encyclopedia.css';
import { LY_PER_PARSEC } from '../data/coords.ts';
import { SOURCES } from '../data/sources.ts';
import { ASTROMETRY, BELTS, EXOPLANETS, FAR_STARS, SYSTEMS, beltsOf, getSystem, hasProvisionalData, saveLocations } from '../data/systems.ts';
import type { SourceRef, StarSystemRecord, SystemId } from '../data/types.ts';
import { MAP_LINKS, formatLy } from '../galaxy/mapData.ts';
import { MAP_LEGEND_TEXT, formatDistanceWithError, formatEpoch } from '../galaxy/mapText.ts';
import { STELLAR } from '../content/stellar/rules.ts';
import { magnitudeText, peakMagnitude } from '../economy/stellar.ts';
import {
  badgeHeading,
  beltBlock,
  componentList,
  factList,
  locationList,
  planetBlock,
  positionList,
  observedMark,
  securityNote,
} from '../galaxy/scienceBlocks.ts';
import { button, dataBadge, sourceLink } from './components.ts';
import { h, type Child } from './dom.ts';
import { codexEntries } from '../economy/progress.ts';

export interface EncyclopediaOptions {
  discoveredBodies: ReadonlySet<string>;
  /** The player's codex (docs/PROCGEN.md §13): bodies scanned, shown as progress per system. */
  catalogued?: ReadonlySet<string>;
  /** Section to open at; the introduction when omitted. */
  initialSystemId?: SystemId;
  /** Runs when the player closes the panel (button or Esc). Not called by the returned close(). */
  onClose: () => void;
}

let instances = 0;

function introSection(id: string): HTMLElement {
  const provisional = hasProvisionalData();
  return h(
    'section',
    { class: 'enc-section', id, 'aria-labelledby': `${id}-h` },
    h('h3', { id: `${id}-h`, tabindex: '-1' }, 'How to read this'),
    h(
      'p',
      null,
      'Starman Reborn is set among real stars near the Sun: Sol, Alpha Centauri, Barnard’s Star, Sirius and Epsilon Eridani. Everything the game shows about them is one of three kinds, and each is labelled:',
    ),
    h(
      'ul',
      { class: 'enc-classes' },
      h(
        'li',
        null,
        dataBadge('observed'),
        h(
          'p',
          null,
          'Real astronomical data: star names, distances from the Sun, positions (with their source, frame and epoch), companion stars, and planets that the cited archive lists as confirmed. Each value has a small source link.',
        ),
      ),
      h(
        'li',
        null,
        dataBadge('estimated'),
        h(
          'p',
          null,
          'Artist’s impressions and schematic depictions where measurements are incomplete: star colours and glow sizes, planet globes and surfaces, orbits, and where bodies sit in flight. These are not photographs or measurements.',
        ),
      ),
      h(
        'li',
        null,
        dataBadge('fictional'),
        h(
          'p',
          null,
          'Game content: stations (including planned ones), factions, jump links, jump fees, transit times and the compressed scale inside each system.',
        ),
      ),
      provisional
        ? h(
            'li',
            null,
            dataBadge('provisional'),
            h(
              'p',
              null,
              'Values transcribed from the cited catalogs that have not yet been checked against a dated archive snapshot. See Data and sources.',
            ),
          )
        : null,
    ),
    h(
      'p',
      null,
      'Properties nobody has measured, such as a planet’s surface, atmosphere or habitability, are shown as Unknown rather than invented.',
    ),
    h('p', { class: 'enc-legend' }, MAP_LEGEND_TEXT),
  );
}

function jumpLinkList(system: StarSystemRecord): HTMLElement {
  const links = MAP_LINKS.filter((l) => l.a === system.id || l.b === system.id);
  return h(
    'p',
    { class: 'sci-note' },
    'Jump links ',
    dataBadge('fictional'),
    ': ',
    links
      .map((l) => {
        const other = getSystem(l.a === system.id ? l.b : l.a);
        return `${other.displayName} (${formatLy(l.distanceLy)}, real distance)`;
      })
      .join(', '),
    '.',
  );
}

/** Codex progress for a system: which of its catalogued bodies the player has scanned. */
function codexLine(systemId: SystemId, catalogued: ReadonlySet<string> | undefined): HTMLElement | null {
  if (!catalogued) return null;
  const here = codexEntries().filter((e) => e.systemId === systemId);
  const done = here.filter((e) => catalogued.has(e.id));
  const complete = done.length === here.length;
  return h(
    'p',
    { class: `enc-codex${complete ? ' complete' : ''}`, 'data-testid': `codex-${systemId}` },
    h('strong', null, complete ? 'Codex complete: ' : `Codex ${done.length}/${here.length}: `),
    here.map((e) => `${catalogued.has(e.id) ? '✓' : '·'} ${e.name}`).join('  '),
  );
}

function systemSection(system: StarSystemRecord, id: string, discovered: ReadonlySet<string>, catalogued?: ReadonlySet<string>): HTMLElement {
  const isSol = system.id === 'sol';
  return h(
    'section',
    { class: 'enc-section', id, 'aria-labelledby': `${id}-h`, 'data-system-id': system.id },
    h('h3', { id: `${id}-h`, tabindex: '-1' }, isSol ? 'Sol: the Solar System' : system.displayName),
    h('p', { class: 'enc-summary' }, system.summary),
    codexLine(system.id, catalogued),
    badgeHeading('h4', 'Position and distance', 'observed', undefined, observedMark(system, 'stars')),
    positionList(system, 'full'),
    badgeHeading('h4', isSol ? 'The Sun' : 'Stars', 'observed', undefined, observedMark(system, 'stars')),
    componentList(system.id, 'full'),
    badgeHeading('h4', isSol ? 'Planets' : 'Confirmed planets', 'observed', undefined, observedMark(system, 'planets')),
    planetBlock(system, discovered, 'full'),
    beltsOf(system.id).length ? [badgeHeading('h4', 'Belts and debris discs', 'observed'), beltBlock(system.id, 'full')] : null,
    h('h4', { class: 'sci-heading' }, 'Science notes'),
    factList(system),
    badgeHeading('h4', 'In the game', 'fictional'),
    h('p', null, system.fiction),
    securityNote(system.id),
    locationList([...system.fictionalLocations, ...saveLocations(system.id)], 'full'),
    jumpLinkList(system),
  );
}

function uniqueSources(): SourceRef[] {
  const out: SourceRef[] = [];
  const seen = new Set<string>();
  const add = (s: SourceRef) => {
    const key = `${s.label}|${s.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  for (const s of Object.values(SOURCES)) add(s);
  add(EXOPLANETS.source);
  for (const c of ASTROMETRY.stars) {
    add(c.parallaxSource);
    add(c.astrometrySource);
  }
  for (const b of BELTS) for (const s of b.sources) add(s);
  return out;
}

/** Notes about special handling derived from the dataset (shared parallaxes, position notes). */
function handlingNotes(): Child[] {
  const notes: Child[] = [];
  const byParallax = new Map<string, string[]>();
  for (const c of ASTROMETRY.stars) {
    const key = `${c.parallaxMas}|${c.parallaxSource.label}`;
    byParallax.set(key, [...(byParallax.get(key) ?? []), c.name]);
  }
  for (const [key, names] of byParallax) {
    if (names.length < 2) continue;
    notes.push(h('li', null, `${names.join(' and ')} share one parallax measurement, from ${key.split('|')[1]}.`));
  }
  for (const c of ASTROMETRY.stars) if (c.positionNote) notes.push(h('li', null, c.positionNote));
  return notes;
}

/**
 * The far stars beyond the map (docs/ASTRONOMY_SOURCES.md, *Far stars*): their catalogue values,
 * cited, and what the game makes of them, marked as fiction (docs/PROCGEN.md §25).
 */
function farStarsSection(id: string): HTMLElement {
  return h(
    'section',
    { class: 'enc-section', id, 'aria-labelledby': `${id}-h`, 'data-testid': 'enc-far-stars' },
    h('h3', { id: `${id}-h`, tabindex: '-1' }, 'Far stars'),
    h('p', null, 'Two red supergiants far beyond the map, seen in every system’s sky in their true direction. Massive stars like these end as supernovae, or perhaps collapse straight into black holes.'),
    FAR_STARS.stars.map((f) =>
      h(
        'div',
        { class: 'enc-far-star' },
        h('h4', null, `${f.name} (${f.designation}) `, dataBadge(f.verification === 'provisional' ? 'provisional' : 'observed')),
        h(
          'dl',
          { class: 'kv' },
          h('dt', null, 'Spectral type'),
          h('dd', null, f.spectralType, ' ', sourceLink(f.spectralTypeSource)),
          h('dt', null, 'Distance'),
          h('dd', null, formatDistanceWithError(f.distanceLightYears, f.distanceErrorLightYears), ' ', sourceLink(f.parallaxSource)),
          h('dt', null, 'Brightness'),
          h('dd', null, `Visual magnitude ${f.magnitudeV.toFixed(2)} from the Sun`, ' ', sourceLink(f.magnitudeSource)),
        ),
        h(
          'p',
          null,
          dataBadge('fictional'),
          ' ',
          f.id === STELLAR.supernova.star
            ? `In this game, ${f.name} explodes as a supernova, rising to magnitude ${magnitudeText(peakMagnitude(f))}: a typical Type II-P supernova’s peak (Richardson et al. 2014) at its real distance. In reality it has not exploded.`
            : `In this game, ${f.name} collapses into a black hole without exploding and goes out. In reality it shines on.`,
        ),
      ),
    ),
  );
}

function dataSection(id: string): HTMLElement {
  const provisional = hasProvisionalData();
  const epochs = [...new Set(ASTROMETRY.stars.map((s) => s.referenceEpoch))].map(formatEpoch).join(', ');
  return h(
    'section',
    { class: 'enc-section', id, 'aria-labelledby': `${id}-h` },
    h('h3', { id: `${id}-h`, tabindex: '-1' }, 'Data and sources'),
    provisional
      ? h(
          'div',
          { class: 'enc-callout', role: 'note' },
          dataBadge('provisional'),
          h(
            'p',
            null,
            h('strong', null, 'Pending verification. '),
            'Star positions, distances and the planet list in this build were transcribed from the cited catalogs and have not yet been checked against a dated, machine-retrieved archive snapshot. Every such value carries this badge until a snapshot replaces it.',
          ),
        )
      : null,
    h('h4', null, 'Dataset status'),
    h(
      'dl',
      { class: 'kv sci-kv' },
      h('dt', null, 'Star positions'),
      h(
        'dd',
        null,
        ASTROMETRY.verification === 'snapshot' ? `Archive snapshot retrieved ${ASTROMETRY.retrieved ?? 'unknown date'}` : 'Provisional transcription (no snapshot yet) ',
        ASTROMETRY.verification === 'provisional' ? dataBadge('provisional') : null,
      ),
      h('dt', null, 'Frame · epoch'),
      h('dd', null, `${ASTROMETRY.frame} · ${formatEpoch(ASTROMETRY.referenceEpoch)}`),
      h('dt', null, 'Planet list'),
      h(
        'dd',
        null,
        `${EXOPLANETS.verification === 'snapshot' ? 'Archive snapshot' : 'Provisional transcription'}, as of ${EXOPLANETS.asOfDate} `,
        EXOPLANETS.verification === 'provisional' ? dataBadge('provisional') : null,
        ' ',
        sourceLink(EXOPLANETS.source),
      ),
    ),
    h(
      'details',
      { class: 'enc-tech' },
      h('summary', null, 'Technical notes on the bundled files'),
      h('p', { class: 'sci-note' }, `Star positions: ${ASTROMETRY.description}`),
      h('p', { class: 'sci-note' }, `Planet list: ${EXOPLANETS.description}`),
    ),
    h('h4', null, 'How positions and distances are computed'),
    h(
      'ol',
      { class: 'enc-steps' },
      h(
        'li',
        null,
        `Distance from parallax: d = 1000 ÷ parallax (milliarcseconds) parsecs, and 1 parsec = ${LY_PER_PARSEC.toFixed(4)} light-years. The ± value is the one-sigma uncertainty carried over from the parallax error.`,
      ),
      h(
        'li',
        null,
        `Right ascension (α) and declination (δ) are ${ASTROMETRY.frame} coordinates, moved with each star’s proper motion from its catalog epoch to ${epochs}.`,
      ),
      h(
        'li',
        null,
        'With the Sun at the origin: x = d cos δ cos α, y = d cos δ sin α, z = d sin δ. The x axis points toward RA 0h, y toward RA 6h and z toward the north celestial pole.',
      ),
      h(
        'li',
        null,
        'The map’s grid is the celestial equator plane (z = 0), with rings every 2 light-years around the Sun; vertical lines show how far each star lies above or below it.',
      ),
      h('li', null, 'Route distances are straight lines between these positions.'),
    ),
    h('h4', null, 'Special cases'),
    h('ul', { class: 'enc-notes' }, handlingNotes()),
    h('h4', { class: 'sci-heading' }, 'What is illustrated ', dataBadge('estimated')),
    h(
      'p',
      null,
      'Star colours and glow sizes on the map are inspired by spectral type. Planet globes, surfaces, orbits and in-flight positions are artist’s impressions or schematic, never photographs or measurements. In flight, the Solar System’s planets lie in their real directions from the Sun on the game’s date (JPL’s approximate elements, valid 1800–2050), at compressed distances; Mars is kept within 140° of Earth so the lane between them never crosses the Sun.',
    ),
    h('h4', { class: 'sci-heading' }, 'What is fiction ', dataBadge('fictional')),
    h(
      'p',
      null,
      'Jump travel and its technology, jump links, fees, transit times, stations, factions and the scale inside each system are game fiction. Stations marked Planned are not yet open.',
    ),
    h('h4', null, 'Sources'),
    h(
      'ul',
      { class: 'enc-sources' },
      uniqueSources().map((s) => h('li', null, sourceLink(s), s.recordId ? h('span', { class: 'sci-note' }, ` ${s.recordId}`) : null)),
    ),
  );
}

export function openEncyclopedia(root: HTMLElement, opts: EncyclopediaOptions): { close(): void } {
  const uid = ++instances;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const ids = {
    title: `enc-${uid}-title`,
    intro: `enc-${uid}-intro`,
    data: `enc-${uid}-data`,
    far: `enc-${uid}-far`,
    system: (id: SystemId) => `enc-${uid}-${id}`,
  };
  const sections: { id: string; label: string }[] = [
    { id: ids.intro, label: 'How to read this' },
    ...SYSTEMS.map((s) => ({ id: ids.system(s.id), label: s.displayName })),
    { id: ids.far, label: 'Far stars' },
    { id: ids.data, label: 'Data and sources' },
  ];

  const body = h(
    'div',
    { class: 'enc-body scroll', tabindex: '-1' },
    introSection(ids.intro),
    SYSTEMS.map((s) => systemSection(s, ids.system(s.id), opts.discoveredBodies, opts.catalogued)),
    farStarsSection(ids.far),
    dataSection(ids.data),
  );
  const navButtons = new Map<string, HTMLButtonElement>();
  const nav = h(
    'nav',
    { class: 'enc-nav', 'aria-label': 'Encyclopedia sections' },
    h(
      'ul',
      { class: 'enc-nav-list' },
      sections.map((s) => {
        const b = h('button', { type: 'button', class: 'enc-nav-btn', 'aria-controls': s.id, onClick: () => goTo(s.id, true) }, s.label);
        navButtons.set(s.id, b);
        return h('li', null, b);
      }),
    ),
  );
  const closeButton = button('Close', {
    icon: 'close',
    ariaLabel: 'Close About the science',
    testId: 'encyclopedia-close',
    onClick: () => finish(true),
  });
  const title = h('h2', { id: ids.title, tabindex: '-1' }, 'About the science');
  const dialog = h(
    'div',
    { class: 'enc panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': ids.title },
    h('header', { class: 'enc-head' }, h('div', { class: 'enc-titles' }, h('p', { class: 'eyebrow' }, 'Encyclopedia'), title), closeButton),
    h('div', { class: 'enc-main' }, nav, body),
  );
  const backdrop = h('div', { class: 'enc-backdrop', 'data-testid': 'encyclopedia' }, dialog);

  const setCurrent = (id: string) => {
    for (const [sid, b] of navButtons) {
      if (sid === id) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
    navButtons.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const sectionEls = [...body.querySelectorAll<HTMLElement>('section.enc-section')];
  // While a nav jump scrolls smoothly, keep its target highlighted.
  let pinned: string | null = null;
  let pinnedUntil = 0;

  function goTo(id: string, smooth: boolean): void {
    const section = sectionEls.find((el) => el.id === id);
    if (!section) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    pinned = id;
    pinnedUntil = performance.now() + 800;
    // .enc-body is the offsetParent of its sections (position: relative).
    body.scrollTo({ top: section.offsetTop, behavior: smooth && !reduce ? 'smooth' : 'auto' });
    setCurrent(id);
    section.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
  }

  // Highlight the section being read: the last one whose top has scrolled past the top edge.
  let spyFrame = 0;
  const onScroll = () => {
    if (spyFrame) return;
    spyFrame = requestAnimationFrame(() => {
      spyFrame = 0;
      if (pinned && performance.now() < pinnedUntil) return;
      pinned = null;
      const y = body.scrollTop + 48;
      let current = sectionEls[0]!;
      for (const el of sectionEls) if (el.offsetTop <= y) current = el;
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) current = sectionEls[sectionEls.length - 1]!;
      setCurrent(current.id);
    });
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(true);
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = [
      ...dialog.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"]), summary'),
    ].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    if (!dialog.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  let open = true;
  function finish(userInitiated: boolean): void {
    if (!open) return;
    open = false;
    document.removeEventListener('keydown', onKey, true);
    body.removeEventListener('scroll', onScroll);
    if (spyFrame) cancelAnimationFrame(spyFrame);
    backdrop.remove();
    if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    if (userInitiated) opts.onClose();
  }

  document.addEventListener('keydown', onKey, true);
  root.appendChild(backdrop);
  body.addEventListener('scroll', onScroll, { passive: true });
  if (opts.initialSystemId) goTo(ids.system(opts.initialSystemId), false);
  else {
    setCurrent(ids.intro);
    title.focus({ preventScroll: true });
  }
  return { close: () => finish(false) };
}

