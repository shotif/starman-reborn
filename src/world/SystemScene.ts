import * as THREE from 'three';
import type { Obstacle } from '../flight/autopilot.ts';
import { getLocation, isInventedSystem } from '../data/systems.ts';
import { createAsteroidField, createDustRing, type AsteroidFieldArt, type AsteroidHit } from './art/asteroids.ts';
import { createPlanet, type PlanetArt } from './art/planets.ts';
import { createSkybox } from './art/skybox.ts';
import { createStar, type StarArt } from './art/stars.ts';
import { createStation, type StationArt } from './art/stations.ts';
import { createGeneratedStation } from './art/stationgen/index.ts';
import { createJumpBeacon, createLaneRing, createNavBuoy, type LaneRingArt } from './art/structures.ts';
import type { ArtContext, ArtObject } from './art/types.ts';
import type { SceneLaneDef, ScenePlanetDef, SceneStarDef, SceneStationDef, SystemSceneDef } from './sceneTypes.ts';
import type { Target } from './targets.ts';

export interface StarRuntime {
  def: SceneStarDef;
  art: StarArt;
  light: THREE.DirectionalLight;
}

export interface PlanetRuntime {
  def: ScenePlanetDef;
  art: PlanetArt;
}

export interface DockSite {
  def: SceneStationDef;
  art: StationArt;
  name: string;
  /** World-space point where docking completes. */
  dockPoint: THREE.Vector3;
  /** World-space unit vector pointing out of the bay. */
  approach: THREE.Vector3;
  radius: number;
  /** False for raider dens: solid, targetable, never a place to dock. */
  dockable: boolean;
}

export interface LaneRuntime {
  def: SceneLaneDef;
  rings: LaneRingArt[];
  ringPositions: THREE.Vector3[];
  direction: THREE.Vector3;
  length: number;
  beam: THREE.Line;
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * One loaded local system: static scenery, lights, docks, lanes and belts built from a
 * SystemSceneDef. Dynamic entities (ships, bolts, loot) are owned by the FlightSession.
 */
export class SystemScene {
  readonly def: SystemSceneDef;
  readonly scene = new THREE.Scene();
  readonly stars: StarRuntime[] = [];
  readonly planets: PlanetRuntime[] = [];
  readonly docks: DockSite[] = [];
  readonly lanes: LaneRuntime[] = [];
  readonly belts: AsteroidFieldArt[] = [];
  readonly targets: Target[] = [];
  private readonly arts: ArtObject[] = [];
  private readonly hemi: THREE.HemisphereLight;
  private time = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly scratchHits: AsteroidHit[] = [];

  constructor(def: SystemSceneDef, ctx: ArtContext) {
    this.def = def;
    this.scene.name = `system:${def.systemId}`;

    const sky = createSkybox(def.skybox, ctx);
    this.add(sky);

    this.hemi = new THREE.HemisphereLight(def.ambient.sky, def.ambient.ground, def.ambient.intensity);
    this.scene.add(this.hemi);

    for (const s of def.stars) {
      const art = createStar(
        {
          radius: s.radius,
          color: s.color,
          kind: s.kind,
          ...(s.activity !== undefined ? { activity: s.activity } : {}),
          ...(s.glowScale !== undefined ? { glowScale: s.glowScale } : {}),
          ...(s.intensity !== undefined ? { intensity: s.intensity } : {}),
          seed: s.id.length * 17,
        },
        ctx,
      );
      art.object.position.copy(s.position);
      this.add(art);
      const light = new THREE.DirectionalLight(s.color, s.light);
      this.scene.add(light, light.target);
      this.stars.push({ def: s, art, light });
      // Pyre is the one invented star (docs/PROCGEN.md §26): its target says so.
      const invented = isInventedSystem(def.systemId);
      this.targets.push({
        id: `star:${s.id}`,
        name: s.name,
        kind: 'star',
        position: s.position,
        radius: s.radius,
        subtitle: invented ? 'Invented red supergiant · not in the real sky' : 'Star · real object; appearance illustrated',
        dataClass: invented ? 'fictional' : 'observed',
        bodyId: s.id,
        alive: true,
        cycle: true,
      });
    }

    const starById = new Map(def.stars.map((s) => [s.id, s]));
    for (const p of def.planets) {
      const host = starById.get(p.hostStarId) ?? def.stars[0]!;
      const art = createPlanet(
        {
          radius: p.radius,
          style: p.style,
          seed: p.id.length * 31 + Math.round(p.radius),
          lightPosition: host.position.clone(),
          lightColor: host.color,
          ...(p.rings ? { rings: p.rings } : {}),
          ...(p.tilt !== undefined ? { tilt: p.tilt } : {}),
          ...(p.spinSpeed !== undefined ? { spinSpeed: p.spinSpeed } : {}),
        },
        ctx,
      );
      art.object.position.copy(p.position);
      this.add(art);
      this.planets.push({ def: p, art });
      this.targets.push({
        id: `planet:${p.id}`,
        name: p.name,
        kind: 'planet',
        position: p.position,
        radius: p.radius,
        subtitle: p.subtitle,
        dataClass: 'observed',
        bodyId: p.id,
        alive: true,
        cycle: true,
      });
      if (def.orbitLines && p.orbitCenter && ctx.quality !== 'low') {
        this.scene.add(this.orbitLine(p.orbitCenter, p.position));
      }
    }

    for (const s of def.stations) {
      // Generated stations are built from their look; the hand-made ones keep their models.
      const art = s.look ? createGeneratedStation(s.look, ctx) : createStation(s.kind, ctx);
      art.object.position.copy(s.position);
      art.object.quaternion.setFromUnitVectors(art.dockApproach.clone().normalize(), s.approach.clone().normalize());
      art.object.updateMatrixWorld(true);
      this.add(art);
      const loc = getLocation(s.locationId);
      const dock: DockSite = {
        def: s,
        art,
        name: loc.name,
        dockPoint: art.object.localToWorld(art.dockPoint.clone()),
        approach: s.approach.clone().normalize(),
        radius: art.radius,
        dockable: !s.hostile && loc.dockable !== false,
      };
      this.docks.push(dock);
      this.targets.push({
        id: `station:${s.locationId}`,
        name: loc.name,
        kind: 'station',
        position: s.position,
        radius: art.radius,
        subtitle: s.hostile ? 'Raider hideout · fictional location' : `${loc.kind[0]!.toUpperCase()}${loc.kind.slice(1)} · fictional location`,
        dataClass: 'fictional',
        ...(loc.factionId ? { faction: loc.factionId } : {}),
        hostile: !!s.hostile,
        locationId: s.locationId,
        alive: true,
        cycle: true,
      });
    }

    for (const lane of def.lanes) this.buildLane(lane, ctx);

    for (const b of def.belts) {
      const field = createAsteroidField(
        {
          seed: b.seed,
          count: b.count[ctx.quality],
          shape: b.shape,
          innerRadius: b.innerRadius,
          outerRadius: b.outerRadius,
          thickness: b.thickness,
          sizeMin: b.sizeMin,
          sizeMax: b.sizeMax,
          color: b.color,
        },
        ctx,
      );
      field.object.position.copy(b.center);
      this.add(field);
      this.belts.push(field);
    }
    for (const d of def.dust) {
      const dust = createDustRing(
        { innerRadius: d.innerRadius, outerRadius: d.outerRadius, color: d.color, opacity: d.opacity, seed: d.seed },
        ctx,
      );
      dust.object.position.copy(d.center);
      this.add(dust);
    }

    for (const b of def.beacons) {
      const art = b.kind === 'jump' ? createJumpBeacon(ctx) : createNavBuoy('#5cc8ff', ctx);
      art.object.position.copy(b.position);
      this.add(art);
      this.targets.push({
        id: `beacon:${b.id}`,
        name: b.name,
        kind: 'beacon',
        position: b.position,
        radius: 40,
        subtitle: 'Jump beacon · fictional',
        dataClass: 'fictional',
        alive: true,
        cycle: false,
      });
    }
  }

  private add(art: ArtObject): void {
    this.scene.add(art.object);
    this.arts.push(art);
  }

  private orbitLine(center: THREE.Vector3, point: THREE.Vector3): THREE.LineLoop {
    const radius = Math.hypot(point.x - center.x, point.z - center.z);
    const segments = 160;
    const positions = new Float32Array(segments * 3);
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      positions[i * 3] = Math.cos(a) * radius;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = Math.sin(a) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const line = new THREE.LineLoop(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x7fa6d8, transparent: true, opacity: 0.13, depthWrite: false }),
    );
    line.position.set(center.x, point.y, center.z);
    line.name = 'schematic-orbit';
    return line;
  }

  private buildLane(def: SceneLaneDef, ctx: ArtContext): void {
    const direction = def.to.clone().sub(def.from);
    const length = direction.length();
    direction.normalize();
    const count = Math.max(2, Math.round(length / def.ringSpacing) + 1);
    const rings: LaneRingArt[] = [];
    const ringPositions: THREE.Vector3[] = [];
    const orient = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, direction);
    for (let i = 0; i < count; i++) {
      const p = def.from.clone().lerp(def.to, i / (count - 1));
      const ring = createLaneRing(ctx);
      ring.object.position.copy(p);
      ring.object.quaternion.copy(orient);
      this.add(ring);
      rings.push(ring);
      ringPositions.push(p);
    }
    const geometry = new THREE.BufferGeometry().setFromPoints([def.from, def.to]);
    const beam = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.12, depthWrite: false }),
    );
    this.scene.add(beam);
    this.lanes.push({ def, rings, ringPositions, direction, length, beam });
    for (const reverse of [false, true]) {
      this.targets.push({
        id: `lane:${def.id}:${reverse ? 'rev' : 'fwd'}`,
        name: reverse ? def.toName : def.fromName,
        kind: 'lane',
        position: reverse ? def.to : def.from,
        radius: 40,
        subtitle: `${def.name} entrance · fictional technology`,
        dataClass: 'fictional',
        laneId: def.id,
        laneReverse: reverse,
        alive: true,
        cycle: true,
      });
    }
  }

  dock(locationId: string): DockSite | undefined {
    return this.docks.find((d) => d.def.locationId === locationId);
  }

  /** Nearby asteroids for collision tests. */
  asteroidsNear(point: THREE.Vector3, radius: number, out: AsteroidHit[]): number {
    let n = 0;
    for (const belt of this.belts) {
      const found = belt.queryNear(point, radius, this.scratchHits);
      for (let i = 0; i < found; i++) {
        const hit = this.scratchHits[i]!;
        const slot = (out[n] ??= { position: new THREE.Vector3(), radius: 0 });
        slot.position.copy(hit.position);
        slot.radius = hit.radius;
        n++;
      }
    }
    return n;
  }

  /**
   * Per-frame update. `focus` is where lighting is evaluated (the player): each star's directional
   * light points from the star to the focus, dimming with distance beyond its light range.
   */
  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3): void {
    this.time += dt;
    for (const art of this.arts) art.update?.(dt, this.time, camera);
    for (const s of this.stars) {
      const d = focus.distanceTo(s.def.position);
      const falloff = d <= s.def.lightRange ? 1 : Math.max(0.04, (s.def.lightRange / d) ** 2);
      s.light.intensity = s.def.light * falloff;
      this.tmp.copy(s.def.position).sub(focus).normalize();
      s.light.position.copy(focus).addScaledVector(this.tmp, 1000);
      s.light.target.position.copy(focus);
    }
  }

  setLaneActive(laneId: string, active: boolean): void {
    const lane = this.lanes.find((l) => l.def.id === laneId);
    if (!lane) return;
    for (const r of lane.rings) r.setActive(active);
    (lane.beam.material as THREE.LineBasicMaterial).opacity = active ? 0.35 : 0.12;
  }

  /** Spheres the autopilot steers around, leaving out the one it is flying to. */
  obstacles(exceptId: string | null): Obstacle[] {
    const list: Obstacle[] = [];
    for (const s of this.stars) list.push({ id: `star:${s.def.id}`, center: s.def.position, radius: s.def.radius * 1.3 });
    for (const p of this.planets) if (`planet:${p.def.id}` !== exceptId) list.push({ id: `planet:${p.def.id}`, center: p.def.position, radius: p.def.radius });
    for (const d of this.docks) if (`station:${d.def.locationId}` !== exceptId) list.push({ id: `station:${d.def.locationId}`, center: d.def.position, radius: d.radius });
    return list;
  }

  dispose(): void {
    for (const art of this.arts) art.dispose();
    this.arts.length = 0;
    this.scene.traverse((node) => {
      const line = node as THREE.Line;
      if ((line as { isLine?: boolean }).isLine) {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
    });
    this.scene.clear();
  }
}
