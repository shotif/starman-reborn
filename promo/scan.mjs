// Looks through captured shots for glitched frames: a frame unlike both its neighbours where the
// neighbours are like each other (a tile the compositor had not drawn yet, a black frame).
//   node promo/scan.mjs [<shot> …]        every captured shot if none is named
// Writes promo/out/glitches.json: { shot: [frame, …] }, which build.mjs repairs from the neighbours.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FPS, OUT } from './lib/harness.mjs';
import { FFMPEG, framePattern } from './lib/media.mjs';

const W = 96;
const H = 54;
/** The mean level of each 8×6-pixel block of a frame, 0–255. */
function blocks(f) {
  const out = [];
  for (let by = 0; by < H; by += 6) {
    for (let bx = 0; bx < W; bx += 8) {
      let sum = 0;
      for (let y = by; y < by + 6; y++) for (let x = bx; x < bx + 8; x++) sum += f[y * W + x];
      out.push(sum / 48);
    }
  }
  return out;
}

/** Scans a captured shot by name, a folder of frames by path, or a video file by path. */
export function scan(shot) {
  const input = /\.(mp4|mkv|mov)$/.test(shot) ? ['-i', shot, '-an'] : ['-framerate', String(FPS), '-i', framePattern(shot.includes('/') ? shot : join(OUT, 'frames', shot)).pattern];
  const r = spawnSync(FFMPEG, ['-v', 'error', ...input, '-vf', `scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  const n = r.stdout.length / (W * H);
  const frame = (i) => r.stdout.subarray(i * W * H, (i + 1) * W * H);
  // Every frame's blocks once, then each frame against the three before and the three after it.
  const all = Array.from({ length: n }, (_, i) => blocks(frame(i)));
  const bad = [];
  for (let i = 0; i < n; i++) {
    let odd = 0;
    for (let k = 0; k < all[i].length; k++) {
      const others = [];
      for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) if (j !== i) others.push(all[j][k]);
      if (others.length < 4) continue;
      // A block gone dark for this frame alone, or for two or three frames running: darker than the
      // frames around it once their two darkest are set aside (they may be the same fault), and by far
      // more than those differ among themselves. (A bolt or a blast is brighter for a frame, never
      // darker; a cut or a fade has frames as dark on one side of it.)
      others.sort((p, q) => p - q);
      const ref = others.slice(2);
      const drop = ref[0] - all[i][k];
      if (drop > 6 && drop > 3 * (ref[ref.length - 1] - ref[0]) + 3) odd++;
    }
    if (odd >= 6) bad.push({ frame: i, t: Math.round((i / FPS) * 100) / 100, odd });
  }
  return { frames: n, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = join(OUT, 'glitches.json');
  const known = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const shots = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(join(OUT, 'frames')).sort();
  for (const shot of shots) {
    const { frames, bad } = scan(shot);
    known[shot] = bad.map((b) => b.frame);
    console.log(`${shot.padEnd(12)} ${String(frames).padStart(5)} frames  ${bad.length ? bad.map((b) => `${b.frame}@${b.t}s(${b.odd})`).join(' ') : 'clean'}`);
  }
  writeFileSync(file, JSON.stringify(known, null, 1) + '\n');
}
