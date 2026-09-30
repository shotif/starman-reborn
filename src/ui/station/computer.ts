import { PEOPLE } from '../../content/people/rules.ts';
import { getLocation, getSystem } from '../../data/systems.ts';
import { COMMODITIES } from '../../economy/commodities.ts';
import { cargoCapacity } from '../../economy/loadout.ts';
import { hasMarket } from '../../economy/markets.ts';
import { knownAt, knownVia } from '../../economy/trade.ts';
import { toggleWatch, tradeRoutes, type TradeRoute } from '../../economy/tradeComputer.ts';
import { button, toast } from '../components.ts';
import { formatCredits, h } from '../dom.ts';
import { glyph } from '../glyphs.ts';
import type { StationContext } from './context.ts';
import { COMMODITY_GLYPH } from './trader.ts';

type Refresh = () => void;

/** Remembered for the session: the computer shows routes from here, or from anywhere known. */
let scope: 'here' | 'anywhere' = 'anywhere';

export function ago(clock: number, t: number): string {
  const m = Math.max(0, Math.round((clock - t) / 60));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

export const RISK_WORD = { patrolled: 'Patrolled', thin: 'Thin patrols', lawless: 'Lawless' } as const;

/**
 * The trade computer (docs/PROCGEN.md §16): the best routes between prices the player has had,
 * by profit per minute, and the watched prices.
 */
export function computerContent(ctx: StationContext, refresh: Refresh): HTMLElement {
  const { state, locationId } = ctx;
  const docked = hasMarket(locationId);
  const fromHere = docked && scope === 'here';
  const routes = tradeRoutes(state, locationId, { fromHere });
  const tab = (value: typeof scope, label: string) =>
    button(label, {
      size: 'sm',
      variant: scope === value ? 'primary' : 'ghost',
      testId: `computer-${value}`,
      onClick: () => {
        scope = value;
        refresh();
      },
    });
  return h(
    'div',
    { class: 'stack computer', 'data-testid': 'computer' },
    h('p', { class: 'muted small' }, `Only prices you have had: seen at a dock, read in a briefing, heard in a bar or relayed by your price watch. A full hold of ${cargoCapacity(state.ship)} units, and ${formatCredits(state.credits)} to spend.`),
    docked ? h('div', { class: 'row wrap segmented' }, tab('anywhere', 'Anywhere'), tab('here', 'Buy here')) : null,
    routes.length
      ? h('ul', { class: 'list routes' }, routes.map((r) => routeRow(ctx, r, refresh)))
      : h('p', { class: 'list-empty', 'data-testid': 'computer-empty' }, fromHere ? 'No profitable route from here that you know of.' : 'No profitable route known yet. Visit markets, read briefings or buy a round in a bar.'),
    watchList(ctx, refresh),
  );
}

function routeRow(ctx: StationContext, r: TradeRoute, refresh: Refresh): HTMLElement {
  const { state } = ctx;
  const a = getLocation(r.from);
  const b = getLocation(r.to);
  const where = (l: typeof a) => (l.systemId === state.location.systemId ? l.name : `${l.name} (${getSystem(l.systemId).displayName})`);
  const age = (id: string, s: number) => (id === ctx.locationId ? 'live' : ago(state.clock, state.clock - s));
  const watched = state.priceWatch.some((w) => w.locationId === r.to && w.commodity === r.commodity);
  return h(
    'li',
    { class: `trade-row route${r.stale ? ' stale' : ''}`, 'data-testid': `route-${r.commodity}-${r.from}-${r.to}` },
    glyph(COMMODITY_GLYPH[r.commodity]),
    h(
      'span',
      { class: 'trade-text' },
      h('span', { class: 'row-name' }, `${COMMODITIES[r.commodity].name}: ${where(a)} → ${where(b)}`),
      h('span', { class: 'row-sub' }, `Buy ${r.buy} cr (${age(r.from, r.buyAge)}) · sell ${r.sell} cr (${age(r.to, r.sellAge)}) · ${r.items} items${r.fees ? ` · fees ${r.fees} cr` : ''}`),
      h(
        'span',
        { class: 'person-tags' },
        h('span', { class: `tag risk-${r.risk}` }, RISK_WORD[r.risk]),
        r.stale ? h('span', { class: 'tag muted' }, 'Old prices') : null,
        ...r.notes.map((n) => h('span', { class: 'tag news' }, n)),
      ),
    ),
    h('span', { class: 'row-value num pos stack-tight' }, h('strong', null, `+${formatCredits(r.profit)}`), h('small', null, `${r.minutes} min · ${r.perMinute} cr/min`)),
    button(watched ? 'Watching' : 'Watch', {
      size: 'sm',
      variant: 'ghost',
      testId: `watch-${r.commodity}-${r.to}`,
      ariaLabel: `${watched ? 'Stop watching' : 'Watch'} ${COMMODITIES[r.commodity].name} at ${b.name}`,
      onClick: () => {
        const res = toggleWatch(state, r.to, r.commodity);
        toast(res.message, res.ok ? 'info' : 'bad', 3000);
        ctx.save();
        refresh();
      },
    }),
  );
}

function watchList(ctx: StationContext, refresh: Refresh): HTMLElement {
  const { state } = ctx;
  return h(
    'section',
    { 'aria-label': 'Price watch' },
    h('div', { class: 'list-head' }, h('span', null, 'Price watch'), h('span', null, `${state.priceWatch.length}/${PEOPLE.watch.max}`)),
    state.priceWatch.length
      ? h(
          'ul',
          { class: 'list', 'data-testid': 'price-watch' },
          state.priceWatch.map((w) => {
            const obs = state.knownMarkets[w.locationId];
            const q = obs?.prices[w.commodity];
            const loc = getLocation(w.locationId);
            const how = obs ? { rumour: 'heard', watch: 'watched', briefing: 'briefed', visited: 'seen' }[knownVia(obs, w.commodity)] : null;
            return h(
              'li',
              { class: 'trade-row' },
              glyph(COMMODITY_GLYPH[w.commodity]),
              h(
                'span',
                { class: 'trade-text' },
                h('span', { class: 'row-name' }, `${COMMODITIES[w.commodity].name} at ${loc.name}`),
                h('span', { class: 'row-sub' }, q && obs ? `Buy ${q.buy ?? '—'} · sell ${q.sell ?? '—'} cr · ${how} ${ago(state.clock, knownAt(obs, w.commodity))}` : 'No price yet'),
              ),
              button('Stop', {
                size: 'sm',
                variant: 'ghost',
                testId: `unwatch-${w.commodity}-${w.locationId}`,
                onClick: () => {
                  toggleWatch(state, w.locationId, w.commodity);
                  ctx.save();
                  refresh();
                },
              }),
            );
          }),
        )
      : h('p', { class: 'list-empty' }, `Watch a price from a route above or at a trader: docking within ${PEOPLE.watch.reach} jumps brings it up to date.`),
  );
}
