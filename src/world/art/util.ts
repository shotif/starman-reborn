import * as THREE from 'three';

/**
 * Resources registered here are module-level caches shared by many art objects (noise volumes,
 * panel textures, common materials). `disposeObject` never frees them, so one instance cannot
 * pull a texture out from under another.
 */
const sharedResources = new WeakSet<object>();

/** Marks a geometry, material or texture as shared so `disposeObject` leaves it alone. */
export function markShared<T extends object>(resource: T): T {
  sharedResources.add(resource);
  return resource;
}

export function isShared(resource: object): boolean {
  return sharedResources.has(resource);
}

function disposeTexture(value: unknown): void {
  if (value instanceof THREE.Texture && !sharedResources.has(value)) value.dispose();
}

/** Disposes geometries, materials and textures owned by an object tree (shared caches are skipped). */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry && !sharedResources.has(mesh.geometry)) mesh.geometry.dispose();
    if ((node as THREE.InstancedMesh).isInstancedMesh) (node as THREE.InstancedMesh).dispose();
    const material = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      if (sharedResources.has(m)) continue;
      for (const value of Object.values(m)) disposeTexture(value);
      const uniforms = (m as THREE.ShaderMaterial).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) disposeTexture(u?.value);
      m.dispose();
    }
  });
}

/** Small deterministic PRNG (mulberry32) so procedural art is reproducible from a seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-quality pick helper: `byQuality(ctx.quality, 16, 24, 32)`. */
export function byQuality<T>(quality: 'low' | 'medium' | 'high', low: T, medium: T, high: T): T {
  return quality === 'low' ? low : quality === 'medium' ? medium : high;
}

/** Linear-space colour (three's working space) from any colour representation. */
export function linearColor(c: THREE.ColorRepresentation, scale = 1): THREE.Color {
  return new THREE.Color(c).multiplyScalar(scale);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Frame-rate independent exponential approach of `current` towards `target`. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

const tmpViewport = new THREE.Vector4();

/**
 * Viewport height in physical pixels, shared by every screen-size-aware shader (light points,
 * star glows, stars). Refreshed from `onBeforeRender` hooks, so it follows the active render
 * target (bloom composer or canvas) without the builders ever seeing the renderer.
 */
export const viewportUniform = { value: 1080 };

export function trackViewport(object: THREE.Object3D): void {
  object.onBeforeRender = (renderer) => {
    renderer.getCurrentViewport(tmpViewport);
    if (tmpViewport.w > 0) viewportUniform.value = tmpViewport.w;
  };
}
