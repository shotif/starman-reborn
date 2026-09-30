import { getLocation } from '../../data/systems.ts';
import { buyShopItem, describeShopItem, GUNS, MISSILE, REPAIR_KIT, repairHull, repairQuote, SHIELDS, shopItems, type ShopItemId } from '../../economy/equipment.ts';
import { button, showModal, toast } from '../components.ts';
import { formatCredits, h } from '../dom.ts';
import { glyph, type GlyphName } from '../glyphs.ts';
import type { Refresh, StationContext } from './context.ts';

export function itemGlyph(id: ShopItemId): GlyphName {
  if (id === 'missile') return 'missile';
  if (id === 'repair-kit') return 'repair';
  return id.startsWith('shield') ? 'shieldgen' : 'gun';
}

const bar = (label: string, value: number, max: number, color: string, text: string) =>
  h('div', { class: 'statbar' }, label, h('div', { class: 'segbar', style: `--fill: ${Math.max(0, Math.min(1, value / max))}; --seg-color: ${color}` }), h('span', { class: 'num' }, text));

/** Your ship as fitted: hull, shield, gun, missiles and kits, with a repair action. */
export function shipStatus(ctx: StationContext, refresh: Refresh, opts: { repair: boolean }): HTMLElement {
  const { state, locationId } = ctx;
  const ship = state.ship;
  const shield = SHIELDS[ship.shieldGenerator];
  const gun = GUNS[ship.gun];
  const repair = repairQuote(state, locationId);
  const canRepair = getLocation(locationId).services.includes('repair');
  return h(
    'div',
    { class: 'ship-status stack' },
    bar('Hull', ship.hull, 100, 'var(--hull)', `${Math.round(ship.hull)}/100`),
    bar('Shield', shield.capacity, 110, 'var(--shield)', shield.name.replace(' shield', '')),
    bar('Gun', gun.damage, 13, 'var(--energy)', gun.name.replace(' pulse cannon', '')),
    bar('Missiles', ship.missiles, MISSILE.max, 'var(--amber)', `${ship.missiles}/${MISSILE.max}`),
    bar('Repair kits', ship.repairKits, REPAIR_KIT.max, 'var(--friendly)', `${ship.repairKits}/${REPAIR_KIT.max}`),
    opts.repair && canRepair && repair.points > 0
      ? button(`Repair hull · ${formatCredits(repair.cost)}${repair.discount ? ` (−${Math.round(repair.discount * 100)}%)` : ''}`, {
          icon: 'repair',
          testId: 'dock-repair',
          disabled: state.credits <= 0,
          onClick: () => {
            const r = repairHull(state, locationId);
            if (r.points > 0) {
              ctx.sfx('repair');
              toast(`Repaired ${r.points} hull for ${formatCredits(r.cost)}`, 'good');
            }
            ctx.save();
            refresh();
          },
        })
      : null,
  );
}

/** The equipment dealer: gear for sale here, and your ship as fitted. */
export function outfitterContent(ctx: StationContext, refresh: Refresh): HTMLElement {
  const { state, locationId } = ctx;
  const items = shopItems(locationId).map((id) => describeShopItem(state, id));
  return h(
    'div',
    { class: 'trade-cols' },
    h(
      'section',
      { 'aria-label': 'Equipment for sale' },
      h('div', { class: 'list-head' }, h('span', null, 'Equipment'), h('span', null, 'Price')),
      h(
        'ul',
        { class: 'list' },
        items.map((it) =>
          h(
            'li',
            { class: `trade-row${it.owned ? ' owned' : ''}`, 'data-testid': `shop-${it.id}` },
            glyph(itemGlyph(it.id)),
            h('span', { class: 'trade-text' }, h('span', { class: 'row-name' }, it.name), h('span', { class: 'row-sub' }, it.blocked && !it.owned ? it.blocked : it.detail)),
            h('span', { class: 'row-value num' }, it.owned ? 'Fitted' : formatCredits(it.price)),
            it.owned
              ? h('span')
              : button('Buy', {
                  size: 'sm',
                  disabled: !!it.blocked,
                  title: it.blocked ?? undefined,
                  testId: `buy-${it.id}`,
                  onClick: () => void confirmShop(ctx, it.id, it.name, it.price, it.detail, refresh),
                }),
          ),
        ),
      ),
    ),
    h('section', { 'aria-label': 'Your ship' }, h('div', { class: 'list-head' }, h('span', null, 'Your ship'), h('span', null, '')), shipStatus(ctx, refresh, { repair: true })),
  );
}

async function confirmShop(ctx: StationContext, id: ShopItemId, name: string, price: number, detail: string, refresh: Refresh): Promise<void> {
  const { state, locationId } = ctx;
  const choice = await showModal({
    title: `Buy ${name}?`,
    body: h(
      'div',
      { class: 'stack' },
      h('div', { class: 'row' }, glyph(itemGlyph(id)), h('p', { class: 'grow' }, detail)),
      h('p', { class: 'num' }, `Price ${formatCredits(price)} · credits after ${formatCredits(state.credits - price)}`),
    ),
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Buy and fit', value: 'ok', variant: 'primary', testId: 'shop-confirm' },
    ],
    dismissValue: 'cancel',
  });
  if (choice !== 'ok') return;
  const r = buyShopItem(state, locationId, id);
  ctx.sfx(r.ok ? 'ui-confirm' : 'ui-error');
  toast(r.message, r.ok ? 'good' : 'bad');
  ctx.save();
  refresh();
}
