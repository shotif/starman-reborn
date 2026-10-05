import type { GameState, OutpostRecord } from '../app/state.ts';
import { EVENTS, type StationEventKind } from '../content/events/rules.ts';
import { OUTPOSTS } from '../content/outposts/rules.ts';
import { outpostId } from '../content/outposts/sites.ts';
import { endedEarly, eventEnd, stationEventAt, stationEventsBetween, type WorldEvent } from './events.ts';

/**
 * Outposts have news (docs/PROCGEN.md §39.4): the world's events at the pilot's outposts, told as
 * they start and end (a line in the Fleet window's reports and a toast), and as the Outpost window
 * says it. The events themselves are the world's (economy/events.ts); only how far the news has been
 * told is kept (`heard`).
 */

export interface OutpostNewsLine {
  /** Game clock when it happened. */
  at: number;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

const KIND_WORD: Record<StationEventKind, string> = { shortage: 'shortage', glut: 'glut', boom: 'boom', strike: 'strike', harvest: 'harvest', survey: 'survey season' };

/** What an event of a kind does to an outpost's income, in words. */
export function incomeEffect(kind: StationEventKind): string {
  const f = OUTPOSTS.news.income[kind];
  const pct = Math.round(Math.abs(f - 1) * 100);
  return f < 1 ? `its income down ${pct}% while it lasts` : f > 1 ? `its income up ${pct}% while it lasts` : 'its income as ever';
}

const toneOf = (kind: StationEventKind): OutpostNewsLine['tone'] => (OUTPOSTS.news.income[kind] < 1 ? 'bad' : OUTPOSTS.news.income[kind] > 1 ? 'good' : 'info');

/** How an event ended, when it ended before its time: relieved, or cleared. */
function endedHow(e: WorldEvent, end: number): string {
  if (end >= e.end) return '';
  if (e.kind === 'shortage') return endedEarly(e) ? ': you relieved it' : ': its relief haulers are in';
  return endedEarly(e) ? ': you cleared it' : ': its surplus has shipped out';
}

/** The events starting or ending at an outpost after `from` and by `to`, in time order. */
export function outpostNewsBetween(o: OutpostRecord, from: number, to: number): OutpostNewsLine[] {
  if (o.stage <= 0 || to <= from) return [];
  const out: OutpostNewsLine[] = [];
  for (const e of stationEventsBetween(outpostId(o.site), from - EVENTS.stationWindow, to)) {
    const kind = e.kind as StationEventKind;
    if (e.start > from && e.start <= to) out.push({ at: e.start, text: `${e.headline}: ${incomeEffect(kind)}.`, tone: toneOf(kind) });
    const end = eventEnd(e);
    if (end > from && end <= to) out.push({ at: end, text: `The ${KIND_WORD[kind]} at ${o.name} is over${endedHow(e, end)}.`, tone: 'info' });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * The news of the pilot's outposts since it was last told, up to now: for each outpost the latest
 * `news.maxReports` lines (away for long, the older ones go untold). An outpost first heard of (one
 * from an older save) starts being told from now.
 */
export function tellOutpostNews(state: GameState, now: number): OutpostNewsLine[] {
  const out: OutpostNewsLine[] = [];
  for (const o of state.world.outposts ?? []) {
    if (o.heard === undefined || o.heard > now) {
      o.heard = now;
      continue;
    }
    out.push(...outpostNewsBetween(o, o.heard, now).slice(-OUTPOSTS.news.maxReports));
    o.heard = now;
  }
  return out.sort((a, b) => a.at - b.at);
}

/** What the Outpost window says of its news: the event under way and what it does, or that all is quiet. */
export function newsLine(o: OutpostRecord, clock: number): { headline: string; detail: string } {
  const e = o.stage > 0 ? stationEventAt(outpostId(o.site), clock) : null;
  if (!e) return { headline: 'All quiet', detail: o.stage > 0 ? 'No shortage, glut, boom or strike here just now.' : 'Its news begins once it opens.' };
  const left = Math.max(1, Math.round((eventEnd(e) - clock) / 60));
  return { headline: e.headline, detail: `${e.detail} ${incomeEffect(e.kind as StationEventKind).replace(/^its/, 'Its')}; due to end in ${left < 90 ? `${left} min` : `about ${Math.round(left / 60)} h`}.` };
}
