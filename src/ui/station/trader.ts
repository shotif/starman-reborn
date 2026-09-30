import type { CommodityId } from '../../app/state.ts';
import { getLocation, getSystem } from '../../data/systems.ts';
import { CARGO_CAPACITY, cargoCount, cargoUsed, itemsThatFit } from '../../economy/cargo.ts';
import { COMMODITIES, COMMODITY_IDS } from '../../economy/commodities.ts';
import { quote } from '../../economy/markets.ts';
import { bestKnownSale, buyCommodity, maxBuyable, routeOpportunities, sellCommodity } from '../../economy/trade.ts';
import { button, showModal, toast } from '../components.ts';
import { formatCredits, h, replaceChildren, signed } from '../dom.ts';
import { glyph, type GlyphName } from '../glyphs.ts';
import { icon } from '../icons.ts';
import type { Refresh, StationContext } from './context.ts';

export const COMMODITY_GLYPH: Record<CommodityId, GlyphName> = {
  medical: 'medical',
  fabricators: 'fabricators',
  deuterium: 'deuterium',
};

function ago(clock: number, t: number): string {
  const s = Math.max(0, clock - t);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

/** The commodity trader: what the dock sells, what your hold carries, and known routes. */
export function traderContent(ctx: StationContext, refresh: Refresh): HTMLElement {
  const { state, locationId } = ctx;
  const forSale: HTMLElement[] = [];
  const hold: HTMLElement[] = [];
  for (const c of COMMODITY_IDS) {
    const q = quote(locationId, c, state.reputation);
    const info = COMMODITIES[c];
    const have = cargoCount(state.ship.cargo, c);
    const best = bestKnownSale(state, c, locationId);
    if (q.buy !== null) {
      const bestText = best ? `Best known: ${best.price} cr at ${getLocation(best.locationId).name}` : 'No other market known yet';
      forSale.push(
        h(
          'li',
          { class: 'trade-row', 'data-testid': `market-row-${c}` },
          glyph(COMMODITY_GLYPH[c]),
          h('span', { class: 'trade-text' }, h('span', { class: 'row-name' }, info.name), h('span', { class: 'row-sub' }, `${info.unitSize} unit${info.unitSize > 1 ? 's' : ''} · ${bestText}`)),
          h('span', { class: 'row-value num' }, `${q.buy} cr`),
          button('Buy', {
            size: 'sm',
            testId: `buy-${c}`,
            disabled: maxBuyable(state, locationId, c) === 0,
            onClick: () => void openBuyDialog(ctx, c, refresh),
          }),
        ),
      );
    }
    if (have > 0) {
      hold.push(
        h(
          'li',
          { class: 'trade-row' },
          glyph(COMMODITY_GLYPH[c]),
          h(
            'span',
            { class: 'trade-text' },
            h('span', { class: 'row-name' }, `${info.name} ×${have}`),
            h('span', { class: 'row-sub' }, q.sell === null ? 'Not bought here' : `This dock pays ${q.sell} cr each`),
          ),
          h('span', { class: 'row-value num' }, q.sell === null ? '—' : formatCredits(q.sell * have)),
          q.sell !== null ? button('Sell', { size: 'sm', testId: `sell-${c}`, onClick: () => void openSellDialog(ctx, c, refresh) }) : h('span'),
        ),
      );
    }
  }
  const used = cargoUsed(state.ship.cargo);
  return h(
    'div',
    { class: 'trader' },
    h(
      'div',
      { class: 'trade-cols' },
      h(
        'section',
        { 'aria-label': 'For sale here' },
        h('div', { class: 'list-head' }, h('span', null, 'For sale here'), h('span', null, 'Price')),
        forSale.length ? h('ul', { class: 'list' }, forSale) : h('p', { class: 'list-empty' }, 'This dock sells nothing.'),
      ),
      h(
        'section',
        { 'aria-label': 'Your hold' },
        h('div', { class: 'list-head' }, h('span', null, 'Your hold'), h('span', { class: 'num' }, `${used}/${CARGO_CAPACITY} units`)),
        h('div', { class: 'segbar hold-bar', style: `--segments: ${CARGO_CAPACITY}; --fill: ${used / CARGO_CAPACITY}; --seg-color: var(--amber)` }),
        hold.length ? h('ul', { class: 'list' }, hold) : h('p', { class: 'list-empty' }, 'Your hold is empty.'),
      ),
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
  const price = quote(locationId, c, state.reputation).buy!;
  const max = maxBuyable(state, locationId, c);
  if (max <= 0) return;
  let qty = Math.min(max, c === 'medical' && cargoCount(state.ship.cargo, c) < 6 ? 6 : 1);
  const best = bestKnownSale(state, c, locationId);
  const summary = h('div', { class: 'buy-summary' });
  const qtyText = h('output', { class: 'num qty', 'aria-live': 'polite', 'data-testid': 'buy-qty' });
  const renderSummary = () => {
    qtyText.textContent = String(qty);
    const total = qty * price;
    const unitsAfter = cargoUsed(state.ship.cargo) + qty * COMMODITIES[c].unitSize;
    replaceChildren(
      summary,
      h(
        'dl',
        { class: 'kv' },
        h('dt', null, 'Unit price'),
        h('dd', { class: 'num' }, `${price} cr`),
        h('dt', null, 'Total'),
        h('dd', { class: 'num', 'data-testid': 'buy-total' }, formatCredits(total)),
        h('dt', null, 'Credits after'),
        h('dd', { class: 'num' }, formatCredits(state.credits - total)),
        h('dt', null, 'Cargo after'),
        h('dd', { class: 'num' }, `${unitsAfter}/${CARGO_CAPACITY} units (${itemsThatFit(state.ship.cargo, c) - qty} more fit)`),
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
  const price = quote(locationId, c, state.reputation).sell!;
  const have = cargoCount(state.ship.cargo, c);
  const reserved = c === 'medical' && state.jobs.lifeline?.status === 'active';
  let qty = have;
  const out = h('output', { class: 'num qty', 'data-testid': 'sell-qty' });
  const total = h('p', { class: 'num' });
  const render = () => {
    out.textContent = String(qty);
    total.textContent = `Total: ${formatCredits(qty * price)} (${price} cr each)`;
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
