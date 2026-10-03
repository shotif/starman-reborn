import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { dockAt } from '../../src/app/rules.ts';
import { CREW } from '../../src/content/crew/rules.ts';
import { SITE_RADIO, WRECK_LOGS } from '../../src/content/wrecks/lines.ts';
import { MYSTERIES, MYSTERY_IDS, type MysteryId, type MysteryRule } from '../../src/content/wrecks/mysteries.ts';
import { WRECKS, type WreckRules } from '../../src/content/wrecks/rules.ts';
import { ALL_LOCATIONS, getLocation, isInventedSystem, SYSTEMS } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { cargoCount } from '../../src/economy/cargo.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import { adjustReputation } from '../../src/economy/factions.ts';
import { abandonJob } from '../../src/economy/jobs.ts';
import { answerLane, laneChoices, laneEncounter, type LaneOffer } from '../../src/economy/lanes.ts';
import { cargoCapacity } from '../../src/economy/loadout.ts';
import { checkTrail, validateWrecks } from '../../src/economy/wreckGuards.ts';
import {
  boardSite,
  chooseEnding,
  findOnScan,
  followLead,
  leadAt,
  markLaneSite,
  mysteryPlaces,
  mysteryUnderWay,
  readSite,
  scanFind,
  scanSite,
  settleSites,
  siteBlock,
  siteRef,
  siteSetup,
  sitesIn,
  siteSpec,
  springSite,
  takeSitePod,
  tidySites,
  type SiteSpec,
} from '../../src/economy/wrecks.ts';
import { emptyInput, type FlightAction } from '../../src/flight/input/types.ts';
import { FlightSession } from '../../src/world/FlightSession.ts';
import { placeSite } from '../../src/world/sites.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import { trafficFor } from '../../src/world/traffic/setup.ts';

/**
 * Wrecks to fly to (docs/PROCGEN.md §31): the rules' guardrails, sites from the lanes and from
 * scans, what is found there, the three trails to their ends, settling, the save, and the sites in a
 * real flight (hulls, pods, scans, raiders lying dark, guards, boarding, a ship in distress reached).
 */

afterEach(() => useWorldLog(null));

/** A pilot past the opening, in flight in a system, with credits, a cabin of three berths and room in the hold. */
function pilot(systemId: SystemId, clock: number): GameState {
  const s = createNewGame(41);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 20_000;
  s.clock = clock;
  s.location = { systemId, dockedAt: null, flight: null, lastDockId: 'earth-port' };
  s.ship.fittings['utility-1'] = 'gear.cabin.2.halden';
  // Past the first hail, so traps may come.
  s.world.lanes = { 'gj-1061.1': { at: 600, kind: 'trader', systemId: 'gj-1061' as SystemId, pick: 'sell' } };
  useWorldLog(s.world);
  return s;
}

/** The first lane encounter, from a slot on, that matches. */
function hail(match: (o: LaneOffer) => boolean, from = 20): LaneOffer {
  for (let slot = from; slot < from + 3_000; slot++) {
    for (const sys of SYSTEMS) {
      const o = laneEncounter(sys.id, slot);
      if (o && match(o)) return o;
    }
  }
  throw new Error('no such encounter');
}

/** The first scan find, from a slot on, that matches. */
function found(match: (s: SiteSpec) => boolean, from = 20): SiteSpec {
  for (let slot = from; slot < from + 2_000; slot++) {
    for (const sys of SYSTEMS) {
      const f = scanFind(sys.id, slot);
      if (f && match(f)) return f;
    }
  }
  throw new Error('no such find');
}

/** A pilot who has just found a scan's site in its slot (marked, with its job). */
function finding(f: SiteSpec): GameState {
  const slot = siteRef(f.id)!.from === 'scan' ? Number(f.id.split('.').pop()) : 0;
  const s = pilot(f.systemId, slot * WRECKS.scan.slotSeconds + 5);
  expect(findOnScan(s, f.systemId)?.siteId).toBe(f.id);
  return s;
}

/** A pilot met by a hail who answered it with `pick`, the site marked. */
function answered(o: LaneOffer, pick: string): { s: GameState; siteId: string; jobId: string } {
  const s = pilot(o.systemId, o.start + 5);
  const out = answerLane(s, o, pick)!;
  expect(out.siteId).toBeDefined();
  return { s, siteId: out.siteId!, jobId: out.jobId! };
}

describe('the rules', () => {
  it('pass their guardrails over every system', { timeout: 120_000 }, () => {
    expect(validateWrecks()).toEqual([]);
  });

  it('catch broken rules and words: odds falling, a trap in secure space, a fence paying less, a number, she, a body described', () => {
    const rules = (patch: (r: { -readonly [K in keyof WreckRules]: any }) => void) => {
      const r = structuredClone(WRECKS) as unknown as { -readonly [K in keyof WreckRules]: any };
      patch(r);
      return validateWrecks(r as unknown as WreckRules).map((i) => i.subject);
    };
    expect(rules((r) => (r.danger.guard.lawless = 0.1))).toContain('guard');
    expect(rules((r) => (r.danger.dark.secure = 0.1))).toContain('dark');
    expect(rules((r) => (r.danger.spring = 5_000))).toContain('spring');
    expect(rules((r) => (r.open.step = 600))).toContain('open');
    expect(rules((r) => (r.kinds.derelict.hulls = ['ship.none']))).toContain('ship.none');
    const m = structuredClone(MYSTERIES) as Record<string, MysteryRule> & { strongbox: { fence: { pay: number } } };
    m.strongbox.fence.pay = 100;
    expect(validateWrecks(WRECKS, m).map((i) => i.subject)).toContain('strongbox');
    const logs = WRECK_LOGS as string[];
    const radio = SITE_RADIO as unknown as Record<string, string>;
    const was = radio.friend!;
    try {
      logs.push('She left after 3 days.');
      radio.friend = 'Adrift near {body}, whose orbit is long.';
      const words = validateWrecks(structuredClone(WRECKS) as WreckRules).filter((i) => i.rule === 'lines').map((i) => i.message);
      expect(words.some((x) => /a number/.test(x))).toBe(true);
      expect(words.some((x) => /he or she/.test(x))).toBe(true);
      expect(words.some((x) => /says something about it/.test(x))).toBe(true);
      expect(words.some((x) => /cannot fill/.test(x))).toBe(true);
    } finally {
      logs.pop();
      radio.friend = was;
    }
  });
});

describe('sites', () => {
  it('are the same every time from their ids, never in Sol or at Pyre, placed clear of docks and bodies without touching the scene', () => {
    for (const sys of ['sol', 'pyre'] as SystemId[]) for (let slot = 0; slot < 400; slot++) expect(scanFind(sys, slot)).toBeNull();
    const f = found((x) => x.kind === 'derelict');
    expect(scanFind(f.systemId, Number(f.id.split('.').pop()))).toEqual(f);
    const def = sceneDefFor(f.systemId);
    const before = JSON.stringify([def.planets.map((p) => p.position), def.stations.map((p) => p.position), def.arrival]);
    const at = placeSite(def, f.id, f.body);
    expect(placeSite(def, f.id, f.body).equals(at)).toBe(true);
    expect(JSON.stringify([def.planets.map((p) => p.position), def.stations.map((p) => p.position), def.arrival])).toBe(before);
    for (const st of def.stations) expect(st.position.distanceTo(at)).toBeGreaterThanOrEqual(WRECKS.place.clearOfDocks);
    const body = def.planets.find((p) => p.id === f.body) ?? def.stars.find((x) => x.id === f.body)!;
    expect(body).toBeDefined();
    expect(f.bodyName).toBeTruthy();
    const locations = ALL_LOCATIONS.length;
    const s = finding(f);
    expect(ALL_LOCATIONS.length).toBe(locations);
    expect(sitesIn(s, f.systemId).map((x) => x.id)).toEqual([f.id]);
  });

  it('come from the lanes: a wreck or a derelict marked, logged for the salvors, or left; only so many at once', () => {
    const w = hail((x) => x.kind === 'wreck' && !!x.owner);
    const { s, siteId, jobId } = answered(w, 'go');
    expect(s.world.wrecks!.sites[siteId]!.kind).toBe('wreck');
    expect(s.contracts[jobId]!.objectives[0]).toMatchObject({ kind: 'site', siteId });
    const t = pilot(w.systemId, w.start + 5);
    const standing = t.reputation[w.owner!] ?? 0;
    expect(answerLane(t, w, 'call')!.siteId).toBeUndefined();
    expect(t.reputation[w.owner!]).toBe(standing + 1);
    expect(answerLane(pilot(w.systemId, w.start + 5), w, 'leave')!.siteId).toBeUndefined();
    const d = hail((x) => x.kind === 'derelict');
    const dd = answered(d, 'go');
    const spec = siteSpec(dd.siteId, dd.s)!;
    expect(spec.kind).toBe('derelict');
    expect(spec.body).toBe(d.body);
    expect(spec.scale).toBeGreaterThan(1);
    // Four open at once close the go choices.
    const full = pilot(w.systemId, w.start + 5);
    for (let i = 0; i < WRECKS.maxOpen; i++) full.world.wrecks = { sites: { ...(full.world.wrecks?.sites ?? {}), [`scan.${w.systemId}.${i}`]: { at: i * WRECKS.scan.slotSeconds, systemId: w.systemId, kind: 'wreck' } } };
    expect(siteBlock(full)).toMatch(/sites marked/);
    expect(laneChoices(full, w).find((c) => c.id === 'go')!.lock).toMatch(/sites marked/);
  });

  it('come from a scan: the slot’s find once, after the opening, never twice', () => {
    const f = found((x) => x.kind === 'wreck');
    const slot = Number(f.id.split('.').pop());
    const early = pilot(f.systemId, slot * WRECKS.scan.slotSeconds + 5);
    delete early.jobs.lifeline;
    expect(findOnScan(early, f.systemId)).toBeNull();
    const s = finding(f);
    expect(s.jobs[`site.${f.id}`]?.status).toBe('active');
    expect(findOnScan(s, f.systemId)).toBeNull();
    expect(Object.keys(s.world.wrecks!.sites)).toEqual([f.id]);
  });
});

describe('what is found there', () => {
  it('a wreck: its log read and its pods tractored in, its salvage paid; the first log holds a lead', () => {
    const f = found((x) => x.kind === 'wreck' && x.pods.some((p) => p.cargo));
    const s = finding(f);
    const credits = s.credits;
    const read = readSite(s, f.id);
    expect(read.card!.text).toBe(WRECK_LOGS[f.log]);
    expect(read.card!.lead).toBeDefined();
    expect(s.world.wrecks!.sites[f.id]!.ended).toBeUndefined();
    for (const p of f.pods) takeSitePod(s, f.id, p.index);
    expect(s.world.wrecks!.sites[f.id]!.ended?.how).toBe('done');
    expect(s.jobs[`site.${f.id}`]?.status).toBe('complete');
    expect(s.credits - credits).toBe(f.pods.reduce((t, p) => t + (p.credits ?? 0), 0));
    const cargo = f.pods.find((p) => p.cargo)!.cargo!;
    expect(cargoCount(s.ship.cargo, cargo.commodity)).toBe(cargo.qty);
    // Scanned again: nothing more.
    expect(scanSite(s, f.id, false).notes).toEqual([]);
  });

  it('a derelict: boarded for its salvage and a data core, if the hold has room', () => {
    const f = found((x) => x.kind === 'derelict' && x.dataCore);
    const s = finding(f);
    const credits = s.credits;
    const out = boardSite(s, f.id);
    expect(s.credits - credits).toBe(f.salvage);
    expect(cargoCount(s.ship.cargo, 'data-cores')).toBe(1);
    expect(out.card!.found).toMatch(/data core/);
    expect(s.world.wrecks!.sites[f.id]!.ended?.how).toBe('done');
    const full = finding(f);
    full.ship.cargo = { metals: cargoCapacity(full.ship) };
    expect(boardSite(full, f.id).notes.map((n) => n.text).join(' ')).toMatch(/No room in the hold/);
    expect(cargoCount(full.ship.cargo, 'data-cores')).toBe(0);
  });

  it('a lead offers a trail only when none is under way, and later logs only now and then', () => {
    const f = found((x) => x.kind === 'wreck');
    const s = finding(f);
    const lead = leadAt(s, f.id)!;
    expect(lead).toBeTruthy();
    expect(followLead(s, f.id, lead.mystery).ok).toBe(true);
    expect(leadAt(s, f.id)).toBeNull();
    expect(followLead(s, f.id, lead.mystery).ok).toBe(false);
    const later = finding(f);
    later.world.wrecks!.read = 5;
    let leads = 0;
    let logs = 0;
    for (let slot = 20; slot < 600 && logs < 200; slot++) {
      for (const sys of SYSTEMS) {
        const g = scanFind(sys.id, slot);
        if (!g || g.kind !== 'wreck') continue;
        logs++;
        if (leadAt(later, g.id)) leads++;
      }
    }
    expect(leads / logs).toBeGreaterThan(WRECKS.leads.chance * 0.5);
    expect(leads / logs).toBeLessThan(WRECKS.leads.chance * 1.5);
  });
});

/** A starting site whose trail goes somewhere, and a pilot who has followed it. */
function trail(m: MysteryId): { s: GameState; from: SiteSpec } {
  const from = found((x) => MYSTERIES[m].from.includes(x.kind) && !!mysteryPlaces(m, x.id));
  const s = finding(from);
  expect(followLead(s, from.id, m).ok).toBe(true);
  expect(mysteryUnderWay(s)).toBe(m);
  return { s, from };
}

/** The pilot docks at a station, as if flown there. */
function dock(s: GameState, locationId: string): void {
  s.location = { ...s.location, systemId: getLocation(locationId).systemId, dockedAt: null };
  dockAt(s, locationId);
}

describe('the trails', () => {
  it('lead where they should from every kind of start: never Sol or Pyre, endings at stations of their kinds, insurers lawful', () => {
    for (const m of MYSTERY_IDS) {
      let n = 0;
      for (let slot = 20; slot < 200 && n < 60; slot++) {
        for (const sys of SYSTEMS) {
          const f = scanFind(sys.id, slot);
          if (!f || !MYSTERIES[m].from.includes(f.kind) || !mysteryPlaces(m, f.id)) continue;
          n++;
          expect(checkTrail(m, f.id)).toBeNull();
          const p = mysteryPlaces(m, f.id)!;
          expect(p.find).not.toBe(f.systemId);
          expect(isInventedSystem(p.find)).toBe(false);
        }
      }
      expect(n).toBeGreaterThan(10);
    }
    // The lifeboat's trail can start from every wreck, so the first log read always holds a lead.
    for (let slot = 20; slot < 120; slot++) {
      for (const sys of SYSTEMS) {
        const f = scanFind(sys.id, slot);
        if (f?.kind === 'wreck') expect(mysteryPlaces('tender', f.id), f.id).not.toBeNull();
      }
    }
  });

  it('the lifeboat: its recorder tractored in, its crew found at a research station or relay, paid', () => {
    const { s } = trail('tender');
    const places = mysteryPlaces('tender', s.world.wrecks!.mysteries!.tender!.from)!;
    s.location.systemId = places.find;
    const out = takeSitePod(s, 'mys.tender.1', 0);
    expect(out.card!.text).toMatch(/hauler took the crew aboard/);
    expect(s.world.wrecks!.mysteries!.tender!.step).toBe(1);
    const credits = s.credits;
    dock(s, places.end);
    expect(s.jobs['mys.tender']?.status).toBe('complete');
    expect(s.credits - credits).toBe(MYSTERIES.tender.end.pay);
    settleSites(s, null);
    expect(s.world.wrecks!.mysteries!.tender!.ended?.how).toBe('solved');
    assertValidState(s);
  });

  it('the strongbox: taken back from guards, then returned to its insurers or sold to a fence for more and the Wake’s thanks', () => {
    for (const choice of ['insurer', 'fence'] as const) {
      const { s } = trail('strongbox');
      const places = mysteryPlaces('strongbox', s.world.wrecks!.mysteries!.strongbox!.from)!;
      const find = siteSpec('mys.strongbox.1', s)!;
      expect(find.guard).not.toBeNull();
      s.location.systemId = places.find;
      const out = takeSitePod(s, 'mys.strongbox.1', 0);
      expect(out.card!.choose).toBeDefined();
      expect(chooseEnding(s, choice).ok).toBe(true);
      const credits = s.credits;
      const wake = s.reputation['hollow-wake'] ?? 0;
      const end = choice === 'fence' ? places.fence! : places.end;
      dock(s, end);
      expect(s.jobs['mys.strongbox']?.status).toBe('complete');
      expect(s.credits - credits).toBe(choice === 'fence' ? MYSTERIES.strongbox.fence!.pay : MYSTERIES.strongbox.end.pay);
      if (choice === 'fence') expect((s.reputation['hollow-wake'] ?? 0) - wake).toBe(MYSTERIES.strongbox.fence!.wake);
      // Its extra salvage pods may still be taken, once.
      const extra = find.pods.find((p) => !p.required);
      if (extra) expect(takeSitePod(s, 'mys.strongbox.1', extra.index).notes.length).toBe(1);
    }
  });

  it('the sister ship: boarded near its body, its vault brought to a research station', () => {
    const { s } = trail('silence');
    const places = mysteryPlaces('silence', s.world.wrecks!.mysteries!.silence!.from)!;
    const find = siteSpec('mys.silence.1', s)!;
    expect(find.kind).toBe('derelict');
    expect(find.ship).toBe(places.sister);
    expect(find.body).toBe(places.body);
    expect(find.dark).toBeNull();
    s.location.systemId = places.find;
    expect(boardSite(s, 'mys.silence.1').card!.found).toMatch(/vault/);
    const credits = s.credits;
    dock(s, places.end);
    expect(s.credits - credits).toBe(MYSTERIES.silence.end.pay);
  });

  it('go cold when a step’s time runs out (never while flying there), drop when abandoned, and come once a save', () => {
    const { s } = trail('tender');
    const places = mysteryPlaces('tender', s.world.wrecks!.mysteries!.tender!.from)!;
    s.clock += WRECKS.open.step + 10;
    settleSites(s, places.find);
    expect(s.world.wrecks!.mysteries!.tender!.ended).toBeUndefined();
    const out = settleSites(s, null);
    expect(s.world.wrecks!.mysteries!.tender!.ended?.how).toBe('cold');
    expect(out.notes.map((n) => n.text).join(' ')).toMatch(/gone cold/);
    expect(s.jobs['mys.tender']?.status).toBe('failed');
    expect(followLead(s, s.world.wrecks!.mysteries!.tender!.from, 'tender').ok).toBe(false);
    const dropped = trail('silence').s;
    abandonJob(dropped, 'mys.silence');
    settleSites(dropped, null);
    expect(dropped.world.wrecks!.mysteries!.silence!.ended?.how).toBe('dropped');
  });
});

describe('settling', () => {
  it('lapses a site after its window, never while flying there; a lifepod let lapse weighs on soft hearts; tidies to the rules', () => {
    const o = hail((x) => x.kind === 'lifepod');
    const { s, siteId, jobId } = answered(o, 'aboard');
    s.clock += WRECKS.open.lane + 10;
    settleSites(s, o.systemId);
    expect(s.world.wrecks!.sites[siteId]!.ended).toBeUndefined();
    const out = settleSites(s, null);
    expect(s.world.wrecks!.sites[siteId]!.ended?.how).toBe('lapsed');
    expect(out.notes[0]!.text).toMatch(/picked up/);
    expect(s.jobs[jobId]?.status).toBe('failed');
    expect(CREW.siteDeeds['lifepod.lapsed']).toBe('adrift');
    const many = pilot(o.systemId, 100_000);
    many.world.wrecks = { sites: {} };
    for (let i = 0; i < 40; i++) many.world.wrecks.sites[`scan.${o.systemId}.${80 + i}`] = { at: (80 + i) * WRECKS.scan.slotSeconds, systemId: o.systemId, kind: 'wreck', ended: { at: 99_000 + i, how: 'done' } };
    tidySites(many);
    expect(Object.keys(many.world.wrecks.sites).length).toBe(WRECKS.keep.sites);
  });

  it('springs a decoy for a pilot the Wake trusts with a wave, and nothing to gain', () => {
    const bait = hail((x) => x.kind === 'mayday' && x.trap);
    const { s, siteId, jobId } = answered(bait, 'help');
    adjustReputation(s.reputation, 'hollow-wake', 60);
    const out = springSite(s, siteId, 'near', true);
    expect(out.comm?.text).toBe(SITE_RADIO.friend);
    expect(s.jobs[jobId]?.status).toBe('failed');
  });
});

describe('the save', () => {
  it('keeps sites and trails, and refuses damaged records', () => {
    const { s } = trail('tender');
    assertValidState(s);
    const refuse = (patch: (x: GameState) => void) => {
      const bad = structuredClone(s);
      patch(bad);
      expect(() => assertValidState(bad)).toThrow(/damaged/);
    };
    refuse((x) => (x.world.wrecks!.sites['lane.nowhere.3'] = { at: 1, systemId: 'barnard' as SystemId, kind: 'wreck' }));
    refuse((x) => (Object.values(x.world.wrecks!.sites)[0]!.taken = [1, 1]));
    refuse((x) => ((Object.values(x.world.wrecks!.sites)[0] as { read?: unknown }).read = false));
    refuse((x) => (x.world.wrecks!.mysteries!.tender!.choice = 'fence'));
    refuse((x) => (x.world.wrecks!.mysteries!.tender!.from = 'mys.tender.1'));
    refuse((x) => delete x.world.wrecks!.sites['mys.tender.1']);
  });
});

// ---------------------------------------------------------------- in flight

function installCanvasStub(): void {
  if ((globalThis as { document?: unknown }).document) return;
  const stub = (): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'getImageData' || prop === 'createImageData') {
          return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
        }
        return stub();
      },
      apply() {
        return stub();
      },
      set() {
        return true;
      },
    });
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => stub() }),
  };
}

/** A real flight in the site's system, its sites spawned, `onSite` writing into the save as the game does. */
function fly(s: GameState, siteId: string): { flight: FlightSession; run: (seconds: number, action?: FlightAction) => void; events: string[]; messages: string[]; target: string } {
  installCanvasStub();
  const systemId = s.world.wrecks!.sites[siteId]!.systemId;
  s.location.systemId = systemId;
  const events: string[] = [];
  const messages: string[] = [];
  const nothing = () => {};
  const flight = new FlightSession({
    system: new SystemScene(sceneDefFor(systemId, null, s.clock), { quality: 'low', reducedMotion: true }),
    camera: new THREE.PerspectiveCamera(),
    state: s,
    settings: defaultSettings(),
    ctx: { quality: 'low', reducedMotion: true },
    audio: { play() {}, setCombatIntensity() {}, setEngine() {} } as unknown as AudioEngine,
    callbacks: {
      onDocked: nothing,
      onPlayerDestroyed: nothing,
      onDiscovery: nothing,
      onScanInfo: nothing,
      onEncounterStart: nothing,
      onEncounterEnd: nothing,
      onLoot: nothing,
      onBounty: nothing,
      onContractKill: nothing,
      onMessage: (t) => messages.push(t),
      onComm: nothing,
      onSite: (id, what, detail) => {
        events.push(`${what}${detail?.how ? `:${detail.how}` : ''}`);
        if (what === 'pod') takeSitePod(s, id, detail!.index!);
        if (what === 'scanned') scanSite(s, id, !!detail?.revealed);
        if (what === 'boarded') boardSite(s, id);
        if (what === 'sprung') springSite(s, id, detail!.how!, !!detail!.friend);
        if (what === 'reached') {
          s.world.wrecks!.sites[id]!.reached = true;
          s.world.wrecks!.sites[id]!.ended = { at: s.clock, how: 'done' };
        }
      },
    },
    lanes: false,
    traffic: { ...trafficFor(systemId, 'low', s.clock), plan: { ...trafficFor(systemId, 'low', s.clock).plan, packs: null, patrolWings: 0 }, sites: sitesIn(s, systemId) },
  });
  flight.start({ kind: 'arrival' });
  const run = (seconds: number, action?: FlightAction) => {
    for (let t = 0; t < seconds; t += 1 / 10) {
      s.clock += 1 / 10;
      const input = emptyInput();
      if (action && t === 0) input.actions.add(action);
      flight.update(1 / 10, input);
    }
  };
  run(2.5);
  return { flight, run, events, messages, target: `site:${siteId}` };
}

describe('in flight', () => {
  it('a wreck: its hull and pods there; scanned, its log read; flown close, its pods come in and it is done', () => {
    const f = found((x) => x.kind === 'wreck' && x.guard === null);
    const s = finding(f);
    const { flight, run, events, target } = fly(s, f.id);
    expect(flight.findTarget(target)?.kind).toBe('wreck');
    expect(flight.debugSites()[0]).toMatchObject({ id: f.id, kind: 'wreck', pods: f.pods.length, guards: 0, dark: null });
    expect(flight.placeNear(target, 900)).toBe(true);
    flight.selectTarget(target);
    run(0.2);
    expect(flight.contextAction()?.label).toBe('Scan');
    run(0.2, 'scan');
    expect(events).toContain('scanned');
    expect(s.world.wrecks!.sites[f.id]!.read).toBe(true);
    expect(flight.placeNear(target, 20)).toBe(true);
    run(8);
    expect(events.filter((e) => e === 'pod').length).toBe(f.pods.length);
    expect(s.world.wrecks!.sites[f.id]!.ended?.how).toBe('done');
    run(0.5);
    expect(flight.findTarget(target)).toBeNull();
    expect(flight.lingering().pods).toEqual([]);
    flight.dispose();
  });

  it('a derelict with raiders lying dark: a scan from further out shows and springs them; nearer, they spring at the hull', () => {
    const f = found((x) => x.kind === 'derelict' && x.dark !== null);
    const near = finding(f);
    const a = fly(near, f.id);
    expect(a.flight.debugSites()[0]!.dark).toBe('hidden');
    a.flight.placeNear(a.target, WRECKS.danger.spring - 500);
    a.run(1);
    expect(a.events).toContain('sprung:near');
    expect(a.flight.debugNpcs().filter((n) => n.site === f.id && n.side === 'raider').length).toBe(f.darkCount);
    expect(a.flight.lingering().packs).toEqual([]);
    a.flight.dispose();
    const far = finding(f);
    const b = fly(far, f.id);
    b.flight.placeNear(b.target, WRECKS.danger.spring + 500);
    b.flight.selectTarget(b.target);
    b.run(0.2, 'scan');
    expect(b.events.slice(0, 2)).toEqual(['sprung:scan', 'scanned']);
    expect(far.world.wrecks!.sites[f.id]!.sprung).toBe(true);
    b.flight.dispose();
  });

  it('a derelict boarded: held steady alongside for its seconds; pulling away breaks it off', () => {
    const f = found((x) => x.kind === 'derelict' && x.dark === null);
    const s = finding(f);
    const { flight, run, events, messages, target } = fly(s, f.id);
    flight.placeNear(target, 100);
    run(0.2);
    expect(flight.contextAction()?.label).toBe('Board');
    run(0.2, 'interact');
    expect(flight.debugSites()[0]!.boarding).not.toBeNull();
    expect(flight.hud.autopilot).toMatch(/Boarding the/);
    flight.player.velocity.set(0, 0, 200);
    run(0.3);
    expect(messages.join(' ')).toMatch(/Boarding broken off/);
    expect(flight.debugSites()[0]!.boarding).toBeNull();
    flight.placeNear(target, 100);
    run(0.2, 'interact');
    run(WRECKS.board.seconds + 1);
    expect(events).toContain('boarded');
    expect(s.world.wrecks!.sites[f.id]!.boarded).toBe(true);
    flight.dispose();
  });

  it('a guarded wreck: its raiders seen, holding their spot', () => {
    const f = found((x) => x.kind === 'wreck' && x.guard !== null);
    const s = finding(f);
    const { flight, run } = fly(s, f.id);
    const guards = flight.debugNpcs().filter((n) => n.site === f.id);
    expect(guards.length).toBe(f.guard);
    run(5);
    expect(flight.debugSites()[0]!.guards).toBe(f.guard);
    flight.dispose();
  });

  it('a ship in distress: at rest until the pilot comes alongside; reached, it is done', () => {
    const o = hail((x) => x.kind === 'mayday' && !x.trap);
    const { s, siteId } = answered(o, 'help');
    const { flight, run, events, target } = fly(s, siteId);
    expect(flight.findTarget(target)?.kind).toBe('ship');
    expect(flight.debugNpcs().find((n) => n.site === siteId)?.role).toBe('trader');
    flight.placeNear(target, WRECKS.reach - 150);
    run(0.5);
    expect(events).toContain('reached');
    flight.dispose();
  });

  it('a site marked mid-flight joins the scene', () => {
    const o = hail((x) => x.kind === 'wreck');
    const { s, siteId } = answered(o, 'go');
    const other = found((x) => x.kind === 'wreck' && x.systemId === o.systemId, 1);
    const t = s;
    const { flight } = fly(t, siteId);
    const before = flight.debugSites().length;
    t.clock = Number(other.id.split('.').pop()) * WRECKS.scan.slotSeconds + 5;
    expect(findOnScan(t, o.systemId)?.siteId).toBe(other.id);
    flight.addSite(siteSetup(t, other.id)!);
    flight.addSite(siteSetup(t, other.id)!);
    expect(flight.debugSites().length).toBe(before + 1);
    flight.dispose();
  });
});

describe('the lanes’ sites and the crew', () => {
  it('a lifepod tractored in is a rescue to soft hearts; marking needs the lane’s own encounter', () => {
    expect(CREW.siteDeeds['lifepod.taken']).toBe('rescue');
    const o = hail((x) => x.kind === 'trader');
    const s = pilot(o.systemId, o.start + 5);
    expect(markLaneSite(s, o)).toBeNull();
  });
});
