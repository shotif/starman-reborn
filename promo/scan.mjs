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

/** Scans a captured shot by name, or a video file by path. */
export function scan(shot) {
  const input = /\.(mp4|mkv|mov)$/.test(shot) ? ['-i', shot, '-an'] : ['-framerate', String(FPS), '-i', framePattern(join(OUT, 'frames', shot)).pattern];
  const r = spawnSync(FFMPEG, ['-v', 'error', ...input, '-vf', `scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  const n = r.stdout.length / (W * H);
  const frame = (i) => r.stdout.subarray(i * W * H, (i + 1) * W * H);
  const bad = [];
  for (let i = 1; i < n - 1; i++) {
    const before = blocks(frame(i - 1));
    const here = blocks(frame(i));
    const after = blocks(frame(i + 1));
    // Blocks that go dark for this one frame and come straight back: a blank tile is many of them together.
    // (A bolt or a blast past the camera is brighter for a frame, never darker.)
    let odd = 0;
    for (let k = 0; k < here.length; k++) {
      const drop = Math.min(before[k], after[k]) - here[k];
      if (drop > 6 && drop > 3 * Math.abs(before[k] - after[k]) + 3) odd++;
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
