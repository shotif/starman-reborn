import * as THREE from 'three';
import type { QualityLevel } from '../world/art/types.ts';
import type { BloomChain } from './bloom.ts';
import { AUTO_QUALITY, FrameGovernor, PRESETS, type Preset } from './frameGovernor.ts';
import type { QualitySetting } from './settings.ts';

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
}

/** 'auto' starts every device at Medium (frameGovernor.ts); it may step down from there. */
export function resolveQuality(setting: QualitySetting): QualityLevel {
  if (setting !== 'auto') return setting;
  return AUTO_QUALITY.start;
}

/**
 * Owns the single WebGLRenderer (WebGL 2). Handles resizing to the canvas' CSS size, a device
 * pixel ratio cap per quality preset, dynamic resolution from measured frame time, optional bloom
 * on the high preset, and WebGL context loss.
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  /** Frame rate, dynamic resolution and Auto's steps down. */
  private readonly governor: FrameGovernor;
  /** Frames drawn so far (the browser tests watch it stop and start with the WebGL context). */
  framesDrawn = 0;
  onContextLost: (() => void) | null = null;
  onContextRestored: (() => void) | null = null;
  contextLost = false;

  private bloomAllowed = true;
  private bloom: BloomChain | null = null;
  private bloomLoading = false;
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement, quality: QualityLevel) {
    this.canvas = canvas;
    this.governor = new FrameGovernor(quality);
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

  /** The preset in use (Auto may have stepped it down). */
  get quality(): QualityLevel {
    return this.governor.quality;
  }

  /** Frames drawn per second, recently. */
  get fps(): number {
    return this.governor.fps;
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

  /** A preset from Settings; `autoSteps` lets Auto step it down on a device that cannot keep up. */
  setQuality(quality: QualityLevel, bloomAllowed: boolean, autoSteps = false): void {
    this.bloomAllowed = bloomAllowed;
    this.governor.reset(quality, autoSteps);
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
    const dpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, this.preset.dprCap) * this.governor.scale);
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
   * Feed the measured frame interval, drawn every `refreshes` display refreshes (2 at half rate on
   * docked and menu screens). Lowers the resolution when frames run over budget, restores it with
   * headroom, and under Auto steps the preset down on a device that cannot keep up.
   */
  recordFrame(dtSeconds: number, refreshes = 1): void {
    const change = this.governor.record(dtSeconds, refreshes, window.devicePixelRatio || 1);
    if (!change) return;
    if (change === 'quality' && !this.useBloom) this.disposeComposer();
    this.resize(true);
  }

  dispose(): void {
    this.disposeComposer();
    this.renderer.dispose();
  }
}
