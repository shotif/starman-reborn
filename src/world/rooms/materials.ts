import * as THREE from 'three';
import { darkMaterial, emissiveMaterial, glassMaterial, hullMaterial, metalMaterial, windowMaterial } from '../art/materials.ts';
import { panelTexture } from '../art/textures.ts';
import type { ArtContext } from '../art/types.ts';
import { withMotion } from './motion.ts';
import type { MotionUniforms } from './motion.ts';
import { deckTexture, fabricTexture, glowAtlas, grateTexture, paintTexture, tileTexture, woodTexture } from './textures.ts';

/**
 * Material set for one interior. Static keys (for the geometry Kit) mix the shared art materials
 * (hull, metal, glass, emissive: cached, never disposed) with interior-owned ones; motion keys (for
 * the MotionKit) are owned variants with the vertex animation patch. Everything owned is disposed
 * with the interior.
 */

export type HoloMode = 'board' | 'chart' | 'news' | 'scope' | 'curtain' | 'pad';

export const HOLO_MODE: Record<HoloMode, number> = { board: 0, chart: 1, news: 2, scope: 3, curtain: 4, pad: 5 };

const HOLO_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vUv = uv;
  vColor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HOLO_FRAG = /* glsl */ `
uniform float uTime;
uniform float uCalm;
varying vec2 vUv;
varying vec3 vColor;
float h1(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float box(vec2 p, vec2 lo, vec2 hi) { vec2 a = step(lo, p) * step(p, hi); return a.x * a.y; }

// Price board: header, rows of glyph blocks, value bars and trend arrows. Values step every few seconds.
vec3 board(vec2 uv, float seed, out vec3 fixedCol) {
  vec3 col = vec3(0.07);
  float frame = 1.0 - box(uv, vec2(0.012, 0.02), vec2(0.988, 0.98));
  col += frame * 0.9;
  col += box(uv, vec2(0.04, 0.86), vec2(0.96, 0.95)) * 0.16;
  float hc = floor(uv.x * 36.0);
  col += step(0.35, h2(vec2(hc, seed))) * box(uv, vec2(0.06, 0.885), vec2(0.58, 0.925)) * 0.9;
  fixedCol = vec3(0.0);
  float rows = 6.0;
  float ry = (0.83 - uv.y) / 0.78 * rows;
  if (ry > 0.0 && ry < rows) {
    float r = floor(ry);
    float fy = fract(ry);
    float mid = step(0.3, fy) * step(fy, 0.7);
    float cell = floor(uv.x * 64.0);
    col += step(0.32, h2(vec2(cell, r + seed * 7.0))) * box(uv, vec2(0.05, 0.0), vec2(0.27, 1.0)) * mid * 0.75;
    float rate = mix(0.22, 0.05, uCalm);
    float clock = uTime * rate + h1(r + seed) * 3.0;
    float epoch = floor(clock);
    float v0 = h2(vec2(r, epoch + seed));
    float v1 = h2(vec2(r, epoch - 1.0 + seed));
    float v = mix(v1, v0, smoothstep(0.0, 0.25, fract(clock)));
    float barEnd = 0.33 + 0.46 * (0.2 + 0.8 * v);
    float bar = box(uv, vec2(0.33, 0.0), vec2(barEnd, 1.0)) * step(0.26, fy) * step(fy, 0.74) * step(0.28, fract(uv.x * 90.0));
    col += bar;
    float up = step(v1, v0);
    vec2 p = vec2((uv.x - 0.885) * 14.0, (fy - 0.5) * 2.2);
    float tri = up > 0.5 ? step(abs(p.x), (0.55 - p.y) * 0.62) * step(-0.55, p.y) : step(abs(p.x), (0.55 + p.y) * 0.62) * step(p.y, 0.55);
    tri *= box(uv, vec2(0.84, 0.0), vec2(0.93, 1.0));
    fixedCol = tri * (up > 0.5 ? vec3(0.3, 1.0, 0.45) : vec3(1.0, 0.32, 0.25)) * 1.3;
    col += step(0.965, fy) * box(uv, vec2(0.04, 0.0), vec2(0.96, 1.0)) * 0.22;
  }
  return col;
}

vec3 chart(vec2 uv, float seed) {
  float grid = max(step(0.965, fract(uv.x * 10.0)), step(0.94, fract(uv.y * 6.0))) * 0.16;
  float x = uv.x * 8.0 + uTime * mix(0.16, 0.04, uCalm) + seed * 5.0;
  float f = 0.5 + 0.18 * sin(x * 1.3 + seed) + 0.1 * sin(x * 3.1 + seed * 2.0) + 0.05 * sin(x * 7.3);
  float line = smoothstep(0.022, 0.0, abs(uv.y - f));
  float under = step(uv.y, f) * 0.1;
  float frame = 1.0 - box(uv, vec2(0.01, 0.015), vec2(0.99, 0.985));
  return vec3(0.05 + grid + line * 1.3 + under + frame * 0.8);
}

// A broadcast on a bar screen: changing picture, headline strip and a scrolling ticker.
vec3 news(vec2 uv, float seed) {
  float epoch = floor(uTime / 8.0 + seed * 3.0);
  vec3 bg = mix(vec3(0.03, 0.09, 0.26), vec3(0.24, 0.06, 0.1), h1(epoch));
  bg = mix(bg, vec3(0.04, 0.2, 0.16), step(0.66, h1(epoch + 9.0)));
  vec3 col = bg * (0.55 + 0.6 * uv.y);
  vec2 c = vec2(0.3 + 0.35 * h1(epoch + 1.0), 0.6);
  float r = 0.16 + 0.1 * h1(epoch + 2.0);
  vec2 d = (uv - c) * vec2(1.7, 1.0);
  float disc = smoothstep(r, r - 0.012, length(d));
  vec3 dc = mix(vec3(0.95, 0.55, 0.25), vec3(0.3, 0.6, 1.0), h1(epoch + 3.0));
  float shade = clamp(0.35 + (d.x * -0.8 + d.y) * 2.5, 0.08, 1.2);
  col = mix(col, dc * shade, disc);
  col += smoothstep(r + 0.03, r, length(d)) * (1.0 - disc) * dc * 0.35;
  float head = box(uv, vec2(0.05, 0.19), vec2(0.95, 0.31));
  col = mix(col, vec3(0.92, 0.93, 0.96), head * 0.9);
  float gl = step(0.36, h2(vec2(floor(uv.x * 48.0), epoch))) * box(uv, vec2(0.07, 0.22), vec2(0.78, 0.28));
  col = mix(col, vec3(0.08), gl);
  float tick = box(uv, vec2(0.0, 0.03), vec2(1.0, 0.14));
  col = mix(col, vec3(0.75, 0.12, 0.08), tick * 0.92);
  float tg = step(0.42, h2(vec2(floor((uv.x + uTime * mix(0.06, 0.015, uCalm)) * 42.0), 3.0))) * box(uv, vec2(0.0, 0.065), vec2(1.0, 0.105));
  col = mix(col, vec3(1.0), tg * 0.9);
  col += box(uv, vec2(0.83, 0.84), vec2(0.95, 0.95)) * vec3(0.9, 0.75, 0.35) * 0.7;
  return col * 1.25;
}

vec3 scope(vec2 uv, float seed) {
  vec2 p = (uv - vec2(0.36, 0.5)) * vec2(1.6, 1.0) * 2.4;
  float r = length(p);
  float rings = (smoothstep(0.03, 0.0, abs(fract(r * 3.0) - 0.5) - 0.46)) * step(r, 1.0) * 0.45;
  float a = atan(p.y, p.x);
  float sweepA = uTime * mix(1.2, 0.3, uCalm) + seed;
  float da = mod(a - sweepA, 6.2831853);
  float sweep = exp(-da * 2.5) * step(r, 1.0) * 0.9;
  float cross = (smoothstep(0.012, 0.0, abs(p.x)) + smoothstep(0.012, 0.0, abs(p.y))) * step(r, 1.0) * 0.4;
  float blip = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 bp = vec2(h1(fi + seed) - 0.5, h1(fi + 4.0 + seed) - 0.5) * 1.4;
    blip += smoothstep(0.07, 0.0, length(p - bp)) * (0.4 + 0.6 * exp(-mod(sweepA - atan(bp.y, bp.x), 6.2831853) * 1.5));
  }
  float bars = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float y0 = 0.15 + fi * 0.15;
    float len = 0.2 + 0.7 * (0.5 + 0.5 * sin(uTime * mix(0.8, 0.2, uCalm) + fi * 1.7 + seed));
    bars += box(uv, vec2(0.74, y0), vec2(0.74 + 0.2 * len, y0 + 0.07));
  }
  float frame = 1.0 - box(uv, vec2(0.01, 0.015), vec2(0.99, 0.985));
  return vec3(0.05 + rings + sweep + cross + blip + bars * 0.9 + frame * 0.8);
}

// Atmosphere curtain across a bay mouth: faint sheet, bright edges, slow scan bands.
vec3 curtain(vec2 uv) {
  float ex = 1.0 - min(min(uv.x, 1.0 - uv.x) * 9.0, 1.0);
  float ey = 1.0 - min(uv.y * 7.0, 1.0);
  float et = 1.0 - min((1.0 - uv.y) * 12.0, 1.0);
  float edge = ex * ex + ey * ey * 0.8 + et * et * 0.6;
  float spd = mix(1.0, 0.25, uCalm);
  float bands = 0.5 + 0.5 * sin(uv.y * 90.0 - uTime * 1.6 * spd);
  float sweep = exp(-pow((fract(uv.y * 0.6 - uTime * 0.05 * spd) - 0.5) * 10.0, 2.0));
  float cells = step(0.93, fract(uv.x * 40.0 + 0.5 * floor(uv.y * 26.0))) * 0.25 + step(0.9, fract(uv.y * 26.0)) * 0.2;
  return vec3(0.05 + edge * 0.45 + bands * 0.025 + sweep * 0.12 + cells * 0.08);
}

// Hover field on a landing pad: soft core, rings rippling outwards, a faint tick ring.
vec3 padField(vec2 uv) {
  vec2 p = uv * 2.0 - 1.0;
  float r = length(p);
  float spd = mix(0.3, 0.08, uCalm);
  float rings = 0.0;
  for (int i = 0; i < 3; i++) {
    float ph = fract(uTime * spd + float(i) / 3.0);
    rings += exp(-pow((r - ph * 0.92) * 16.0, 2.0)) * (1.0 - ph) * (1.0 - uCalm * 0.6);
  }
  float core = exp(-r * r * 5.0) * 0.75;
  float ticks = step(0.9, fract(atan(p.y, p.x) / 6.2831853 * 32.0)) * smoothstep(0.62, 0.66, r) * smoothstep(0.78, 0.74, r) * 0.35;
  return vec3(core + rings * 0.8 + ticks) * smoothstep(1.0, 0.86, r);
}

void main() {
  float mode = floor(vUv.x * 0.5 + 0.0001);
  float seed = floor(vUv.y * 0.5 + 0.0001);
  vec2 uv = vUv - vec2(mode, seed) * 2.0;
  vec3 tinted = vec3(0.0);
  vec3 fixedCol = vec3(0.0);
  float lum = dot(vColor, vec3(0.3, 0.5, 0.2));
  if (mode < 0.5) {
    tinted = board(uv, seed, fixedCol);
  } else if (mode < 1.5) {
    tinted = chart(uv, seed);
  } else if (mode < 2.5) {
    fixedCol = news(uv, seed);
  } else if (mode < 3.5) {
    tinted = scope(uv, seed);
  } else if (mode < 4.5) {
    tinted = curtain(uv);
  } else {
    tinted = padField(uv);
  }
  float scan = mode > 4.5 ? 1.0 : 0.84 + 0.16 * sin(uv.y * 420.0 + uTime * 3.0 * (1.0 - uCalm));
  float flick = 1.0 - (1.0 - uCalm) * 0.05 * (0.5 + 0.5 * sin(uTime * 23.0 + seed * 3.0));
  vec3 c = (tinted * vColor + fixedCol * lum) * scan * flick;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface RoomMaterials {
  readonly statics: Record<string, THREE.Material>;
  readonly motion: Record<string, THREE.Material>;
  readonly motionUniforms: MotionUniforms;
  readonly time: { value: number };
  dispose(): void;
}

export interface RoomMaterialOptions {
  floorRough: number;
  floorMetal: number;
  barFloor: 'tiles' | 'planks' | 'plates' | 'terrazzo';
}

export function createRoomMaterials(ctx: ArtContext, opts: RoomMaterialOptions): RoomMaterials {
  const q = ctx.quality;
  const owned: THREE.Material[] = [];
  const own = <T extends THREE.Material>(m: T): T => {
    owned.push(m);
    return m;
  };
  const time = { value: 0 };
  const motionUniforms: MotionUniforms = { uMotionTime: { value: 0 }, uMotionScale: { value: ctx.reducedMotion ? 0.3 : 1 } };

  const std = (params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    own(new THREE.MeshStandardMaterial({ vertexColors: true, ...params }));

  const barMap =
    opts.barFloor === 'planks' ? woodTexture(q) : opts.barFloor === 'plates' ? deckTexture(q) : tileTexture(q, opts.barFloor);

  const holo = own(
    new THREE.ShaderMaterial({
      uniforms: { uTime: time, uCalm: { value: ctx.reducedMotion ? 1 : 0 } },
      vertexShader: HOLO_VERT,
      fragmentShader: HOLO_FRAG,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      // Additive blending is order independent: skip three's back-then-front double pass.
      forceSinglePass: true,
    }),
  );
  holo.name = 'room-holo';

  const glow = own(
    new THREE.MeshBasicMaterial({
      map: glowAtlas(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    }),
  );
  glow.name = 'room-glow';

  const statics: Record<string, THREE.Material> = {
    hull: hullMaterial(q),
    metal: metalMaterial(q),
    dark: darkMaterial(),
    glass: glassMaterial('cool'),
    glassWarm: glassMaterial('warm'),
    emissive: emissiveMaterial(),
    windows: windowMaterial(q),
    floor: std({ map: deckTexture(q), roughness: opts.floorRough, metalness: opts.floorMetal }),
    paint: std({ map: paintTexture(q), roughness: 0.58, metalness: 0.08, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    grate: std({ map: grateTexture(q), roughness: 0.5, metalness: 0.6 }),
    plain: std({ roughness: 0.55, metalness: 0.15 }),
    gloss: std({ roughness: 0.16, metalness: 0.3 }),
    wood: std({ map: woodTexture(q), roughness: 0.42, metalness: 0.04 }),
    fabric: std({ map: fabricTexture(q), roughness: 0.86, metalness: 0 }),
    barFloor: std({ map: barMap, roughness: opts.barFloor === 'planks' ? 0.4 : opts.barFloor === 'plates' ? 0.6 : 0.3, metalness: opts.barFloor === 'plates' ? 0.4 : 0.05 }),
    glow,
    holo,
  };

  const motion: Record<string, THREE.Material> = {
    'm:metal': own(withMotion(new THREE.MeshStandardMaterial({ vertexColors: true, map: panelTexture(q), roughness: 0.5, metalness: 0.5 }), motionUniforms)),
    'm:plain': own(withMotion(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.2 }), motionUniforms)),
    'm:emissive': own(withMotion(new THREE.MeshBasicMaterial({ vertexColors: true }), motionUniforms, false)),
    // A stronger cool rim keeps figures readable against dark rooms (classic character lighting).
    people: own(withMotion(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.04 }), motionUniforms, true, 5)),
  };
  motion.people!.name = 'room-people';

  return {
    statics,
    motion,
    motionUniforms,
    time,
    dispose() {
      for (const m of owned) m.dispose();
    },
  };
}
