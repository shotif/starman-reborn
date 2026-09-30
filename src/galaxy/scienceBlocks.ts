/**
 * DOM building blocks for observed / illustrated / fictional content, shared by the map info card
 * and the "About the science" encyclopedia. Every observed value carries a source link; values
 * from provisional records carry a "Pending verification" badge; fiction carries a fiction badge.
 */
import '../ui/styles/encyclopedia.css';
import { formatDec, formatRa } from '../data/coords.ts';
import { EXOPLANETS, SOLAR_BODIES, WORLD, componentsOf, getComponent } from '../data/systems.ts';
import { trafficFor } from '../world/traffic/setup.ts';
import { COMMODITIES } from '../economy/commodities.ts';
import { marketTables } from '../economy/markets.ts';
import type {
  ConfirmedBody,
  FictionalLocation,
  StarSystemRecord,
  StellarComponent,
  SystemId,
  Verification,
} from '../data/types.ts';
import { dataBadge, sourceLink } from '../ui/components.ts';
import { h, type Child } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { formatHeightLong, formatLy } from './mapData.ts';
import {
  FACTION_NAMES,
  LOCATION_KIND_LABELS,
  SERVICE_LABELS,
  allCatalogIds,
  capitalize,
  formatDistanceWithError,
  formatEpoch,
  formatParallax,
  planetMeasurements,
  primaryCatalogId,
  roleNote,
} from './mapText.ts';

export type Detail = 'compact' | 'full';

/** "Pending verification" badge for provisional records, or a retrieval note for snapshots. */
export function verificationMark(v: Verification, retrieved?: string | null): HTMLElement | null {
  if (v === 'provisional') return dataBadge('provisional');
  return retrieved ? h('span', { class: 'sci-retrieved' }, `Retrieved ${retrieved}`) : null;
}

export function tag(kind: 'discovered' | 'disputed' | 'functional' | 'planned', text?: string): HTMLSpanElement {
  const spec = {
    discovered: { cls: 'sci-tag sci-tag-discovered', ic: icon('scan'), label: 'Discovered', title: 'You scanned this planet in flight' },
    disputed: {
      cls: 'sci-tag sci-tag-disputed',
      ic: icon('alert'),
      label: 'Disputed',
      title: 'The archive flags this planet as controversial',
    },
    functional: { cls: 'sci-tag sci-tag-open', ic: null, label: 'Open', title: 'Open to traffic (fiction)' },
    planned: { cls: 'sci-tag sci-tag-planned', ic: null, label: 'Planned', title: 'Not yet open (fiction)' },
  }[kind];
  return h('span', { class: spec.cls, title: spec.title }, spec.ic, text ?? spec.label);
}

/** Heading with a data-class badge (and optional extra marks). */
export function badgeHeading(
  level: 'h3' | 'h4',
  text: string,
  kind: 'observed' | 'estimated' | 'fictional' | null,
  id?: string,
  ...extra: Child[]
): HTMLElement {
  return h(level, { class: 'sci-heading', id }, h('span', null, text), kind ? dataBadge(kind) : null, extra);
}

// ---------- Position ----------

/** Observed position of a system's reference star (distance, RA/Dec, epoch, frame, catalog). */
export function positionList(system: StarSystemRecord, detail: Detail): HTMLElement {
  if (system.id === 'sol') {
    return h(
      'dl',
      { class: 'kv sci-kv' },
      h('dt', null, 'Distance from Sol'),
      h('dd', null, '0 ly — the Sun is the origin of the map.'),
      h('dt', null, 'RA / Dec'),
      h('dd', null, 'Not applicable: coordinates are measured from the Solar System.'),
    );
  }
  const ref = componentsOf(system.id).find((c) => c.role === 'primary') ?? componentsOf(system.id)[0]!;
  const rows: Child[] = [
    h('dt', null, 'Distance from Sol'),
    h(
      'dd',
      null,
      h('span', { class: 'num' }, formatDistanceWithError(ref.distanceLightYears, ref.distanceErrorLightYears)),
      ' ',
      sourceLink(ref.parallaxSource),
    ),
    h('dt', null, 'RA / Dec'),
    h(
      'dd',
      null,
      h('span', { class: 'num' }, `${formatRa(ref.raDegrees)}, ${formatDec(ref.decDegrees)}`),
      ' ',
      sourceLink(ref.astrometrySource),
    ),
    h('dt', null, 'Epoch · frame'),
    h('dd', null, `${formatEpoch(ref.referenceEpoch)} · ${ref.frame}`),
    h('dt', null, 'Catalog'),
    h('dd', null, primaryCatalogId(ref)),
  ];
  if (detail === 'full') {
    rows.push(
      h('dt', null, 'Parallax'),
      h('dd', null, h('span', { class: 'num' }, formatParallax(ref)), ' ', sourceLink(ref.parallaxSource)),
      h('dt', null, 'Map position'),
      h(
        'dd',
        null,
        h('span', { class: 'num' }, `x ${ref.positionLy[0].toFixed(2)}, y ${ref.positionLy[1].toFixed(2)}, z ${ref.positionLy[2].toFixed(2)} ly`),
        h('span', { class: 'sci-note' }, ` (derived; ${formatHeightLong(ref.positionLy[2])})`),
      ),
    );
  }
  return h('dl', { class: 'kv sci-kv' }, rows);
}

// ---------- Stars ----------

function componentItem(c: StellarComponent, detail: Detail): HTMLLIElement {
  const lines: Child[] = [
    h(
      'div',
      { class: 'sci-item-head' },
      h('strong', null, c.name),
      ' ',
      h('span', { class: 'sci-chip num', title: 'Spectral type' }, c.spectralType),
      ' ',
      h('span', { class: 'num' }, formatLy(c.distanceLightYears)),
    ),
    h('p', { class: 'sci-item-text' }, roleNote(c)),
  ];
  if (detail === 'full') {
    lines.push(
      h(
        'dl',
        { class: 'kv sci-kv' },
        h('dt', null, 'Distance'),
        h(
          'dd',
          null,
          h('span', { class: 'num' }, formatDistanceWithError(c.distanceLightYears, c.distanceErrorLightYears)),
          ' ',
          sourceLink(c.parallaxSource),
        ),
        h('dt', null, 'Parallax'),
        h('dd', null, h('span', { class: 'num' }, formatParallax(c))),
        h('dt', null, 'RA / Dec'),
        h(
          'dd',
          null,
          h('span', { class: 'num' }, `${formatRa(c.raDegrees)}, ${formatDec(c.decDegrees)}`),
          ` (${formatEpoch(c.referenceEpoch)}, ${c.frame}) `,
          sourceLink(c.astrometrySource),
        ),
        h('dt', null, 'Spectral type'),
        h('dd', null, c.spectralType, ' ', sourceLink(c.spectralTypeSource)),
        h('dt', null, 'Catalog IDs'),
        h('dd', null, allCatalogIds(c).join(' · ')),
      ),
    );
    if (c.positionNote) lines.push(h('p', { class: 'sci-note' }, c.positionNote));
  } else {
    lines.push(h('p', { class: 'sci-item-src' }, 'Spectral type: ', sourceLink(c.spectralTypeSource)));
  }
  return h('li', { class: 'sci-item' }, lines);
}

export function componentList(systemId: SystemId, detail: Detail): HTMLElement {
  if (systemId === 'sol') {
    const sun = SOLAR_BODIES.find((b) => b.id === 'sun')!;
    return h(
      'ul',
      { class: 'sci-list' },
      h(
        'li',
        { class: 'sci-item' },
        h('div', { class: 'sci-item-head' }, h('strong', null, 'Sun'), ' ', h('span', { class: 'sci-chip' }, 'star')),
        h('p', { class: 'sci-item-text' }, 'The star at the centre of the Solar System. ', sourceLink(sun.source)),
      ),
    );
  }
  return h('ul', { class: 'sci-list' }, componentsOf(systemId).map((c) => componentItem(c, detail)));
}

// ---------- Planets ----------

function planetItem(p: ConfirmedBody, discovered: ReadonlySet<string>, detail: Detail): HTMLLIElement {
  const host = getComponent(p.hostId);
  const measurements = planetMeasurements(p);
  const facts: Child[] = [
    h('dt', null, 'Status'),
    h('dd', null, dataBadge('observed', 'Confirmed'), p.controversial ? [' ', tag('disputed')] : null),
    h('dt', null, 'Host star'),
    h('dd', null, host?.name ?? p.hostId),
    h('dt', null, 'Archive name'),
    h('dd', null, p.archiveName, ' ', sourceLink({ label: EXOPLANETS.source.label, url: p.sourceUrl })),
    h('dt', null, 'As of'),
    h('dd', null, p.asOfDate),
  ];
  if (p.discoveryYear || p.discoveryMethod) {
    facts.push(
      h('dt', null, 'Discovery'),
      h('dd', null, [p.discoveryYear, p.discoveryMethod ? p.discoveryMethod.toLowerCase() : null].filter(Boolean).join(', ')),
    );
  }
  for (const [label, value] of measurements) facts.push(h('dt', null, label), h('dd', { class: 'num' }, value));
  for (const unknown of p.unknowns) facts.push(h('dt', null, capitalize(unknown)), h('dd', { class: 'sci-unknown' }, 'Unknown'));
  return h(
    'li',
    { class: 'sci-item' },
    h(
      'div',
      { class: 'sci-item-head' },
      h('strong', null, p.displayName),
      discovered.has(p.id) ? [' ', tag('discovered')] : null,
    ),
    h('dl', { class: `kv sci-kv${detail === 'compact' ? ' sci-kv-compact' : ''}` }, facts),
  );
}

/** Confirmed planets of a system, plus explicit "none listed" notes for stars without any. */
export function planetBlock(system: StarSystemRecord, discovered: ReadonlySet<string>, detail: Detail): HTMLElement {
  const wrap = h('div', { class: 'sci-planets' });
  if (system.id === 'sol') {
    wrap.append(solarBodyList());
    return wrap;
  }
  if (system.confirmedBodies.length) {
    wrap.append(h('ul', { class: 'sci-list' }, system.confirmedBodies.map((p) => planetItem(p, discovered, detail))));
  }
  const hostsWithout = componentsOf(system.id).filter((c) => !system.confirmedBodies.some((p) => p.hostId === c.id));
  if (hostsWithout.length) {
    wrap.append(
      h(
        'p',
        { class: 'sci-note' },
        `No confirmed planets around ${hostsWithout.map((c) => c.name).join(' or ')} in the bundled ${EXOPLANETS.source.label} list. `,
        sourceLink(EXOPLANETS.source),
      ),
    );
  }
  if (system.confirmedBodies.some((p) => p.verification === 'provisional')) {
    wrap.append(
      h(
        'p',
        { class: 'sci-note' },
        dataBadge('provisional'),
        ' Planet names and status were transcribed from the archive; measured values are added when a dated archive snapshot replaces them. Values not measured are shown as Unknown.',
      ),
    );
  }
  return wrap;
}

export function solarBodyList(): HTMLElement {
  const planets = SOLAR_BODIES.filter((b) => b.kind !== 'star' && b.kind !== 'moon').sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const moon = SOLAR_BODIES.find((b) => b.kind === 'moon');
  return h(
    'div',
    { class: 'sci-solar' },
    h(
      'ol',
      { class: 'sci-solar-list' },
      planets.map((p) => h('li', null, h('strong', null, p.name), h('span', { class: 'sci-chip' }, p.kind))),
    ),
    h(
      'p',
      { class: 'sci-note' },
      `The ${planets.length} planets in order from the Sun${moon ? `; Earth’s ${moon.name} also appears in flight` : ''}. `,
      sourceLink(planets[0]!.source),
      moon ? [' ', sourceLink(moon.source)] : null,
    ),
    h('p', { class: 'sci-note' }, dataBadge('estimated'), ' Positions, sizes and orbital spacing in flight are schematic.'),
  );
}

// ---------- Facts ----------

export function factList(system: StarSystemRecord): HTMLElement {
  return h(
    'ul',
    { class: 'sci-list sci-facts' },
    system.scienceFacts.map((f) =>
      h('li', { class: 'sci-fact' }, dataBadge(f.dataClass), ' ', h('span', null, f.text), ' ', sourceLink(f.source)),
    ),
  );
}

// ---------- Fiction ----------

export function locationList(locations: readonly FictionalLocation[], detail: Detail): HTMLElement {
  return h(
    'ul',
    { class: 'sci-list' },
    locations.map((l) =>
      h(
        'li',
        { class: 'sci-item' },
        h(
          'div',
          { class: 'sci-item-head' },
          h('strong', null, l.name),
          ' ',
          dataBadge('fictional'),
          ' ',
          tag(l.status === 'functional' ? 'functional' : 'planned'),
        ),
        h(
          'p',
          { class: 'sci-item-text' },
          [l.dockable === false ? 'Raider hideout, closed to lawful pilots' : LOCATION_KIND_LABELS[l.kind], l.factionId ? FACTION_NAMES[l.factionId] : null].filter(Boolean).join(' · '),
        ),
        tradeLine(l.id, detail),
        detail === 'full' || l.status === 'planned' ? h('p', { class: 'sci-item-text muted' }, l.description) : null,
        detail === 'full' && l.services.length
          ? h('p', { class: 'sci-item-text muted' }, `Services: ${l.services.map((s) => SERVICE_LABELS[s]).join(', ')}`)
          : null,
      ),
    ),
  );
}

/** How safe a system is: patrol level, owner and the raider threat (fiction, from the world generator). */
export function securityNote(systemId: string): HTMLElement | null {
  const p = WORLD.profiles.get(systemId);
  if (!p) return null;
  const packs = trafficFor(systemId, 'high').plan.packs;
  const label = p.security >= 0.75 ? 'Secure' : p.security >= 0.55 ? 'Patrolled' : p.security >= 0.35 ? 'Thinly patrolled' : 'Lawless';
  const owner = p.owner ? FACTION_NAMES[p.owner] : 'Unclaimed';
  const threat = packs ? `raider packs, threat ${packs.level} of 3` : 'no raider packs';
  return h('p', { class: `sci-item-text security security-${packs ? `threat-${packs.level}` : 'safe'}`, 'data-testid': 'security-note' }, `${label} · ${owner} · ${threat}`);
}

/** "Makes metals, deuterium · wants ore, water" from the station's market (public knowledge, no prices). */
function tradeLine(locationId: string, detail: Detail): HTMLElement | null {
  const market = marketTables().get(locationId);
  if (!market) return null;
  const names = (role: 'produce' | 'consume') => {
    const list = [...market.entries.values()].filter((e) => e.role === role).map((e) => COMMODITIES[e.commodity].name.toLowerCase());
    return detail === 'compact' && list.length > 3 ? `${list.slice(0, 3).join(', ')}…` : list.join(', ');
  };
  const makes = names('produce');
  const wants = names('consume');
  const parts = [makes ? `Makes ${makes}` : null, wants ? `${makes ? 'wants' : 'Wants'} ${wants}` : null].filter(Boolean);
  return parts.length ? h('p', { class: 'sci-item-text muted' }, parts.join(' · ')) : null;
}

/**
 * Mark for a section of observed values: a "Pending verification" badge when any record in it is
 * provisional, otherwise the snapshot retrieval date (null for Sol, which has no catalog records).
 */
export function observedMark(system: StarSystemRecord, part: 'stars' | 'planets' | 'all'): HTMLElement | null {
  const stars = part === 'planets' ? [] : componentsOf(system.id);
  const planets = part === 'stars' ? [] : system.confirmedBodies;
  if (stars.some((c) => c.verification === 'provisional') || planets.some((p) => p.verification === 'provisional')) {
    return dataBadge('provisional');
  }
  const retrieved = stars.find((c) => c.astrometrySource.retrieved)?.astrometrySource.retrieved;
  return retrieved ? verificationMark('snapshot', retrieved) : null;
}
