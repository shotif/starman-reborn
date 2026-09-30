/**
 * three.js content of the 3D neighborhood map: star glows, equatorial grid with distance rings,
 * drop lines, fictional jump links, the selected route and status markers.
 *
 * Camera-relative rendering: every object keeps a double-precision world anchor (map light-years,
 * see mapMath.ts for the axes). Each frame the camera sits at the origin and each object is placed
 * at (anchor - cameraPosition), computed in JS doubles. Line vertices are stored relative to their
 * object's anchor. Nothing here allocates per frame.
 */
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { SystemId } from '../data/types.ts';
import { isNewSystem, SYSTEM_IDS } from '../data/systems.ts';
import { MAP_LABELS, MAP_LINKS, MAP_STARS, RING_RADII_LY, systemAnchor } from './mapData.ts';
import {
  clamp,
  createScreenPoint,
  projectPoint,
  spriteScaleForPixels,
  type ScreenPoint,
  type Vec3,
} from './mapMath.ts';

export const MAP_FOV_DEG = 50;

const COLORS = {
  background: '#050912',
  grid: '#7eaaff',
  link: '#cfa8ff',
  route: '#5cc8ff',
  current: '#5cc8ff',
  selected: '#ffffff',
  objective: '#ffb45c',
  visited: '#62e3a0',
};

export interface MapMarkers {
  current: SystemId;
  selected: SystemId | null;
  objective: SystemId | null;
  visited: ReadonlySet<SystemId>;
  /** Systems along the highlighted route, in order (null or fewer than 2 = no route). */
  route: readonly SystemId[] | null;
}

interface Placed {
  object: THREE.Object3D;
  anchor: Vec3;
}

interface SizedSprite {
  sprite: THREE.Sprite;
  anchor: Vec3;
  /** Base diameter in CSS pixels. */
  px: number;
  /** Grow slightly as the camera approaches (stars only). */
  zoomScaled: boolean;
  pulse: 'none' | 'scale' | 'opacity';
  baseOpacity: number;
}

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) draw(g, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function radialTexture(stops: readonly [number, number][]): THREE.CanvasTexture {
  return canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    for (const [at, alpha] of stops) grad.addColorStop(at, `rgba(255,255,255,${alpha})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

function strokeTexture(draw: (g: CanvasRenderingContext2D, s: number) => void, width: number): THREE.CanvasTexture {
  return canvasTexture(128, (g, s) => {
    g.strokeStyle = '#ffffff';
    g.lineWidth = width * s;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    draw(g, s);
  });
}

export class MapScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(MAP_FOV_DEG, 1, 0.004, 2000);
  /** projection x view, refreshed by updateFrame(). */
  readonly viewProjection = new THREE.Matrix4();

  private readonly textures: THREE.Texture[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly placed: Placed[] = [];
  private readonly sprites: SizedSprite[] = [];
  private readonly lineMaterials: LineMaterial[] = [];

  private routeGeometry: LineSegmentsGeometry;
  private readonly routeLine: LineSegments2;
  private readonly routeGlow: LineSegments2;
  private readonly linkMaterial: LineMaterial;
  private readonly currentMarker: SizedSprite;
  private readonly selectedMarker: SizedSprite;
  private readonly objectiveMarker: SizedSprite;
  private readonly visitedMarkers = new Map<SystemId, SizedSprite>();

  private width = 1;
  private height = 1;
  private shiftX = 0;
  private shiftY = 0;
  private cameraPos: Vec3 = [0, 0, 0];

  constructor() {
    this.scene.background = new THREE.Color(COLORS.background);
    this.camera.position.set(0, 0, 0);

    const glow = this.track(
      radialTexture([
        [0, 1],
        [0.08, 0.9],
        [0.2, 0.5],
        [0.38, 0.2],
        [0.62, 0.06],
        [1, 0],
      ]),
    );
    const core = this.track(
      radialTexture([
        [0, 1],
        [0.28, 1],
        [0.5, 0.45],
        [0.75, 0.06],
        [1, 0],
      ]),
    );
    const ring = this.track(
      strokeTexture((g, s) => {
        g.beginPath();
        g.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
        g.stroke();
      }, 0.06),
    );
    const thinRing = this.track(
      strokeTexture((g, s) => {
        g.setLineDash([s * 0.09, s * 0.07]);
        g.beginPath();
        g.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
        g.stroke();
      }, 0.07),
    );
    const reticle = this.track(
      strokeTexture((g, s) => {
        const a = s * 0.12;
        const b = s * 0.88;
        const l = s * 0.2;
        g.beginPath();
        g.moveTo(a, a + l);
        g.lineTo(a, a);
        g.lineTo(a + l, a);
        g.moveTo(b - l, a);
        g.lineTo(b, a);
        g.lineTo(b, a + l);
        g.moveTo(b, b - l);
        g.lineTo(b, b);
        g.lineTo(b - l, b);
        g.moveTo(a + l, b);
        g.lineTo(a, b);
        g.lineTo(a, b - l);
        g.stroke();
      }, 0.055),
    );
    const diamond = this.track(
      strokeTexture((g, s) => {
        g.beginPath();
        g.moveTo(s / 2, s * 0.06);
        g.lineTo(s * 0.94, s / 2);
        g.lineTo(s / 2, s * 0.94);
        g.lineTo(s * 0.06, s / 2);
        g.closePath();
        g.stroke();
      }, 0.05),
    );
    const dot = this.track(
      radialTexture([
        [0, 1],
        [0.45, 1],
        [0.7, 0.3],
        [1, 0],
      ]),
    );

    // Equatorial grid: distance rings and faint spokes every 2h of right ascension.
    const grid: number[] = [];
    for (const r of RING_RADII_LY) {
      const n = 160;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        grid.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
      }
    }
    this.addLines(grid, { color: COLORS.grid, opacity: 0.2, width: 1, order: 0 }, [0, 0, 0]);
    const spokes: number[] = [];
    const outer = RING_RADII_LY[RING_RADII_LY.length - 1]!;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      spokes.push(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5, Math.cos(a) * outer, 0, Math.sin(a) * outer);
    }
    this.addLines(spokes, { color: COLORS.grid, opacity: 0.08, width: 1, order: 0 }, [0, 0, 0]);

    // Drop lines from each plotted position to the equatorial plane, tinted like the star.
    const drops: number[] = [];
    const dropColors: number[] = [];
    const tint = new THREE.Color();
    for (const label of MAP_LABELS) {
      const [x, y, z] = label.pos;
      // One line per system; the far shell's are fainter so the neighbourhood reads first.
      if (Math.abs(y) < 1e-6 || !label.primary) continue;
      drops.push(x, y, z, x, 0, z);
      const star = MAP_STARS.find((s) => s.key === label.starKeys[0])!;
      tint.set(star.colorHex);
      if (isNewSystem(label.systemId)) tint.multiplyScalar(0.45);
      dropColors.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b);
      this.addSprite(dot, star.colorHex, [x, 0, z], 7, 5, isNewSystem(label.systemId) ? 0.4 : 0.75);
    }
    this.addLines(drops, { color: '#ffffff', opacity: 0.5, width: 1.25, order: 1, colors: dropColors }, [0, 0, 0]);

    // Fictional jump links (dashed) between system reference positions.
    const links: number[] = [];
    for (const link of MAP_LINKS) {
      const a = systemAnchor(link.a);
      const b = systemAnchor(link.b);
      links.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    const linkLine = this.addLines(
      links,
      { color: COLORS.link, opacity: 0.8, width: 1.6, order: 2, dashed: true },
      [0, 0, 0],
    );
    this.linkMaterial = linkLine.material;

    // Highlighted route (rebuilt on selection).
    this.routeGeometry = new LineSegmentsGeometry();
    this.routeGeometry.setPositions([0, 0, 0, 0, 0, 0]);
    this.routeGlow = this.addLineObject(this.routeGeometry, { color: COLORS.route, opacity: 0.2, width: 10, order: 3 }, [0, 0, 0]);
    this.routeLine = this.addLineObject(this.routeGeometry, { color: COLORS.route, opacity: 0.95, width: 3.5, order: 3 }, [0, 0, 0]);
    this.routeGlow.visible = false;
    this.routeLine.visible = false;

    // Stars: additive halo plus a whiter core, both at the component's own position.
    const white = new THREE.Color('#ffffff');
    for (const star of MAP_STARS) {
      this.addSprite(glow, star.colorHex, star.pos, star.glowPx * 2.2, 10, 0.95).zoomScaled = true;
      const coreColor = new THREE.Color(star.colorHex).lerp(white, 0.55);
      this.addSprite(core, coreColor, star.pos, Math.max(6, star.glowPx * 0.42), 11, 1).zoomScaled = true;
    }

    // Status markers.
    this.currentMarker = this.addSprite(ring, COLORS.current, [0, 0, 0], 46, 20, 0.95);
    this.currentMarker.pulse = 'scale';
    this.selectedMarker = this.addSprite(reticle, COLORS.selected, [0, 0, 0], 58, 21, 0.95);
    this.objectiveMarker = this.addSprite(diamond, COLORS.objective, [0, 0, 0], 66, 20, 0.95);
    this.objectiveMarker.pulse = 'opacity';
    for (const id of SYSTEM_IDS) {
      const m = this.addSprite(thinRing, COLORS.visited, systemAnchor(id), 32, 19, 0.8);
      m.sprite.visible = false;
      this.visitedMarkers.set(id, m);
    }
  }

  private track<T extends THREE.Texture>(t: T): T {
    this.textures.push(t);
    return t;
  }

  private place(object: THREE.Object3D, anchor: Readonly<Vec3>): Placed {
    object.frustumCulled = false;
    const p: Placed = { object, anchor: [anchor[0], anchor[1], anchor[2]] };
    this.placed.push(p);
    this.scene.add(object);
    return p;
  }

  private addSprite(
    map: THREE.Texture,
    color: THREE.ColorRepresentation,
    anchor: Readonly<Vec3>,
    px: number,
    order: number,
    opacity: number,
  ): SizedSprite {
    const material = new THREE.SpriteMaterial({
      map,
      color,
      opacity,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false,
      toneMapped: false,
    });
    this.materials.push(material);
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = order;
    const placed = this.place(sprite, anchor);
    const entry: SizedSprite = { sprite, anchor: placed.anchor, px, zoomScaled: false, pulse: 'none', baseOpacity: opacity };
    this.sprites.push(entry);
    return entry;
  }

  private makeLineMaterial(o: {
    color: THREE.ColorRepresentation;
    opacity: number;
    width: number;
    dashed?: boolean;
    colors?: number[];
  }): LineMaterial {
    const material = new LineMaterial({
      color: o.colors ? 0xffffff : o.color,
      linewidth: o.width,
      transparent: true,
      opacity: o.opacity,
      depthTest: false,
      depthWrite: false,
      dashed: o.dashed ?? false,
      dashSize: 0.32,
      gapSize: 0.22,
      vertexColors: !!o.colors,
      toneMapped: false,
    });
    this.materials.push(material);
    this.lineMaterials.push(material);
    return material;
  }

  private addLineObject(
    geometry: LineSegmentsGeometry,
    o: { color: THREE.ColorRepresentation; opacity: number; width: number; order: number; dashed?: boolean; colors?: number[] },
    anchor: Readonly<Vec3>,
  ): LineSegments2 {
    const line = new LineSegments2(geometry, this.makeLineMaterial(o));
    line.renderOrder = o.order;
    this.place(line, anchor);
    return line;
  }

  /** Line segments with vertices relative to `anchor`. */
  private addLines(
    positions: number[],
    o: { color: THREE.ColorRepresentation; opacity: number; width: number; order: number; dashed?: boolean; colors?: number[] },
    anchor: Readonly<Vec3>,
  ): LineSegments2 {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    if (o.colors) geometry.setColors(o.colors);
    this.geometries.push(geometry);
    const line = this.addLineObject(geometry, o, anchor);
    if (o.dashed) line.computeLineDistances();
    return line;
  }

  /** Canvas size in CSS pixels. */
  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.updateProjection();
  }

  /** Moves the projection centre by (x, y) CSS pixels (centres the target in the visible stage). */
  setViewShift(x: number, y: number): void {
    if (Math.abs(x - this.shiftX) < 0.01 && Math.abs(y - this.shiftY) < 0.01) return;
    this.shiftX = x;
    this.shiftY = y;
    this.updateProjection();
  }

  private updateProjection(): void {
    const cam = this.camera;
    cam.aspect = this.width / this.height;
    if (Math.abs(this.shiftX) > 0.01 || Math.abs(this.shiftY) > 0.01) {
      cam.setViewOffset(this.width, this.height, -this.shiftX, -this.shiftY, this.width, this.height);
    } else {
      cam.clearViewOffset();
    }
    cam.updateProjectionMatrix();
  }

  setMarkers(m: MapMarkers): void {
    const setAt = (entry: SizedSprite, id: SystemId | null) => {
      entry.sprite.visible = id !== null;
      if (id === null) return;
      const a = systemAnchor(id);
      entry.anchor[0] = a[0];
      entry.anchor[1] = a[1];
      entry.anchor[2] = a[2];
    };
    setAt(this.currentMarker, m.current);
    setAt(this.selectedMarker, m.selected);
    setAt(this.objectiveMarker, m.objective);
    for (const [id, entry] of this.visitedMarkers) entry.sprite.visible = m.visited.has(id) && id !== m.current;

    const route = m.route && m.route.length > 1 ? m.route : null;
    this.routeLine.visible = !!route;
    this.routeGlow.visible = !!route;
    if (route) {
      const positions: number[] = [];
      for (let i = 0; i < route.length - 1; i++) {
        const a = systemAnchor(route[i]!);
        const b = systemAnchor(route[i + 1]!);
        positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      }
      // A fresh geometry per route so the old GPU buffers are released by dispose().
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(positions);
      this.routeGeometry.dispose();
      this.routeGeometry = geometry;
      this.routeLine.geometry = geometry;
      this.routeGlow.geometry = geometry;
    }
  }

  /**
   * Places the camera at the origin looking at `target` and every object at (anchor - cameraPos).
   * `time` drives marker pulses when `animate` is true.
   */
  updateFrame(cameraPos: Readonly<Vec3>, target: Readonly<Vec3>, orbitDistance: number, time: number, animate: boolean): void {
    const cp = this.cameraPos;
    cp[0] = cameraPos[0];
    cp[1] = cameraPos[1];
    cp[2] = cameraPos[2];
    const cam = this.camera;
    cam.position.set(0, 0, 0);
    cam.up.set(0, 1, 0);
    cam.lookAt(target[0] - cp[0], target[1] - cp[1], target[2] - cp[2]);
    cam.updateMatrixWorld(true);
    this.viewProjection.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    for (let i = 0; i < this.placed.length; i++) {
      const p = this.placed[i]!;
      p.object.position.set(p.anchor[0] - cp[0], p.anchor[1] - cp[1], p.anchor[2] - cp[2]);
    }

    const projYY = cam.projectionMatrix.elements[5]!;
    const pulse = animate ? Math.sin(time * Math.PI * 1.2) : 0;
    for (let i = 0; i < this.sprites.length; i++) {
      const s = this.sprites[i]!;
      if (!s.sprite.visible) continue;
      let px = s.px;
      if (s.zoomScaled) {
        const dx = s.anchor[0] - cp[0];
        const dy = s.anchor[1] - cp[1];
        const dz = s.anchor[2] - cp[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        px *= clamp(Math.pow(14 / Math.max(d, 1e-3), 0.35), 0.72, 1.7);
      }
      if (s.pulse === 'scale') px *= 1 + 0.07 * pulse;
      if (s.pulse === 'opacity') (s.sprite.material as THREE.SpriteMaterial).opacity = s.baseOpacity * (0.8 + 0.2 * pulse);
      s.sprite.scale.setScalar(spriteScaleForPixels(px, projYY, this.height));
    }

    // Keep dashes roughly constant on screen as the camera zooms.
    this.linkMaterial.dashScale = clamp(12 / Math.max(orbitDistance, 0.05), 0.3, 40);
  }

  /** Projects a map position (using the camera from the last updateFrame) to canvas CSS pixels. */
  project(pos: Readonly<Vec3>, out: ScreenPoint = createScreenPoint()): ScreenPoint {
    const cp = this.cameraPos;
    return projectPoint(
      this.viewProjection.elements,
      pos[0] - cp[0],
      pos[1] - cp[1],
      pos[2] - cp[2],
      this.width,
      this.height,
      out,
    );
  }

  dispose(): void {
    this.routeGeometry.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.scene.clear();
  }
}
