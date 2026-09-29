import * as THREE from 'three';
import type { QualityLevel } from './types.ts';
import { markShared, seededRandom } from './util.ts';

/**
 * Small generated canvas textures shared by ships, stations and structures. Cached per size and
 * never disposed (see markShared). All are tileable and neutral so vertex colours tint them.
 */

const cache = new Map<string, THREE.Texture>();

function sizeFor(quality: QualityLevel, high = 512): number {
  return quality === 'low' ? Math.min(256, high) : high;
}

function canvasTexture(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, srgb = true): THREE.Texture {
  const k = `${key}:${size}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  draw(g, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  markShared(tex);
  cache.set(k, tex);
  return tex;
}

const grey = (v: number): string => {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${c},${c},${c})`;
};

/** Hull plating: recursively split plates, seams, hatches, vents and rivet rows. */
export function panelTexture(quality: QualityLevel): THREE.Texture {
  return canvasTexture('panel', sizeFor(quality), (g, s) => {
    const rand = seededRandom(4242);
    const u = s / 256;
    g.fillStyle = grey(212);
    g.fillRect(0, 0, s, s);
    const plates: [number, number, number, number][] = [];
    const split = (x: number, y: number, w: number, h: number, depth: number): void => {
      const min = 22 * u;
      if (depth > 4 || (depth > 1 && rand() < 0.22) || (w < min * 2 && h < min * 2)) {
        plates.push([x, y, w, h]);
        return;
      }
      if ((w > h && w >= min * 2) || h < min * 2) {
        const f = Math.round((0.3 + rand() * 0.4) * w);
        split(x, y, f, h, depth + 1);
        split(x + f, y, w - f, h, depth + 1);
      } else {
        const f = Math.round((0.3 + rand() * 0.4) * h);
        split(x, y, w, f, depth + 1);
        split(x, y + f, w, h - f, depth + 1);
      }
    };
    split(0, 0, s, s, 0);
    for (const [x, y, w, h] of plates) {
      g.fillStyle = grey(196 + rand() * 30);
      g.fillRect(x, y, w, h);
      // Subtle bevel light on the top/left edge.
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x, y, w, Math.max(1, u));
      g.fillRect(x, y, Math.max(1, u), h);
      const r = rand();
      if (r < 0.18 && w > 30 * u && h > 30 * u) {
        // Access hatch.
        const hw = w * (0.35 + rand() * 0.3);
        const hh = h * (0.35 + rand() * 0.3);
        const hx = x + (w - hw) / 2;
        const hy = y + (h - hh) / 2;
        g.strokeStyle = grey(120);
        g.lineWidth = Math.max(1, u);
        g.strokeRect(hx, hy, hw, hh);
        g.fillStyle = grey(186 + rand() * 20);
        g.fillRect(hx + u, hy + u, hw - 2 * u, hh - 2 * u);
      } else if (r < 0.3 && w > 26 * u && h > 16 * u) {
        // Vent grille.
        const n = 4 + Math.floor(rand() * 5);
        const vw = w * 0.5;
        const vx = x + w * 0.25;
        g.fillStyle = grey(95);
        for (let i = 0; i < n; i++) g.fillRect(vx, y + h * 0.25 + i * 3 * u, vw, Math.max(1, u * 1.2));
      } else if (r < 0.45) {
        // Rivet row.
        g.fillStyle = grey(150);
        const n = Math.floor(w / (6 * u));
        for (let i = 1; i < n; i++) g.fillRect(x + i * 6 * u, y + 3 * u, Math.max(1, u), Math.max(1, u));
      }
    }
    // Seams on the left/top edge of every plate; the root seams wrap for seamless tiling.
    g.fillStyle = grey(96);
    for (const [x, y, w, h] of plates) {
      g.fillRect(x, y, w, Math.max(1, u * 1.2));
      g.fillRect(x, y, Math.max(1, u * 1.2), h);
    }
    // Fine grime.
    const img = g.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rand() - 0.5) * 10;
      img.data[i] = img.data[i]! + n;
      img.data[i + 1] = img.data[i + 1]! + n;
      img.data[i + 2] = img.data[i + 2]! + n;
    }
    g.putImageData(img, 0, 0);
  });
}

/** Rows of lit windows on black; used as the colour map of an unlit emissive material. */
export function windowTexture(quality: QualityLevel): THREE.Texture {
  return canvasTexture('windows', sizeFor(quality, 256), (g, s) => {
    const rand = seededRandom(777);
    const u = s / 256;
    g.fillStyle = '#000000';
    g.fillRect(0, 0, s, s);
    const rows = 8;
    const cols = 16;
    const cw = s / cols;
    const rh = s / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = rand();
        if (lit < 0.28) continue;
        const warm = rand() < 0.75;
        const b = 0.6 + rand() * 0.4;
        g.fillStyle = warm ? `rgba(255,${Math.round(200 + 30 * b)},${Math.round(140 + 40 * b)},${b})` : `rgba(200,225,255,${b})`;
        g.fillRect(c * cw + 2 * u, r * rh + rh * 0.3, cw - 4 * u, rh * 0.4);
      }
    }
  });
}

/** Photovoltaic cells: deep blue with silver grid lines. */
export function solarTexture(quality: QualityLevel): THREE.Texture {
  return canvasTexture('solar', sizeFor(quality, 256), (g, s) => {
    const rand = seededRandom(99);
    const n = 8;
    const c = s / n;
    g.fillStyle = '#9aa2b0';
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const grad = g.createLinearGradient(x * c, y * c, (x + 1) * c, (y + 1) * c);
        const k = rand() * 12;
        grad.addColorStop(0, `rgb(${22 + k},${40 + k},${92 + k})`);
        grad.addColorStop(1, `rgb(${12 + k},${24 + k},${62 + k})`);
        g.fillStyle = grad;
        g.fillRect(x * c + 1.5, y * c + 1.5, c - 3, c - 3);
        g.fillStyle = 'rgba(160,180,220,0.25)';
        g.fillRect(x * c + c / 2, y * c + 1.5, 1, c - 3);
      }
    }
  });
}

/** Radiator panels: pale ribbed plates. Also used (dimmed, red) as an emissive heat map. */
export function radiatorTexture(quality: QualityLevel): THREE.Texture {
  return canvasTexture('radiator', sizeFor(quality, 256), (g, s) => {
    const u = s / 256;
    g.fillStyle = grey(200);
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 32; i++) {
      const x = i * 8 * u;
      g.fillStyle = grey(236);
      g.fillRect(x, 0, 3 * u, s);
      g.fillStyle = grey(150);
      g.fillRect(x + 3 * u, 0, u, s);
    }
    g.fillStyle = grey(120);
    g.fillRect(0, 0, s, 2 * u);
  });
}
