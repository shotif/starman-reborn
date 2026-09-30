import { voyageTotals, type GameState } from '../../app/state.ts';
import { cargoCount } from '../../economy/cargo.ts';
import { COMMODITIES, COMMODITY_IDS } from '../../economy/commodities.ts';
import { FACTIONS, standingTier, TIER_LABEL } from '../../economy/factions.ts';
import { describeObjective, getJob } from '../../economy/jobs.ts';
import { dataBadge } from '../components.ts';
import { h, signed } from '../dom.ts';
import { icon } from '../icons.ts';

/** True when the current voyage has anything to report. */
export function hasVoyage(state: GameState): boolean {
  return !!state.flags.voyage && state.ledger.some((e) => e.t >= state.voyageStartClock);
}

/** Money in and out since the first delivery contract was accepted. */
export function voyageReport(state: GameState): HTMLElement | null {
  if (!hasVoyage(state)) return null;
  const t = voyageTotals(state, state.voyageStartClock);
  const row = (label: string, value: number) => [h('dt', null, label), h('dd', { class: `num ${value >= 0 ? 'pos' : 'neg'}` }, signed(value) + ' cr')];
  const held = COMMODITY_IDS.filter((c) => cargoCount(state.ship.cargo, c) > 0)
    .map((c) => `${cargoCount(state.ship.cargo, c)} ${COMMODITIES[c].name.toLowerCase()}`)
    .join(', ');
  return h(
    'div',
    { class: 'voyage stack', 'data-testid': 'voyage-report' },
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

/** Your contracts, standing with each faction and the voyage so far. */
export function journalContent(state: GameState): HTMLElement {
  const active = Object.entries(state.jobs).filter(([, p]) => p.status === 'active');
  const done = Object.entries(state.jobs).filter(([, p]) => p.status === 'complete');
  const voyage = voyageReport(state);
  return h(
    'div',
    { class: 'stack journal' },
    h('div', { class: 'list-head' }, h('span', null, 'Active contracts'), h('span', null, '')),
    active.length
      ? h(
          'ul',
          { class: 'plain active-jobs' },
          active.map(([id]) => {
            const o = describeObjective(state, id);
            return h('li', null, icon('objective'), h('strong', null, ` ${getJob(id, state).title}`), o ? h('div', { class: 'muted small' }, o.text) : null);
          }),
        )
      : h('p', { class: 'list-empty' }, 'No active contracts. Check the job board in a station bar.'),
    done.length ? h('p', { class: 'muted small' }, `Completed: ${done.map(([id]) => getJob(id, state).title).join(', ')}.`) : null,
    h('div', { class: 'list-head' }, h('span', null, 'Standing'), dataBadge('fictional')),
    h(
      'dl',
      { class: 'kv' },
      (['sta', 'frontier', 'hollow-wake'] as const).flatMap((f) => [
        h('dt', null, FACTIONS[f].name),
        h('dd', null, `${TIER_LABEL[standingTier(state.reputation[f] ?? 0)]} (${signed(state.reputation[f] ?? 0)})`),
      ]),
    ),
    voyage ? h('div', { class: 'list-head' }, h('span', null, 'Voyage report'), h('span', null, '')) : null,
    voyage,
  );
}
