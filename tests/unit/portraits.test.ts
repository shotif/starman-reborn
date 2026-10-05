import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHARACTERS } from '../../src/content/story/arcs.ts';
import type { CharacterId } from '../../src/content/story/types.ts';
import {
  PORTRAIT_AGES,
  PORTRAIT_FACTIONS,
  PORTRAIT_ROLES,
  STORY_PORTRAITS,
  describeLook,
  portraitElement,
  portraitSvg,
  portraitTraits,
  type PortraitLook,
} from '../../src/ui/portraits.ts';

/**
 * Procedural portraits for the people in the bars (src/ui/portraits.ts): deterministic, varied,
 * well-formed and light SVG for every faction, role and age, and the six story characters.
 */

const EVERY_LOOK: PortraitLook[] = PORTRAIT_FACTIONS.flatMap((faction) => PORTRAIT_ROLES.flatMap((role) => PORTRAIT_AGES.map((age) => ({ faction, role, age }))));

/** Structural problems with an SVG document, as readable strings (empty when fine). */
function svgProblems(svg: string): string[] {
  const problems: string[] = [];
  if (!svg.startsWith('<svg ') || !svg.endsWith('</svg>')) problems.push('not a single <svg> element');
  if ((svg.match(/<svg[\s>]/g) ?? []).length !== 1) problems.push('more than one <svg> element');
  if (!/^<svg [^>]*viewBox="0 0 96 96"/.test(svg)) problems.push('no 96×96 viewBox on the root');
  if (!/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg)) problems.push('no SVG namespace');
  if (/NaN|undefined|Infinity|null|\[object/.test(svg)) problems.push('a value that did not format');
  if (/<script|<foreignObject|\son[a-z]+=/i.test(svg)) problems.push('something other than shapes');
  // Balanced tags; attribute values always quoted.
  const stack: string[] = [];
  for (const [tag, close, name, attrs, self] of svg.matchAll(/<(\/?)([a-zA-Z]+)([^<>]*?)(\/?)>/g)) {
    if (/=[^"]/.test(attrs!.replace(/="[^"]*"/g, ''))) problems.push(`unquoted attribute in ${tag}`);
    if (self) continue;
    if (!close) stack.push(name!);
    else if (stack.pop() !== name) problems.push(`</${name}> closes the wrong element`);
    if (stack.length === 0 && close && name === 'svg' && tag !== svg.slice(-tag.length)) problems.push('content after </svg>');
  }
  if (stack.length) problems.push(`unclosed ${stack.join(', ')}`);
  if (svg.replace(/<[^<>]*>/g, '').trim()) problems.push('stray text between tags');
  // Every reference points at an id defined once in the same document.
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
  if (new Set(ids).size !== ids.length) problems.push('an id defined twice');
  for (const [, ref] of svg.matchAll(/(?:url\(#|href="#)([^")]+)/g)) if (!ids.includes(ref!)) problems.push(`reference to missing #${ref}`);
  return problems;
}

/** The markup with its id prefix replaced, so two portraits compare by what they draw. */
function drawn(svg: string): string {
  const prefix = /\sid="([^"]*?)b"/.exec(svg)![1]!;
  return svg.split(prefix).join('#');
}

describe('portraits', () => {
  it('are a pure function of the seed and look', () => {
    for (const look of EVERY_LOOK.slice(0, 20)) {
      for (const seed of [0, 1, 42, 1_000_003, 0xffffffff]) {
        expect(portraitSvg(seed, look)).toBe(portraitSvg(seed, look));
        expect(portraitTraits(seed, look)).toEqual(portraitTraits(seed, look));
      }
    }
  });

  it('differ from seed to seed', () => {
    const look: PortraitLook = { faction: 'independent', role: 'trader' };
    const faces = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) faces.add(drawn(portraitSvg(seed, look)));
    expect(faces.size).toBe(60);
    // And not only in the details: skin, hair and face shape vary across a few dozen people.
    const traits = Array.from({ length: 60 }, (_, i) => portraitTraits(i + 1, look));
    expect(new Set(traits.map((t) => t.skin)).size).toBeGreaterThanOrEqual(10);
    expect(new Set(traits.map((t) => t.style)).size).toBeGreaterThanOrEqual(10);
    expect(new Set(traits.map((t) => t.hair)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(traits.map((t) => t.hw.toFixed(0))).size).toBeGreaterThanOrEqual(3);
  });

  it('keep the same face when only the clothes change', () => {
    const a = portraitTraits(77, { faction: 'sta', role: 'officer', age: 'middle' });
    const b = portraitTraits(77, { faction: 'hollow-wake', role: 'miner', age: 'middle' });
    expect([b.skin, b.iris, b.eye, b.chin, b.hw, b.noseW]).toEqual([a.skin, a.iris, a.eye, a.chin, a.hw, a.noseW]);
    expect(b.garment).not.toBe(a.garment);
  });

  it('are well-formed SVG for every faction, role and age', () => {
    for (const look of EVERY_LOOK) {
      for (const seed of [1, 7, 23, 404, 9001]) {
        const svg = portraitSvg(seed, look);
        expect(svgProblems(svg), `${seed} ${JSON.stringify(look)}`).toEqual([]);
      }
    }
  });

  it('stay light: a few KB each', () => {
    const sizes = EVERY_LOOK.flatMap((look) => Array.from({ length: 12 }, (_, i) => portraitSvg(i * 97 + 5, look).length));
    expect(Math.max(...sizes)).toBeLessThan(10_000);
    expect(sizes.reduce((a, b) => a + b, 0) / sizes.length).toBeLessThan(7_500);
  });

  it('dress each role and faction as the brief says', () => {
    for (const look of EVERY_LOOK) {
      for (const seed of [3, 30, 300]) {
        const t = portraitTraits(seed, look);
        const where = `${seed} ${JSON.stringify(look)}`;
        expect(t.age, where).toBe(look.age);
        expect(t.headwear === 'headset', where).toBe(look.role === 'pilot');
        expect(t.headwear === 'hood', where).toBe(look.role === 'fixer');
        if (look.role === 'miner') expect(['goggles', 'visor'], where).toContain(t.headwear);
        expect(t.tabs, where).toBe(look.role === 'officer');
        expect(t.slate, where).toBe(look.role === 'trader' || look.role === 'scientist');
        if (look.role === 'colonist') expect([null, 'beanie', 'scarf'], where).toContain(t.headwear);
        if (look.faction === 'sta') expect([t.cloth.trim, t.emblem], where).toEqual(['#5cc8ff', 'ring']);
        if (look.faction === 'frontier') expect(t.emblem, where).toBe('chevron');
        if (look.faction === 'hollow-wake') expect(t.emblem, where).toBe('wake');
      }
    }
    // The Wake wears patches and scars more than anyone.
    const scarred = (faction: PortraitLook['faction']) => Array.from({ length: 200 }, (_, i) => portraitTraits(i, { faction, role: 'trader' })).filter((t) => t.scar).length;
    expect(scarred('hollow-wake')).toBeGreaterThan(scarred('sta') * 3);
    expect(portraitTraits(5, { faction: 'hollow-wake', role: 'colonist' }).patches).toBeGreaterThan(0);
  });

  it('grey with age', () => {
    const greys = ['#716d69', '#a2a09c', '#c8cacb', '#e8e6e1'];
    for (let seed = 0; seed < 100; seed++) {
      const old = portraitTraits(seed, { faction: 'frontier', role: 'colonist', age: 'old' });
      const young = portraitTraits(seed, { faction: 'frontier', role: 'colonist', age: 'young' });
      expect(greys).toContain(old.hair);
      expect(old.wrinkles).toBeGreaterThan(0.5);
      expect(young.wrinkles).toBe(0);
    }
  });

  it('cover the story characters, each with a face of their own', () => {
    const ids = Object.keys(CHARACTERS) as CharacterId[];
    expect(Object.keys(STORY_PORTRAITS).sort()).toEqual([...ids].sort());
    expect(new Set(ids.map((id) => STORY_PORTRAITS[id].seed)).size).toBe(ids.length);
    for (const id of ids) {
      const { seed, look } = STORY_PORTRAITS[id];
      expect(look.faction, id).toBe(CHARACTERS[id].factionId ?? 'independent');
      expect(look.age, id).toBeDefined();
      expect(seed, id).toBeGreaterThan(1000);
      expect(svgProblems(portraitSvg(seed, look)), id).toEqual([]);
    }
  });

  it('keep what makes each story character who they are', () => {
    const t = (id: CharacterId) => portraitTraits(STORY_PORTRAITS[id].seed, STORY_PORTRAITS[id].look);
    expect([t('castell').glasses, t('castell').tabs, t('castell').garment]).toEqual(['square', true, 'tunic']);
    expect([t('kettering').headwear, t('kettering').style]).toEqual(['headset', 'side']);
    expect([t('quist').headwear, t('quist').slate]).toEqual(['scarf', true]);
    expect([t('brandt').headwear, t('brandt').beard]).toEqual(['beanie', null]);
    expect([t('ansari').glasses, t('ansari').garment]).toEqual(['square', 'lab']);
    expect([t('salt').implant, t('salt').scar, t('salt').age]).toEqual(['eye', 'cheek', 'old']);
    expect([t('halloway').headwear, t('halloway').style, t('halloway').garment]).toEqual(['headset', 'bob', 'jacket']);
    expect([t('fenwick').style, t('fenwick').garment, t('fenwick').beard]).toEqual(['afro', 'shirt', null]);
    expect([t('rook').headwear, t('rook').style, t('rook').garment]).toEqual(['goggles', 'bun', 'coverall']);
    expect([t('ashdown').headwear, t('ashdown').beard, t('ashdown').garment]).toEqual(['goggles', 'full', 'coverall']);
  });

  it('describe themselves to screen readers', () => {
    expect(describeLook({ faction: 'sta', role: 'officer' })).toBe('Portrait of a Transit Authority officer');
    expect(describeLook({ faction: 'independent', role: 'miner' })).toBe('Portrait of an independent miner');
    expect(describeLook({ faction: 'hollow-wake', role: 'fixer', age: 'old' })).toBe('Portrait of an older Hollow Wake fixer');
  });
});

describe('portrait elements', () => {
  // A small stand-in for the DOM: enough for h() and innerHTML.
  let installed = false;
  beforeAll(() => {
    if ((globalThis as { document?: unknown }).document) return;
    installed = true;
    (globalThis as { document?: unknown }).document = {
      createElement: (tagName: string) => {
        const attrs: Record<string, string> = {};
        return { tagName: tagName.toUpperCase(), className: '', innerHTML: '', dataset: {}, style: {}, attrs, setAttribute: (k: string, v: string) => (attrs[k] = v), getAttribute: (k: string) => attrs[k] ?? null };
      },
    };
  });
  afterAll(() => {
    if (installed) delete (globalThis as { document?: unknown }).document;
  });

  type Fake = { tagName: string; className: string; innerHTML: string; dataset: Record<string, string>; getAttribute(k: string): string | null };

  it('are framed, labelled images holding the SVG', () => {
    const el = portraitElement(1915, STORY_PORTRAITS.castell.look, { label: 'Rhea Castell', size: 'lg' }) as unknown as Fake;
    expect(el.tagName).toBe('SPAN');
    expect(el.className.split(' ')).toEqual(expect.arrayContaining(['portrait', 'frame', 'portrait-lg']));
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('Rhea Castell');
    expect(el.dataset.faction).toBe('sta');
    expect(el.innerHTML.startsWith('<svg aria-hidden="true" focusable="false" ')).toBe(true);
    expect(svgProblems(el.innerHTML.replace(' aria-hidden="true" focusable="false"', ''))).toEqual([]);
    const plain = portraitElement(3, { faction: 'frontier', role: 'miner' }) as unknown as Fake;
    expect(plain.getAttribute('aria-label')).toBe('Portrait of a Frontier Cooperative miner');
    expect(plain.className).toContain('portrait-md');
  });

  it('give every copy its own ids, so one page can show the same person twice', () => {
    const look: PortraitLook = { faction: 'hollow-wake', role: 'pilot' };
    const a = (portraitElement(8, look) as unknown as Fake).innerHTML;
    const b = (portraitElement(8, look) as unknown as Fake).innerHTML;
    const ids = (svg: string) => [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids(a).filter((id) => ids(b).includes(id))).toEqual([]);
    expect(drawn(a)).toBe(drawn(b));
  });
});
