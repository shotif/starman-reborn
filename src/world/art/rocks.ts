import * as THREE from 'three';
import { createNoise3, fbm3 } from './noise.ts';
import { seededRandom } from './util.ts';

export interface RockOptions {
  /** Icosphere subdivision (1 = 80 faces, 2 = 320, 3 = 1280). */
  detail: number;
  /** Non-uniform squash/stretch. */
  stretch?: [number, number, number];
  /** Lumpiness, ~0.2..0.45. */
  rough?: number;
  /** Number of impact dents. */
  craters?: number;
  /** Fraction of faces tinted as bright ice/regolith patches. */
  ice?: number;
  /** Base tint multiplied into the baked shading (default neutral grey-brown). */
  color?: THREE.ColorRepresentation;
}

/**
 * Noise-displaced icosphere (unit-ish radius) with flat faces and baked vertex-colour shading:
 * crevices darker, ridges lighter. Displacement depends only on position, so shared vertices of
 * the non-indexed mesh stay welded.
 */
export function rockGeometry(seed: number, opts: RockOptions): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, opts.detail);
  const noise = createNoise3(seed);
  const rand = seededRandom(seed * 17 + 3);
  const rough = opts.rough ?? 0.3;
  const stretch = opts.stretch ?? [1, 1, 1];
  const dents: { c: THREE.Vector3; r: number; d: number }[] = [];
  for (let i = 0; i < (opts.craters ?? 4); i++) {
    const c = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    dents.push({ c, r: 0.25 + rand() * 0.35, d: 0.06 + rand() * 0.1 });
  }
  const pos = g.attributes.position!;
  const disp = new Float32Array(pos.count);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).normalize();
    let d = 1 + rough * fbm3(noise, p.x * 1.4, p.y * 1.4, p.z * 1.4, 4) + rough * 0.3 * fbm3(noise, p.x * 4 + 7, p.y * 4, p.z * 4, 2);
    for (const dent of dents) {
      const a = p.distanceTo(dent.c) / dent.r;
      if (a < 1.3) d -= dent.d * (a < 1 ? 1 - a * a : 0) - dent.d * 0.25 * Math.max(0, 1 - Math.abs(a - 1) * 4);
    }
    disp[i] = d;
    pos.setXYZ(i, p.x * d * stretch[0], p.y * d * stretch[1], p.z * d * stretch[2]);
  }
  g.computeVertexNormals();
  // Per-face colour: average displacement drives cavity darkening.
  const colors = new Float32Array(pos.count * 3);
  const ice = opts.ice ?? 0;
  const tint = new THREE.Color(opts.color ?? '#8a8178');
  for (let f = 0; f < pos.count; f += 3) {
    const avg = (disp[f]! + disp[f + 1]! + disp[f + 2]!) / 3;
    p.fromBufferAttribute(pos, f);
    const n = fbm3(noise, p.x * 3 + 11, p.y * 3, p.z * 3, 2);
    let b = 0.72 + (avg - 1) * 1.1 + n * 0.25 + (rand() - 0.5) * 0.08;
    b = Math.max(0.35, Math.min(1.15, b));
    // Pale icy regolith patches ignore the base tint.
    const icy = ice > 0 && n > 0.35 - ice * 0.5;
    const r = icy ? b * 0.78 : b * tint.r;
    const gg = icy ? b * 0.82 : b * tint.g;
    const bl = icy ? b * 0.9 : b * tint.b;
    for (let k = 0; k < 3; k++) {
      colors[(f + k) * 3] = r;
      colors[(f + k) * 3 + 1] = gg;
      colors[(f + k) * 3 + 2] = bl;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  g.computeBoundingSphere();
  return g;
}
