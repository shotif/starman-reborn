import type * as THREE from 'three';
import type { AudioEngine } from '../audio/AudioEngine.ts';
import { ambienceFor, chooseMood, TravelClock, type MoodSituation } from '../audio/moodRules.ts';
import type { AmbienceRoom, MusicMood } from '../audio/types.ts';
import { TERRITORY } from '../content/world/rules.ts';
import { getLocation, WORLD } from '../data/systems.ts';
import { denDown } from '../economy/dens.ts';
import type { SystemSceneDef } from '../world/sceneTypes.ts';
import { trafficFor } from '../world/traffic/setup.ts';
import type { GameState } from './state.ts';

/** What the soundscape needs to know about a system: who keeps the peace, where the dens are, how busy the radio is. */
export interface SystemSound {
  /** Nobody keeps the peace: unclaimed space, or security below the world's lawless line. */
  lawless: boolean;
  /** Raider dens in the scene (knocked-out ones are skipped while they are dark). */
  dens: { locationId: string; position: THREE.Vector3 }[];
  /** 0..1: how much traffic talks on the local radio (traders and patrols in flight). */
  radio: number;
}

/** Ships in flight at which the local radio is at its busiest (a core system: three traders, two patrol wings). */
const BUSIEST = 7;

export function systemSound(def: SystemSceneDef, clock: number): SystemSound {
  const profile = WORLD.profiles.get(def.systemId);
  const lawless = profile ? !profile.owner || profile.security < TERRITORY.lawlessBelow : false;
  const dens = def.stations.filter((s) => s.hostile).map((s) => ({ locationId: s.locationId, position: s.position }));
  // The nominal plan (not the quality preset's thinned one): raids quieten the lanes, sweeps add patrols.
  const plan = trafficFor(def.systemId, 'high', clock).plan;
  const ships = plan.traders + plan.patrolWings * plan.wingSize;
  return { lawless, dens, radio: Math.max(0, Math.min(1, (ships - 1) / (BUSIEST - 1))) };
}

/** The flight facts the music follows, read each frame. */
export interface FlightSound {
  position: THREE.Vector3;
  inLane: boolean;
  cruising: boolean;
  combat: boolean;
}

/**
 * Keeps the music, the station ambience and the local radio in step with where the player is
 * (docs/DESIGN.md, Audio). The rules are pure (src/audio/moodRules.ts); this gathers the facts:
 * the room, the system's theme, lawlessness and dens, lanes and cruise, fights. Every call only
 * asks the engine for what should play; the engine ignores requests that change nothing.
 */
export class Soundscape {
  private readonly audio: AudioEngine;
  private scene: 'title' | 'docked' | 'flight' = 'title';
  private mapOpen = false;
  private room: AmbienceRoom = 'deck';
  private atDen = false;
  private theme: MusicMood = 'sol';
  private system: SystemSound | null = null;
  private state: GameState | null = null;
  private readonly travel = new TravelClock();
  private inLane = false;
  private combat = false;
  private denDistance = Infinity;
  private recheck = 0;

  constructor(audio: AudioEngine) {
    this.audio = audio;
  }

  title(): void {
    this.scene = 'title';
    this.mapOpen = false;
    this.apply();
  }

  /** Docked, in a room (called on arrival and on every room change). */
  docked(locationId: string, room: AmbienceRoom): void {
    this.scene = 'docked';
    this.mapOpen = false;
    this.room = room;
    this.atDen = getLocation(locationId).stationType === 'pirate-den';
    this.apply();
  }

  /** Flying in a system: on launch, arrival or a restored save. `theme` is the system's own mood. */
  flight(def: SystemSceneDef, theme: MusicMood, state: GameState, position: THREE.Vector3): void {
    this.scene = 'flight';
    this.mapOpen = false;
    this.theme = theme;
    this.state = state;
    this.system = systemSound(def, state.clock);
    this.travel.reset();
    this.inLane = false;
    this.combat = false;
    this.denDistance = this.nearestDen(position);
    this.recheck = 0.25;
    this.apply();
  }

  /** The star map opens over the current scene, or closes again. */
  map(open: boolean): void {
    this.mapOpen = open;
    this.apply();
  }

  /** Each flight frame: lanes, long cruises, dens nearby and fights move the music. */
  update(dt: number, f: FlightSound): void {
    if (this.scene !== 'flight' || this.mapOpen) return;
    this.travel.update(dt, f.inLane || f.cruising);
    const changed = f.inLane !== this.inLane || f.combat !== this.combat;
    this.inLane = f.inLane;
    this.combat = f.combat;
    this.recheck -= dt;
    if (!changed && this.recheck > 0) return;
    this.recheck = 0.25;
    this.denDistance = this.nearestDen(f.position);
    this.apply();
  }

  /** Asks again for everything (after the audio unlocks). */
  refresh(): void {
    this.apply();
  }

  situation(): MoodSituation {
    return {
      scene: this.mapOpen ? 'map' : this.scene,
      room: this.room,
      atDen: this.atDen,
      theme: this.theme,
      lawless: this.system?.lawless ?? false,
      denDistance: this.denDistance,
      inLane: this.inLane,
      travel: this.travel.travel,
      sinceTravel: this.travel.since,
      combat: this.combat,
    };
  }

  private apply(): void {
    const s = this.situation();
    this.audio.setMusic(chooseMood(s, this.audio.currentMood));
    this.audio.setAmbience(ambienceFor(s));
    // The local radio is heard in flight, and keeps quiet while a fight's own chatter is on.
    this.audio.setRadio(s.scene === 'flight' && !s.combat ? (this.system?.radio ?? 0) : 0);
  }

  private nearestDen(p: THREE.Vector3): number {
    let best = Infinity;
    for (const d of this.system?.dens ?? []) {
      if (this.state && denDown(this.state, d.locationId)) continue;
      best = Math.min(best, d.position.distanceTo(p));
    }
    return best;
  }
}
