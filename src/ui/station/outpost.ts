import type { CommodityId } from '../../app/state.ts';
import { OUTPOSTS } from '../../content/outposts/rules.ts';
import { kindWord, outpostId, type OutpostSite } from '../../content/outposts/sites.ts';
import type { StationType } from '../../content/world/types.ts';
import { getPlanet } from '../../data/systems.ts';
import { cargoCount } from '../../economy/cargo.ts';
import { COMMODITIES } from '../../economy/commodities.ts';
import { charterOffers, charterOutpost, deliverable, deliverToOutpost, nextStage, outpostOf, outpostPlace, outpostStatus, stillNeeded, type CharterOffer } from '../../economy/outposts.ts';
import { button, showModal, toast } from '../components.ts';
import { formatCredits, h, replaceChildren } from '../dom.ts';
import { glyph } from '../glyphs.ts';
import type { Refresh, StationContext } from './context.ts';
import { COMMODITY_GLYPH } from './trader.ts';

/**
 * A station of your own (docs/PROCGEN.md §22): the outpost's part of the Fleet window (how it
 * stands, or the sites of this system to charter), and the Outpost window at the outpost itself
 * (the materials for the next stage, handed over from the hold).
 */

const goodName = (c: CommodityId) => COMMODITIES[c].name.toLowerCase();
const article = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

/** True when docked at the player's own outpost. */
export function atOwnOutpost(ctx: StationContext): boolean {
  const o = outpostOf(ctx.state);
  return !!o && ctx.locationId === outpostId(o.site);
}

// ---------------------------------------------------------------- the Fleet window

export function outpostSection(ctx: StationContext, refresh: Refresh): HTMLElement {
  const o = outpostOf(ctx.state);
  if (o) {
    return h(
      'section',
      { 'aria-label': 'Your outpost', 'data-testid': 'outpost' },
      h('div', { class: 'list-head' }, h('span', null, 'Your outpost'), h('span', null, `earned ${formatCredits(o.earned)}`)),
      h(
        'ul',
        { class: 'list' },
        h(
          'li',
          { class: 'trade-row fleet-row', 'data-testid': 'outpost-row' },
          glyph('dock'),
          h(
            'span',
            { class: 'trade-text' },
            h('span', { class: 'row-name' }, `${o.name} · ${kindWord(o.kind)}`),
            h('span', { class: 'row-sub' }, outpostPlace(o)),
            h('span', { class: 'row-sub fleet-status', 'data-testid': 'outpost-status' }, outpostStatus(ctx.state, o)),
            atOwnOutpost(ctx) ? null : h('span', { class: 'row-note' }, nextStage(o) ? 'Dock there to hand over the materials.' : 'Fiction: your station, at a real planet.'),
          ),
        ),
      ),
    );
  }
  const offers = charterOffers(ctx.state);
  return h(
    'section',
    { 'aria-label': 'Found an outpost', 'data-testid': 'outpost-sites' },
    h('div', { class: 'list-head' }, h('span', null, 'Found an outpost'), h('span', null, `charter ${formatCredits(OUTPOSTS.charter)}`)),
    offers.length
      ? h(
          'ul',
          { class: 'list' },
          offers.map((offer) => siteRow(ctx, offer, refresh)),
        )
      : h('p', { class: 'list-empty' }, 'No sites in this system. An outpost can be built in orbit of a confirmed planet, outside Sol and the first systems settled: charter it from a station of its system.'),
  );
}

function siteRow(ctx: StationContext, offer: CharterOffer, refresh: Refresh): HTMLElement {
  const planet = getPlanet(offer.site.planetId)!;
  return h(
    'li',
    { class: 'trade-row fleet-row', 'data-testid': `outpost-site-${offer.site.planetId}` },
    glyph('science'),
    h(
      'span',
      { class: 'trade-text' },
      h('span', { class: 'row-name' }, `In orbit of ${planet.displayName}`),
      h('span', { class: 'row-sub' }, `Can be ${offer.kinds.map((k) => article(kindWord(k.kind))).join(', ')}`),
    ),
    h(
      'span',
      { class: 'row-actions' },
      button('Charter', {
        size: 'sm',
        testId: `outpost-charter-${offer.site.planetId}`,
        disabled: !!offer.blocked,
        title: offer.blocked ?? undefined,
        onClick: () => void openCharter(ctx, offer, refresh),
      }),
    ),
  );
}

async function openCharter(ctx: StationContext, offer: CharterOffer, refresh: Refresh): Promise<void> {
  const site: OutpostSite = offer.site;
  const planet = getPlanet(site.planetId)!;
  let kind: StationType = offer.kinds[0]!.kind;
  let name = offer.kinds[0]!.names[0]!;
  const kindSelect = h(
    'select',
    { id: 'outpost-kind', 'data-testid': 'outpost-kind' },
    offer.kinds.map((k) => h('option', { value: k.kind }, kindWord(k.kind))),
  );
  const nameSelect = h('select', { id: 'outpost-name', 'data-testid': 'outpost-name' });
  const fillNames = () => {
    const names = offer.kinds.find((k) => k.kind === kind)!.names;
    if (!names.includes(name)) name = names[0]!;
    replaceChildren(
      nameSelect,
      names.map((n) => h('option', { value: n, selected: n === name }, n)),
    );
  };
  kindSelect.addEventListener('change', () => {
    kind = kindSelect.value as StationType;
    fillNames();
  });
  nameSelect.addEventListener('change', () => {
    name = nameSelect.value;
  });
  fillNames();
  const stages = h(
    'dl',
    { class: 'kv' },
    OUTPOSTS.stages.flatMap((s, i) => [
      h('dt', null, `${i + 1}. ${s.name}`),
      h(
        'dd',
        null,
        `${(Object.entries(s.needs) as [CommodityId, number][]).map(([c, q]) => `${q} ${goodName(c)}`).join(', ')}: ${i === 0 ? 'it opens, with a market and repairs' : s.services.includes('equipment') ? 'an outfitter' : 'a job board'}, ${formatCredits(s.income)} an hour`,
      ),
    ]),
  );
  const answer = await showModal({
    title: `An outpost in orbit of ${planet.displayName}`,
    testId: 'outpost-charter-dialog',
    body: h(
      'div',
      { class: 'stack hire' },
      h('p', null, `The charter costs ${formatCredits(offer.price)}. Then bring the materials for each stage to the site; your outpost opens once its frame is up, and pays you by the hour from then on. Raids in its system cut that hour's income.`),
      h('div', { class: 'hire-field' }, h('label', { for: 'outpost-kind' }, 'What it is'), kindSelect),
      h('div', { class: 'hire-field' }, h('label', { for: 'outpost-name' }, 'Its name'), nameSelect),
      stages,
      h('p', { class: 'muted small' }, `The outpost and its people are fiction; ${planet.displayName} is a real planet. One outpost to a pilot.`),
    ),
    actions: [
      { label: 'Cancel', value: 'cancel', testId: 'outpost-charter-cancel' },
      { label: `Charter · ${formatCredits(offer.price)}`, value: 'ok', variant: 'primary', testId: 'outpost-charter-confirm' },
    ],
    dismissValue: 'cancel',
  });
  if (answer !== 'ok') return;
  const r = charterOutpost(ctx.state, site.planetId, kind, name);
  ctx.sfx(r.ok ? 'credits' : 'ui-error');
  toast(r.message, r.ok ? 'good' : 'bad', 5000);
  ctx.save();
  refresh();
}

// ---------------------------------------------------------------- the Outpost window (docked there)

export function outpostContent(ctx: StationContext, refresh: Refresh): HTMLElement {
  const { state } = ctx;
  const o = outpostOf(state)!;
  const stage = nextStage(o);
  const needs = stillNeeded(o);
  return h(
    'div',
    { class: 'stack fleet', 'data-testid': 'outpost-window' },
    h('p', { class: 'muted small' }, `${o.name}, your ${kindWord(o.kind)} (fiction) in orbit of ${outpostPlace(o)}.`),
    h('p', { 'data-testid': 'outpost-window-status' }, outpostStatus(state, o)),
    stage
      ? h(
          'section',
          { 'aria-label': `The ${stage.name.toLowerCase()}` },
          h('div', { class: 'list-head' }, h('span', null, `Building: the ${stage.name.toLowerCase()}`), h('span', null, `${needs.filter((x) => x.left === 0).length}/${needs.length} done`)),
          h(
            'ul',
            { class: 'list' },
            needs.map((x) => {
              const can = deliverable(state, x.commodity);
              return h(
                'li',
                { class: 'trade-row fleet-row', 'data-testid': `outpost-need-${x.commodity}` },
                glyph(COMMODITY_GLYPH[x.commodity]),
                h(
                  'span',
                  { class: 'trade-text' },
                  h('span', { class: 'row-name' }, COMMODITIES[x.commodity].name),
                  h('span', { class: 'row-sub' }, `${x.delivered}/${x.need} delivered${x.left ? ` · you carry ${cargoCount(state.ship.cargo, x.commodity)}` : ''}`),
                ),
                h(
                  'span',
                  { class: 'row-actions' },
                  x.left
                    ? button(can ? `Deliver ${can}` : 'Deliver', {
                        size: 'sm',
                        testId: `outpost-deliver-${x.commodity}`,
                        disabled: can <= 0,
                        title: can <= 0 ? 'None in your hold' : undefined,
                        onClick: () => {
                          const r = deliverToOutpost(state, x.commodity, can);
                          ctx.sfx(r.ok ? 'ui-confirm' : 'ui-error');
                          toast(r.message, r.ok ? 'good' : 'bad', 5000);
                          ctx.save();
                          // A stage done changes the station itself: build it again (its market opens, it grows).
                          if (r.stageDone) ctx.reload('outpost');
                          else refresh();
                        },
                      })
                    : h('span', { class: 'tag' }, 'Done'),
                ),
              );
            }),
          ),
        )
      : h('p', { class: 'callout' }, 'Complete: a port with a market, repairs, a job board and an outfitter.'),
  );
}
