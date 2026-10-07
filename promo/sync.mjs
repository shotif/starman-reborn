// Checks picture against sound in the master: for the big moments the game drew and voiced in the
// same frame (the blasts in the fight, the launch, cruise engaging), when the picture changes and
// when the sound starts.
//   node promo/sync.mjs [file = promo/out/starman-reborn-trailer-60s.mp4]
// Writes promo/out/qa/sync.json and prints a table. A frame is 16.7 ms.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, PROMO } from './lib/harness.mjs';
import { FFMPEG } from './lib/media.mjs';
import { loadEdl } from './lib/timeline.mjs';

const RATE = 48_000;
const W = 64;
const H = 36;

function pcm(file, from, seconds, filter = 'anull') {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-ss', String(from), '-t', String(seconds), '-i', file, '-vn', '-af', `${filter},aresample=${RATE}`, '-ac', '1', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
}

function luma(file, firstFrame, count, fps) {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-an', '-vf', `trim=start_frame=${firstFrame}:end_frame=${firstFrame + count},setpts=PTS-STARTPTS,scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  const frames = [];
  for (let i = 0; i < count; i++) frames.push(r.stdout.subarray(i * W * H, (i + 1) * W * H));
  void fps;
  return frames;
}

/** Where a sound begins: the first sample over a fifth of the loudest in the window. */
function onset(samples) {
  let peak = 0;
  for (const x of samples) peak = Math.max(peak, Math.abs(x));
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) > peak * 0.2) return i;
  return -1;
}

/** How many samples `b` lags `a` by, searching ±`reach`. */
function lag(a, b, reach) {
  let best = 0;
  let bestSum = -Infinity;
  for (let d = -reach; d <= reach; d += 4) {
    let sum = 0;
    for (let i = reach; i < a.length - reach; i += 4) sum += a[i] * b[i + d];
    if (sum > bestSum) {
      bestSum = sum;
      best = d;
    }
  }
  return best;
}

export function checkSync(file = join(OUT, 'starman-reborn-trailer-60s.mp4')) {
  const edl = loadEdl();
  const fps = edl.fps;
  const plan = JSON.parse(readFileSync(join(PROMO, 'cues', 'timeline.json'), 'utf8'));
  const sfxStem = join(OUT, 'audio', 'sfx.wav');
  // The moments to check: every large blast a shot's own cue sheet put in the trailer, the launch and the lane.
  // (Sounds with a sharp start only: the lane's whoosh swells for a third of a second, so it has no instant to measure.)
  const wanted = plan.sfx.filter((e) => e.clip !== 'hit' && ['explosion-large', 'undock', 'cruise-engage'].includes(e.id));
  const rows = [];
  for (const e of wanted) {
    const before = 0.2;
    const from = Math.max(0, e.t - before);
    // Sound: where the effect starts in the effects stem, and how far the master's sound is from the stem's.
    const stem = pcm(sfxStem, from, 0.6);
    const start = onset(stem.subarray(Math.round((before - 0.02) * RATE)));
    const soundAt = from + before - 0.02 + start / RATE;
    const master = pcm(file, from, 0.6, 'highpass=f=300');
    const stemHigh = pcm(sfxStem, from, 0.6, 'highpass=f=300');
    const masterLag = lag(stemHigh, master, 1200) / RATE;
    // Picture: the frame that differs most from the one before it, within five frames either side.
    const first = Math.max(1, Math.round(e.t * fps) - 5);
    const frames = luma(file, first - 1, 12, fps);
    let pictureFrame = first;
    let most = -1;
    for (let i = 1; i < frames.length; i++) {
      let sum = 0;
      for (let k = 0; k < W * H; k++) sum += Math.abs(frames[i][k] - frames[i - 1][k]);
      if (sum > most) {
        most = sum;
        pictureFrame = first - 1 + i;
      }
    }
    const pictureAt = pictureFrame / fps;
    rows.push({ id: e.id, clip: e.clip, planned: Math.round(e.t * 1000) / 1000, pictureFrame, pictureAt: Math.round(pictureAt * 1000) / 1000, soundAt: Math.round(soundAt * 1000) / 1000, soundAfterPictureMs: Math.round((soundAt + masterLag - pictureAt) * 1000), masterVsStemMs: Math.round(masterLag * 1000) });
  }
  mkdirSync(join(OUT, 'qa'), { recursive: true });
  writeFileSync(join(OUT, 'qa', 'sync.json'), JSON.stringify(rows, null, 1) + '\n');
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = checkSync(process.argv[2]);
  console.log('effect            clip      planned  picture(frame)   sound   sound−picture  master−stem');
  for (const r of rows) console.log(`${r.id.padEnd(17)} ${r.clip.padEnd(9)} ${r.planned.toFixed(3).padStart(7)}  ${r.pictureAt.toFixed(3)} (${r.pictureFrame})  ${r.soundAt.toFixed(3)}  ${String(r.soundAfterPictureMs).padStart(6)} ms  ${String(r.masterVsStemMs).padStart(6)} ms`);
  const worst = Math.max(...rows.map((r) => Math.abs(r.soundAfterPictureMs)));
  console.log(`Worst: ${worst} ms (${(worst / (1000 / 60)).toFixed(1)} frames)`);
  if (worst > 34) process.exit(1);
}
