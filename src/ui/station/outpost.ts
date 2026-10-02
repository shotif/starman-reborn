import type { CommodityId } from '../../app/state.ts';
import { OUTPOSTS } from '../../content/outposts/rules.ts';
import { kindWord, outpostId, type OutpostSite } from '../../content/outposts/sites.ts';
import type { StationType } from '../../content/world/types.ts';
import { getPlanet } from '../../data/systems.ts';
import { cargoCount } from '../../economy/cargo.ts';
import { COMMODITIES } from '../../economy/commodities.ts';
import { charterOffers, charterOutpost, deliverable, deliverToOutpost, nextStage, outpostOf, outpostPlace, outpostStatus, stillNeeded, type CharterOffer } from '../../economy/outposts.ts';
import { OUTPOST_RAIDS } from '../../content/outposts/raids.ts';
import { RAID_FICTION } from '../../content/outposts/raidLines.ts';
import { shipModel } from '../../content/catalog.ts';
import type { OutpostRecord } from '../../app/state.ts';
import {
  defenceAt,
  defenceLine,
  deliverForTurret,
  guardHireBlock,
  guardOffers,
  hireGuard,
  holdOdds,
  nextRaid,
  oddsWord,
  raidBand,
  repairTurret,
  turretCap,
  turretNeeds,
} from '../../economy/outpostRaids.ts';
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
            o.stage > 0 ? h('span', { class: 'row-sub', 'data-testid': 'outpost-defence-line' }, defenceLine(ctx.state, o)) : null,
            atOwnOutpost(ctx) ? null : h('span', { class: 'row-note' }, nextStage(o) ? 'Dock there to hand over the materials.' : 'Fiction: your station, at a real planet.'),
          ),
          // Guards can be hired from any full-service dock (docs/PROCGEN.md §29).
          o.stage > 0 && !atOwnOutpost(ctx) && !guardHireBlock(ctx.state, o)
            ? h('span', { class: 'row-actions' }, button('Hire guards', { size: 'sm', testId: 'outpost-hire-guards', onClick: () => void openGuardHire(ctx, o, refresh) }))
            : null,
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
      h('p', null, `The charter costs ${formatCredits(offer.price)}. Then bring the materials for each stage to the site; your outpost opens once its frame is up, and pays you by the hour from then on. Raids in its system cut that hour's income, and raiders will come for the outpost itself now and then: build turrets there and hire guards to hold them off.`),
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
    { class: 'stack fleet', 'data-testid': 'outpost-content' },
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
    o.stage > 0 ? defenceSection(ctx, o, refresh) : null,
  );
}

// ---------------------------------------------------------------- its defences (docs/PROCGEN.md §29)

const HOUR = 3_600;
const clockIn = (seconds: number) => (seconds < HOUR ? `${Math.max(1, Math.round(seconds / 60))} min` : `${Math.round(seconds / HOUR)} h`);

/** The outpost's defences, docked there: the raid watch and the odds, turrets (built from materials, repaired), guards, and the last raids. */
function defenceSection(ctx: StationContext, o: OutpostRecord, refresh: Refresh): HTMLElement {
  const { state } = ctx;
  const d = o.defence;
  const now = defenceAt(state, o, state.clock);
  const next = nextRaid(state, o);
  const warned = next && d?.warned === next.window && next.at > state.clock;
  const threat = next?.threat ?? OUTPOST_RAIDS.threat[raidBand(o)];
  const odds = holdOdds(now.value, threat);
  const built = d?.turrets ?? 0;
  const cap = turretCap(o);
  const needs = turretNeeds(o);
  const guards = (d?.guards ?? []).filter((g) => g.until > state.clock);
  const block = guardHireBlock(state, o);
  return h(
    'section',
    { 'aria-label': 'Defences', 'data-testid': 'outpost-defences' },
    h('div', { class: 'list-head' }, h('span', null, 'Defences'), h('span', null, `${now.turrets} turret${now.turrets === 1 ? '' : 's'} up · ${now.guards.length} on post`)),
    h(
      'p',
      { class: warned ? 'callout warn' : 'muted small', 'data-testid': 'outpost-raid-watch' },
      warned ? `Raiders expected in about ${clockIn(next!.at - state.clock)}: ${next!.ships} ships. ${oddsWord(holdOdds(defenceAt(state, o, next!.at).value, next!.threat))}` : `Raiders come for outposts in ${raidBand(o)} space now and then; its watch sees them a quarter of an hour off. Against a raid now: ${oddsWord(odds)}`,
    ),
    h('div', { class: 'odds-bar', role: 'img', 'aria-label': `Odds of holding: ${Math.round(odds * 100)}%`, 'data-testid': 'outpost-odds' }, h('span', { class: 'odds-fill', style: `--fill: ${odds}` })),
    h('div', { class: 'list-head' }, h('span', null, 'Turrets'), h('span', null, `${built}/${cap} built`)),
    h(
      'ul',
      { class: 'list' },
      Array.from({ length: built }, (_, i) => {
        const downUntil = d?.down[i] ?? 0;
        const down = downUntil > state.clock;
        return h(
          'li',
          { class: 'trade-row fleet-row', 'data-testid': `outpost-turret-${i}` },
          glyph('gun'),
          h('span', { class: 'trade-text' }, h('span', { class: 'row-name' }, `Turret ${i + 1}`), h('span', { class: 'row-sub' }, down ? `Knocked out: back up in ${clockIn(downUntil - state.clock)}` : `Up · ${formatCredits(OUTPOST_RAIDS.turrets.upkeep)} an hour`)),
          down
            ? h(
                'span',
                { class: 'row-actions' },
                button(`Repair · ${formatCredits(OUTPOST_RAIDS.turrets.repair)}`, {
                  size: 'sm',
                  testId: `outpost-turret-repair-${i}`,
                  disabled: state.credits < OUTPOST_RAIDS.turrets.repair,
                  onClick: () => {
                    const r = repairTurret(state, i);
                    ctx.sfx(r.ok ? 'ui-confirm' : 'ui-error');
                    toast(r.message, r.ok ? 'good' : 'bad', 4000);
                    ctx.save();
                    refresh();
                  },
                }),
              )
            : null,
        );
      }),
      needs.map((x) => {
        const carry = cargoCount(state.ship.cargo, x.commodity);
        const can = Math.min(x.left, carry);
        return h(
          'li',
          { class: 'trade-row fleet-row', 'data-testid': `outpost-turret-need-${x.commodity}` },
          glyph(COMMODITY_GLYPH[x.commodity]),
          h('span', { class: 'trade-text' }, h('span', { class: 'row-name' }, `Turret ${built + 1}: ${COMMODITIES[x.commodity].name}`), h('span', { class: 'row-sub' }, `${x.delivered}/${x.need} delivered${x.left ? ` · you carry ${carry}` : ''}`)),
          h(
            'span',
            { class: 'row-actions' },
            x.left
              ? button(can ? `Deliver ${can}` : 'Deliver', {
                  size: 'sm',
                  testId: `outpost-turret-deliver-${x.commodity}`,
                  disabled: can <= 0,
                  title: can <= 0 ? 'None in your hold' : undefined,
                  onClick: () => {
                    const r = deliverForTurret(state, x.commodity, can);
                    ctx.sfx(r.ok ? (r.built ? 'mission-complete' : 'ui-confirm') : 'ui-error');
                    toast(r.message, r.ok ? 'good' : 'bad', 5000);
                    ctx.save();
                    refresh();
                  },
                })
              : h('span', { class: 'tag' }, 'Done'),
          ),
        );
      }),
    ),
    built >= cap && cap < OUTPOST_RAIDS.turrets.needs.length ? h('p', { class: 'muted small' }, 'One turret for each stage built: the next comes with the next stage.') : null,
    h('div', { class: 'list-head' }, h('span', null, 'Guards'), h('span', null, `${guards.length}/${OUTPOST_RAIDS.guards.max}`)),
    guards.length
      ? h(
          'ul',
          { class: 'list' },
          guards.map((g) =>
            h(
              'li',
              { class: 'trade-row fleet-row', 'data-testid': `outpost-guard-${g.id}` },
              glyph('wing'),
              h('span', { class: 'trade-text' }, h('span', { class: 'row-name' }, g.name), h('span', { class: 'row-sub' }, `${shipModel(g.model).name} · ${g.skill === 'sharp' ? 'sharp shot' : 'steady hand'} · ${g.from > state.clock ? `on post in ${clockIn(g.from - state.clock)}` : `on post for ${clockIn(g.until - state.clock)} more`}`)),
            ),
          ),
        )
      : h('p', { class: 'list-empty' }, 'No guards. Pilots here will guard the outpost by the hour, as will pilots at any dock with a market, repairs and a job board.'),
    h('div', { class: 'row wrap' }, button('Hire a guard', { testId: 'outpost-hire-guards', disabled: !!block, title: block ?? undefined, onClick: () => void openGuardHire(ctx, o, refresh) })),
    block && guards.length < OUTPOST_RAIDS.guards.max ? h('p', { class: 'muted small' }, block) : null,
    d?.raids.length
      ? h(
          'div',
          { class: 'stack-tight' },
          h('div', { class: 'list-head' }, h('span', null, 'Raids'), h('span', null, '')),
          h(
            'ul',
            { class: 'plain small', 'data-testid': 'outpost-raids' },
            [...d.raids].reverse().map((r) => h('li', null, `${clockIn(Math.max(60, state.clock - r.at))} ago: ${r.result === 'held' ? 'held' : 'lost'}${r.where === 'flight' ? ', with you there' : ''}${r.took ? ` (took ${r.took})` : ''}`)),
          ),
        )
      : null,
    h('p', { class: 'muted small' }, RAID_FICTION),
  );
}

/** Hiring a guard: two pilots this posting, a term, paid up front; on post a quarter of an hour on. */
async function openGuardHire(ctx: StationContext, o: OutpostRecord, refresh: Refresh): Promise<void> {
  const { state } = ctx;
  // Pilots already guarding the outpost are not looking for work.
  const offers = guardOffers(state, o).filter((g) => !(o.defence?.guards ?? []).some((x) => x.id === g.id && x.until > state.clock));
  if (!offers.length) {
    toast('Nobody else is looking for guard work this posting.', 'bad', 4000);
    return;
  }
  let pick = offers[0]!.id;
  let hours = OUTPOST_RAIDS.guards.terms[1] ?? OUTPOST_RAIDS.guards.terms[0]!;
  const termSelect = h(
    'select',
    { id: 'guard-term', 'data-testid': 'guard-term' },
    OUTPOST_RAIDS.guards.terms.map((t) => h('option', { value: String(t), selected: t === hours }, `${t} hours`)),
  );
  const cost = h('p', { 'data-testid': 'guard-cost' });
  const update = () => {
    const offer = offers.find((x) => x.id === pick)!;
    cost.textContent = `${offer.name} for ${hours} hours: ${formatCredits(offer.perHour * hours)}, paid now (you have ${formatCredits(state.credits)}). On post at ${o.name} a quarter of an hour after hiring.`;
  };
  termSelect.addEventListener('change', () => {
    hours = Number(termSelect.value);
    update();
  });
  const list = h(
    'div',
    { class: 'choice-options', role: 'radiogroup', 'aria-label': 'Pilots looking for work' },
    offers.map((g) => {
      const input = h('input', { type: 'radio', name: 'guard', value: g.id, checked: g.id === pick, 'data-testid': `guard-${g.id}` }) as HTMLInputElement;
      input.addEventListener('change', () => {
        pick = g.id;
        update();
      });
      return h('label', { class: 'choice-option' }, input, h('span', { class: 'choice-label' }, ` ${g.name}`), h('span', { class: 'choice-effects' }, `${shipModel(g.model).name} · ${g.skill === 'sharp' ? 'sharp shot' : 'steady hand'} · ${formatCredits(g.perHour)} an hour`));
    }),
  );
  update();
  const answer = await showModal({
    title: `Guards for ${o.name}`,
    testId: 'guard-hire-dialog',
    body: h('div', { class: 'stack hire' }, h('p', null, 'Pilots who will fly round your outpost and fight off raiders, by the hour. No refunds.'), list, h('div', { class: 'hire-field' }, h('label', { for: 'guard-term' }, 'For'), termSelect), cost, h('p', { class: 'muted small' }, RAID_FICTION)),
    actions: [
      { label: 'Cancel', value: 'cancel', testId: 'guard-cancel' },
      { label: 'Hire', value: 'ok', variant: 'primary', testId: 'guard-confirm' },
    ],
    dismissValue: 'cancel',
  });
  if (answer !== 'ok') return;
  const r = hireGuard(state, pick, hours);
  ctx.sfx(r.ok ? 'credits' : 'ui-error');
  toast(r.message, r.ok ? 'good' : 'bad', 5000);
  ctx.save();
  refresh();
}
