import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { RADIO } from '../../src/audio/ambienceSpecs.ts';
import { MOOD_RULES, TravelClock, ambienceFor, chooseMood } from '../../src/audio/moodRules.ts';
import type { MoodSituation } from '../../src/audio/moodRules.ts';
import { MOODS } from '../../src/audio/moods.ts';
import { mulberry32 } from '../../src/audio/theory.ts';
import type { AmbienceRoom, MusicMood } from '../../src/audio/types.ts';
import { Soundscape, systemSound } from '../../src/app/soundscape.ts';
import { createNewGame } from '../../src/app/state.ts';
import { TERRITORY } from '../../src/content/world/rules.ts';
import { ALL_LOCATIONS, SYSTEMS, WORLD } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import { frontsAt, frontsHere } from '../../src/economy/border.ts';

/** Which music, ambience and radio play where: the pure mood rules, and the soundscape on the real world. */

const ROOMS: AmbienceRoom[] = ['deck', 'bar', 'trader', 'outfitter'];
const fly = (s: Partial<MoodSituation> = {}): MoodSituation => ({ scene: 'flight', theme: 'sol', ...s });

describe('mood rules', () => {
  it('keeps the title and star map themes whatever else is going on', () => {
    for (const scene of ['title', 'map'] as const) {
      const s: MoodSituation = { scene, theme: 'sirius', room: 'bar', atDen: true, lawless: true, denDistance: 10, inLane: true, travel: 60, combat: true };
      expect(chooseMood(s, 'den')).toBe(scene);
    }
  });

  it('plays the bar in the bar room, the docked theme elsewhere, and the den throughout a den', () => {
    expect(chooseMood({ scene: 'docked', theme: 'sol', room: 'bar' })).toBe('bar');
    for (const room of ['deck', 'trader', 'outfitter', null] as const) expect(chooseMood({ scene: 'docked', theme: 'sol', room })).toBe('docked');
    for (const room of ROOMS) expect(chooseMood({ scene: 'docked', theme: 'sol', room, atDen: true })).toBe('den');
  });

  it("flies to the system's theme in policed space and to the frontier in lawless space", () => {
    expect(chooseMood(fly({ theme: 'epsilon-eridani' }))).toBe('epsilon-eridani');
    expect(chooseMood(fly({ theme: 'barnard', lawless: true }))).toBe('frontier');
    expect(chooseMood(fly({ theme: 'barnard', lawless: true, combat: true }))).toBe('frontier');
    expect(chooseMood(fly({ theme: 'sol', combat: true }))).toBe('sol');
  });

  it('turns to the den near a raider den, and lets go only past a wider ring', () => {
    const { denNear, denLeave } = MOOD_RULES;
    expect(denLeave).toBeGreaterThan(denNear);
    expect(chooseMood(fly({ lawless: true, denDistance: denNear - 1 }))).toBe('den');
    expect(chooseMood(fly({ lawless: true, denDistance: denNear + 1 }), 'frontier')).toBe('frontier');
    expect(chooseMood(fly({ lawless: true, denDistance: denNear + 1 }), 'den')).toBe('den');
    expect(chooseMood(fly({ lawless: true, denDistance: denLeave + 1 }), 'den')).toBe('frontier');
    expect(chooseMood(fly({ lawless: true, denDistance: Infinity }), 'den')).toBe('frontier');
    // The den wins over travel, and stays through a fight with its guns.
    expect(chooseMood(fly({ denDistance: 5_000, travel: 90 }))).toBe('den');
    expect(chooseMood(fly({ denDistance: 5_000, combat: true }))).toBe('den');
  });

  it('brings in the deep-space drones in a lane or on a long cruise, but never in a fight', () => {
    const { laneAfter, cruiseAfter } = MOOD_RULES;
    expect(chooseMood(fly({ inLane: true, travel: laneAfter + 0.1 }))).toBe('deep-space');
    expect(chooseMood(fly({ inLane: true, travel: laneAfter - 0.1 }))).toBe('sol');
    expect(chooseMood(fly({ travel: cruiseAfter + 0.1 }))).toBe('deep-space');
    expect(chooseMood(fly({ travel: cruiseAfter - 0.1 }))).toBe('sol');
    expect(chooseMood(fly({ travel: cruiseAfter + 0.1, lawless: true }))).toBe('deep-space');
    // Combat takes over from the travel music.
    expect(chooseMood(fly({ inLane: true, travel: 30, combat: true }), 'deep-space')).toBe('sol');
    expect(chooseMood(fly({ travel: 300, lawless: true, combat: true }), 'deep-space')).toBe('frontier');
  });

  it('holds the drones briefly after a ride ends, and through a quick return to cruise', () => {
    const { travelHold } = MOOD_RULES;
    expect(chooseMood(fly({ travel: 0, sinceTravel: travelHold - 0.5 }), 'deep-space')).toBe('deep-space');
    expect(chooseMood(fly({ travel: 0, sinceTravel: travelHold + 0.5 }), 'deep-space')).toBe('sol');
    expect(chooseMood(fly({ travel: 1, sinceTravel: 0 }), 'deep-space')).toBe('deep-space');
    // Without the drones already playing, a short ride does nothing.
    expect(chooseMood(fly({ travel: 1, sinceTravel: 0 }), 'sol')).toBe('sol');
    expect(chooseMood(fly({ travel: 0, sinceTravel: 1 }), 'sol')).toBe('sol');
  });

  it('only ever picks moods that exist', () => {
    const rng = mulberry32(12);
    const themes = Object.keys(MOODS) as MusicMood[];
    const scenes = ['title', 'map', 'docked', 'flight'] as const;
    for (let i = 0; i < 2000; i++) {
      const s: MoodSituation = {
        scene: scenes[Math.floor(rng() * scenes.length)]!,
        theme: themes[Math.floor(rng() * themes.length)]!,
        room: ROOMS[Math.floor(rng() * ROOMS.length)]!,
        atDen: rng() < 0.2,
        lawless: rng() < 0.5,
        denDistance: rng() < 0.5 ? Infinity : rng() * 30_000,
        inLane: rng() < 0.3,
        travel: rng() < 0.5 ? 0 : rng() * 60,
        sinceTravel: rng() * 20,
        combat: rng() < 0.3,
      };
      expect(MOODS[chooseMood(s, themes[Math.floor(rng() * themes.length)]!)]).toBeDefined();
    }
  });

  it('plays a room bed only while docked', () => {
    expect(ambienceFor({ scene: 'docked', theme: 'sol', room: 'bar' })).toBe('bar');
    expect(ambienceFor({ scene: 'docked', theme: 'sol' })).toBe('deck');
    for (const scene of ['title', 'map', 'flight'] as const) expect(ambienceFor({ scene, theme: 'sol', room: 'bar' })).toBeNull();
  });

  it('times rides and the gaps between them', () => {
    const clock = new TravelClock();
    expect(clock.travel).toBe(0);
    expect(clock.since).toBe(Infinity);
    for (let i = 0; i < 10; i++) clock.update(0.5, true);
    expect(clock.travel).toBeCloseTo(5, 9);
    expect(clock.since).toBe(0);
    clock.update(0.25, false);
    clock.update(0.25, false);
    expect(clock.travel).toBe(0);
    expect(clock.since).toBeCloseTo(0.5, 9);
    clock.update(Number.NaN, false);
    clock.update(-3, true);
    expect(clock.travel).toBe(0);
    clock.update(1, true);
    expect(clock.travel).toBe(1);
    clock.reset();
    expect(clock.travel).toBe(0);
    expect(clock.since).toBe(Infinity);
  });
});

describe('soundscape of the world', () => {
  const location = (systemId: SystemId, type: string): string => ALL_LOCATIONS.find((l) => l.systemId === systemId && l.stationType === type)!.id;
  // A den away from the border war (a front brings patrols into a den's system when the law pushes).
  const denSystem = SYSTEMS.map((s) => s.id).find((id) => {
    const def = sceneDefFor(id);
    const den = def.stations.find((s) => s.hostile);
    return den && den.position.distanceTo(def.arrival.position) > MOOD_RULES.denLeave * 1.5 && frontsAt(id).length === 0;
  })!;

  it('knows who keeps the peace, where the dens are and how busy the radio is', () => {
    const sol = systemSound(sceneDefFor('sol'), 0);
    expect(sol).toMatchObject({ lawless: false, dens: [], radio: 1 });
    for (const sys of SYSTEMS) {
      const s = systemSound(sceneDefFor(sys.id), 0);
      const p = WORLD.profiles.get(sys.id)!;
      expect(s.lawless).toBe(!p.owner || p.security < TERRITORY.lawlessBelow);
      expect(s.radio >= 0 && s.radio <= 1).toBe(true);
      // Dens only in lawless space, where the lanes are quiet (unless the law is pushing into it on a border front).
      if (s.dens.length > 0) {
        expect(s.lawless).toBe(true);
        const patrolled = frontsHere(sys.id, 0).some((f) => f.front.wakeSystem === sys.id && (f.phase === 'pushed-back' || f.phase === 'skirmish'));
        if (!patrolled) expect(s.radio).toBeLessThan(RADIO.threshold);
      }
    }
    expect(denSystem).toBeDefined();
  });

  it('follows the player from the title to the bar, the map and the hangar', () => {
    const audio = new AudioEngine();
    const scape = new Soundscape(audio);
    scape.title();
    expect([audio.currentMood, audio.currentAmbience, audio.radioLevel]).toEqual(['title', null, 0]);
    scape.docked('earth-port', 'bar');
    expect([audio.currentMood, audio.currentAmbience]).toEqual(['bar', 'bar']);
    scape.docked('earth-port', 'trader');
    expect([audio.currentMood, audio.currentAmbience]).toEqual(['docked', 'trader']);
    scape.map(true);
    expect([audio.currentMood, audio.currentAmbience]).toEqual(['map', null]);
    scape.map(false);
    expect([audio.currentMood, audio.currentAmbience]).toEqual(['docked', 'trader']);
    scape.docked(location(denSystem, 'pirate-den'), 'bar');
    expect([audio.currentMood, audio.currentAmbience]).toEqual(['den', 'bar']);
  });

  it('flies with the system theme and the radio, drones on long rides, and goes quiet in a fight', () => {
    const audio = new AudioEngine();
    const scape = new Soundscape(audio);
    const state = createNewGame(3);
    const def = sceneDefFor('sol');
    scape.flight(def, 'sol', state, def.arrival.position);
    expect([audio.currentMood, audio.currentAmbience]).toEqual(['sol', null]);
    expect(audio.radioLevel).toBe(1);
    const at = def.arrival.position.clone();
    const frames = (seconds: number, f: { inLane?: boolean; cruising?: boolean; combat?: boolean }): void => {
      for (let t = 0; t < seconds; t += 0.1) scape.update(0.1, { position: at, inLane: false, cruising: false, combat: false, ...f });
    };
    frames(MOOD_RULES.cruiseAfter - 2, { cruising: true });
    expect(audio.currentMood).toBe('sol');
    frames(3, { cruising: true });
    expect(audio.currentMood).toBe('deep-space');
    frames(MOOD_RULES.travelHold - 1, {});
    expect(audio.currentMood).toBe('deep-space');
    frames(2, {});
    expect(audio.currentMood).toBe('sol');
    frames(MOOD_RULES.laneAfter + 0.5, { inLane: true });
    expect(audio.currentMood).toBe('deep-space');
    frames(1, { inLane: true, combat: true });
    expect([audio.currentMood, audio.radioLevel]).toEqual(['sol', 0]);
    frames(1, {});
    expect(audio.radioLevel).toBe(1);
    scape.map(true);
    expect([audio.currentMood, audio.radioLevel]).toEqual(['map', 0]);
    scape.map(false);
    expect(audio.radioLevel).toBe(1);
  });

  it('plays the frontier in lawless space and the den near a den until it is knocked out', () => {
    const audio = new AudioEngine();
    const scape = new Soundscape(audio);
    const state = createNewGame(5);
    const def = sceneDefFor(denSystem);
    const den = def.stations.find((s) => s.hostile)!;
    scape.flight(def, 'barnard', state, def.arrival.position);
    expect(audio.currentMood).toBe('frontier');
    expect(audio.radioLevel).toBeLessThan(RADIO.threshold);
    const toward = new THREE.Vector3().subVectors(def.arrival.position, den.position).normalize();
    const at = (d: number): THREE.Vector3 => den.position.clone().addScaledVector(toward, d);
    const frame = (d: number): void => scape.update(0.5, { position: at(d), inLane: false, cruising: false, combat: false });
    frame(MOOD_RULES.denNear + 500);
    expect(audio.currentMood).toBe('frontier');
    frame(MOOD_RULES.denNear - 500);
    expect(audio.currentMood).toBe('den');
    frame((MOOD_RULES.denNear + MOOD_RULES.denLeave) / 2);
    expect(audio.currentMood).toBe('den');
    frame(MOOD_RULES.denLeave + 500);
    expect(audio.currentMood).toBe('frontier');
    frame(2_000);
    expect(audio.currentMood).toBe('den');
    state.dens[den.locationId] = state.clock;
    frame(2_000);
    expect(audio.currentMood).toBe('frontier');
    // Arriving (or restoring a save) near a standing den asks for the den's music straight away.
    delete state.dens[den.locationId];
    const fresh = new AudioEngine();
    new Soundscape(fresh).flight(def, 'barnard', state, at(3_000));
    expect(fresh.currentMood).toBe('den');
  });
});
