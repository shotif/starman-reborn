import { describe, expect, it } from 'vitest';
import { shipsForSale, gearForSale, shopRule } from '../../src/content/catalog.ts';
import { bundledWorldContext, validateBundledWorld } from '../../src/content/world/bundled.ts';
import { generateWorld, spectralClass } from '../../src/content/world/generate.ts';
import { jumpsFrom } from '../../src/content/world/network.ts';
import { NETWORK, TERRITORY, WORLD_SEED } from '../../src/content/world/rules.ts';
import type { WorldResult } from '../../src/content/world/types.ts';
import { validateWorld } from '../../src/content/world/validate.ts';
import { formatIssues } from '../../src/content/validate.ts';
import { getLocation, getSystem, SYSTEMS, WORLD, WORLD_SEEDS } from '../../src/data/systems.ts';

const rulesOf = (issues: { rule: string }[]) => [...new Set(issues.map((i) => i.rule))];

describe('world generator', () => {
  it('builds the bundled world without breaking a guardrail', () => {
    const issues = validateBundledWorld();
    expect(formatIssues(issues)).toBe('');
  });

  it('is a pure function of the catalogue and the seed', () => {
    const again = generateWorld(WORLD_SEEDS, WORLD_SEED);
    expect(JSON.stringify(again.stations)).toBe(JSON.stringify(WORLD.stations));
    expect([...again.links]).toEqual([...WORLD.links]);
    expect([...again.profiles]).toEqual([...WORLD.profiles]);
  });

  it('passes every guardrail for other seeds too', () => {
    const ctx = bundledWorldContext();
    for (let seed = 1; seed <= 12; seed++) {
      const world = generateWorld(WORLD_SEEDS, seed * 7919);
      const issues = validateWorld(WORLD_SEEDS, world, { ...ctx, curated: ctx.curated });
      expect(formatIssues(issues), `seed ${seed * 7919}`).toBe('');
    }
  });

  it('keeps the hand-authored core and its lanes', () => {
    expect(WORLD.links.get('sol')).toEqual(expect.arrayContaining(['alpha-centauri', 'barnard', 'sirius']));
    expect(WORLD.links.get('sirius')).toContain('epsilon-eridani');
    for (const id of ['sol', 'alpha-centauri', 'barnard', 'sirius', 'epsilon-eridani']) {
      expect(WORLD.stations.some((s) => s.systemId === id)).toBe(false);
      expect(WORLD.profiles.get(id)!.security).toBe(1);
    }
    expect(WORLD.profiles.get('sol')!.owner).toBe('sta');
    expect(WORLD.profiles.get('epsilon-eridani')!.owner).toBe('frontier');
  });

  it('grows lawless toward the edge and hides raiders away from the core', () => {
    const jumps = jumpsFrom(WORLD.links, 'sol');
    const neighbours = WORLD.links.get('sol')!.filter((id) => !['alpha-centauri', 'barnard', 'sirius'].includes(id));
    for (const id of neighbours) expect(WORLD.profiles.get(id)!.owner).toBe('sta');
    const dens = WORLD.stations.filter((s) => s.type === 'pirate-den');
    expect(dens.length).toBeGreaterThanOrEqual(3);
    for (const d of dens) {
      expect(jumps.get(d.systemId)!).toBeGreaterThanOrEqual(2);
      expect(WORLD.profiles.get(d.systemId)!.security).toBeLessThan(TERRITORY.lawlessBelow);
      expect(getLocation(d.id).dockable).toBe(false);
    }
    // Security falls with distance from the lawful homes, on average.
    const sec = (ids: string[]) => ids.reduce((a, id) => a + WORLD.profiles.get(id)!.security, 0) / ids.length;
    const near = SYSTEMS.filter((s) => (jumps.get(s.id) ?? 0) <= 1).map((s) => s.id);
    const far = SYSTEMS.filter((s) => (jumps.get(s.id) ?? 0) >= 4).map((s) => s.id);
    expect(sec(near)).toBeGreaterThan(sec(far) + 0.2);
  });

  it('attaches stations to real stars and confirmed planets and builds every kind', () => {
    const types = new Set(WORLD.stations.map((s) => s.type));
    expect(types.size).toBe(12);
    for (const st of WORLD.stations) {
      const sys = getSystem(st.systemId);
      const bodies = [...sys.componentIds, ...sys.confirmedBodies.map((p) => p.id)];
      expect(bodies).toContain(st.anchorId);
      const loc = getLocation(st.id);
      expect(loc.fictional).toBe(true);
      expect(loc.stationType).toBe(st.type);
      expect(sys.fictionalLocations.some((l) => l.id === st.id)).toBe(true);
    }
    // Mining outposts only where a small confirmed planet exists to mine.
    for (const st of WORLD.stations.filter((s) => s.type === 'mining-outpost')) {
      expect(getSystem(st.systemId).confirmedBodies.some((p) => p.id === st.anchorId)).toBe(true);
    }
  });

  it('gives generated outfitters and shipyards real stock', () => {
    const yards = WORLD.stations.filter((s) => (s.shop?.shipyard.length ?? 0) > 0);
    expect(yards.length).toBeGreaterThan(5);
    for (const st of yards) expect(shipsForSale(st.id).length, st.id).toBeGreaterThan(0);
    for (const st of WORLD.stations.filter((s) => s.services.includes('equipment'))) expect(gearForSale(st.id).length, st.id).toBeGreaterThan(0);
    // Free ports sell salvaged raider gear.
    const freeport = WORLD.stations.find((s) => s.type === 'freeport')!;
    expect(shopRule(freeport.id)!.makers).toContain('wake');
    expect(shopRule('earth-port')!.makers).toEqual(['halden']);
  });

  it('reads spectral classes the way the catalogue writes them', () => {
    expect(spectralClass('M5.5Ve')).toBe('M');
    expect(spectralClass('dM6 e')).toBe('M');
    expect(spectralClass('sdM4')).toBe('M');
    expect(spectralClass('DA2')).toBe('D');
    expect(spectralClass('DZ7')).toBe('D');
    expect(spectralClass('K0V')).toBe('K');
  });
});

describe('world guardrails catch broken worlds', () => {
  const ctx = bundledWorldContext();
  const mutate = (fn: (w: { links: Map<string, string[]>; stations: WorldResult['stations'][number][]; profiles: Map<string, WorldResult['profiles'] extends ReadonlyMap<string, infer P> ? P : never> }) => void) => {
    const w = {
      links: new Map([...WORLD.links].map(([k, v]) => [k, [...v]])),
      stations: structuredClone([...WORLD.stations]),
      profiles: new Map([...WORLD.profiles].map(([k, v]) => [k, { ...v }])),
    };
    fn(w);
    return rulesOf(validateWorld(WORLD_SEEDS, w, ctx));
  };

  it('reports one-way, unreachable and overlong lanes', () => {
    expect(
      mutate((w) => {
        w.links.set('altair', []);
        w.links.set('70-ophiuchi', w.links.get('70-ophiuchi')!.filter((x) => x !== 'altair'));
      }),
    ).toContain('network');
    expect(mutate((w) => w.links.get('sol')!.push('altair'))).toContain('network');
    expect(NETWORK.maxLinkLy).toBeLessThan(16);
  });

  it('reports a pirate den in policed space, a clashing name and a lawful station without services', () => {
    expect(
      mutate((w) => {
        const den = w.stations.find((s) => s.type === 'pirate-den')!;
        w.profiles.get(den.systemId)!.security = 0.9;
      }),
    ).toContain('stations');
    expect(
      mutate((w) => {
        const st = w.stations.find((s) => s.type === 'relay')!;
        st.name = 'Petrel Relay';
      }),
    ).toContain('names');
    expect(
      mutate((w) => {
        const st = w.stations.find((s) => s.type === 'factory')!;
        (st as unknown as { services: string[] }).services = [];
      }),
    ).toContain('stations');
  });

  it('reports a missing kind of station and a shipyard with nothing to sell', () => {
    expect(mutate((w) => w.stations.splice(0, w.stations.length, ...w.stations.filter((s) => s.type !== 'shipyard')))).toContain('coverage');
    expect(
      mutate((w) => {
        const st = w.stations.find((s) => (s.shop?.shipyard.length ?? 0) > 0)!;
        st.shop = { ...st.shop!, makers: ['ares'], shipyard: ['surveyor'] };
      }),
    ).toContain('shops');
  });
});
