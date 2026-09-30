import { maker, shipClass, shipModel } from '../../content/catalog.ts';
import type { ShipPerformance } from '../../content/loadout.ts';
import { buyShip, shipOffers, tradeInValue, type ShipOffer } from '../../economy/equipment.ts';
import { buyAndKeep, keepOffer } from '../../economy/fleet.ts';
import { FLEET } from '../../content/fleet/rules.ts';
import { gunSummary, newShipState, performanceOf } from '../../economy/loadout.ts';
import { button, showModal, toast } from '../components.ts';
import { formatCredits, h } from '../dom.ts';
import { glyph } from '../glyphs.ts';
import type { Refresh, StationContext } from './context.ts';
import { shipKind, shipStatsLine } from './gearText.ts';

/** The ship dealer: models on sale here, priced after trading in your ship and its fittings. */
export function shipyardContent(ctx: StationContext, refresh: Refresh): HTMLElement {
  const { state, locationId } = ctx;
  const offers = shipOffers(state, locationId);
  const current = shipModel(state.ship.model);
  const byClass = new Map<string, ShipOffer[]>();
  for (const o of offers) {
    const list = byClass.get(o.model.class);
    if (list) list.push(o);
    else byClass.set(o.model.class, [o]);
  }
  return h(
    'div',
    { class: 'stack shipyard' },
    h(
      'p',
      { class: 'muted trade-in-note', 'data-testid': 'trade-in' },
      `Trade-in for your ${current.name} and its fittings: `,
      h('strong', { class: 'num' }, formatCredits(tradeInValue(state))),
    ),
    offers.length === 0 ? h('p', { class: 'list-empty' }, 'No ships for sale here.') : null,
    [...byClass.entries()].map(([cls, list]) =>
      h(
        'section',
        { 'aria-label': shipClass(list[0]!.model.class).name },
        h('div', { class: 'list-head' }, h('span', null, `${shipClass(list[0]!.model.class).name}s`), h('span', null, cls === current.class ? 'Your class' : 'You pay')),
        h('ul', { class: 'list' }, list.map((o) => shipRow(ctx, o, refresh))),
      ),
    ),
  );
}

function shipRow(ctx: StationContext, o: ShipOffer, refresh: Refresh): HTMLElement {
  const perf = performanceOf({ model: o.model.id, fittings: o.model.stock });
  // Buy and keep (docs/PROCGEN.md §18): the ship you fly is parked here instead of traded in.
  const keep = keepOffer(ctx.state, ctx.locationId, o.model.id);
  const canKeep = !!keep && !keep.blocked;
  return h(
    'li',
    { class: `trade-row${o.current ? ' owned' : ''}`, 'data-testid': `ship-${o.model.id}` },
    glyph('shipyard'),
    h(
      'span',
      { class: 'trade-text' },
      h('span', { class: 'row-name' }, o.model.name),
      h('span', { class: 'row-sub' }, `${shipKind(o.model)} · ${maker(o.model.maker).short} · ${shipStatsLine(perf)}`),
      o.blocked && !o.current ? h('span', { class: 'row-note' }, o.blocked) : null,
    ),
    h('span', { class: `row-value num${o.net < 0 ? ' pos' : ''}` }, o.current ? 'Yours' : formatCredits(o.net)),
    o.current && !canKeep
      ? h('span')
      : button('Buy', {
          size: 'sm',
          disabled: !!o.blocked && !canKeep,
          title: o.blocked && !canKeep ? o.blocked : undefined,
          testId: `buy-ship-${o.model.id}`,
          onClick: () => void confirmShip(ctx, o, refresh),
        }),
  );
}

function compare(label: string, now: string, next: string, better: boolean | null): HTMLElement {
  return h(
    'tr',
    null,
    h('th', { scope: 'row' }, label),
    h('td', { class: 'num' }, now),
    h('td', { class: `num${better === true ? ' pos' : better === false ? ' neg' : ''}` }, next),
  );
}

function comparison(now: ShipPerformance, next: ShipPerformance, nowGuns: string, nextGuns: string): HTMLElement {
  const n = (a: number, b: number) => (b === a ? null : b > a);
  const shield = (p: ShipPerformance) => (p.shield ? `${p.shield.capacity} ${p.shield.shieldType}` : 'none');
  return h(
    'table',
    { class: 'compare' },
    h('thead', null, h('tr', null, h('th', null, ''), h('th', { scope: 'col' }, 'Now'), h('th', { scope: 'col' }, 'New'))),
    h(
      'tbody',
      null,
      compare('Hull', String(now.hullMax), String(next.hullMax), n(now.hullMax, next.hullMax)),
      compare('Shield', shield(now), shield(next), n(now.shield?.capacity ?? 0, next.shield?.capacity ?? 0)),
      compare('Guns', nowGuns, nextGuns, n(now.guns.length, next.guns.length)),
      compare('Cargo', String(now.cargo), String(next.cargo), n(now.cargo, next.cargo)),
      compare('Top speed', `${Math.round(now.flight.maxSpeed)} m/s`, `${Math.round(next.flight.maxSpeed)} m/s`, n(now.flight.maxSpeed, next.flight.maxSpeed)),
      compare('Turn rate', now.flight.maxTurnRate.toFixed(2), next.flight.maxTurnRate.toFixed(2), n(now.flight.maxTurnRate, next.flight.maxTurnRate)),
      compare('Energy', `${now.flight.energyMax} +${now.flight.energyRegen}/s`, `${next.flight.energyMax} +${next.flight.energyRegen}/s`, n(now.flight.energyRegen, next.flight.energyRegen)),
    ),
  );
}

async function confirmShip(ctx: StationContext, o: ShipOffer, refresh: Refresh): Promise<void> {
  const { state, locationId } = ctx;
  const current = shipModel(state.ship.model);
  const nextShip = newShipState(o.model.id);
  const keep = keepOffer(state, locationId, o.model.id);
  const canKeep = !!keep && !keep.blocked;
  const choice = await showModal({
    title: `Buy the ${o.model.name}?`,
    testId: 'ship-dialog',
    body: h(
      'div',
      { class: 'stack' },
      h('p', null, h('strong', null, shipKind(o.model)), ` · ${maker(o.model.maker).name}. ${o.model.description}`),
      h('p', { class: 'muted' }, maker(o.model.maker).blurb),
      comparison(performanceOf(state.ship), performanceOf(nextShip), gunSummary(state.ship), gunSummary(nextShip)),
      o.blocked
        ? h('p', { class: 'muted' }, o.current ? `You fly a ${current.name} already: buy and keep a second one.` : `Trading in: ${o.blocked.toLowerCase()}.`)
        : [
            h(
              'p',
              { class: 'num' },
              `Trade in: price ${formatCredits(o.model.price)} − trade-in ${formatCredits(o.tradeIn)} = ${formatCredits(o.net)} · credits after ${formatCredits(state.credits - o.net)}`,
            ),
            h('p', { class: 'muted' }, `Your ${current.name} and everything fitted to it go to the yard. The new ship comes with its stock loadout and full racks; your cargo and repair kits move across.`),
          ],
      keep
        ? h(
            'p',
            { class: 'num', 'data-testid': 'shipyard-keep-note' },
            canKeep
              ? `Buy and keep: ${formatCredits(keep.price)} · credits after ${formatCredits(state.credits - keep.price)}. Your ${current.name} stays parked here as it is (${state.fleet.ships.length + 1} of ${FLEET.hangar.max} ships besides the one you fly)${keep.cargoMoves ? '; your cargo moves across' : ', with your cargo: it does not fit the new hold'}.`
              : `Buy and keep: ${keep.blocked!.toLowerCase()}.`,
          )
        : null,
    ),
    actions: [
      { label: 'Cancel', value: 'cancel' },
      ...(canKeep ? [{ label: 'Buy and keep', value: 'keep', testId: `shipyard-keep-${o.model.id}` }] : []),
      ...(o.blocked ? [] : [{ label: canKeep ? 'Trade in and buy' : 'Buy ship', value: 'ok', variant: 'primary' as const, testId: 'ship-confirm' }]),
    ],
    dismissValue: 'cancel',
  });
  if (choice === 'keep') {
    const r = buyAndKeep(state, locationId, o.model.id);
    ctx.sfx(r.ok ? 'ui-confirm' : 'ui-error');
    toast(r.message, r.ok ? 'good' : 'bad', 4500);
    ctx.save();
    if (r.ok) ctx.shipChanged();
    refresh();
    return;
  }
  if (choice !== 'ok') return;
  const r = buyShip(state, locationId, o.model.id);
  ctx.sfx(r.ok ? 'ui-confirm' : 'ui-error');
  toast(r.message, r.ok ? 'good' : 'bad');
  ctx.save();
  if (r.ok) ctx.shipChanged();
  refresh();
}
