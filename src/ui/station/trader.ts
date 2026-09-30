import type { CommodityId } from '../../app/state.ts';
import type { MarketRole } from '../../content/economy/rules.ts';
import { getLocation, getSystem } from '../../data/systems.ts';
import { cargoCount, cargoUsed, itemsThatFit } from '../../economy/cargo.ts';
import { cargoCapacity } from '../../economy/loadout.ts';
import { COMMODITIES, COMMODITY_IDS } from '../../economy/commodities.ts';
import { stationEventAt } from '../../economy/events.ts';
import { marketEntry, stockAvailable } from '../../economy/markets.ts';
import { bestKnownSale, buyCommodity, liveQuote, marketContext, maxBuyable, orderPrice, routeOpportunities, sellCommodity } from '../../economy/trade.ts';
import { button, showModal, toast } from '../components.ts';
import { formatCredits, h, replaceChildren, signed } from '../dom.ts';
import { glyph, type GlyphName } from '../glyphs.ts';
import { icon } from '../icons.ts';
import type { Refresh, StationContext } from './context.ts';

export const COMMODITY_GLYPH: Record<CommodityId, GlyphName> = {
  water: 'water',
  ore: 'ore',
  gases: 'gases',
  deuterium: 'deuterium',
  'helium-3': 'helium',
  metals: 'metals',
  polymers: 'polymers',
  food: 'food',
  'fine-food': 'finefood',
  medical: 'medical',
  machinery: 'machinery',
  electronics: 'electronics',
  fabricators: 'fabricators',
  'consumer-goods': 'consumer',
  'ship-parts': 'shipparts',
  'habitat-modules': 'habitat',
  'research-samples': 'samples',
  'data-cores': 'datacore',
  luxuries: 'luxury',
  weapons: 'weapons',
  salvage: 'salvage',
};

const ROLE_TAG: Record<MarketRole, string> = { produce: 'Made here', trade: 'Traded here', consume: 'Wanted here' };

function ago(clock: number, t: number): string {
  const s = Math.max(0, clock - t);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

const units = (n: number) => `${n} unit${n > 1 ? 's' : ''}`;

/** The commodity trader: what the dock makes, trades and wants, your hold, and known routes. */
export function traderContent(ctx: StationContext, refresh: Refresh): HTMLElement {
  const { state, locationId } = ctx;
  const rows: HTMLElement[] = [];
  const hold: HTMLElement[] = [];
  // A shortage, glut, boom or strike here moves some prices for a while.
  const event = stationEventAt(locationId, state.clock);
  const EVENT_TAG = { shortage: 'Shortage: pays more', glut: 'Glut: cheap', boom: 'Boom: pays more', strike: 'Strike: scarce' } as const;
  // What the dock makes first, then what it trades, then what it wants.
  const order: MarketRole[] = ['produce', 'trade', 'consume'];
  const rank = (c: CommodityId) => {
    const e = marketEntry(locationId, c);
    return e ? order.indexOf(e.role) : order.length;
  };
  for (const c of [...COMMODITY_IDS].sort((a, b) => rank(a) - rank(b))) {
    const entry = marketEntry(locationId, c);
    const info = COMMODITIES[c];
    const have = cargoCount(state.ship.cargo, c);
    const q = liveQuote(state, locationId, c);
    if (entry) {
      const best = bestKnownSale(state, c, locationId);
      const stock = stockAvailable(locationId, c, marketContext(state));
      const hit = !!event && event.goods.includes(c) && event.kind in EVENT_TAG;
      const details = [...(hit ? [EVENT_TAG[event!.kind as keyof typeof EVENT_TAG]] : []), ROLE_TAG[entry.role], units(info.unitSize)];
      if (entry.role !== 'consume') details.push(`${stock} in stock`);
      if (q.buy !== null) details.push(best ? `best known ${best.price} cr at ${getLocation(best.locationId).name}` : 'no other buyer known');
      rows.push(
        h(
          'li',
          { class: `trade-row market-row role-${entry.role}${hit ? ' event' : ''}`, 'data-testid': `market-row-${c}` },
          glyph(COMMODITY_GLYPH[c]),
          h('span', { class: 'trade-text' }, h('span', { class: 'row-name' }, have ? `${info.name} (×${have})` : info.name), h('span', { class: 'row-sub' }, details.join(' · '))),
          h('span', { class: 'row-value num price-buy', title: 'You pay' }, q.buy === null ? '—' : `${q.buy} cr`),
          h('span', { class: 'row-value num price-sell', title: 'You receive' }, q.sell === null ? '—' : `${q.sell} cr`),
          h(
            'span',
            { class: 'row-actions' },
            q.buy !== null
              ? button('Buy', { size: 'sm', testId: `buy-${c}`, disabled: maxBuyable(state, locationId, c) === 0, onClick: () => void openBuyDialog(ctx, c, refresh) })
              : null,
            have > 0 && q.sell !== null ? button('Sell', { size: 'sm', testId: `sell-${c}`, onClick: () => void openSellDialog(ctx, c, refresh) }) : null,
          ),
        ),
      );
    } else if (have > 0) {
      const best = bestKnownSale(state, c, locationId);
      hold.push(
        h(
          'li',
          { class: 'trade-row' },
          glyph(COMMODITY_GLYPH[c]),
          h(
            'span',
            { class: 'trade-text' },
            h('span', { class: 'row-name' }, `${info.name} ×${have}`),
            h('span', { class: 'row-sub' }, best ? `Not bought here · best known ${best.price} cr at ${getLocation(best.locationId).name}` : 'Not bought here'),
          ),
        ),
      );
    }
  }
  const used = cargoUsed(state.ship.cargo);
  const capacity = cargoCapacity(state.ship);
  return h(
    'div',
    { class: 'trader' },
    h(
      'section',
      { 'aria-label': 'Market' },
      event?.locationId === locationId ? h('p', { class: 'callout market-event', 'data-testid': 'market-event' }, icon('alert'), h('span', null, event.detail)) : null,
      h('div', { class: 'list-head market-head' }, h('span', null, 'Market'), h('span', { class: 'num' }, 'Buy'), h('span', { class: 'num' }, 'Sell'), h('span')),
      rows.length ? h('ul', { class: 'list market-list' }, rows) : h('p', { class: 'list-empty' }, 'This dock has no market.'),
    ),
    h(
      'section',
      { 'aria-label': 'Your hold' },
      h('div', { class: 'list-head' }, h('span', null, 'Your hold'), h('span', { class: 'num' }, `${used}/${capacity} units`)),
      h('div', { class: 'segbar hold-bar', style: `--segments: ${Math.min(capacity, 40)}; --fill: ${used / capacity}; --seg-color: var(--amber)` }),
      hold.length ? h('ul', { class: 'list' }, hold) : h('p', { class: 'list-empty' }, used ? 'Everything you carry is traded here.' : 'Your hold is empty.'),
    ),
    tradeComputer(ctx),
  );
}

function tradeComputer(ctx: StationContext): HTMLElement {
  const { state, locationId } = ctx;
  const opps = routeOpportunities(state, locationId, (a, b) => ctx.travelCost(a, b)).slice(0, 4);
  return h(
    'details',
    { class: 'trade-computer', 'data-testid': 'trade-computer', open: opps.length > 0 },
    h('summary', null, icon('list'), ' Trade computer'),
    h('p', { class: 'muted small' }, 'Returns for buying here, from prices you have seen or been told in briefings.'),
    opps.length
      ? h(
          'ul',
          { class: 'list' },
          opps.map((o) => {
            const dest = getLocation(o.destinationId);
            const fee = o.travelCost ? ` · fees −${o.travelCost}` : o.destinationSystemId !== state.location.systemId ? ' · fee covered' : '';
            return h(
              'li',
              { class: 'trade-row route' },
              glyph(COMMODITY_GLYPH[o.commodity]),
              h(
                'span',
                { class: 'trade-text' },
                h('span', { class: 'row-name' }, `${COMMODITIES[o.commodity].name} → ${dest.name}`),
                h('span', { class: 'row-sub' }, `${getSystem(o.destinationSystemId).displayName} · ${o.buyPrice}→${o.sellPrice} cr × ${o.items}${fee} · ${o.source === 'briefing' ? 'briefing' : `seen ${ago(state.clock, o.observedAt)}`}`),
              ),
              h('span', { class: `row-value num ${o.netProfit >= 0 ? 'pos' : 'neg'}` }, `${signed(o.netProfit)} cr`),
            );
          }),
        )
      : h('p', { class: 'list-empty' }, 'No profitable route known yet. Visit more docks or accept a contract with a price briefing.'),
  );
}

async function openBuyDialog(ctx: StationContext, c: CommodityId, refresh: Refresh): Promise<void> {
  const { state, locationId } = ctx;
  const price = liveQuote(state, locationId, c).buy!;
  const max = maxBuyable(state, locationId, c);
  if (max <= 0) return;
  let qty = Math.min(max, c === 'medical' && cargoCount(state.ship.cargo, c) < 6 ? 6 : 1);
  const best = bestKnownSale(state, c, locationId);
  const summary = h('div', { class: 'buy-summary' });
  const qtyText = h('output', { class: 'num qty', 'aria-live': 'polite', 'data-testid': 'buy-qty' });
  const renderSummary = () => {
    qtyText.textContent = String(qty);
    const total = orderPrice(state, locationId, c, qty, 'buy') ?? qty * price;
    const unitsAfter = cargoUsed(state.ship.cargo) + qty * COMMODITIES[c].unitSize;
    replaceChildren(
      summary,
      h(
        'dl',
        { class: 'kv' },
        h('dt', null, 'Unit price'),
        h('dd', { class: 'num' }, qty > 1 && Math.round(total / qty) !== price ? `${price} cr, ${Math.round(total / qty)} cr average` : `${price} cr`),
        h('dt', null, 'Total'),
        h('dd', { class: 'num', 'data-testid': 'buy-total' }, formatCredits(total)),
        h('dt', null, 'Credits after'),
        h('dd', { class: 'num' }, formatCredits(state.credits - total)),
        h('dt', null, 'Cargo after'),
        h('dd', { class: 'num' }, `${unitsAfter}/${cargoCapacity(state.ship)} units (${itemsThatFit(state.ship.cargo, c, cargoCapacity(state.ship)) - qty} more fit)`),
        h('dt', null, 'Destination'),
        h(
          'dd',
          null,
          best
            ? `${getLocation(best.locationId).name} buys at ${best.price} cr (${signed(best.price - price)} per item, ${best.source === 'briefing' ? 'posted in briefing' : 'from your visit'})`
            : 'No known buyer yet',
        ),
      ),
    );
  };
  const step = (d: number) => () => {
    qty = Math.max(1, Math.min(max, qty + d));
    renderSummary();
  };
  const body = h(
    'div',
    { class: 'stack' },
    h('div', { class: 'row' }, glyph(COMMODITY_GLYPH[c]), h('p', { class: 'grow' }, COMMODITIES[c].description)),
    h(
      'div',
      { class: 'qty-row' },
      button('−10', { size: 'sm', onClick: step(-10), ariaLabel: 'Decrease by 10' }),
      button('−', { size: 'sm', onClick: step(-1), ariaLabel: 'Decrease by 1', testId: 'buy-minus' }),
      qtyText,
      button('+', { size: 'sm', onClick: step(1), ariaLabel: 'Increase by 1', testId: 'buy-plus' }),
      button('Max', { size: 'sm', onClick: step(max), testId: 'buy-max' }),
    ),
    summary,
  );
  renderSummary();
  const choice = await showModal({
    title: `Buy ${COMMODITIES[c].name}`,
    body,
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Buy', value: 'ok', variant: 'primary', testId: 'buy-confirm' },
    ],
    dismissValue: 'cancel',
    testId: 'buy-dialog',
  });
  if (choice !== 'ok') return;
  const r = buyCommodity(state, locationId, c, qty);
  if (r.ok) {
    ctx.sfx('credits');
    toast(`Bought ${r.qty} ${COMMODITIES[c].name} for ${formatCredits(r.total)}`, 'good');
  } else {
    ctx.sfx('ui-error');
    toast(r.message, 'bad');
  }
  ctx.save();
  refresh();
}

async function openSellDialog(ctx: StationContext, c: CommodityId, refresh: Refresh): Promise<void> {
  const { state, locationId } = ctx;
  const price = liveQuote(state, locationId, c).sell!;
  const have = cargoCount(state.ship.cargo, c);
  const reserved = c === 'medical' && state.jobs.lifeline?.status === 'active';
  let qty = have;
  const out = h('output', { class: 'num qty', 'data-testid': 'sell-qty' });
  const total = h('p', { class: 'num' });
  const render = () => {
    out.textContent = String(qty);
    const sum = orderPrice(state, locationId, c, qty, 'sell') ?? qty * price;
    const avg = Math.round(sum / qty);
    total.textContent = `Total: ${formatCredits(sum)} (${avg === price ? `${price} cr each` : `${price} cr falling to ${avg} cr average as the station fills up`})`;
  };
  const step = (d: number) => () => {
    qty = Math.max(1, Math.min(have, qty + d));
    render();
  };
  render();
  const choice = await showModal({
    title: `Sell ${COMMODITIES[c].name}`,
    body: h(
      'div',
      { class: 'stack' },
      reserved ? h('p', { class: 'callout warn' }, icon('alert'), 'Your delivery contract needs 6 medical supplies. Selling them means buying more later.') : null,
      h('div', { class: 'qty-row' }, button('−', { size: 'sm', onClick: step(-1) }), out, button('+', { size: 'sm', onClick: step(1) }), button('All', { size: 'sm', onClick: step(have) })),
      total,
    ),
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Sell', value: 'ok', variant: 'primary', testId: 'sell-confirm' },
    ],
    dismissValue: 'cancel',
  });
  if (choice !== 'ok') return;
  const r = sellCommodity(state, locationId, c, qty);
  if (r.ok) {
    ctx.sfx('credits');
    toast(`Sold ${r.qty} ${COMMODITIES[c].name} for ${formatCredits(r.total)}`, 'good');
  } else {
    toast(r.message, 'bad');
  }
  ctx.save();
  refresh();
}
