import * as THREE from 'three';
import type { QualityLevel } from '../world/art/types.ts';
import type { BloomChain } from './bloom.ts';
import type { QualitySetting } from './settings.ts';

interface Preset {
  dprCap: number;
  frameBudgetMs: number;
  bloom: boolean;
}

const PRESETS: Record<QualityLevel, Preset> = {
  low: { dprCap: 1, frameBudgetMs: 1000 / 30, bloom: false },
  medium: { dprCap: 1.5, frameBudgetMs: 1000 / 60, bloom: false },
  high: { dprCap: 2, frameBudgetMs: 1000 / 60, bloom: true },
};

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
}

/** 'auto' picks the low preset on phones/tablets and medium on desktops. */
export function resolveQuality(setting: QualitySetting): QualityLevel {
  if (setting !== 'auto') return setting;
  return isTouchDevice() ? 'low' : 'medium';
}

/**
 * Owns the single WebGLRenderer (WebGL 2). Handles resizing to the canvas' CSS size, a device
 * pixel ratio cap per quality preset, dynamic resolution from measured frame time, optional bloom
 * on the high preset, and WebGL context loss.
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  quality: QualityLevel;
  /** Multiplier applied on top of the capped DPR (0.55..1), driven by frame time. */
  dynamicScale = 1;
  /** Frames drawn so far (the browser tests watch it stop and start with the WebGL context). */
  framesDrawn = 0;
  onContextLost: (() => void) | null = null;
  onContextRestored: (() => void) | null = null;
  contextLost = false;

  private bloomAllowed = true;
  private bloom: BloomChain | null = null;
  private bloomLoading = false;
  private frameTimes: number[] = [];
  private slowFor = 0;
  private fastFor = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  fps = 0;

  constructor(canvas: HTMLCanvasElement, quality: QualityLevel) {
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !isTouchDevice(),
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor(0x020308, 1);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.onContextLost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.onContextRestored?.();
    });
    this.resize(true);
  }

  get preset(): Preset {
    return PRESETS[this.quality];
  }

  get pixelRatio(): number {
    return this.dpr;
  }

  /** What the browser says about its WebGL, for the device report (null while the context is lost). */
  graphicsInfo(): { webgl2: boolean; gpu: string; maxTexture: number } | null {
    if (this.contextLost) return null;
    const gl = this.renderer.getContext();
    let gpu = String(gl.getParameter(gl.RENDERER));
    // Chrome only says "WebKit WebGL" there; its debug extension names the chip where it is allowed.
    if (/webgl/i.test(gpu)) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    }
    return { webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext, gpu, maxTexture: this.renderer.capabilities.maxTextureSize };
  }

  setQuality(quality: QualityLevel, bloomAllowed: boolean): void {
    this.quality = quality;
    this.bloomAllowed = bloomAllowed;
    this.dynamicScale = 1;
    this.frameTimes = [];
    if (!this.useBloom) this.disposeComposer();
    this.resize(true);
  }

  /** Whether the bloom glow is drawn (High preset, allowed in Settings). */
  get useBloom(): boolean {
    return this.preset.bloom && this.bloomAllowed;
  }

  /** Matches the drawing buffer to the canvas CSS size × capped DPR × dynamic scale. */
  resize(force = false): void {
    const w = Math.max(1, Math.floor(this.canvas.clientWidth || window.innerWidth));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight || window.innerHeight));
    const dpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, this.preset.dprCap) * this.dynamicScale);
    if (!force && w === this.width && h === this.height && Math.abs(dpr - this.dpr) < 0.01) return;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    if (this.bloom) {
      this.bloom.composer.setPixelRatio(dpr);
      this.bloom.composer.setSize(w, h);
    }
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.contextLost) return;
    this.framesDrawn++;
    if (this.useBloom && this.bloom) {
      this.bloom.renderPass.scene = scene;
      this.bloom.renderPass.camera = camera;
      this.bloom.composer.render();
      return;
    }
    if (this.useBloom && !this.bloomLoading) this.loadBloom(scene, camera);
    this.renderer.render(scene, camera);
  }

  /** The bloom chain is a separate chunk, fetched only when the High preset first needs it. */
  private loadBloom(scene: THREE.Scene, camera: THREE.Camera): void {
    this.bloomLoading = true;
    void import('./bloom.ts')
      .then(({ createBloomChain }) => {
        if (!this.useBloom) return;
        this.bloom = createBloomChain(this.renderer, scene, camera, this.width, this.height, this.dpr);
      })
      .catch(() => {
        this.bloomAllowed = false;
      })
      .finally(() => {
        this.bloomLoading = false;
      });
  }

  private disposeComposer(): void {
    this.bloom?.dispose();
    this.bloom = null;
  }

  /**
   * Feed the measured frame interval. Lowers the resolution scale when frames run over budget
   * and slowly restores it when there is headroom.
   */
  recordFrame(dtSeconds: number): void {
    const ms = dtSeconds * 1000;
    this.frameTimes.push(ms);
    if (this.frameTimes.length > 30) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps = avg > 0 ? 1000 / avg : 0;
    if (this.frameTimes.length < 20) return;
    const budget = this.preset.frameBudgetMs;
    if (avg > budget * 1.2) {
      this.slowFor += dtSeconds;
      this.fastFor = 0;
    } else if (avg < budget * 0.75) {
      this.fastFor += dtSeconds;
      this.slowFor = 0;
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
    if (this.slowFor > 1.5 && this.dynamicScale > 0.55) {
      this.dynamicScale = Math.max(0.55, this.dynamicScale - 0.1);
      this.slowFor = 0;
      this.frameTimes = [];
      this.resize(true);
    } else if (this.fastFor > 4 && this.dynamicScale < 1) {
      this.dynamicScale = Math.min(1, this.dynamicScale + 0.05);
      this.fastFor = 0;
      this.resize(true);
    }
  }

  dispose(): void {
    this.disposeComposer();
    this.renderer.dispose();
  }
}
