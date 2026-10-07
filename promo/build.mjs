// Builds the trailer from the captured frames, the cards and the soundtrack, as promo/edl.json says.
//
//   node promo/build.mjs              everything: cards, soundtrack, picture, master, loop, checks
//   node promo/build.mjs --picture    the picture and master only (cards and soundtrack as they are)
//   node promo/build.mjs --draft      a quick 960×540 draft with the same cut (no checks)
//
// Out: promo/out/starman-reborn-trailer-60s.mp4, promo/out/hook-loop.mp4, promo/out/qa/.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HEIGHT, OUT, PROMO, WIDTH } from './lib/harness.mjs';
import { ffmpeg, ffmpegReport, ffprobe, framePattern } from './lib/media.mjs';
import { loadEdl } from './lib/timeline.mjs';
import { scan } from './scan.mjs';
import { checkSync } from './sync.mjs';

const args = new Set(process.argv.slice(2));
const draft = args.has('--draft');
const pictureOnly = args.has('--picture') || draft;
const MASTER = join(OUT, draft ? 'draft.mp4' : 'starman-reborn-trailer-60s.mp4');
const SEGMENTS = join(OUT, 'segments');
const CARDS = join(OUT, 'cards');
const QA = join(OUT, 'qa');
const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

const edl = loadEdl();
const FPS = edl.fps;
/** Frames scan.mjs found with part of the picture missing: no clip may include one. */
const glitches = existsSync(join(OUT, 'glitches.json')) ? JSON.parse(readFileSync(join(OUT, 'glitches.json'), 'utf8')) : {};

/** Looks for the edit to choose from: a little contrast and colour, never anything the game did not draw. */
const GRADES = {
  none: null,
  pop: 'eq=contrast=1.05:saturation=1.1',
  warm: 'eq=contrast=1.05:saturation=1.12,colorbalance=rm=0.02:bm=-0.02',
};

function run(script, extra = []) {
  const r = spawnSync(process.execPath, [join(PROMO, script), ...extra], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${script} failed`);
}

/** One clip of the EDL as a lossless segment of exactly its frames. */
function segment(clip) {
  const out = join(SEGMENTS, `${String(clip.index).padStart(2, '0')}-${clip.id}.mkv`);
  const dir = join(OUT, 'frames', clip.plate ?? clip.shot);
  if (!existsSync(dir)) throw new Error(`No frames for ${clip.plate ?? clip.shot}: run "node promo/capture.mjs ${clip.plate ?? clip.shot}"`);
  const { pattern, count: have } = framePattern(dir);
  const start = Math.round(clip.in * FPS);
  const need = Math.ceil(clip.frames * clip.speed) + (clip.speed > 1 ? Math.ceil(clip.speed) : 0);
  if (start + need > have) throw new Error(`${clip.id}: needs frames ${start}–${start + need} of ${clip.plate ?? clip.shot}, which has ${have}`);
  const flagged = (glitches[clip.plate ?? clip.shot] ?? []).filter((f) => f >= start && f < start + need);
  if (flagged.length) throw new Error(`${clip.id}: frames ${flagged.join(', ')} of ${clip.plate ?? clip.shot} are glitched (promo/scan.mjs): move the clip or capture the shot again`);
  const chain = [];
  const k = clip.speed;
  if (k !== 1) {
    if (Number.isInteger(k) && clip.blend !== false) chain.push(`tmix=frames=${k}`, `select='not(mod(n\\,${k}))'`, `setpts=N/(${FPS}*TB)`);
    else chain.push(`setpts=PTS/${k}`, `fps=${FPS}`);
  }
  if (clip.zoom) {
    const z = clip.zoom;
    const n = Math.max(1, clip.frames - 1);
    const zoom = `(${z.from ?? 1}+(${(z.to ?? 1) - (z.from ?? 1)})*min(n,${n})/${n})`;
    // Drawn at twice the size first, so the slow push-in moves by half pixels and does not shimmer.
    chain.push(`scale=w='trunc(${WIDTH}*${zoom})*2':h='trunc(${HEIGHT}*${zoom})*2':eval=frame:flags=bicubic`, `crop=${WIDTH * 2}:${HEIGHT * 2}:x='(iw-${WIDTH * 2})*${z.x ?? 0.5}':y='(ih-${HEIGHT * 2})*${z.y ?? 0.5}'`, `scale=${WIDTH}:${HEIGHT}:flags=lanczos`);
  }
  const grade = GRADES[clip.grade ?? edl.grade ?? 'none'];
  if (grade) chain.push(grade);
  if (clip.fadeIn) chain.push(`fade=t=in:st=0:d=${clip.fadeIn.frames / FPS}:color=${clip.fadeIn.color ?? 'black'}`);
  if (clip.fadeOut) chain.push(`fade=t=out:st=${(clip.frames - clip.fadeOut.frames) / FPS}:d=${clip.fadeOut.frames / FPS}:color=${clip.fadeOut.color ?? 'black'}`);
  chain.push('scale=out_color_matrix=bt709:out_range=tv', 'format=yuv420p');
  ffmpeg(['-framerate', String(FPS), '-start_number', String(start), '-i', pattern, '-vf', chain.join(','), '-frames:v', String(clip.frames), '-r', String(FPS), '-c:v', 'libx264', '-qp', '0', '-preset', 'veryfast', ...BT709, out]);
  const got = Number(ffprobe(out).streams[0].nb_read_frames ?? ffprobeFrames(out));
  if (got !== clip.frames) throw new Error(`${clip.id}: ${got} frames, wanted ${clip.frames}`);
  return out;
}

function ffprobeFrames(file) {
  const r = ffmpegReport(['-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-']);
  return Number((r.match(/frame=\s*(\d+)/g) ?? []).pop()?.replace(/\D/g, '') ?? NaN);
}

/** Overlays: the captions, and the end card's layers coming on one after another. */
function overlays() {
  const list = [];
  edl.captions.forEach((c, i) => list.push({ file: join(CARDS, `caption-${String(i).padStart(2, '0')}.png`), at: c.at, end: c.end, fadeIn: c.fadeIn ?? 0.2, fadeOut: c.fadeOut ?? 0.25, rise: 16 }));
  const card = edl.clips.find((c) => c.card === 'title');
  if (card && edl.endCard) {
    const e = edl.endCard;
    for (const [name, delay, fade] of [['scrim', e.scrimAt ?? 0, 0.6], ['logo', e.logoAt ?? 0.3, 0.5], ['tagline', e.taglineAt ?? 1.1, 0.4], ['cta', e.ctaAt ?? 1.8, 0.4]]) {
      list.push({ file: join(CARDS, `title-${name}.png`), at: card.at + delay, end: edl.seconds, fadeIn: fade, fadeOut: 0, rise: name === 'scrim' ? 0 : 12 });
    }
  }
  for (const o of list) if (!existsSync(o.file)) throw new Error(`No card ${o.file}: run "node promo/cards.mjs"`);
  return list;
}

function assemble(segments, audio) {
  const listFile = join(SEGMENTS, 'list.txt');
  writeFileSync(listFile, segments.map((s) => `file '${s}'`).join('\n') + '\n');
  const over = overlays();
  const inputs = ['-f', 'concat', '-safe', '0', '-i', listFile];
  const graph = [];
  let last = '0:v';
  over.forEach((o, i) => {
    const dur = o.end - o.at;
    inputs.push('-loop', '1', '-framerate', String(FPS), '-t', dur.toFixed(4), '-i', o.file);
    const fades = [`fade=t=in:st=0:d=${o.fadeIn}:alpha=1`];
    if (o.fadeOut > 0) fades.push(`fade=t=out:st=${(dur - o.fadeOut).toFixed(4)}:d=${o.fadeOut}:alpha=1`);
    graph.push(`[${i + 1}:v]format=rgba,${fades.join(',')},setpts=PTS+${o.at.toFixed(4)}/TB[c${i}]`);
    // The words settle upward a few pixels as they come on.
    const y = o.rise ? `'if(lt(t-${o.at.toFixed(4)},0.4),${o.rise}*pow(1-(t-${o.at.toFixed(4)})/0.4,2),0)'` : '0';
    graph.push(`[${last}][c${i}]overlay=x=0:y=${y}:eof_action=pass:enable='between(t,${o.at.toFixed(4)},${o.end.toFixed(4)})'[v${i}]`);
    last = `v${i}`;
  });
  const tail = draft ? `scale=960:540:flags=bicubic,format=yuv420p` : 'format=yuv420p';
  graph.push(`[${last}]${tail}[vout]`);
  const maps = ['-map', '[vout]'];
  if (audio) {
    inputs.push('-i', audio);
    maps.push('-map', `${over.length + 1}:a`);
  }
  const video = draft
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22']
    : ['-c:v', 'libx264', '-profile:v', 'high', '-level:v', '4.2', '-preset', 'slow', '-crf', String(edl.encode.crf), '-maxrate', edl.encode.maxrate, '-bufsize', edl.encode.bufsize, '-g', String(FPS * 2), '-bf', '2'];
  ffmpeg([
    ...inputs,
    '-filter_complex', graph.join(';'),
    ...maps,
    ...video, '-pix_fmt', 'yuv420p', '-r', String(FPS), ...BT709,
    ...(audio ? ['-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '320k', '-ar', '48000', '-ac', '2'] : []),
    '-t', String(edl.seconds), '-movflags', '+faststart', MASTER,
  ]);
}

/** The silent loop: five seconds of a shot whose end is dissolved into its start, so it repeats without a seam. */
function hookLoop() {
  const l = edl.loop;
  if (!l) return null;
  const { pattern } = framePattern(join(OUT, 'frames', l.shot));
  const start = Math.round(l.in * FPS);
  const n = Math.round(l.seconds * FPS);
  const f = Math.round((l.dissolve ?? 0.5) * FPS);
  const out = join(OUT, 'hook-loop.mp4');
  const src = `-framerate ${FPS} -start_number`.split(' ');
  ffmpeg([
    ...src, String(start + f), '-i', pattern,
    ...src, String(start), '-i', pattern,
    '-filter_complex', `[0:v]trim=end_frame=${n},setpts=PTS-STARTPTS[a];[1:v]trim=end_frame=${f},setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=${f / FPS}:offset=${(n - f) / FPS},scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]`,
    '-map', '[v]', '-frames:v', String(n), '-an', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', String(FPS), ...BT709, '-movflags', '+faststart', out,
  ]);
  return out;
}

/** Checks on the master: the specs, the loudness, a frame every half second to look at, and sync on the hits. */
function check() {
  rmSync(QA, { recursive: true, force: true });
  mkdirSync(QA, { recursive: true });
  const probe = ffprobe(MASTER);
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const frames = ffprobeFrames(MASTER);
  const loud = ffmpegReport(['-i', MASTER, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const tail = loud.slice(loud.lastIndexOf('Summary:'));
  const num = (re) => Number((tail.match(re) ?? [])[1]);
  const stats = ffmpegReport(['-i', MASTER, '-af', 'astats=metadata=0:measure_perchannel=none', '-f', 'null', '-']);
  const stat = (label) => (stats.match(new RegExp(`${label}:\\s+(\\S+)`)) ?? [])[1];
  const facts = {
    file: MASTER,
    seconds: Number(probe.format.duration),
    videoSeconds: Number(v.duration),
    audioSeconds: Number(a.duration),
    frames,
    size: `${v.width}x${v.height}`,
    fps: v.avg_frame_rate,
    constantFps: v.avg_frame_rate === v.r_frame_rate,
    codec: `${v.codec_name} ${v.profile} L${v.level / 10}`,
    pixFmt: v.pix_fmt,
    videoMbps: Math.round(Number(v.bit_rate) / 1e4) / 100,
    audio: `${a.codec_name} ${a.profile} ${a.channels}ch ${a.sample_rate} Hz ${Math.round(Number(a.bit_rate) / 1000)} kbps`,
    megabytes: Math.round(Number(probe.format.size) / 1e4) / 100,
    lufs: num(/I:\s+(-?[\d.]+) LUFS/),
    loudnessRange: num(/LRA:\s+(-?[\d.]+) LU/),
    truePeakDb: num(/Peak:\s+(-?[\d.]+) dBFS/),
    samplePeakDb: Number(stat('Peak level dB')),
    faststart: (() => {
      const r = spawnSync('head', ['-c', '200', MASTER]);
      return r.stdout.includes('moov') || r.stdout.indexOf('moov') >= 0;
    })(),
  };
  const fails = [];
  const expect = (ok, what) => ok || fails.push(what);
  expect(Math.abs(facts.frames - edl.seconds * FPS) <= 1, `frames: ${facts.frames}`);
  expect(Math.abs(facts.seconds - edl.seconds) <= 1 / FPS + 0.022, `duration: ${facts.seconds}`);
  expect(facts.size === `${WIDTH}x${HEIGHT}`, `size: ${facts.size}`);
  expect(v.codec_name === 'h264' && v.profile === 'High' && v.pix_fmt === 'yuv420p', `codec: ${facts.codec} ${facts.pixFmt}`);
  expect(facts.constantFps && v.avg_frame_rate === `${FPS}/1`, `frame rate: ${v.avg_frame_rate} / ${v.r_frame_rate}`);
  expect(a.codec_name === 'aac' && a.profile === 'LC' && a.channels === 2 && a.sample_rate === '48000', `audio: ${facts.audio}`);
  expect(Math.abs(facts.lufs - edl.mix.lufs) <= 1, `loudness: ${facts.lufs} LUFS`);
  expect(facts.truePeakDb <= -1, `true peak: ${facts.truePeakDb} dBTP`);
  expect(facts.faststart, 'moov atom not at the front');
  // A frame every half second, as contact sheets, and the same at the size of a small store player.
  ffmpeg(['-i', MASTER, '-vf', `fps=2,scale=640:360,tile=6x5:padding=4:color=0x202020`, '-q:v', '3', join(QA, 'sheet-%02d.jpg')]);
  ffmpeg(['-i', MASTER, '-lavfi', 'showspectrumpic=s=1800x600:legend=1:scale=log:fscale=log:start=30:stop=18000', join(QA, 'spectrum.png')]);
  ffmpeg(['-i', MASTER, '-lavfi', 'showwavespic=s=1800x400:split_channels=1:colors=0x5cc8ff|0xffc45c', join(QA, 'waves.png')]);
  // No frame of the master with part of the picture gone dark for that frame alone.
  const dropouts = scan(MASTER).bad.map((b) => b.frame);
  expect(dropouts.length === 0, `glitched frames in the master: ${dropouts.join(', ')}`);
  facts.glitchedFrames = dropouts.length;
  // Picture against sound on the moments the game drew and voiced in the same frame.
  const sync = checkSync(MASTER);
  const worst = Math.max(0, ...sync.map((r) => Math.abs(r.soundAfterPictureMs)));
  expect(sync.length >= 3, `sync: only ${sync.length} moments to check`);
  expect(worst <= 34, `sync: sound and picture ${worst} ms apart`);
  facts.syncChecked = sync.length;
  facts.syncWorstMs = worst;
  writeFileSync(join(QA, 'facts.json'), JSON.stringify({ ...facts, fails }, null, 1) + '\n');
  console.log(facts);
  if (fails.length) console.error(`CHECKS FAILED:\n  ${fails.join('\n  ')}`);
  else console.log('All checks passed.');
  return fails;
}

if (!pictureOnly) {
  run('cards.mjs');
  run('audio.mjs');
} else if (!existsSync(CARDS)) run('cards.mjs');
rmSync(SEGMENTS, { recursive: true, force: true });
mkdirSync(SEGMENTS, { recursive: true });
const segments = edl.clips.map((c) => {
  const s = segment(c);
  console.log(`${String(c.index).padStart(2)} ${c.id.padEnd(14)} ${c.at.toFixed(3).padStart(7)} – ${c.end.toFixed(3).padStart(7)}  ${String(c.frames).padStart(4)} frames  ${c.plate ?? c.shot} from ${c.in}s${c.speed !== 1 ? ` ×${c.speed}` : ''}`);
  return s;
});
const audio = join(OUT, 'audio', 'master.wav');
assemble(segments, existsSync(audio) ? audio : null);
console.log(`Wrote ${MASTER}`);
if (!draft) {
  const loop = hookLoop();
  if (loop) console.log(`Wrote ${loop}`);
  const fails = check();
  if (fails.length) process.exit(1);
}
