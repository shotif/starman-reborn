import { treatWing, wingTreatQuote } from '../../economy/wing.ts';
import { getLocation } from '../../data/systems.ts';
import { gearItem, shipModel } from '../../content/catalog.ts';
import { cargoUsed } from '../../economy/cargo.ts';
import {
  ammoOffers,
  buyAmmo,
  buyGear,
  buyRepairKit,
  gearOffers,
  REPAIR_KIT,
  repairHull,
  repairKitOffer,
  repairQuote,
  sellGear,
  sellQuote,
  sellsEquipment,
  type ConsumableOffer,
  type GearOffer,
} from '../../economy/equipment.ts';
import { fittedItem, fittedLaunchers, gunSummary, performanceOf, roundsLabel, shipSlots } from '../../economy/loadout.ts';
import { buyDecoy, decoyOffer, fitFromStash, repairSystems, sellFromStash, stashOffers, systemsQuote } from '../../economy/combat.ts';
import { crewLine, treatCrew, treatQuote } from '../../economy/crew.ts';
import { COMBAT } from '../../content/combat/rules.ts';
import { button, showModal, toast } from '../components.ts';
import { formatCredits, h } from '../dom.ts';
import { glyph } from '../glyphs.ts';
import type { Refresh, StationContext } from './context.ts';
import { gearGlyph, gearLine, shipKind, slotGlyph, slotLabel } from './gearText.ts';
import { priceWords, rankNote } from './shipyard.ts';

const bar = (label: string, value: number, max: number, color: string, text: string) =>
  h('div', { class: 'statbar' }, label, h('div', { class: 'segbar', style: `--fill: ${max > 0 ? Math.max(0, Math.min(1, value / max)) : 0}; --seg-color: ${color}` }), h('span', { class: 'num' }, text));

/**
 * Your ship as fitted: hull, shield, guns, rounds, kits and hold, with a repair action. The compact
 * form (hangar deck) folds rounds and kits into one line and leaves the hold to the header.
 */
export function shipStatus(ctx: StationContext, refresh: Refresh, opts: { repair: boolean; compact?: boolean }): HTMLElement {
  const { state, locationId } = ctx;
  const ship = state.ship;
  const model = shipModel(ship.model);
  const perf = performanceOf(ship);
  const repair = repairQuote(state, locationId);
  // Raider dens patch up the pilots they take in.
  const canRepair = getLocation(locationId).services.includes('repair') || getLocation(locationId).stationType === 'pirate-den';
  return h(
    'div',
    { class: 'ship-status stack', 'data-testid': 'ship-status' },
    h('div', { class: 'ship-title' }, h('strong', null, model.name), h('span', { class: 'muted' }, shipKind(model))),
    bar('Hull', ship.hull, perf.hullMax, 'var(--hull)', `${Math.round(ship.hull)}/${perf.hullMax}`),
    bar('Shield', perf.shield ? 1 : 0, 1, 'var(--shield)', perf.shield ? `${perf.shield.capacity} ${perf.shield.shieldType}` : 'none'),
    h('div', { class: 'statbar' }, 'Guns', h('span', { class: 'ship-guns' }, gunSummary(ship))),
    opts.compact
      ? h(
          'div',
          { class: 'statbar' },
          'Racks',
          h(
            'span',
            { class: 'ship-guns' },
            [
              ...fittedLaunchers(ship).map((l) => `${l.ammo}/${l.stats.maxAmmo} ${roundsLabel(l.stats.kind).toLowerCase()}`),
              `${ship.repairKits}/${REPAIR_KIT.max} kits`,
              `${ship.decoys}/${COMBAT.decoys.max} decoys`,
            ].join(' · '),
          ),
        )
      : [
          fittedLaunchers(ship).map((l) => bar(roundsLabel(l.stats.kind), l.ammo, l.stats.maxAmmo, 'var(--amber)', `${l.ammo}/${l.stats.maxAmmo}`)),
          bar('Repair kits', ship.repairKits, REPAIR_KIT.max, 'var(--friendly)', `${ship.repairKits}/${REPAIR_KIT.max}`),
          bar('Decoys', ship.decoys, COMBAT.decoys.max, 'var(--warm)', `${ship.decoys}/${COMBAT.decoys.max}`),
          bar('Cargo', cargoUsed(ship.cargo), perf.cargo, 'var(--amber)', `${cargoUsed(ship.cargo)}/${perf.cargo}`),
        ],
    systemsLine(ship),
    // The crew aboard (docs/PROCGEN.md §30), and a medic for the hurt where ships are repaired.
    crewLine(state) ? h('div', { class: 'statbar', 'data-testid': 'ship-crew' }, 'Crew', h('span', { class: 'ship-guns' }, crewLine(state))) : null,
    opts.repair && treatQuote(state, locationId) > 0
      ? button(`Treat the crew · ${formatCredits(treatQuote(state, locationId))}`, {
          icon: 'repair',
          testId: 'dock-treat-crew',
          disabled: state.credits < treatQuote(state, locationId),
          onClick: () => {
            const r = treatCrew(state, locationId);
            ctx.sfx(r.ok ? 'repair' : 'ui-error');
            toast(r.message, r.ok ? 'good' : 'bad');
            ctx.save();
            refresh();
          },
        })
      : null,
    // The wing's hurt (docs/PROCGEN.md §34), seen to by the same medic.
    opts.repair && wingTreatQuote(state, locationId) > 0
      ? button(`Treat your wing · ${formatCredits(wingTreatQuote(state, locationId))}`, {
          icon: 'repair',
          testId: 'dock-treat-wing',
          disabled: state.credits < wingTreatQuote(state, locationId),
          onClick: () => {
            const r = treatWing(state, locationId);
            ctx.sfx(r.ok ? 'repair' : 'ui-error');
            toast(r.message, r.ok ? 'good' : 'bad');
            ctx.save();
            refresh();
          },
        })
      : null,
    opts.repair && canRepair && systemsQuote(state, locationId) > 0
      ? button(`Repair systems · ${formatCredits(systemsQuote(state, locationId))}`, {
          icon: 'repair',
          testId: 'dock-repair-systems',
          disabled: state.credits < systemsQuote(state, locationId),
          onClick: () => {
            const r = repairSystems(state, locationId);
            ctx.sfx(r.ok ? 'repair' : 'ui-error');
            toast(r.ok ? `Systems repaired for ${formatCredits(r.cost)}` : 'Not enough credits', r.ok ? 'good' : 'bad');
            ctx.save();
            refresh();
          },
        })
      : null,
    opts.repair && canRepair && repair.points > 0
      ? button(`Repair hull · ${formatCredits(repair.cost)}${repair.discount > 0 ? ` (−${Math.round(repair.discount * 100)}%)` : repair.discount < 0 ? ` (+${Math.round(-repair.discount * 100)}%)` : ''}`, {
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

/**
 * The equipment dealer. Left: your ship's mounts (pick one). Right: what is on sale for that mount,
 * priced after the dealer buys back what it replaces, plus rounds and repair kits.
 */
export function outfitterContent(ctx: StationContext, refresh: Refresh, selected: string | null, onSelect: (slotId: string) => void): HTMLElement {
  const { state, locationId } = ctx;
  const slots = shipSlots(state.ship);
  const slot = slots.find((s) => s.id === selected) ?? slots[0]!;
  const current = fittedItem(state.ship, slot.id);
  const offers = sellsEquipment(locationId) ? gearOffers(state, locationId, slot.id) : [];
  const sale = current ? sellQuote(state, locationId, slot.id) : null;
  const supplies: ConsumableOffer[] = [...ammoOffers(state, locationId)];
  const kit = repairKitOffer(state, locationId);
  if (kit) supplies.push(kit);
  const decoy = decoyOffer(state, locationId);
  if (decoy) supplies.push({ id: 'decoy', name: COMBAT.decoys.name, price: decoy.price, have: decoy.have, max: decoy.max, blocked: decoy.blocked });
  const stash = stashOffers(state, locationId);

  const mounts = h(
    'ul',
    { class: 'list slot-list', 'aria-label': 'Mounts' },
    slots.map((s) => {
      const item = fittedItem(state.ship, s.id);
      return h(
        'li',
        null,
        h(
          'button',
          {
            type: 'button',
            class: 'list-row',
            'aria-selected': String(s.id === slot.id),
            'data-testid': `slot-${s.id}`,
            onClick: () => onSelect(s.id),
          },
          glyph(slotGlyph(s, item)),
          h('span', null, h('span', { class: 'row-name' }, item ? item.short : 'Empty'), h('span', { class: 'row-sub' }, `${slotLabel(s, slots)} · class ≤${s.maxClass}`)),
          h('span', { class: 'row-value' }, item ? `C${item.tier}` : '—'),
        ),
      );
    }),
  );

  const forSale = sellsEquipment(locationId)
    ? offers.length
      ? h('ul', { class: 'list' }, offers.map((o) => offerRow(ctx, o, slot.id, refresh)))
      : h('p', { class: 'list-empty' }, `Nothing for this mount here.`)
    : h('p', { class: 'list-empty' }, 'No equipment dealer at this station: supplies only.');

  return h(
    'div',
    { class: 'outfitter' },
    h(
      'section',
      { class: 'outfitter-mounts', 'aria-label': 'Your ship' },
      h('div', { class: 'list-head' }, h('span', null, 'Your ship'), h('span', null, 'Class')),
      mounts,
    ),
    h(
      'section',
      { class: 'outfitter-status', 'aria-label': 'Status' },
      h('div', { class: 'list-head' }, h('span', null, 'Status'), h('span', null, '')),
      shipStatus(ctx, refresh, { repair: true }),
    ),
    h(
      'section',
      { class: 'outfitter-sale', 'aria-label': 'For sale' },
      h('div', { class: 'list-head' }, h('span', null, `For ${slotLabel(slot, slots).toLowerCase()}`), h('span', null, 'You pay')),
      sellsEquipment(locationId) ? rankNote(ctx) : null,
      forSale,
      sale && !sale.blocked
        ? h(
            'div',
            { class: 'row wrap sell-row' },
            button(`Sell ${sale.item.short} · +${formatCredits(sale.value)}`, { size: 'sm', testId: 'sell-slot', onClick: () => void confirmSell(ctx, slot.id, refresh) }),
          )
        : null,
      supplies.length ? h('div', { class: 'list-head supplies-head' }, h('span', null, 'Supplies'), h('span', null, 'Each')) : null,
      supplies.length ? h('ul', { class: 'list' }, supplies.map((o) => supplyRow(ctx, o, refresh))) : null,
      stash.length ? h('div', { class: 'list-head supplies-head' }, h('span', null, 'Salvaged equipment'), h('span', null, `${stash.length}/${COMBAT.loot.stash}`)) : null,
      stash.length ? h('ul', { class: 'list', 'data-testid': 'stash' }, stash.map((o) => stashRow(ctx, o, slot.id, refresh))) : null,
    ),
  );
}

/** Damage to the ship's systems, when there is any. */
function systemsLine(ship: StationContext['state']['ship']): HTMLElement | null {
  const s = ship.systems;
  const hurt = (['engines', 'guns', 'shields'] as const).filter((k) => s[k] > 0).map((k) => `${k === 'shields' ? 'shield' : k} ${Math.round(s[k] * 100)}%`);
  return hurt.length ? h('p', { class: 'callout warn small', 'data-testid': 'systems-damage' }, `Damaged systems: ${hurt.join(', ')}.`) : null;
}

function mountName(ctx: StationContext, slotId: string): string {
  const slots = shipSlots(ctx.state.ship);
  const slot = slots.find((x) => x.id === slotId);
  return slot ? slotLabel(slot, slots) : slotId;
}

/** A salvaged item: fit it (into the selected mount when it fits there) or sell it. */
function stashRow(ctx: StationContext, o: ReturnType<typeof stashOffers>[number], selectedSlot: string, refresh: Refresh): HTMLElement {
  const item = gearItem(o.gearId);
  const into = o.slots.find((s) => s.id === selectedSlot) ?? o.slots[0];
  const act = (r: { ok: boolean; message: string }) => {
    ctx.sfx(r.ok ? 'ui-confirm' : 'ui-error');
    toast(r.message, r.ok ? 'good' : 'bad');
    ctx.save();
    refresh();
  };
  return h(
    'li',
    { class: 'trade-row', 'data-testid': `stash-${o.index}` },
    glyph(gearGlyph(item)),
    h(
      'span',
      { class: 'trade-text' },
      h('span', { class: 'row-name' }, o.name),
      h('span', { class: 'row-sub' }, into ? `${mountName(ctx, into.id)}${into.replaces ? `: replaces ${into.replaces}` : ': empty mount'}` : gearLine(item)),
      o.blocked ? h('span', { class: 'row-note' }, o.blocked) : null,
    ),
    h(
      'span',
      { class: 'row wrap stash-actions' },
      into && !o.blocked ? button('Fit', { size: 'sm', testId: `stash-fit-${o.index}`, onClick: () => act(fitFromStash(ctx.state, ctx.locationId, o.index, into.id)) }) : null,
      button(`Sell · ${formatCredits(o.value)}`, {
        size: 'sm',
        disabled: o.blocked === 'An equipment dealer fits and buys salvage',
        testId: `stash-sell-${o.index}`,
        onClick: () => act(sellFromStash(ctx.state, ctx.locationId, o.index)),
      }),
    ),
  );
}

function offerRow(ctx: StationContext, o: GearOffer, slotId: string, refresh: Refresh): HTMLElement {
  return h(
    'li',
    { class: `trade-row${o.fitted ? ' owned' : ''}`, 'data-testid': `shop-${o.item.id}` },
    glyph(gearGlyph(o.item)),
    h(
      'span',
      { class: 'trade-text' },
      h('span', { class: 'row-name' }, o.item.name),
      h('span', { class: 'row-sub' }, gearLine(o.item)),
      o.blocked && !o.fitted ? h('span', { class: 'row-note' }, o.blocked) : null,
    ),
    h('span', { class: `row-value num${o.net < 0 ? ' pos' : ''}` }, o.fitted ? 'Fitted' : formatCredits(o.net)),
    o.fitted
      ? h('span')
      : button('Buy', {
          size: 'sm',
          disabled: !!o.blocked,
          title: o.blocked ?? undefined,
          testId: `buy-${o.item.id}`,
          onClick: () => void confirmBuy(ctx, o, slotId, refresh),
        }),
  );
}

function supplyRow(ctx: StationContext, o: ConsumableOffer, refresh: Refresh): HTMLElement {
  const isKit = o.id === 'repair-kit';
  const isDecoy = o.id === 'decoy';
  return h(
    'li',
    { class: 'trade-row', 'data-testid': isKit ? 'supply-repair-kit' : `supply-${o.id}` },
    glyph(isKit ? 'repair' : isDecoy ? 'scanner' : 'missile'),
    h(
      'span',
      { class: 'trade-text' },
      h('span', { class: 'row-name' }, o.name),
      h('span', { class: 'row-sub' }, o.blocked && o.blocked !== 'Rack full' && o.blocked !== 'Kit storage full' && o.blocked !== 'Launcher full' ? o.blocked : `${o.have}/${o.max} carried`),
    ),
    h('span', { class: 'row-value num' }, formatCredits(o.price)),
    button('Buy', {
      size: 'sm',
      disabled: !!o.blocked,
      title: o.blocked ?? undefined,
      testId: isKit ? 'buy-repair-kit' : isDecoy ? 'buy-decoy' : `buy-ammo-${o.id}`,
      onClick: () => {
        const r = isKit ? buyRepairKit(ctx.state, ctx.locationId) : isDecoy ? buyDecoy(ctx.state, ctx.locationId) : buyAmmo(ctx.state, ctx.locationId, o.id);
        ctx.sfx(r.ok ? 'ui-confirm' : 'ui-error');
        if (!r.ok) toast(r.message, 'bad');
        ctx.save();
        refresh();
      },
    }),
  );
}

async function confirmBuy(ctx: StationContext, o: GearOffer, slotId: string, refresh: Refresh): Promise<void> {
  const { state, locationId } = ctx;
  const current = fittedItem(state.ship, slotId);
  const choice = await showModal({
    title: `Fit the ${o.item.name}?`,
    body: h(
      'div',
      { class: 'stack' },
      h('div', { class: 'row' }, glyph(gearGlyph(o.item)), h('p', { class: 'grow' }, o.item.description)),
      current ? h('p', { class: 'muted' }, `Replaces your ${current.name}; the dealer pays ${formatCredits(o.tradeIn)} for it.`) : null,
      h(
        'p',
        { class: 'num' },
        current ? `Price ${priceWords(o.price, o.item.price, o.discount)} − ${formatCredits(o.tradeIn)} = ${formatCredits(o.net)}` : `Price ${priceWords(o.price, o.item.price, o.discount)}`,
        ` · credits after ${formatCredits(state.credits - o.net)}`,
      ),
    ),
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Buy and fit', value: 'ok', variant: 'primary', testId: 'shop-confirm' },
    ],
    dismissValue: 'cancel',
  });
  if (choice !== 'ok') return;
  const r = buyGear(state, locationId, o.item.id, slotId);
  ctx.sfx(r.ok ? 'ui-confirm' : 'ui-error');
  toast(r.message, r.ok ? 'good' : 'bad');
  ctx.save();
  refresh();
}

async function confirmSell(ctx: StationContext, slotId: string, refresh: Refresh): Promise<void> {
  const { state, locationId } = ctx;
  const quote = sellQuote(state, locationId, slotId);
  if (!quote) return;
  const choice = await showModal({
    title: `Sell the ${quote.item.name}?`,
    body: h('p', null, `The dealer pays ${formatCredits(quote.value)}. The mount stays empty until you fit something else.`),
    actions: [
      { label: 'Keep it', value: 'cancel' },
      { label: 'Sell', value: 'ok', variant: 'primary', testId: 'sell-slot-confirm' },
    ],
    dismissValue: 'cancel',
  });
  if (choice !== 'ok') return;
  const r = sellGear(state, locationId, slotId);
  ctx.sfx(r.ok ? 'ui-confirm' : 'ui-error');
  toast(r.message, r.ok ? 'good' : 'bad');
  ctx.save();
  refresh();
}
