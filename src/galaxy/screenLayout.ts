/**
 * Screen-space helpers shared by the 3D map labels and the 2D SVG map: greedy label placement
 * with collision avoidance, and tap/click picking. Pure and allocation-free per call.
 */
import type { Rect } from './mapMath.ts';

export interface LabelBox {
  // Inputs
  anchorX: number;
  anchorY: number;
  width: number;
  height: number;
  /** Clearance between the anchor point and the label edge (e.g. the star glow radius). */
  gap: number;
  /** Higher priority labels are placed first and win conflicts. */
  priority: number;
  /** False hides the label (anchor off screen or not wanted). */
  active: boolean;
  /** Whether other labels must keep clear of this label's anchor point. */
  anchorBlocks: boolean;
  /** Also try a ring of farther slots (for labels drawn with a leader line). */
  far: boolean;
  // Outputs
  x: number;
  y: number;
  visible: boolean;
  /** Candidate slot used last time (kept when it still fits, so labels do not jitter). */
  slot: number;
}

export function createLabelBox(): LabelBox {
  return {
    anchorX: 0,
    anchorY: 0,
    width: 0,
    height: 0,
    gap: 8,
    priority: 0,
    active: false,
    anchorBlocks: true,
    far: false,
    x: 0,
    y: 0,
    visible: false,
    slot: -1,
  };
}

/**
 * Candidate slots around the anchor: right, left, above, below, then the four diagonals; slots
 * 8-15 repeat them farther out for labels with `far` set.
 */
export const LABEL_SLOTS = 16;
const FAR_FACTOR = 2.6;

function slotGap(slot: number, b: LabelBox): number {
  return slot >= 8 ? b.gap * FAR_FACTOR : b.gap;
}

function slotX(slot: number, b: LabelBox): number {
  const gap = slotGap(slot, b);
  const d = gap * 0.72;
  switch (slot % 8) {
    case 0:
      return b.anchorX + gap;
    case 1:
      return b.anchorX - gap - b.width;
    case 2:
    case 3:
      return b.anchorX - b.width / 2;
    case 4:
    case 5:
      return b.anchorX + d;
    default:
      return b.anchorX - d - b.width;
  }
}

function slotY(slot: number, b: LabelBox): number {
  const gap = slotGap(slot, b);
  const d = gap * 0.72;
  switch (slot % 8) {
    case 0:
    case 1:
      return b.anchorY - b.height / 2;
    case 2:
      return b.anchorY - gap - b.height;
    case 3:
      return b.anchorY + gap;
    case 4:
    case 6:
      return b.anchorY - d - b.height;
    default:
      return b.anchorY + d;
  }
}

export function rectsOverlap(ax: number, ay: number, aw: number, ah: number, b: Rect, pad = 0): boolean {
  return ax < b.x + b.w + pad && ax + aw + pad > b.x && ay < b.y + b.h + pad && ay + ah + pad > b.y;
}

/** Radius (px) around another label's anchor that a label may not cover. */
const ANCHOR_CLEARANCE = 5;
const LABEL_PAD = 3;

function fits(
  labels: readonly LabelBox[],
  self: number,
  x: number,
  y: number,
  bounds: Rect,
  obstacles: readonly Rect[],
  placed: readonly number[],
  placedCount: number,
): boolean {
  const b = labels[self]!;
  if (x < bounds.x || y < bounds.y || x + b.width > bounds.x + bounds.w || y + b.height > bounds.y + bounds.h) {
    return false;
  }
  for (let i = 0; i < obstacles.length; i++) {
    if (rectsOverlap(x, y, b.width, b.height, obstacles[i]!, LABEL_PAD)) return false;
  }
  for (let i = 0; i < placedCount; i++) {
    const o = labels[placed[i]!]!;
    if (
      x < o.x + o.width + LABEL_PAD &&
      x + b.width + LABEL_PAD > o.x &&
      y < o.y + o.height + LABEL_PAD &&
      y + b.height + LABEL_PAD > o.y
    ) {
      return false;
    }
  }
  for (let i = 0; i < labels.length; i++) {
    if (i === self) continue;
    const o = labels[i]!;
    if (!o.active || !o.anchorBlocks) continue;
    // Anchors sitting on this label's own anchor (e.g. a close binary) do not block it.
    if (Math.abs(o.anchorX - b.anchorX) < 2 && Math.abs(o.anchorY - b.anchorY) < 2) continue;
    if (
      o.anchorX > x - ANCHOR_CLEARANCE &&
      o.anchorX < x + b.width + ANCHOR_CLEARANCE &&
      o.anchorY > y - ANCHOR_CLEARANCE &&
      o.anchorY < y + b.height + ANCHOR_CLEARANCE
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Greedy placement by priority. Each label tries its previous slot first, then the others; a label
 * that fits nowhere inside `bounds` without touching obstacles, placed labels or other anchors is
 * hidden. `order` and `placed` are caller-owned scratch arrays (resized as needed, reused per frame).
 */
export function layoutLabels(
  labels: LabelBox[],
  bounds: Rect,
  obstacles: readonly Rect[],
  order: number[],
  placed: number[],
): void {
  const n = labels.length;
  order.length = n;
  for (let i = 0; i < n; i++) order[i] = i;
  // Insertion sort by descending priority (stable, no allocation).
  for (let i = 1; i < n; i++) {
    const v = order[i]!;
    const pv = labels[v]!.priority;
    let j = i - 1;
    while (j >= 0 && labels[order[j]!]!.priority < pv) {
      order[j + 1] = order[j]!;
      j--;
    }
    order[j + 1] = v;
  }
  placed.length = n;
  let placedCount = 0;
  for (let k = 0; k < n; k++) {
    const idx = order[k]!;
    const b = labels[idx]!;
    b.visible = false;
    if (!b.active || b.width <= 0 || b.height <= 0) continue;
    let chosen = -1;
    const slots = b.far ? LABEL_SLOTS : 8;
    if (b.slot >= 0 && b.slot < slots) {
      if (fits(labels, idx, slotX(b.slot, b), slotY(b.slot, b), bounds, obstacles, placed, placedCount)) chosen = b.slot;
    }
    for (let s = 0; chosen < 0 && s < slots; s++) {
      if (s === b.slot) continue;
      if (fits(labels, idx, slotX(s, b), slotY(s, b), bounds, obstacles, placed, placedCount)) chosen = s;
    }
    if (chosen < 0) continue;
    b.slot = chosen;
    b.x = slotX(chosen, b);
    b.y = slotY(chosen, b);
    b.visible = true;
    placed[placedCount++] = idx;
  }
}

export interface PickPoint {
  x: number;
  y: number;
  visible: boolean;
}

/** Index of the visible point nearest to (px, py) within `radius` CSS pixels, or -1. */
export function pickNearestPoint(points: readonly PickPoint[], px: number, py: number, radius: number): number {
  let best = -1;
  let bestD = radius * radius;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (!p.visible) continue;
    const dx = p.x - px;
    const dy = p.y - py;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Index of the visible label whose box (grown by `pad`) contains (px, py), or -1. */
export function pickLabelAt(labels: readonly LabelBox[], px: number, py: number, pad = 4): number {
  for (let i = 0; i < labels.length; i++) {
    const b = labels[i]!;
    if (!b.visible) continue;
    if (px >= b.x - pad && px <= b.x + b.width + pad && py >= b.y - pad && py <= b.y + b.height + pad) return i;
  }
  return -1;
}
