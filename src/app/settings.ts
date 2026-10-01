import type { SaveBackend } from './save/backend.ts';

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high';
export type AimAssist = 'off' | 'low' | 'medium';
export type Difficulty = 'relaxed' | 'standard' | 'veteran';
/** Desktop steering: follow the cursor, steer only while dragging, or keyboard steer + mouse aim. */
export type SteeringMode = 'mouse' | 'drag' | 'keyboard';

export interface Settings {
  version: 1;
  quality: QualitySetting;
  reducedMotion: boolean;
  cameraShake: boolean;
  bloom: boolean;
  textScale: number;
  volumes: { master: number; music: number; sfx: number };
  muted: boolean;
  aimAssist: AimAssist;
  difficulty: Difficulty;
  steering: SteeringMode;
  invertY: boolean;
  /** Mirror touch controls for left-handed play (aim on the left). */
  swapTouchSides: boolean;
  showFps: boolean;
}

export const TEXT_SCALES = [1, 1.15, 1.3, 1.5] as const;

export function defaultSettings(): Settings {
  const prefersReduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  return {
    version: 1,
    quality: 'auto',
    reducedMotion: prefersReduced,
    cameraShake: !prefersReduced,
    bloom: true,
    textScale: 1,
    volumes: { master: 0.8, music: 0.55, sfx: 0.8 },
    muted: false,
    aimAssist: 'low',
    difficulty: 'standard',
    steering: 'mouse',
    invertY: false,
    swapTouchSides: false,
    showFps: false,
  };
}

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function unit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

/** Accepts anything read from storage and returns valid settings (unknown fields dropped). */
export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const vol = (typeof r.volumes === 'object' && r.volumes !== null ? r.volumes : {}) as Record<string, unknown>;
  return {
    version: 1,
    quality: pick(r.quality, ['auto', 'low', 'medium', 'high'] as const, d.quality),
    reducedMotion: typeof r.reducedMotion === 'boolean' ? r.reducedMotion : d.reducedMotion,
    cameraShake: typeof r.cameraShake === 'boolean' ? r.cameraShake : d.cameraShake,
    bloom: typeof r.bloom === 'boolean' ? r.bloom : d.bloom,
    textScale: pick(r.textScale, TEXT_SCALES, 1),
    volumes: { master: unit(vol.master, d.volumes.master), music: unit(vol.music, d.volumes.music), sfx: unit(vol.sfx, d.volumes.sfx) },
    muted: typeof r.muted === 'boolean' ? r.muted : d.muted,
    aimAssist: pick(r.aimAssist, ['off', 'low', 'medium'] as const, d.aimAssist),
    difficulty: pick(r.difficulty, ['relaxed', 'standard', 'veteran'] as const, d.difficulty),
    steering: pick(r.steering, ['mouse', 'drag', 'keyboard'] as const, d.steering),
    invertY: typeof r.invertY === 'boolean' ? r.invertY : d.invertY,
    swapTouchSides: typeof r.swapTouchSides === 'boolean' ? r.swapTouchSides : d.swapTouchSides,
    showFps: typeof r.showFps === 'boolean' ? r.showFps : d.showFps,
  };
}

/** Where the settings are kept, beside the saves. */
export const SETTINGS_KEY = 'settings';

/** The stored settings, made valid (defaults when there are none or storage fails). */
export async function loadSettings(backend: SaveBackend): Promise<Settings> {
  return sanitizeSettings(await backend.get(SETTINGS_KEY).catch(() => undefined));
}

/** Text size and reduced motion apply to the whole page, the loading title included. */
export function applyDocumentSettings(settings: Settings): void {
  const root = document.documentElement;
  root.style.setProperty('--text-scale', String(settings.textScale));
  root.classList.toggle('reduced-motion', settings.reducedMotion);
}

export const DIFFICULTY = {
  relaxed: { enemyDamage: 0.55, enemyAccuracy: 0.55, enemyHealth: 0.8 },
  standard: { enemyDamage: 1, enemyAccuracy: 0.8, enemyHealth: 1 },
  veteran: { enemyDamage: 1.35, enemyAccuracy: 0.95, enemyHealth: 1.25 },
} as const satisfies Record<Difficulty, { enemyDamage: number; enemyAccuracy: number; enemyHealth: number }>;
