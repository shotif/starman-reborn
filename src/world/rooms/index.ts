import * as THREE from 'three';
import type { ArtContext } from '../art/types.ts';
import { disposeObject } from '../art/util.ts';
import { CameraRig } from './camera.ts';
import type { ViewShots } from './camera.ts';
import { buildHangar } from './hangar.ts';
import { buildLounge } from './lounge.ts';
import { createRoomMaterials } from './materials.ts';
import { createBackdrop } from './space.ts';
import { STYLES } from './styles.ts';
import type { InteriorStyle } from './styles.ts';
import { environmentCube } from './textures.ts';
import type { RoomHotspot, RoomView, StationInterior, StationInteriorOptions, ViewTransition } from './types.ts';

export type * from './types.ts';
export { STYLES } from './styles.ts';
export type { InteriorStyle } from './styles.ts';
export { generateInteriorStyle } from './stylegen.ts';
export { STATION_OWNERS, STATION_TYPES } from './look.ts';
export type { StationLook, StationOwner, StationType } from './look.ts';

function styleOf(opts: StationInteriorOptions): InteriorStyle {
  if (opts.style) return opts.style;
  if (opts.station && STYLES[opts.station]) return STYLES[opts.station];
  throw new Error('createStationInterior: give a hand-built station or a style');
}

/** Canonical order of the views; 'deck' is always present. */
export const ROOM_ORDER: readonly RoomView[] = ['deck', 'trader', 'outfitter', 'bar'];

const tmp = new THREE.Vector3();
const tmpCam = new THREE.Vector3();

/**
 * Builds the docked interior of a station: the hangar deck with the player's ship, the trader's
 * cargo floor and the outfitter's workshop in one hall (camera moves between them), and the lounge
 * (camera cuts to it). Render with `renderer.render(interior.scene, interior.camera)` after
 * `update(dt)`; call `resize(w, h)` with the canvas CSS size.
 */
export function createStationInterior(opts: StationInteriorOptions, ctx: ArtContext): StationInterior {
  const style = styleOf(opts);
  const rooms = ROOM_ORDER.filter((v) => v === 'deck' || opts.rooms.includes(v));
  const scene = new THREE.Scene();
  scene.name = `interior:${opts.station ?? style.kind}`;
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.2, 2_000_000);
  camera.name = 'interior-camera';

  const mats = createRoomMaterials(ctx, { floorRough: style.hangar.floorRough, floorMetal: style.hangar.floorMetal, barFloor: style.bar.floorPattern });
  const backdrop = createBackdrop(opts, style.outside, ctx);
  scene.add(backdrop.object);

  const hangar = buildHangar(ctx, style, rooms, opts.seed, backdrop, opts.ship);
  hangar.builder.finish(mats);
  scene.add(hangar.builder.group);

  const lounge = rooms.includes('bar') ? buildLounge(ctx, style, opts.seed, backdrop) : null;
  if (lounge) {
    lounge.builder.finish(mats);
    scene.add(lounge.builder.group);
  }

  const h = style.hangar;
  const spill = backdrop.starColor.clone().lerp(new THREE.Color(style.outside.spillTint), style.outside.spillMix);
  const hangarEnv = environmentCube(
    { floor: h.floor, wall: h.wall, ceiling: h.wallDark, lamp: h.lamp, accent: h.glow, bay: `#${spill.getHexString()}`, bayLevel: 1 },
    ctx.quality,
  );
  const barEnv = lounge
    ? environmentCube(
        { floor: style.bar.floor, wall: style.bar.wall, ceiling: style.bar.counter, lamp: style.bar.lamp, accent: style.bar.accent, bay: `#${spill.getHexString()}`, bayLevel: 0.7 },
        ctx.quality,
      )
    : null;
  const fog = new THREE.FogExp2(h.fog, h.fogDensity);
  scene.fog = fog;

  const shots: Partial<Record<RoomView, ViewShots>> = { ...hangar.shots };
  if (lounge) shots.bar = lounge.shots;
  const rig = new CameraRig(camera, shots, 'deck', ctx.reducedMotion);
  let view: RoomView = 'deck';

  const applyRoom = (v: RoomView): void => {
    const inBar = v === 'bar';
    hangar.builder.group.visible = !inBar;
    if (lounge) lounge.builder.group.visible = inBar;
    fog.color.set(inBar ? style.bar.fog : h.fog);
    fog.density = inBar ? style.bar.fogDensity : h.fogDensity;
    scene.environment = inBar ? barEnv : hangarEnv;
    scene.environmentIntensity = inBar ? 0.35 : 0.28;
  };
  applyRoom('deck');

  let time = 0;
  let disposed = false;

  const interior: StationInterior = {
    scene,
    camera,
    rooms,
    get view() {
      return view;
    },
    setView(next: RoomView, instant = false): ViewTransition {
      if (!rooms.includes(next) || next === view) return 'move';
      const crossing = next === 'bar' || view === 'bar';
      const animate = !crossing && !instant && !ctx.reducedMotion;
      view = next;
      applyRoom(next);
      rig.go(next, animate);
      return animate ? 'move' : 'cut';
    },
    resize(width: number, height: number) {
      rig.resize(width, height);
    },
    update(dt: number) {
      if (disposed) return;
      const step = Math.max(0, Math.min(0.1, dt));
      time += step;
      rig.update(step);
      mats.time.value = time;
      mats.motionUniforms.uMotionTime.value = time;
      if (hangar.builder.lightPoints) hangar.builder.lightPoints.uniforms.uTime.value = time;
      if (lounge?.builder.lightPoints) lounge.builder.lightPoints.uniforms.uTime.value = time;
      backdrop.update(step, time, camera);
      if (view !== 'bar') hangar.update(step, time, camera);
    },
    hotspots(): RoomHotspot[] {
      const list = view === 'bar' ? (lounge?.anchors ?? []) : (hangar.anchors[view] ?? []);
      const { width, height } = rig.size;
      camera.updateMatrixWorld();
      return list.map((a) => {
        tmpCam.copy(a.position).applyMatrix4(camera.matrixWorldInverse);
        tmp.copy(a.position).project(camera);
        const x = ((tmp.x + 1) / 2) * width;
        const y = ((1 - tmp.y) / 2) * height;
        const visible = tmpCam.z < 0 && x >= 0 && x <= width && y >= 0 && y <= height;
        return { id: a.id, label: a.label, x, y, visible };
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      hangar.ship.dispose();
      backdrop.dispose();
      disposeObject(hangar.builder.group);
      for (const l of hangar.lights) l.dispose();
      if (lounge) {
        disposeObject(lounge.builder.group);
        for (const l of lounge.lights) l.dispose();
      }
      mats.dispose();
      hangarEnv.dispose();
      barEnv?.dispose();
      scene.environment = null;
      scene.fog = null;
      scene.clear();
    },
  };
  return interior;
}
