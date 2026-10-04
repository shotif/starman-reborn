import * as THREE from 'three';
import { BATTLES } from '../content/border/battles.ts';
import type { BattlePlan } from '../economy/battles.ts';
import type { SystemSceneDef } from './sceneTypes.ts';

/** How far out each side forms up before it closes on the battle point. */
export const FORM_UP = 2_500;

/** Where a border battle is fought in a scene, and where each side comes in from (docs/PROCGEN.md §35). */
export interface BattleSite {
  at: THREE.Vector3;
  lawFrom: THREE.Vector3;
  wakeFrom: THREE.Vector3;
}

/** The system's jump beacon (where its lanes come in). */
export function beaconOf(def: SystemSceneDef): THREE.Vector3 {
  return (def.beacons.find((b) => b.kind === 'jump')?.position ?? def.arrival.position).clone();
}

/**
 * A clash's battle line: the share of the way from the beacon to what the line runs toward, within
 * its bounds and clear of a den; each side comes in from its own end. A turning battle: off the
 * station's bay, its defenders holding there and its attackers coming from the beacon's side.
 */
export function battleSite(def: SystemSceneDef, plan: Pick<BattlePlan, 'kind' | 'toward' | 'lawSystem' | 'attacker'>): BattleSite | null {
  const station = def.stations.find((s) => s.locationId === plan.toward);
  if (!station) return null;
  const beacon = beaconOf(def);
  if (plan.kind === 'clash') {
    const L = BATTLES.line;
    const way = station.position.clone().sub(beacon);
    const length = way.length();
    const dir = way.normalize();
    let d = Math.min(L.max, Math.max(L.min, L.share * length));
    if (!plan.lawSystem) d = Math.max(L.min, Math.min(d, length - L.denClear));
    const at = beacon.clone().addScaledVector(dir, d);
    const nearBeacon = at.clone().addScaledVector(dir, -FORM_UP);
    const nearHome = at.clone().addScaledVector(dir, FORM_UP);
    // In the lawful system the Wake comes down the lane; in the den's, the law does.
    return plan.lawSystem ? { at, lawFrom: nearHome, wakeFrom: nearBeacon } : { at, lawFrom: nearBeacon, wakeFrom: nearHome };
  }
  const at = station.position.clone().addScaledVector(station.approach, BATTLES.turning.standOff);
  const from = at.clone().add(beacon.clone().sub(at).normalize().multiplyScalar(FORM_UP + 500));
  return plan.attacker === 'wake' ? { at, lawFrom: at.clone(), wakeFrom: from } : { at, lawFrom: from, wakeFrom: at.clone() };
}
