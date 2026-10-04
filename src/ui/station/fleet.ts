import type { Cargo, CommodityId, OwnedShip } from '../../app/state.ts';
import { shipModel } from '../../content/catalog.ts';
import { FLEET } from '../../content/fleet/rules.ts';
import { getLocation, getSystem } from '../../data/systems.ts';
import { cargoCount, cargoUsed } from '../../economy/cargo.ts';
import { COMMODITIES, COMMODITY_IDS } from '../../economy/commodities.ts';
import { hasShipyard } from '../../economy/equipment.ts';
import {
  buyStake,
  captainFor,
  dividendFactor,
  dividendPerHour,
  haulDestinations,
  haulEstimate,
  haulerStatus,
  haulGoods,
  haulFees,
  haulTimes,
  hireBlock,
  hireHauler,
  hireWorker,
  mineTargets,
  miningEstimate,
  supplyPlan,
  supplyTargets,
  lastReport,
  leaseStorage,
  moveCargo,
  parkedAt,
  recallHauler,
  sellOffer,
  sellShip,
  sellStake,
  setInsured,
  stakeOffer,
  stakeValue,
  storageAt,
  storageMoves,
  switchShip,
  type HaulEstimate,
  type StakeOffer,
} from '../../economy/fleet.ts';
import { cargoCapacity, hullMax } from '../../economy/loadout.ts';
import { button, confirmDialog, showModal, toast } from '../components.ts';
import { formatCredits, h, replaceChildren } from '../dom.ts';
import { glyph } from '../glyphs.ts';
import { icon } from '../icons.ts';
import '../styles/fleet.css';
import { ago, RISK_WORD } from './computer.ts';
import type { Refresh, StationContext } from './context.ts';
import { shipKind } from './gearText.ts';
import { outpostSection } from './outpost.ts';
import { outpostId } from '../../content/outposts/sites.ts';
import { refineAllowance } from '../../economy/outpostTrade.ts';
import { COMMODITY_GLYPH } from './trader.ts';

/**
 * The Fleet window (docs/PROCGEN.md §18): ships parked here (switch, hire a captain, sell), the
 * haulers and ships elsewhere, storage here, stakes in station trade, and the latest reports.
 */

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const minutes = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
const goodName = (c: CommodityId) => COMMODITIES[c].name;
/** Signed credits with thousands separators: +1,234 cr, −56 cr. */
const money = (n: number) => `${Math.round(n) > 0 ? '+' : Math.round(n) < 0 ? '−' : ''}${formatCredits(Math.abs(n))}`;

function where(ctx: StationContext, id: string): string {
  const loc = getLocation(id);
  return loc.systemId === getLocation(ctx.locationId).systemId ? loc.name : `${loc.name} (${getSystem(loc.systemId).displayName})`;
}

function cargoList(cargo: Cargo): string {
  return COMMODITY_IDS.filter((c) => cargoCount(cargo, c) > 0)
    .map((c) => `${cargoCount(cargo, c)} ${goodName(c).toLowerCase()}`)
    .join(', ');
}

function shipLine(o: OwnedShip): string {
  const s = o.ship;
  return `${shipKind(shipModel(s.model))} · hull ${Math.round(s.hull)}/${hullMax(s)} · hold ${cargoUsed(s.cargo)}/${cargoCapacity(s)}`;
}

/** After any change: sound, a toast, save and redraw. */
function done(ctx: StationContext, refresh: Refresh, r: { ok: boolean; message: string }, sound: 'ui-confirm' | 'credits' = 'ui-confirm'): void {
  ctx.sfx(r.ok ? sound : 'ui-error');
  toast(r.message, r.ok ? 'good' : 'bad', 4500);
  ctx.save();
  refresh();
}

export function fleetContent(ctx: StationContext, refresh: Refresh): HTMLElement {
  const { state } = ctx;
  const owned = state.fleet.ships.length;
  return h(
    'div',
    { class: 'stack fleet', 'data-testid': 'fleet' },
    h(
      'p',
      { class: 'muted small' },
      `You own ${owned === 0 ? 'no ship' : owned === 1 ? 'one ship' : `${owned} ships`} besides the one you fly (at most ${FLEET.hangar.max}). Captains and stakes are worked out from the clock, and your captains fly the lanes, where you can meet them.`,
    ),
    h(
      'div',
      { class: 'trade-cols fleet-cols' },
      h('div', { class: 'stack' }, parkedHere(ctx, refresh), haulers(ctx, refresh), parkedElsewhere(ctx)),
      h('div', { class: 'stack' }, outpostSection(ctx, refresh), storage(ctx, refresh), stakes(ctx, refresh), reports(ctx)),
    ),
  );
}

// ---------------------------------------------------------------- ships

function parkedHere(ctx: StationContext, refresh: Refresh): HTMLElement {
  const { state, locationId } = ctx;
  const here = parkedAt(state, locationId);
  return h(
    'section',
    { 'aria-label': 'Parked here' },
    h('div', { class: 'list-head' }, h('span', null, 'Parked here'), h('span', null, `${state.fleet.ships.length}/${FLEET.hangar.max} owned`)),
    here.length
      ? h('ul', { class: 'list' }, here.map((o) => parkedRow(ctx, o, refresh)))
      : h(
          'p',
          { class: 'list-empty' },
          hasShipyard(locationId) ? 'None of your ships is parked here. At the shipyard (Ships), Buy and keep parks the ship you fly here instead of trading it in.' : 'None of your ships is parked here.',
        ),
  );
}

function parkedRow(ctx: StationContext, o: OwnedShip, refresh: Refresh): HTMLElement {
  const { state, locationId } = ctx;
  const model = shipModel(o.ship.model);
  const sale = sellOffer(state, o);
  const block = hireBlock(state, o);
  const dests = block ? [] : haulDestinations(state, o.locationId);
  const work = block ? false : supplyTargets(state).length > 0 || mineTargets(state, o).length > 0;
  const noHire = block ?? (dests.length || work ? null : 'Captains fly only to docks you have been to: dock at another market first');
  return h(
    'li',
    { class: 'trade-row fleet-row', 'data-testid': `fleet-ship-${o.id}` },
    glyph('shipyard'),
    h(
      'span',
      { class: 'trade-text' },
      h('span', { class: 'row-name' }, model.name),
      h('span', { class: 'row-sub' }, shipLine(o)),
      cargoUsed(o.ship.cargo) ? h('span', { class: 'row-sub' }, `Aboard: ${cargoList(o.ship.cargo)}`) : null,
      noHire ? h('span', { class: 'row-note' }, noHire) : null,
    ),
    h(
      'span',
      { class: 'row-actions' },
      button('Switch', { size: 'sm', testId: `fleet-switch-${o.id}`, ariaLabel: `Switch to the ${model.name}`, onClick: () => void switchTo(ctx, o, refresh) }),
      button('Hire a captain', { size: 'sm', testId: `fleet-hire-${o.id}`, disabled: !!noHire, title: noHire ?? undefined, onClick: () => void openHire(ctx, o, dests, refresh) }),
      hasShipyard(locationId)
        ? button(`Sell · ${formatCredits(sale.value)}`, {
            size: 'sm',
            variant: 'ghost',
            testId: `fleet-sell-${o.id}`,
            disabled: !!sale.blocked,
            title: sale.blocked ?? undefined,
            onClick: () => void confirmSell(ctx, o, sale.value, refresh),
          })
        : null,
    ),
  );
}

async function switchTo(ctx: StationContext, o: OwnedShip, refresh: Refresh): Promise<void> {
  const { state } = ctx;
  const flown = shipModel(state.ship.model).name;
  if (cargoUsed(state.ship.cargo) > 0) {
    const ok = await confirmDialog(
      `Switch to the ${shipModel(o.ship.model).name}?`,
      `Each ship keeps its own hold: your cargo (${cargoList(state.ship.cargo)}) stays aboard the ${flown}, parked here, until you switch back.`,
      'Switch',
    );
    if (!ok) return;
  }
  const r = switchShip(state, o.id);
  done(ctx, refresh, r);
  if (r.ok) ctx.shipChanged();
}

async function confirmSell(ctx: StationContext, o: OwnedShip, value: number, refresh: Refresh): Promise<void> {
  const name = shipModel(o.ship.model).name;
  const ok = await confirmDialog(`Sell your ${name}?`, `The shipyard pays ${formatCredits(value)} for it and everything fitted to it.`, 'Sell', { danger: true });
  if (!ok) return;
  done(ctx, refresh, sellShip(ctx.state, o.id), 'credits');
}

function haulers(ctx: StationContext, refresh: Refresh): HTMLElement | null {
  const { state } = ctx;
  const list = state.fleet.ships.filter((o) => o.hauler);
  if (!list.length) return null;
  return h(
    'section',
    { 'aria-label': 'Haulers' },
    h('div', { class: 'list-head' }, h('span', null, 'Haulers'), h('span', null, `${list.length} on the lanes`)),
    h(
      'ul',
      { class: 'list' },
      list.map((o) => {
        const hl = o.hauler!;
        const { from, to, commodity: c } = hl.route;
        const last = lastReport(state, o.id);
        const route = hl.work === 'supply' ? `Supplying ${where(ctx, to)} from ${where(ctx, from)}` : hl.work === 'mine' ? `Mining for ${where(ctx, to)}, home ${where(ctx, from)}` : `${goodName(c)}: ${where(ctx, from)} → ${where(ctx, to)}`;
        const record =
          hl.work === 'supply'
            ? `${hl.runs} deliver${hl.runs === 1 ? 'y' : 'ies'} · spent ${formatCredits(Math.abs(hl.earned))} · safe deliveries`
            : hl.work === 'mine'
              ? `${hl.runs} load${hl.runs === 1 ? '' : 's'} refined · ${money(hl.earned)} · safe deliveries`
              : `${hl.runs} run${hl.runs === 1 ? '' : 's'} · ${money(hl.earned)} · ${hl.insured ? 'insured' : 'not insured'}`;
        return h(
          'li',
          { class: 'trade-row fleet-row', 'data-testid': `fleet-hauler-${o.id}` },
          glyph(COMMODITY_GLYPH[c]),
          h(
            'span',
            { class: 'trade-text' },
            h('span', { class: 'row-name' }, `${shipModel(o.ship.model).name} · ${hl.captain}`),
            h('span', { class: 'row-sub' }, route),
            h('span', { class: 'row-sub fleet-status', 'data-testid': `fleet-status-${o.id}` }, haulerStatus(state, o)),
            h('span', { class: 'row-sub' }, record),
            last ? h('span', { class: 'row-sub fleet-last' }, `${ago(state.clock, last.at)}: ${last.text}`) : null,
          ),
          h(
            'span',
            { class: 'row-actions' },
            button(hl.recalled ? 'Recalled' : 'Recall', {
              size: 'sm',
              testId: `fleet-recall-${o.id}`,
              disabled: hl.recalled,
              onClick: () => done(ctx, refresh, recallHauler(state, o.id)),
            }),
            // Supply and mining captains are never raided (docs/PROCGEN.md §37.3): nothing to insure.
            hl.work
              ? null
              : button(hl.insured ? 'Drop insurance' : 'Insure', {
                  size: 'sm',
                  variant: 'ghost',
                  testId: `fleet-insure-${o.id}`,
                  onClick: () => done(ctx, refresh, setInsured(state, o.id, !hl.insured)),
                }),
          ),
        );
      }),
    ),
  );
}

function parkedElsewhere(ctx: StationContext): HTMLElement | null {
  const { state, locationId } = ctx;
  const away = state.fleet.ships.filter((o) => !o.hauler && o.locationId !== locationId);
  if (!away.length) return null;
  return h(
    'section',
    { 'aria-label': 'Parked elsewhere' },
    h('div', { class: 'list-head' }, h('span', null, 'Parked elsewhere'), h('span', null, `${away.length}`)),
    h(
      'ul',
      { class: 'list' },
      away.map((o) =>
        h(
          'li',
          { class: 'trade-row fleet-row', 'data-testid': `fleet-parked-${o.id}` },
          glyph('shipyard'),
          h(
            'span',
            { class: 'trade-text' },
            h('span', { class: 'row-name' }, shipModel(o.ship.model).name),
            h('span', { class: 'row-sub' }, `Parked at ${where(ctx, o.locationId)}`),
            h('span', { class: 'row-sub' }, shipLine(o)),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------- hiring a captain

interface Choice {
  to: string;
  c: CommodityId;
  est: HaulEstimate;
}

/** Goods for a destination, best run first. */
function choicesFor(ctx: StationContext, o: OwnedShip, to: string, insured: boolean): Choice[] {
  return haulGoods(ctx.state, o.locationId, to)
    .map((c) => ({ to, c, est: haulEstimate(ctx.state, o, to, c, insured) }))
    .filter((x): x is Choice => !!x.est)
    .sort((a, b) => b.est.net - a.est.net);
}

type Work = 'haul' | 'supply' | 'mine';
const WORK_WORD: Record<Work, string> = { haul: 'Haul a trade route', supply: 'Supply an outpost', mine: 'Mine for a refinery' };

async function openHire(ctx: StationContext, o: OwnedShip, dests: string[], refresh: Refresh): Promise<void> {
  const { state } = ctx;
  const model = shipModel(o.ship.model);
  const captain = captainFor(state, o.id);
  // What the captain can be hired to do (docs/PROCGEN.md §37): a trade route, an outpost to supply, a refinery to mine for.
  const supplies = supplyTargets(state);
  const mines = mineTargets(state, o);
  const works = (['haul', 'supply', 'mine'] as const).filter((w) => (w === 'haul' ? dests.length : w === 'supply' ? supplies.length : mines.length) > 0);
  let work: Work = works[0] ?? 'haul';
  let supplyTo = supplies[0] ? outpostId(supplies[0].site) : '';
  let mineFor = mines[0] ? outpostId(mines[0].site) : '';
  let insured = false;
  // Start from the destination whose best run pays most.
  const best = dests.map((d) => choicesFor(ctx, o, d, insured)[0]).filter((x): x is Choice => !!x).sort((a, b) => b.est.net - a.est.net)[0];
  let to = best?.to ?? dests[0] ?? '';
  let c: CommodityId | null = best?.c ?? null;
  const destSelect = h(
    'select',
    { id: 'fleet-dest', 'data-testid': 'fleet-dest' },
    dests.map((d) => h('option', { value: d, selected: d === to }, where(ctx, d))),
  );
  const goodSelect = h('select', { id: 'fleet-good', 'data-testid': 'fleet-good' });
  const insure = h('input', { id: 'fleet-insure', type: 'checkbox', 'data-testid': 'fleet-insure' });
  const summary = h('div', { class: 'hire-summary', 'aria-live': 'polite' });
  const confirm = () => document.querySelector<HTMLButtonElement>('[data-testid="fleet-hire-confirm"]');
  const fillGoods = () => {
    const list = choicesFor(ctx, o, to, insured);
    if (!list.some((x) => x.c === c)) c = list[0]?.c ?? null;
    replaceChildren(
      goodSelect,
      list.map((x) => h('option', { value: x.c, selected: x.c === c }, `${goodName(x.c)} · ${money(x.est.net)} a run`)),
    );
  };
  const update = () => {
    const est = c ? haulEstimate(state, o, to, c, insured) : null;
    const pays = !!est && est.net >= FLEET.haulers.minProfit;
    const hire = confirm();
    if (hire) hire.disabled = work === 'haul' && !pays;
    if (!est) {
      replaceChildren(summary, h('p', { class: 'list-empty' }, 'Nothing sold here that you know a buyer for there.'));
      return;
    }
    const r = est.risk;
    replaceChildren(
      summary,
      h(
        'dl',
        { class: 'kv' },
        h('dt', null, 'Each run'),
        h('dd', null, `${est.qty} ${goodName(est.commodity).toLowerCase()}, bought here for ${formatCredits(est.goods)}`),
        h('dt', null, 'Sold there'),
        h('dd', null, `about ${formatCredits(est.sale)} (you saw ${est.sell} cr each ${ago(state.clock, state.clock - est.sellAge)}; less as the price slides)`),
        h('dt', null, 'Costs'),
        h('dd', null, `jump fees ${formatCredits(est.fees)} · captain ${formatCredits(est.fee)} and ${pct(FLEET.haulers.wageShare)} of the profit${insured ? ` · insurance ${pct(FLEET.risk.premium)}` : ''}`),
        h('dt', null, 'Time'),
        h('dd', null, `${minutes(est.times.run)} a run, there and back`),
        h('dt', null, h('strong', null, 'You make')),
        h('dd', { class: `num ${est.net >= 0 ? 'pos' : 'neg'}`, 'data-testid': 'fleet-hire-net' }, h('strong', null, `${money(est.net)} a run`), ' at these prices'),
        h('dt', null, 'Risk'),
        h(
          'dd',
          { 'data-testid': 'fleet-hire-risk' },
          h('span', { class: `tag risk-${r.level}` }, RISK_WORD[r.level]),
          ` raiders strike ${pct(r.raided)} of runs, and ${pct(r.raided * r.shipLost)} lose the ship${r.raid ? ' (a raid is under way on the route)' : ''}`,
        ),
      ),
      pays ? null : h('p', { class: 'callout warn' }, icon('alert'), `No captain takes a run that pays under ${FLEET.haulers.minProfit} cr.`),
    );
  };
  destSelect.addEventListener('change', () => {
    to = destSelect.value;
    fillGoods();
    update();
  });
  goodSelect.addEventListener('change', () => {
    c = goodSelect.value as CommodityId;
    update();
  });
  insure.addEventListener('change', () => {
    insured = insure.checked;
    fillGoods();
    update();
  });
  fillGoods();
  update();
  // Supply: the next run as it would load now, and what it costs.
  const supplySelect = h(
    'select',
    { id: 'fleet-supply-to', 'data-testid': 'fleet-supply-to' },
    supplies.map((p) => h('option', { value: outpostId(p.site), selected: outpostId(p.site) === supplyTo }, p.name)),
  );
  const supplySummary = h('div', { class: 'hire-summary', 'aria-live': 'polite', 'data-testid': 'fleet-supply-summary' });
  const updateSupply = () => {
    if (!supplyTo) return;
    const plan = supplyPlan(state, o, supplyTo);
    const list = (cargo: Cargo) => (Object.entries(cargo) as [CommodityId, number][]).map(([c, q]) => `${q} ${goodName(c).toLowerCase()}`).join(', ');
    replaceChildren(
      supplySummary,
      plan
        ? h(
            'dl',
            { class: 'kv' },
            h('dt', null, 'First run'),
            h('dd', null, [list(plan.stored) ? `${list(plan.stored)} from your storage` : '', list(plan.bought) ? `${list(plan.bought)} bought here` : ''].filter(Boolean).join('; ') || 'what is aboard'),
            h('dt', null, 'Costs'),
            h('dd', null, `goods ${formatCredits(plan.goods)} · captain ${formatCredits(plan.share)} (${pct(FLEET.work.share)} of the goods’ value) · jump fees ${formatCredits(plan.fees)}`),
            h('dt', null, h('strong', null, 'Each run')),
            h('dd', { class: 'num', 'data-testid': 'fleet-supply-cost' }, h('strong', null, `${formatCredits(plan.cost)}, paid as it sets out`)),
            h('dt', null, 'Time'),
            h('dd', null, `${minutes(haulTimes(o.locationId, supplyTo).run)} a run, there and back`),
          )
        : h('p', { class: 'list-empty' }, 'Nothing it still needs is in your storage here or for sale here: the captain would wait until it is.'),
    );
  };
  supplySelect.addEventListener('change', () => {
    supplyTo = supplySelect.value;
    updateSupply();
  });
  // Mine: a load, a cycle, and what the refinery takes and pays an hour.
  const mineSelect = h(
    'select',
    { id: 'fleet-mine-for', 'data-testid': 'fleet-mine-for' },
    mines.map((p) => h('option', { value: outpostId(p.site), selected: outpostId(p.site) === mineFor }, p.name)),
  );
  const mineSummary = h('div', { class: 'hire-summary', 'aria-live': 'polite', 'data-testid': 'fleet-mine-summary' });
  const updateMine = () => {
    const post = mines.find((p) => outpostId(p.site) === mineFor);
    if (!post) return;
    const est = miningEstimate(o, post);
    const list = (Object.entries(est.load) as [CommodityId, number][]).map(([c, q]) => `${q} ${goodName(c).toLowerCase()}`).join(', ');
    replaceChildren(
      mineSummary,
      h(
        'dl',
        { class: 'kv' },
        h('dt', null, 'Each load'),
        h('dd', null, `${list}, cut in ${minutes(est.cycle - 2 * FLEET.work.transit)}; ${minutes(est.cycle)} a cycle with the trips`),
        h('dt', null, 'Refined'),
        h('dd', null, `about ${est.perHour} units an hour (the refinery takes ${refineAllowance(post)} an hour, your own refining included)`),
        h('dt', null, h('strong', null, 'You make')),
        h('dd', { class: 'num pos', 'data-testid': 'fleet-mine-pay' }, h('strong', null, `about ${money(est.payPerHour)} an hour`), ` after the captain’s ${pct(FLEET.work.cut)}`),
        h('dt', null, 'Getting there'),
        h('dd', null, `${minutes(haulTimes(o.locationId, mineFor).load + haulTimes(o.locationId, mineFor).oneWay)}, jump fees there and back ${formatCredits(haulFees(o.locationId, mineFor))}`),
      ),
    );
  };
  mineSelect.addEventListener('change', () => {
    mineFor = mineSelect.value;
    updateMine();
  });
  updateSupply();
  updateMine();
  const sections: Record<Work, HTMLElement> = {
    haul: h(
      'div',
      { class: 'stack', 'data-testid': 'fleet-hire-haul' },
      h('p', null, `${captain} will fly it from here for ${formatCredits(FLEET.haulers.fee)} a run and ${pct(FLEET.haulers.wageShare)} of each run’s profit, loading here and selling at the far end.`),
      h('div', { class: 'hire-field' }, h('label', { for: 'fleet-dest' }, 'Destination'), destSelect),
      h('div', { class: 'hire-field' }, h('label', { for: 'fleet-good' }, 'Cargo'), goodSelect),
      summary,
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'fleet-insure' }, 'Insure the ship', h('span', { class: 'hint' }, `Pays ${formatCredits(Math.round(FLEET.risk.payout * model.price))} if raiders destroy it, for ${pct(FLEET.risk.premium)} of each run’s profit.`)),
        insure,
      ),
      h('p', { class: 'muted small' }, 'Prices at the far end are the last you saw. Every run moves both markets, so a route worked hard pays less; the captain decides on the day, waits while a run does not pay, and reports as the runs go. Meet your ship on the lanes, and you can guard it if raiders strike.'),
    ),
    supply: h(
      'div',
      { class: 'stack', 'data-testid': 'fleet-hire-supply' },
      h('p', null, `${captain} will bring what your outpost’s next stage needs, stage after stage until it is complete: first what your storage here holds, then what this market sells. For ${pct(FLEET.work.share)} of the goods’ value a run.`),
      h('div', { class: 'hire-field' }, h('label', { for: 'fleet-supply-to' }, 'Outpost'), supplySelect),
      supplySummary,
      h('p', { class: 'muted small' }, 'Safe deliveries: raiders leave your supply captains alone. Keep your storage here stocked with what this market does not sell.'),
    ),
    mine: h(
      'div',
      { class: 'stack', 'data-testid': 'fleet-hire-mine' },
      h('p', null, `${captain} will fly it to your refinery and work its belt with the ship’s mining laser, handing each load over to be refined, for ${pct(FLEET.work.cut)} of what the refinery pays.`),
      h('div', { class: 'hire-field' }, h('label', { for: 'fleet-mine-for' }, 'Refinery'), mineSelect),
      mineSummary,
      h('p', { class: 'muted small' }, 'Safe deliveries: raiders leave your mining captains alone. Fly out to the belt to watch them work; the captains and their ships’ work are fiction, the belt is real.'),
    ),
  };
  const workField = h('div', { class: 'hire-field' }, h('label', { for: 'fleet-work' }, 'Work'), h('select', { id: 'fleet-work', 'data-testid': 'fleet-work' }, works.map((w) => h('option', { value: w, selected: w === work }, WORK_WORD[w]))));
  const show = () => {
    for (const [k, el] of Object.entries(sections) as [Work, HTMLElement][]) el.hidden = k !== work;
    const hire = confirm();
    if (hire) hire.disabled = false;
    if (work === 'haul') update();
  };
  workField.querySelector('select')?.addEventListener('change', (e) => {
    work = (e.target as HTMLSelectElement).value as Work;
    show();
  });
  show();
  const answer = showModal({
    title: `A captain for your ${model.name}`,
    testId: 'fleet-hire-dialog',
    body: h('div', { class: 'stack hire' }, workField, ...works.map((w) => sections[w])),
    actions: [
      { label: 'Cancel', value: 'cancel', testId: 'fleet-hire-cancel' },
      { label: 'Hire', value: 'ok', variant: 'primary', testId: 'fleet-hire-confirm' },
    ],
    dismissValue: 'cancel',
  });
  show();
  if ((await answer) !== 'ok') return;
  if (work === 'haul') {
    if (!c) return;
    done(ctx, refresh, hireHauler(state, o.id, to, c, insured));
  } else done(ctx, refresh, hireWorker(state, o.id, work, work === 'supply' ? supplyTo : mineFor));
}

// ---------------------------------------------------------------- storage

function storage(ctx: StationContext, refresh: Refresh): HTMLElement {
  const { state, locationId } = ctx;
  const hold = storageAt(state, locationId);
  const elsewhere = Object.entries(state.fleet.storage).filter(([id]) => id !== locationId);
  const cap = FLEET.storage.capacity;
  const goods = COMMODITY_IDS.filter((c) => cargoCount(state.ship.cargo, c) > 0 || (hold && cargoCount(hold, c) > 0));
  return h(
    'section',
    { 'aria-label': 'Storage', 'data-testid': 'storage' },
    h('div', { class: 'list-head' }, h('span', null, 'Storage here'), hold ? h('span', { class: 'num' }, `${cargoUsed(hold)}/${cap} units`) : h('span')),
    hold
      ? [
          h('div', { class: 'segbar hold-bar', style: `--segments: ${Math.min(cap, 30)}; --fill: ${cargoUsed(hold) / cap}; --seg-color: var(--amber)` }),
          goods.length
            ? h(
                'ul',
                { class: 'list' },
                goods.map((c) => {
                  const m = storageMoves(state, locationId, c);
                  return h(
                    'li',
                    { class: 'trade-row fleet-row', 'data-testid': `storage-row-${c}` },
                    glyph(COMMODITY_GLYPH[c]),
                    h('span', { class: 'trade-text' }, h('span', { class: 'row-name' }, goodName(c)), h('span', { class: 'row-sub' }, `In your hold ${cargoCount(state.ship.cargo, c)} · stored ${cargoCount(hold, c)}`)),
                    h(
                      'span',
                      { class: 'row-actions' },
                      button('Store', { size: 'sm', testId: `storage-store-${c}`, disabled: m.store === 0, onClick: () => void openMove(ctx, c, 'store', m.store, refresh) }),
                      button('Take', { size: 'sm', testId: `storage-take-${c}`, disabled: m.take === 0, onClick: () => void openMove(ctx, c, 'take', m.take, refresh) }),
                    ),
                  );
                }),
              )
            : h('p', { class: 'list-empty' }, 'Your hold and this storage are both empty.'),
        ]
      : h(
          'div',
          { class: 'callout fleet-offer' },
          h('span', { class: 'grow' }, `Lease a ${cap}-unit hold here for ${formatCredits(FLEET.storage.lease)}, paid once: cargo waits here while you fly.`),
          button('Lease', {
            size: 'sm',
            testId: 'storage-lease',
            disabled: state.credits < FLEET.storage.lease,
            onClick: () => done(ctx, refresh, leaseStorage(state, locationId), 'credits'),
          }),
        ),
    elsewhere.length
      ? [
          h('div', { class: 'list-head fleet-subhead' }, h('span', null, 'Storage elsewhere'), h('span')),
          h(
            'ul',
            { class: 'list' },
            elsewhere.map(([id, cargo]) =>
              h(
                'li',
                { class: 'trade-row fleet-row' },
                glyph('trader'),
                h('span', { class: 'trade-text' }, h('span', { class: 'row-name' }, where(ctx, id)), h('span', { class: 'row-sub' }, `${cargoUsed(cargo)}/${cap} units${cargoUsed(cargo) ? `: ${cargoList(cargo)}` : ''}`)),
              ),
            ),
          ),
        ]
      : null,
  );
}

async function openMove(ctx: StationContext, c: CommodityId, way: 'store' | 'take', max: number, refresh: Refresh): Promise<void> {
  if (max <= 0) return;
  let qty = max;
  const out = h('output', { class: 'num qty', 'aria-live': 'polite', 'data-testid': 'storage-qty' });
  const step = (d: number) => () => {
    qty = Math.max(1, Math.min(max, qty + d));
    out.textContent = String(qty);
  };
  out.textContent = String(qty);
  const choice = await showModal({
    title: `${way === 'store' ? 'Store' : 'Take'} ${goodName(c).toLowerCase()}`,
    testId: 'storage-dialog',
    body: h(
      'div',
      { class: 'stack' },
      h('p', null, way === 'store' ? `From your hold into storage at ${getLocation(ctx.locationId).name}.` : `From storage into your hold.`),
      h(
        'div',
        { class: 'qty-row' },
        button('−', { size: 'sm', ariaLabel: 'One fewer', testId: 'storage-minus', onClick: step(-1) }),
        out,
        button('+', { size: 'sm', ariaLabel: 'One more', testId: 'storage-plus', onClick: step(1) }),
        button('All', { size: 'sm', testId: 'storage-all', onClick: step(max) }),
      ),
    ),
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: way === 'store' ? 'Store' : 'Take', value: 'ok', variant: 'primary', testId: 'storage-confirm' },
    ],
    dismissValue: 'cancel',
  });
  if (choice !== 'ok') return;
  done(ctx, refresh, moveCargo(ctx.state, ctx.locationId, c, qty, way));
}

// ---------------------------------------------------------------- stakes

function stakes(ctx: StationContext, refresh: Refresh): HTMLElement | null {
  const { state, locationId } = ctx;
  const offer = stakeOffer(state, locationId);
  const mine = state.fleet.stakes;
  if (!offer && !mine.length) return null;
  return h(
    'section',
    { 'aria-label': 'Stakes' },
    h('div', { class: 'list-head' }, h('span', null, 'Stakes in station trade'), h('span', null, `${mine.length}/${FLEET.stakes.maxStations} stations`)),
    offer ? stakeHere(ctx, offer, refresh) : null,
    mine.length
      ? h(
          'ul',
          { class: 'list' },
          mine.map((k) => {
            const value = Math.round(stakeValue(k) * FLEET.stakes.sellBack);
            return h(
              'li',
              { class: 'trade-row fleet-row', 'data-testid': `stake-${k.locationId}` },
              glyph('trader'),
              h(
                'span',
                { class: 'trade-text' },
                h('span', { class: 'row-name' }, `${k.percent}% of ${where(ctx, k.locationId)}`),
                h('span', { class: 'row-sub' }, `Paid ${formatCredits(k.paid)} · earned ${formatCredits(k.earned)} · about ${formatCredits(dividendPerHour(k.locationId, k.percent, state.clock))} an hour now`),
              ),
              h(
                'span',
                { class: 'row-actions' },
                button(`Sell · ${formatCredits(value)}`, {
                  size: 'sm',
                  variant: 'ghost',
                  testId: `stake-sell-${k.locationId}`,
                  onClick: async () => {
                    const ok = await confirmDialog(`Sell your stake?`, `${getLocation(k.locationId).name} buys back your ${k.percent}% for ${formatCredits(value)} (${pct(FLEET.stakes.sellBack)} of its price).`, 'Sell', { danger: true });
                    if (ok) done(ctx, refresh, sellStake(state, k.locationId), 'credits');
                  },
                }),
              ),
            );
          }),
        )
      : null,
  );
}

function stakeHere(ctx: StationContext, offer: StakeOffer, refresh: Refresh): HTMLElement {
  const { state, locationId } = ctx;
  const name = getLocation(locationId).name;
  const f = dividendFactor(locationId, state.clock);
  const perHour = dividendPerHour(locationId, 1, state.clock);
  let n = 1;
  const out = h('output', { class: 'num qty', 'aria-live': 'polite', 'data-testid': 'stake-pct' });
  const buy = button('', {
    size: 'sm',
    variant: 'primary',
    testId: 'stake-buy',
    onClick: () => done(ctx, refresh, buyStake(state, locationId, n), 'credits'),
  });
  const render = () => {
    out.textContent = `${n}%`;
    buy.textContent = `Buy · ${formatCredits(n * offer.perPercent)}`;
    buy.disabled = !!offer.blocked || n * offer.perPercent > state.credits;
  };
  const step = (d: number) => () => {
    n = Math.max(1, Math.min(offer.room, n + d));
    render();
  };
  render();
  return h(
    'div',
    { class: 'fleet-stake-here', 'data-testid': 'stake-here' },
    h(
      'p',
      { class: 'small' },
      `A share of ${name}’s trade: ${formatCredits(offer.perPercent)} for each 1%, up to ${FLEET.stakes.maxPercent}%. Each 1% pays about ${formatCredits(perHour)} an hour of game time now; the station buys it back at ${pct(FLEET.stakes.sellBack)}.`,
      offer.held ? ` You own ${offer.held}%.` : '',
    ),
    f.events.length
      ? h(
          'span',
          { class: 'person-tags' },
          f.events.map((e) => h('span', { class: `tag ${FLEET.stakes.events[e.kind] >= 1 ? 'good-tag' : 'news'}` }, `${e.headline}: dividends ×${FLEET.stakes.events[e.kind]}`)),
        )
      : null,
    offer.room > 0 && (offer.held > 0 || state.fleet.stakes.length < FLEET.stakes.maxStations)
      ? h(
          'div',
          { class: 'qty-row' },
          button('−', { size: 'sm', ariaLabel: 'One per-cent less', testId: 'stake-minus', onClick: step(-1) }),
          out,
          button('+', { size: 'sm', ariaLabel: 'One per-cent more', testId: 'stake-plus', onClick: step(1) }),
          buy,
        )
      : null,
    offer.blocked ? h('p', { class: 'row-note' }, offer.blocked) : null,
  );
}

// ---------------------------------------------------------------- reports

function reports(ctx: StationContext): HTMLElement | null {
  const { state } = ctx;
  const list = [...state.fleet.reports].reverse();
  if (!list.length) return null;
  return h(
    'section',
    { 'aria-label': 'Fleet reports' },
    h('div', { class: 'list-head' }, h('span', null, 'Reports'), h('span', null, 'Newest first')),
    h(
      'ul',
      { class: 'fleet-reports', 'data-testid': 'fleet-reports' },
      list.map((r) =>
        h(
          'li',
          { class: `report-${r.kind}` },
          h('span', { class: 'report-when' }, ago(state.clock, r.at)),
          h('span', { class: 'report-text' }, r.text),
          r.amount ? h('span', { class: `num report-amount ${r.amount > 0 ? 'pos' : 'neg'}` }, money(r.amount)) : null,
        ),
      ),
    ),
  );
}
