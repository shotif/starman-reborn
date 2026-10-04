import { getLocation } from '../../data/systems.ts';
import { voyageTotals, type GameState } from '../../app/state.ts';
import { storyRecord } from '../story.ts';
import { lanesRecord } from '../lanes.ts';
import { wrecksRecord } from '../wrecks.ts';
import { ranksRecord } from '../ranks.ts';
import { racingRecord } from '../racing.ts';
import { crewRecord, rivalsRecord } from '../rivalStories.ts';
import { wingRecord } from '../wing.ts';
import { battlesRecord } from '../battles.ts';
import { cargoCount } from '../../economy/cargo.ts';
import { COMMODITIES, COMMODITY_IDS } from '../../economy/commodities.ts';
import { FACTIONS, standingTier, TIER_LABEL } from '../../economy/factions.ts';
import { abandonJob, describeObjective, getJob } from '../../economy/jobs.ts';
import { CONTRACTS } from '../../content/contracts/rules.ts';
import { button, confirmDialog, dataBadge, toast } from '../components.ts';
import { formatCredits, h, signed } from '../dom.ts';
import { MILESTONES, RATINGS, type RatingKind } from '../../content/progress/rules.ts';
import { codexProgress, rating } from '../../economy/progress.ts';
import { icon } from '../icons.ts';
import type { Refresh, StationContext } from './context.ts';

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
      t.fleet ? row('Stakes and storage', t.fleet) : null,
      h('dt', null, h('strong', null, 'Net change')),
      h('dd', { class: `num ${t.net >= 0 ? 'pos' : 'neg'}` }, h('strong', null, signed(t.net) + ' cr')),
    ),
    held ? h('p', { class: 'muted small' }, `Still in the hold (not yet sold): ${held}.`) : null,
  );
}

/** Your contracts, standing with each faction and the voyage so far. */
export function journalContent(ctx: StationContext, refresh: Refresh): HTMLElement {
  const { state } = ctx;
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
            return h(
              'li',
              { class: 'active-job' },
              h('div', { class: 'grow' }, icon('objective'), h('strong', null, ` ${getJob(id, state).title}`), o ? h('div', { class: 'muted small' }, o.text) : null),
              state.contracts[id] ? button('Abandon', { size: 'sm', variant: 'ghost', testId: `abandon-${id}`, onClick: () => void confirmAbandon(ctx, id, refresh) }) : null,
            );
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
        h('dd', null, `${TIER_LABEL[standingTier(state.reputation[f] ?? 0)]} (${signed(state.reputation[f] ?? 0)})${state.law.fines[f] ? ` · owes ${formatCredits(state.law.fines[f])} in fines` : ''}`),
      ]),
    ),
    ranksRecord(state),
    racingRecord(state),
    storyRecord(state),
    rivalsRecord(state),
    crewRecord(state),
    wingRecord(state),
    battlesRecord(state),
    lanesRecord(state),
    wrecksRecord(state),
    heardRecord(state),
    pilotRecord(state),
    voyage ? h('div', { class: 'list-head' }, h('span', null, 'Voyage report'), h('span', null, '')) : null,
    voyage,
  );
}

/** What was heard in the bars, newest first (docs/PROCGEN.md §16). */
function heardRecord(state: GameState): HTMLElement | null {
  if (!state.rumours.length) return null;
  return h(
    'section',
    { 'aria-label': 'Heard in the bars', 'data-testid': 'heard' },
    h('div', { class: 'list-head' }, h('span', null, 'Heard in the bars'), h('span', null, '')),
    h(
      'ul',
      { class: 'plain heard-list' },
      [...state.rumours].reverse().map((r) => {
        const m = Math.max(0, Math.round((state.clock - r.at) / 60));
        return h('li', null, h('span', { class: 'muted small' }, `${getLocation(r.locationId).name} · ${m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`}`), h('div', null, r.text));
      }),
    ),
  );
}

/** Ratings, the codex and milestones (docs/PROCGEN.md §13). */
function pilotRecord(state: GameState): HTMLElement {
  const { done, total } = codexProgress(state);
  const earned = MILESTONES.filter((m) => state.milestones[m.id] !== undefined);
  return h(
    'section',
    { class: 'pilot-record', 'aria-label': 'Pilot record', 'data-testid': 'pilot-record' },
    h('div', { class: 'list-head' }, h('span', null, 'Pilot ratings'), h('span', null, '')),
    h(
      'ul',
      { class: 'plain ratings' },
      (Object.keys(RATINGS) as RatingKind[]).map((k) => {
        const r = rating(state, k);
        const prev = RATINGS[k].ranks[r.index]![1];
        const fill = r.next ? (r.score - prev) / (r.next.at - prev) : 1;
        return h(
          'li',
          { class: 'rating', 'data-testid': `rating-${k}` },
          h('span', { class: 'rating-kind' }, RATINGS[k].label),
          h('strong', { class: 'rating-rank' }, r.rank),
          h('span', { class: 'rating-bar', style: `--fill: ${Math.max(0, Math.min(1, fill))}` }),
          h('span', { class: 'muted small rating-next' }, r.next ? `${r.next.rank} at ${formatCredits(r.next.at).replace(' cr', '')}` : 'Top rank'),
        );
      }),
    ),
    h('p', { class: 'muted small' }, `Codex of the real sky: ${done} of ${total} catalogued stars and confirmed planets scanned. `, dataBadge('observed')),
    h('div', { class: 'list-head' }, h('span', null, 'Milestones'), h('span', null, `${earned.length}/${MILESTONES.length}`)),
    earned.length ? h('ul', { class: 'plain milestones' }, earned.map((m) => h('li', null, icon('objective'), ` ${m.title}`))) : h('p', { class: 'list-empty' }, 'None yet.'),
  );
}

async function confirmAbandon(ctx: StationContext, jobId: string, refresh: Refresh): Promise<void> {
  const job = ctx.state.contracts[jobId]!;
  const deposit = job.contract?.deposit;
  const costs = [
    deposit ? `Your deposit of ${formatCredits(deposit)} is forfeit; the cargo stays in your hold.` : '',
    job.factionId ? `Your standing with the ${FACTIONS[job.factionId].name} drops by ${CONTRACTS.abandonStanding}.` : '',
  ].filter(Boolean);
  const ok = await confirmDialog(`Abandon “${job.title}”?`, `${costs.join(' ')} The contract cannot be taken again.`.trim(), 'Abandon', { danger: true });
  if (!ok) return;
  const r = abandonJob(ctx.state, jobId);
  ctx.sfx(r.ok ? 'ui-confirm' : 'ui-error');
  toast(r.message, r.ok ? 'info' : 'bad');
  ctx.save();
  refresh();
}
