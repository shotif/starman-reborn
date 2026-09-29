/** WebGL 2 capability probe, run before the renderer is created. */
export interface WebGLSupport {
  webgl2: boolean;
  reason?: string;
}

export function detectWebGL2(): WebGLSupport {
  try {
    const params = new URLSearchParams(window.location.search);
    // Test hook: `?nowebgl=1` exercises the compatibility path.
    if (params.get('nowebgl') === '1') return { webgl2: false, reason: 'WebGL 2 disabled by ?nowebgl=1' };
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (!gl) return { webgl2: false, reason: 'This browser or device did not provide a WebGL 2 context.' };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl2: true };
  } catch (err) {
    return { webgl2: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
