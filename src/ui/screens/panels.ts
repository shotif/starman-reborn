import type { Settings, SteeringMode } from '../../app/settings.ts';
import { TEXT_SCALES } from '../../app/settings.ts';
import { getComponent, getPlanet, SOLAR_BODIES } from '../../data/systems.ts';
import { formatDec, formatRa } from '../../data/coords.ts';
import type { ConfirmedBody } from '../../data/types.ts';
import { KEY_BINDINGS, keyLabel } from '../../flight/input/DesktopInput.ts';
import { button, dataBadge, sourceLink } from '../components.ts';
import { h, type Child } from '../dom.ts';
import { icon } from '../icons.ts';
import '../styles/screens.css';

/** A full-screen sheet with a title, scrollable body and a close button. */
export function sheet(
  parent: HTMLElement,
  title: string,
  body: Child,
  onClose: () => void,
  testId?: string,
): { root: HTMLElement; close(): void } {
  const prevFocus = document.activeElement as HTMLElement | null;
  const closeBtn = button('Close', { icon: 'close', testId: 'sheet-close', onClick: () => close() });
  const root = h(
    'section',
    { class: 'sheet-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, 'data-testid': testId },
    h(
      'div',
      { class: 'panel sheet' },
      h('div', { class: 'sheet-head' }, h('h2', null, title), closeBtn),
      h('div', { class: 'sheet-body scroll' }, body),
    ),
  );
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  function close() {
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    prevFocus?.focus?.();
    onClose();
  }
  parent.appendChild(root);
  closeBtn.focus();
  return { root, close };
}

// ---------------------------------------------------------------- controls help

const DESKTOP_ROWS: [string, readonly string[] | string][] = [
  ['Steer', 'Move the mouse: the ship turns toward the cursor (centre = straight ahead)'],
  ['Fire guns', 'Right mouse button — bolts fly toward the cursor within the gun arc'],
  ['Select target', 'Left click a marker or object'],
  ['Throttle', [...KEY_BINDINGS.throttleUp, ...KEY_BINDINGS.throttleDown]],
  ['Throttle (fine)', 'Mouse wheel'],
  ['Strafe', [...KEY_BINDINGS.strafeLeft, ...KEY_BINDINGS.strafeRight]],
  ['Boost', KEY_BINDINGS.boost.slice(0, 1)],
  ['Cruise on/off', KEY_BINDINGS.cruise],
  ['Dock / lane / interact', KEY_BINDINGS.interact],
  ['Go to selected target', KEY_BINDINGS.goto],
  ['Cycle targets', KEY_BINDINGS.targetNext],
  ['Nearest hostile', KEY_BINDINGS.targetHostile],
  ['Missile', [...KEY_BINDINGS.missile, 'middle mouse']],
  ['Repair kit', KEY_BINDINGS.repair],
  ['Scan target', KEY_BINDINGS.scan],
  ['Engines off (drift)', KEY_BINDINGS.engineKill],
  ['Star map', KEY_BINDINGS.map],
  ['Pause', KEY_BINDINGS.pause],
];

function keys(v: readonly string[] | string): Child {
  if (typeof v === 'string') return v;
  return v.map((code, i) => [i > 0 ? ' ' : null, code.includes(' ') ? code : h('kbd', { class: 'kbd' }, keyLabel(code))]);
}

export function controlsContent(steering: SteeringMode, scheme: 'desktop' | 'touch' = 'desktop'): HTMLElement {
  const root = h(
    'div',
    { class: 'stack controls-help' },
    h(
      'div',
      { class: 'overview-card' },
      h('h3', null, icon('info'), 'Mouse and keyboard'),
      steering !== 'mouse'
        ? h(
            'p',
            { class: 'muted small' },
            steering === 'drag'
              ? 'Drag-to-steer is on: hold the left button and move to steer; release to aim freely.'
              : 'Keyboard steering is on: arrow keys (or I/J/K/L) steer, the mouse only aims.',
          )
        : null,
      h('table', { class: 'table' }, h('tbody', null, DESKTOP_ROWS.map(([label, v]) => h('tr', null, h('td', null, label), h('td', null, keys(v)))))),
    ),
    h(
      'div',
      { class: 'overview-card' },
      h('h3', null, icon('help'), 'Touch (phone and tablet)'),
      h(
        'ul',
        { class: 'plain touch-help' },
        h('li', null, h('strong', null, 'Left thumb: '), 'touch anywhere in the lower-left area to drop a steering stick and drag.'),
        h('li', null, h('strong', null, 'Right thumb: '), 'touch and drag in the lower-right area to move the reticle; guns fire while you hold.'),
        h('li', null, h('strong', null, 'Throttle: '), 'slide the bar on the left edge (bottom section is reverse).'),
        h('li', null, h('strong', null, 'Buttons: '), 'Boost (hold), Cruise, Target (hold for nearest hostile), Missile, Repair, and the green action button for Dock, Enter lane, Scan or Go to.'),
        h('li', null, h('strong', null, 'Aim assist: '), 'the chip above the right buttons shows and changes its strength (Off / Low / Medium). It only nudges your reticle toward the selected target’s lead marker; it never picks targets for you.'),
        h('li', null, 'A mouse or keyboard plugged into a tablet switches to the desktop controls automatically.'),
        h('li', null, h('strong', null, 'Practice: '), 'three training drones circle just outside Halcyon Ring. Select one and shoot it to try aiming — no reward, no risk.'),
      ),
    ),
  );
  // Show the scheme in use first.
  if (scheme === 'touch') root.prepend(root.lastElementChild!);
  return root;
}

// ---------------------------------------------------------------- settings

export interface SettingsCallbacks {
  onChange(next: Settings): void;
  onResetSave(): void;
}

export function settingsContent(settings: Settings, cb: SettingsCallbacks): HTMLElement {
  const s = structuredClone(settings);
  const update = () => cb.onChange(structuredClone(s));
  const select = <T extends string | number>(label: string, value: T, options: [T, string][], set: (v: T) => void, hint?: string, testId?: string) => {
    const id = `set-${label.replace(/\W+/g, '-').toLowerCase()}`;
    const el = h(
      'select',
      { id, 'data-testid': testId },
      options.map(([v, text]) => h('option', { value: String(v), selected: v === value }, text)),
    );
    el.addEventListener('change', () => {
      const raw = el.value;
      const match = options.find(([v]) => String(v) === raw);
      if (match) {
        set(match[0]);
        update();
      }
    });
    return h('div', { class: 'field' }, h('label', { for: id }, label, hint ? h('span', { class: 'hint' }, hint) : null), el);
  };
  const toggle = (label: string, value: boolean, set: (v: boolean) => void, hint?: string, testId?: string) => {
    const id = `set-${label.replace(/\W+/g, '-').toLowerCase()}`;
    const el = h('input', { id, type: 'checkbox', checked: value, 'data-testid': testId });
    el.addEventListener('change', () => {
      set(el.checked);
      update();
    });
    return h('div', { class: 'field' }, h('label', { for: id }, label, hint ? h('span', { class: 'hint' }, hint) : null), el);
  };
  const slider = (label: string, value: number, set: (v: number) => void) => {
    const id = `set-${label.replace(/\W+/g, '-').toLowerCase()}`;
    const el = h('input', { id, type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(value * 100)) });
    el.addEventListener('input', () => {
      set(Number(el.value) / 100);
      update();
    });
    return h('div', { class: 'field' }, h('label', { for: id }, label), el);
  };
  return h(
    'div',
    { class: 'stack settings' },
    h('h3', null, 'Graphics'),
    select('Quality', s.quality, [['auto', 'Auto (recommended)'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], (v) => (s.quality = v), 'Resolution adapts to frame rate on every preset.', 'set-quality'),
    toggle('Bloom glow', s.bloom, (v) => (s.bloom = v), 'Soft glow on the High preset.'),
    toggle('Show frame rate', s.showFps, (v) => (s.showFps = v)),
    h('h3', null, 'Accessibility'),
    select('Text size', s.textScale, TEXT_SCALES.map((t) => [t, `${Math.round(t * 100)}%`] as [number, string]), (v) => (s.textScale = v), undefined, 'set-text-size'),
    toggle('Reduced motion', s.reducedMotion, (v) => (s.reducedMotion = v), 'Calmer effects, no speed FOV, gentler jump transition.', 'set-reduced-motion'),
    toggle('Camera shake', s.cameraShake, (v) => (s.cameraShake = v)),
    h('h3', null, 'Sound'),
    toggle('Mute', s.muted, (v) => (s.muted = v), undefined, 'set-mute'),
    slider('Master volume', s.volumes.master, (v) => (s.volumes.master = v)),
    slider('Music', s.volumes.music, (v) => (s.volumes.music = v)),
    slider('Effects', s.volumes.sfx, (v) => (s.volumes.sfx = v)),
    h(
      'p',
      { class: 'muted small' },
      'Sound starts after your first tap or key press. On iPhone and iPad, game audio follows the Ring/Silent switch: switch it to Ring to hear sound.',
    ),
    h('h3', null, 'Controls'),
    select('Aim assist', s.aimAssist, [['off', 'Off'], ['low', 'Low (default)'], ['medium', 'Medium']], (v) => (s.aimAssist = v), 'Nudges the reticle toward the selected target’s lead marker. Never selects targets.', 'set-aim-assist'),
    select('Difficulty', s.difficulty, [['relaxed', 'Relaxed'], ['standard', 'Standard'], ['veteran', 'Veteran']], (v) => (s.difficulty = v), undefined, 'set-difficulty'),
    select(
      'Desktop steering',
      s.steering,
      [
        ['mouse', 'Follow mouse (default)'],
        ['drag', 'Drag to steer'],
        ['keyboard', 'Keyboard steer + mouse aim'],
      ],
      (v) => (s.steering = v),
      undefined,
      'set-steering',
    ),
    toggle('Invert pitch', s.invertY, (v) => (s.invertY = v)),
    toggle('Left-handed touch layout', s.swapTouchSides, (v) => (s.swapTouchSides = v), 'Aim on the left, steer on the right.'),
    h('h3', null, 'Save data'),
    h('p', { class: 'muted small' }, 'Progress is saved automatically in this browser on this device.'),
    button('Reset save…', { variant: 'danger', testId: 'reset-save', onClick: () => cb.onResetSave() }),
  );
}

// ---------------------------------------------------------------- science cards

function measured(label: string, m: ConfirmedBody['orbitalPeriodDays'], unknown: boolean, digits = 3): Child {
  if (unknown) return null;
  if (!m) return [h('dt', null, label), h('dd', { class: 'muted' }, 'Pending archive snapshot')];
  const err = m.error !== undefined ? ` ± ${m.error.toPrecision(2)}` : '';
  return [h('dt', null, label), h('dd', { class: 'num' }, `${Number(m.value.toPrecision(digits))}${err} ${m.unit}${m.qualifier ? ` (${m.qualifier})` : ''}`)];
}

/** Science card for a confirmed planet (discovery) — real status with citation, unknowns marked unknown. */
export function planetCard(body: ConfirmedBody, discovered: boolean): HTMLElement {
  const host = getComponent(body.hostId);
  return h(
    'div',
    { class: 'stack science-card', 'data-testid': 'planet-card' },
    h(
      'div',
      { class: 'row wrap' },
      dataBadge('observed', 'Confirmed exoplanet'),
      body.verification === 'provisional' ? dataBadge('provisional') : null,
      body.controversial ? h('span', { class: 'badge badge-provisional' }, 'Flagged controversial in archive') : null,
      discovered ? h('span', { class: 'badge badge-friendly' }, '✓ Discovered') : null,
    ),
    h(
      'dl',
      { class: 'kv' },
      h('dt', null, 'Archive name'),
      h('dd', null, body.archiveName),
      h('dt', null, 'Status'),
      h(
        'dd',
        null,
        body.verification === 'snapshot'
          ? `Confirmed in the archive as of ${body.asOfDate}`
          : 'Confirmed per NASA Exoplanet Archive (dated snapshot pending)',
      ),
      h('dt', null, 'Host star'),
      h('dd', null, host ? `${host.name} (${host.spectralType})` : body.hostId),
      body.discoveryYear ? [h('dt', null, 'Discovered'), h('dd', null, `${body.discoveryYear}${body.discoveryMethod ? ` · ${body.discoveryMethod}` : ''}`)] : null,
      measured('Orbital period', body.orbitalPeriodDays, body.unknowns.includes('orbital period')),
      measured('Orbit size', body.semiMajorAxisAu, body.unknowns.includes('orbit size')),
      measured('Mass', body.massEarth, body.unknowns.includes('mass')),
      measured('Radius', body.radiusEarth, body.unknowns.includes('radius')),
      body.unknowns.flatMap((u) => [h('dt', null, u[0]!.toUpperCase() + u.slice(1)), h('dd', null, 'Unknown')]),
    ),
    h('p', { class: 'row wrap' }, sourceLink({ label: 'NASA Exoplanet Archive', url: body.sourceUrl, recordId: body.archiveName, ...(body.verification === 'snapshot' ? { retrieved: body.asOfDate } : {}) })),
    h('p', { class: 'muted small' }, dataBadge('estimated'), ' The globe you see in flight is an artist’s impression, not an image or a measurement.'),
  );
}

/** Science card for other real bodies (stars, Solar System planets). */
export function bodyCard(bodyId: string, name: string): HTMLElement {
  const comp = getComponent(bodyId);
  if (comp) {
    return h(
      'div',
      { class: 'stack science-card' },
      h('div', { class: 'row wrap' }, dataBadge('observed', 'Real star'), comp.verification === 'provisional' ? dataBadge('provisional') : null),
      h(
        'dl',
        { class: 'kv' },
        h('dt', null, 'Spectral type'),
        h('dd', null, comp.spectralType),
        h('dt', null, 'Distance from Sol'),
        h('dd', { class: 'num' }, `${comp.distanceLightYears.toFixed(3)} ± ${comp.distanceErrorLightYears.toFixed(3)} ly`),
        h('dt', null, 'Position (ICRS)'),
        h('dd', { class: 'num' }, `${formatRa(comp.raDegrees)} ${formatDec(comp.decDegrees)} · J${comp.referenceEpoch.toFixed(1)}`),
        h('dt', null, 'Catalog'),
        h('dd', null, comp.catalogIds.gaiaDr3 ?? comp.catalogIds.hip ?? comp.catalogIds.simbad ?? comp.id),
      ),
      h('p', { class: 'row wrap' }, sourceLink(comp.astrometrySource), ' ', sourceLink(comp.parallaxSource, 'parallax')),
      h('p', { class: 'muted small' }, dataBadge('estimated'), ' Size, colour and glow in flight are illustrative.'),
    );
  }
  const solar = SOLAR_BODIES.find((b) => b.id === bodyId);
  if (solar) {
    return h(
      'div',
      { class: 'stack science-card' },
      h('div', { class: 'row wrap' }, dataBadge('observed', 'Real body')),
      h(
        'dl',
        { class: 'kv' },
        h('dt', null, 'Type'),
        h('dd', null, solar.kind),
        solar.order ? [h('dt', null, 'Order from the Sun'), h('dd', null, String(solar.order))] : null,
      ),
      h('p', null, sourceLink(solar.source)),
      h('p', { class: 'muted small' }, dataBadge('estimated'), ' In flight, sizes, colours and orbital spacing are schematic and positions do not match today’s sky.'),
    );
  }
  const planet = getPlanet(bodyId);
  if (planet) return planetCard(planet, true);
  return h('p', null, `${name}: no catalogue data bundled.`);
}
