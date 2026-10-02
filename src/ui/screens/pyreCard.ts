import { DOOMED } from '../../content/stellar/doomed.ts';
import { EDGE_FICTION } from '../../content/stellar/doomedLines.ts';
import { apparentAt, fillEdge, horizonKm, PYRE_HOLE_ID, pyreAbsoluteMagnitude, pyreRadiusSolar, tidalLimitKm } from '../../economy/doomed.ts';
import { magnitudeText } from '../../economy/stellar.ts';
import { dataBadge } from '../components.ts';
import { h } from '../dom.ts';

const n = (x: number) => Math.round(x).toLocaleString('en-GB');

/**
 * The science card of Pyre or of its black hole (docs/PROCGEN.md §26): invented, and said to be;
 * every number worked out from the rules with the real physics. Null for any other body.
 */
export function pyreCard(bodyId: string): HTMLElement | null {
  const star = DOOMED.star;
  if (bodyId === star.id) {
    return h(
      'div',
      { class: 'stack science-card', 'data-testid': 'pyre-card' },
      h('div', { class: 'row wrap' }, dataBadge('fictional', 'Invented star')),
      h('p', null, fillEdge(EDGE_FICTION)),
      h(
        'dl',
        { class: 'kv' },
        h('dt', null, 'Kind'),
        h('dd', null, `Red supergiant (${star.spectralType}), about ${star.massSolar} times the Sun’s mass at birth`),
        h('dt', null, 'Distance from Sol'),
        h('dd', { class: 'num' }, `${star.distanceLy} ly (invented)`),
        h('dt', null, 'Size'),
        h('dd', { class: 'num' }, `about ${n(pyreRadiusSolar())} times the Sun’s`),
        h('dt', null, 'Brightness from Earth'),
        h('dd', { class: 'num' }, `magnitude ${magnitudeText(apparentAt(pyreAbsoluteMagnitude(), star.distanceLy))}`),
      ),
      h('p', { class: 'muted small' }, 'Its size and brightness are worked out from its invented luminosity and temperature with the real physics. In flight it is drawn far smaller than it would be.'),
    );
  }
  if (bodyId === PYRE_HOLE_ID) {
    const bh = DOOMED.blackHole;
    return h(
      'div',
      { class: 'stack science-card', 'data-testid': 'pyre-hole-card' },
      h('div', { class: 'row wrap' }, dataBadge('fictional', 'Invented black hole')),
      h('p', null, fillEdge(EDGE_FICTION)),
      h(
        'dl',
        { class: 'kv' },
        h('dt', null, 'Mass'),
        h('dd', { class: 'num' }, `about ${bh.massSolar} times the Sun’s`),
        h('dt', null, 'Event horizon'),
        h('dd', { class: 'num' }, `about ${n(2 * horizonKm())} km across`),
        h('dt', null, 'Tides'),
        h('dd', { class: 'num' }, `would pull a ${bh.tides.shipLengthM} m ship apart within about ${n(tidalLimitKm())} km`),
      ),
      h(
        'p',
        null,
        'Nothing is pulled in from afar: away from it, its pull is no stronger than that of a star of the same mass. It glows only while the star’s gas falls back in.',
      ),
      h(
        'p',
        { class: 'muted small' },
        'Most exploding stars are thought to leave a neutron star; which leave black holes depends on how their cores are built, and no supernova has yet been seen for certain to leave one. In flight the hole is drawn far larger than it would be, and its tides far nearer.',
      ),
    );
  }
  return null;
}
