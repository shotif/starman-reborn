import type { SfxId } from '../../audio/types.ts';
import { voyageTotals, type CommodityId, type GameState } from '../../app/state.ts';
import { getLocation, getSystem } from '../../data/systems.ts';
import type { SystemId } from '../../data/types.ts';
import { CARGO_CAPACITY, cargoCount, cargoUsed, itemsThatFit } from '../../economy/cargo.ts';
import { COMMODITIES, COMMODITY_IDS } from '../../economy/commodities.ts';
import { welcomeText } from '../../economy/dockText.ts';
import { buyShopItem, describeShopItem, repairHull, repairQuote, shopItems } from '../../economy/equipment.ts';
import { FACTIONS, standingTier, TIER_LABEL } from '../../economy/factions.ts';
import { canDeliver, describeObjective, jobsAt, type JobOffer } from '../../economy/jobs.ts';
import { hasMarket, quote } from '../../economy/markets.ts';
import { bestKnownSale, buyCommodity, maxBuyable, routeOpportunities, sellCommodity } from '../../economy/trade.ts';
import { button, dataBadge, showModal, toast } from '../components.ts';
import { formatCredits, h, replaceChildren, signed } from '../dom.ts';
import { icon } from '../icons.ts';
import '../styles/dock.css';

export interface DockContext {
  state: GameState;
  locationId: string;
  /** Persist after any change. */
  save(): void;
  sfx(id: SfxId): void;
  launch(): void;
  openMap(): void;
  openEncyclopedia(): void;
  acceptJob(jobId: string): void;
  deliverJob(jobId: string): void;
  /** Jump fees between systems (0 when covered by a contract). */
  travelCost(from: SystemId, to: SystemId): number;
}

type Tab = 'overview' | 'market' | 'outfitter' | 'contracts';

const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview',
  market: 'Market',
  outfitter: 'Outfitter',
  contracts: 'Contracts',
};

function ago(state: GameState, t: number): string {
  const s = Math.max(0, state.clock - t);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

/** The docked station UI. Re-renders its active tab after every transaction. */
export class DockScreen {
  readonly root: HTMLElement;
  private readonly ctx: DockContext;
  private tab: Tab = 'overview';
  private readonly body: HTMLElement;
  private readonly header: HTMLElement;
  private readonly tabBar: HTMLElement;

  constructor(parent: HTMLElement, ctx: DockContext, initialTab: Tab = 'overview') {
    this.ctx = ctx;
    this.tab = initialTab;
    this.header = h('div', { class: 'dock-header' });
    this.tabBar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Station services' });
    this.body = h('div', { class: 'dock-body scroll', role: 'tabpanel' });
    const footer = h(
      'div',
      { class: 'dock-footer' },
      button('Star map', { icon: 'map', onClick: () => ctx.openMap(), testId: 'dock-map' }),
      button('Launch', { icon: 'launch', variant: 'primary', size: 'lg', onClick: () => ctx.launch(), testId: 'dock-launch' }),
    );
    this.root = h(
      'section',
      { class: 'dock-screen', 'aria-label': 'Docked station', 'data-testid': 'dock-screen' },
      h('div', { class: 'panel dock-panel' }, this.header, this.tabBar, this.body, footer),
    );
    parent.appendChild(this.root);
    this.render();
    // Keyboard users land on the station tabs.
    this.tabBar.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
  }

  setTab(tab: Tab): void {
    this.tab = tab;
    this.render();
  }

  destroy(): void {
    this.root.remove();
  }

  render(): void {
    const { state, locationId } = this.ctx;
    const loc = getLocation(locationId);
    const faction = loc.factionId ? FACTIONS[loc.factionId] : null;
    const standing = loc.factionId ? state.reputation[loc.factionId] ?? 0 : 0;
    const welcome = welcomeText(state, locationId);
    replaceChildren(
      this.header,
      h(
        'div',
        { class: 'spread wrap' },
        h(
          'div',
          null,
          h('div', { class: 'eyebrow' }, `${getSystem(loc.systemId).displayName} · docked`),
          h('h2', { class: 'dock-title' }, loc.name, ' ', dataBadge('fictional')),
        ),
        h(
          'div',
          { class: 'dock-wallet' },
          h('div', { class: 'row' }, icon('credits'), h('strong', { class: 'num', 'data-testid': 'dock-credits' }, formatCredits(state.credits))),
          h('div', { class: 'row muted' }, icon('cargo'), h('span', { class: 'num' }, `${cargoUsed(state.ship.cargo)}/${CARGO_CAPACITY} cargo units`)),
        ),
      ),
      h(
        'p',
        { class: `welcome${welcome.improved ? ' improved' : ''}`, 'data-testid': 'dock-welcome' },
        welcome.text,
        faction ? h('span', { class: 'standing' }, ` ${faction.shortName}: ${TIER_LABEL[standingTier(standing)]} (${signed(standing)})`) : null,
      ),
    );
    const tabs: Tab[] = ['overview'];
    if (hasMarket(locationId)) tabs.push('market');
    if (shopItems(locationId).length) tabs.push('outfitter');
    tabs.push('contracts');
    if (!tabs.includes(this.tab)) this.tab = 'overview';
    replaceChildren(
      this.tabBar,
      tabs.map((t) => {
        const hasAction = t === 'contracts' && this.contractsNeedAttention();
        return h(
          'button',
          {
            type: 'button',
            class: 'tab',
            role: 'tab',
            'aria-selected': String(t === this.tab),
            'data-testid': `dock-tab-${t}`,
            onClick: () => this.setTab(t),
          },
          TAB_LABEL[t],
          hasAction ? h('span', { class: 'tab-dot', 'aria-label': 'needs attention' }, ' ●') : null,
        );
      }),
    );
    const content =
      this.tab === 'market'
        ? this.renderMarket()
        : this.tab === 'outfitter'
          ? this.renderOutfitter()
          : this.tab === 'contracts'
            ? this.renderContracts()
            : this.renderOverview();
    replaceChildren(this.body, content);
  }

  private contractsNeedAttention(): boolean {
    const { state, locationId } = this.ctx;
    return jobsAt(state, locationId).some((o) => o.status === 'available') ||
      Object.keys(state.jobs).some((id) => canDeliver(state, id, locationId));
  }

  private changed(): void {
    this.ctx.save();
    this.render();
  }

  // ---------------------------------------------------------------- overview

  private renderOverview(): HTMLElement {
    const { state, locationId } = this.ctx;
    const loc = getLocation(locationId);
    const repair = repairQuote(state, locationId);
    const canRepair = loc.services.includes('repair');
    const parts: HTMLElement[] = [];
    parts.push(h('p', { class: 'muted' }, loc.description));
    if (state.location.dockedAt === 'mars-depot' && state.flags.clearance) {
      parts.push(h('div', { class: 'callout good' }, icon('jump'), 'Interstellar departure clearance: granted. Open the star map in flight to jump.'));
    }
    const hullRow = h(
      'div',
      { class: 'overview-card' },
      h('h3', null, 'Ship'),
      h(
        'dl',
        { class: 'kv' },
        h('dt', null, 'Hull'),
        h('dd', { class: 'num' }, `${Math.round(state.ship.hull)} / 100`),
        h('dt', null, 'Missiles'),
        h('dd', { class: 'num' }, String(state.ship.missiles)),
        h('dt', null, 'Repair kits'),
        h('dd', { class: 'num' }, String(state.ship.repairKits)),
      ),
      canRepair && repair.points > 0
        ? button(`Repair hull (${formatCredits(repair.cost)}${repair.discount ? `, ${Math.round(repair.discount * 100)}% standing discount` : ''})`, {
            icon: 'repair',
            testId: 'dock-repair',
            disabled: state.credits <= 0,
            onClick: () => {
              const r = repairHull(state, locationId);
              if (r.points > 0) {
                this.ctx.sfx('repair');
                toast(`Repaired ${r.points} hull for ${formatCredits(r.cost)}`, 'good');
              }
              this.changed();
            },
          })
        : h('p', { class: 'muted small' }, repair.points > 0 ? 'No repair service here.' : 'Hull fully repaired.'),
    );
    parts.push(hullRow);

    const voyage = this.renderVoyage();
    if (voyage) parts.push(voyage);

    parts.push(
      h(
        'div',
        { class: 'overview-card' },
        h('h3', null, 'Standing ', dataBadge('fictional')),
        h(
          'dl',
          { class: 'kv' },
          (['sta', 'frontier'] as const).flatMap((f) => [
            h('dt', null, FACTIONS[f].name),
            h('dd', null, `${TIER_LABEL[standingTier(state.reputation[f] ?? 0)]} (${signed(state.reputation[f] ?? 0)})`),
          ]),
        ),
        h('p', { class: 'muted small' }, 'Friendly standing improves prices and repairs at that faction’s docks and opens more contracts.'),
      ),
    );
    parts.push(
      h(
        'div',
        { class: 'row wrap' },
        button('About this system', { icon: 'source', onClick: () => this.ctx.openEncyclopedia() }),
      ),
    );
    return h('div', { class: 'stack' }, parts);
  }

  private renderVoyage(): HTMLElement | null {
    const { state } = this.ctx;
    if (!state.flags.voyage) return null;
    const t = voyageTotals(state, state.voyageStartClock);
    if (!state.ledger.some((e) => e.t >= state.voyageStartClock)) return null;
    const row = (label: string, value: number) => [h('dt', null, label), h('dd', { class: `num ${value >= 0 ? 'pos' : 'neg'}` }, signed(value) + ' cr')];
    const held = COMMODITY_IDS.filter((c) => cargoCount(state.ship.cargo, c) > 0)
      .map((c) => `${cargoCount(state.ship.cargo, c)} ${COMMODITIES[c].name.toLowerCase()}`)
      .join(', ');
    return h(
      'div',
      { class: 'overview-card', 'data-testid': 'voyage-report' },
      h('h3', null, 'Voyage report since Halcyon Ring'),
      h(
        'dl',
        { class: 'kv' },
        row('Trade (sales − purchases)', t.trade),
        row('Bounties and salvage', t.bountiesAndSalvage),
        row('Contract rewards', t.rewards),
        row('Repairs and rescue', t.repairsAndRescue),
        row('Jump fees', t.fees),
        row('Equipment', t.equipment),
        h('dt', null, h('strong', null, 'Net change')),
        h('dd', { class: `num ${t.net >= 0 ? 'pos' : 'neg'}` }, h('strong', null, signed(t.net) + ' cr')),
      ),
      held ? h('p', { class: 'muted small' }, `Still in the hold (not yet sold): ${held}.`) : null,
    );
  }

  // ---------------------------------------------------------------- market

  private renderMarket(): HTMLElement {
    const { state, locationId } = this.ctx;
    const rows = COMMODITY_IDS.map((c) => {
      const q = quote(locationId, c, state.reputation);
      if (q.buy === null && q.sell === null) return null;
      const have = cargoCount(state.ship.cargo, c);
      const best = bestKnownSale(state, c, locationId);
      const bestText = best
        ? `${getLocation(best.locationId).name}: ${best.price} cr (${best.source === 'briefing' ? 'posted in briefing' : 'visited'})`
        : 'No other market known yet';
      return h(
        'tr',
        { 'data-testid': `market-row-${c}` },
        h('td', null, h('strong', null, COMMODITIES[c].name), h('div', { class: 'muted small' }, `${COMMODITIES[c].unitSize} cargo unit${COMMODITIES[c].unitSize > 1 ? 's' : ''} each`)),
        h('td', { class: 'right num' }, q.buy === null ? '—' : `${q.buy}`),
        h('td', { class: 'right num' }, q.sell === null ? '—' : `${q.sell}`),
        h('td', { class: 'right num' }, String(have)),
        h('td', { class: 'small muted best-known' }, bestText),
        h(
          'td',
          { class: 'right actions' },
          q.buy !== null
            ? button('Buy', {
                size: 'sm',
                testId: `buy-${c}`,
                disabled: maxBuyable(state, locationId, c) === 0,
                onClick: () => void this.openBuyDialog(c),
              })
            : null,
          q.sell !== null && have > 0
            ? button('Sell', { size: 'sm', testId: `sell-${c}`, onClick: () => void this.openSellDialog(c) })
            : null,
        ),
      );
    }).filter((r): r is HTMLTableRowElement => r !== null);

    return h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table market' },
          h(
            'thead',
            null,
            h('tr', null, h('th', null, 'Commodity'), h('th', { class: 'right' }, 'Buy'), h('th', { class: 'right' }, 'Sell'), h('th', { class: 'right' }, 'Held'), h('th', null, 'Best known elsewhere'), h('th', null, '')),
          ),
          h('tbody', null, rows),
        ),
      ),
      h('p', { class: 'muted small' }, 'Prices in credits per item. “Buy” is what you pay here; “Sell” is what this dock pays you. Goods, prices and markets are game fiction.'),
      this.renderTradeComputer(),
    );
  }

  private renderTradeComputer(): HTMLElement {
    const { state, locationId } = this.ctx;
    const opps = routeOpportunities(state, locationId, (a, b) => this.ctx.travelCost(a, b)).slice(0, 4);
    return h(
      'div',
      { class: 'overview-card', 'data-testid': 'trade-computer' },
      h('h3', null, 'Trade computer'),
      h('p', { class: 'muted small' }, 'Expected returns for buying here, using only prices you have seen at visited docks or been told in contract briefings. Estimates exclude repairs.'),
      opps.length
        ? h(
            'ul',
            { class: 'route-list' },
            opps.map((o) => {
              const dest = getLocation(o.destinationId);
              return h(
                'li',
                null,
                h('strong', null, `${COMMODITIES[o.commodity].name} → ${dest.name}`),
                h('span', { class: 'muted' }, ` (${getSystem(o.destinationSystemId).displayName}, ${o.source === 'briefing' ? 'posted in briefing' : `seen ${ago(state, o.observedAt)}`})`),
                h(
                  'div',
                  { class: 'num small' },
                  `${o.buyPrice} → ${o.sellPrice} cr: ${signed(o.profitPerItem)} per item × ${o.items} = ${signed(o.grossProfit)} cr`,
                  o.travelCost ? `, jump fees −${o.travelCost} cr` : o.destinationSystemId !== this.ctx.state.location.systemId ? ', jump fee covered' : '',
                  ` → net ${signed(o.netProfit)} cr`,
                ),
              );
            }),
          )
        : h('p', { class: 'muted' }, 'No profitable route known yet. Visit more docks (or accept a contract with a price briefing) to fill in the trade computer.'),
    );
  }

  private async openBuyDialog(c: CommodityId): Promise<void> {
    const { state, locationId } = this.ctx;
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
      h('p', null, COMMODITIES[c].description),
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
        { label: 'Confirm purchase', value: 'ok', variant: 'primary', testId: 'buy-confirm' },
      ],
      dismissValue: 'cancel',
      testId: 'buy-dialog',
    });
    if (choice !== 'ok') return;
    const r = buyCommodity(state, locationId, c, qty);
    if (r.ok) {
      this.ctx.sfx('credits');
      toast(`Bought ${r.qty} ${COMMODITIES[c].name} for ${formatCredits(r.total)}`, 'good');
    } else {
      this.ctx.sfx('ui-error');
      toast(r.message, 'bad');
    }
    this.changed();
  }

  private async openSellDialog(c: CommodityId): Promise<void> {
    const { state, locationId } = this.ctx;
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
      this.ctx.sfx('credits');
      toast(`Sold ${r.qty} ${COMMODITIES[c].name} for ${formatCredits(r.total)}`, 'good');
    } else {
      toast(r.message, 'bad');
    }
    this.changed();
  }

  // ---------------------------------------------------------------- outfitter

  private renderOutfitter(): HTMLElement {
    const { state, locationId } = this.ctx;
    const items = shopItems(locationId).map((id) => describeShopItem(state, id));
    return h(
      'div',
      { class: 'stack' },
      h(
        'ul',
        { class: 'shop-list' },
        items.map((it) =>
          h(
            'li',
            { class: 'shop-item', 'data-testid': `shop-${it.id}` },
            h('div', { class: 'grow' }, h('strong', null, it.name), h('div', { class: 'muted small' }, it.detail)),
            h('div', { class: 'num price' }, it.owned ? 'Installed' : formatCredits(it.price)),
            it.owned
              ? null
              : button('Buy', {
                  size: 'sm',
                  disabled: !!it.blocked,
                  title: it.blocked ?? undefined,
                  testId: `buy-${it.id}`,
                  onClick: () => void this.confirmShop(it.id, it.name, it.price, it.detail),
                }),
            it.blocked && !it.owned ? h('div', { class: 'blocked small' }, it.blocked) : null,
          ),
        ),
      ),
      h('p', { class: 'muted small' }, 'Ship equipment is game fiction. Upgrades take effect immediately.'),
    );
  }

  private async confirmShop(id: Parameters<typeof buyShopItem>[2], name: string, price: number, detail: string): Promise<void> {
    const { state, locationId } = this.ctx;
    const choice = await showModal({
      title: `Buy ${name}?`,
      body: h('div', { class: 'stack' }, h('p', null, detail), h('p', { class: 'num' }, `Price ${formatCredits(price)} · credits after ${formatCredits(state.credits - price)}`)),
      actions: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Buy and install', value: 'ok', variant: 'primary', testId: 'shop-confirm' },
      ],
      dismissValue: 'cancel',
    });
    if (choice !== 'ok') return;
    const r = buyShopItem(state, locationId, id);
    this.ctx.sfx(r.ok ? 'ui-confirm' : 'ui-error');
    toast(r.message, r.ok ? 'good' : 'bad');
    this.changed();
  }

  // ---------------------------------------------------------------- contracts

  private renderContracts(): HTMLElement {
    const { state, locationId } = this.ctx;
    const offers = jobsAt(state, locationId);
    const deliverable = Object.keys(state.jobs).filter((id) => canDeliver(state, id, locationId));
    const active = Object.entries(state.jobs)
      .filter(([, p]) => p.status === 'active')
      .map(([id]) => describeObjective(state, id))
      .filter((o): o is NonNullable<typeof o> => o !== null);
    return h(
      'div',
      { class: 'stack' },
      deliverable.length
        ? h(
            'div',
            { class: 'callout good' },
            icon('cargo'),
            h('span', { class: 'grow' }, 'Cargo for an active contract can be delivered here.'),
            deliverable.map((id) =>
              button('Deliver', { variant: 'primary', testId: `deliver-${id}`, onClick: () => this.ctx.deliverJob(id) }),
            ),
          )
        : null,
      offers.length
        ? h('ul', { class: 'job-list' }, offers.map((o) => this.renderOffer(o)))
        : h('p', { class: 'muted' }, 'No contracts posted at this dock.'),
      active.length
        ? h(
            'div',
            { class: 'overview-card' },
            h('h3', null, 'Your active contracts'),
            h('ul', { class: 'plain' }, active.map((o) => h('li', null, h('strong', null, o.jobTitle), ': ', o.text))),
          )
        : null,
    );
  }

  private renderOffer(o: JobOffer): HTMLElement {
    const job = o.job;
    const dest = getLocation(job.destinationLocationId);
    const stars = '★'.repeat(job.difficulty) + '☆'.repeat(3 - job.difficulty);
    return h(
      'li',
      { class: `job ${o.status}`, 'data-testid': `job-${job.id}` },
      h(
        'div',
        { class: 'spread wrap' },
        h('h3', null, job.title, ' ', dataBadge('fictional')),
        h('span', { class: 'num reward' }, formatCredits(job.reward)),
      ),
      h('p', null, job.briefing),
      h(
        'dl',
        { class: 'kv' },
        h('dt', null, 'Destination'),
        h('dd', null, `${dest.name} (${getSystem(dest.systemId).displayName})`),
        h('dt', null, 'Difficulty'),
        h('dd', null, h('span', { 'aria-label': `${job.difficulty} of 3` }, stars), ` · ${job.difficultyNote}`),
        h('dt', null, 'Objectives'),
        h('dd', null, h('ol', { class: 'objectives' }, job.objectives.map((x) => h('li', null, x.text)))),
      ),
      o.status === 'available'
        ? button('Accept contract', { variant: 'primary', testId: `accept-${job.id}`, onClick: () => this.ctx.acceptJob(job.id) })
        : o.status === 'locked'
          ? h('p', { class: 'blocked' }, icon('alert'), ` ${o.lockReason}`)
          : h('p', { class: 'muted' }, o.status === 'active' ? 'Accepted — in progress.' : 'Completed.'),
    );
  }
}
