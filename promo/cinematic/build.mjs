// Builds the cinematic cut, "The Stars Are Real", from the captured shots, the narration, the
// score and the sound design, as promo/cinematic/edl.json says.
//
//   node promo/cinematic/build.mjs            everything: cards, soundtrack, picture, master, checks
//   node promo/cinematic/build.mjs --picture  the picture and master only (cards and soundtrack as they are)
//   node promo/cinematic/build.mjs --uhd      also a 3840×2160 copy for upload (YouTube gives 4K uploads a better stream)
//
// Out: promo/out/starman-reborn-cinematic.mp4 and promo/out/cinematic/ (stems, cards, qa).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, loudness, master, renderStems } from '../audio.mjs';
import { HEIGHT, OUT, WIDTH } from '../lib/harness.mjs';
import { ffmpeg, ffmpegReport, ffprobe } from '../lib/media.mjs';
import { scan } from '../scan.mjs';
import { checkSync } from '../sync.mjs';
import { ASSETS, readScript } from './voice.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = join(OUT, 'cinematic');
const AUDIO = join(WORK, 'audio');
const CARDS = join(WORK, 'cards');
const QA = join(WORK, 'qa');
const MASTER = join(OUT, 'starman-reborn-cinematic.mp4');
const RATE = 48_000;
const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const GRADES = { none: null, pop: 'eq=contrast=1.05:saturation=1.1' };

/** The EDL, its times read: seconds, or "b25" (bar 25 of the score), "b25:3" (its third beat), with "+0.2" or "-0.2" after either. */
export function loadCut(path = join(HERE, 'edl.json')) {
  const edl = JSON.parse(readFileSync(path, 'utf8'));
  const fps = edl.fps;
  const beat = 60 / edl.bpm;
  const time = (v) => {
    let s = v;
    if (typeof v === 'string') {
      const m = /^b(\d+)(?::([\d.]+))?([+-][\d.]+)?$/.exec(v);
      if (!m) throw new Error(`Bad time in the EDL: ${v}`);
      s = (Number(m[1]) - 1) * beat * 4 + (m[2] ? (Number(m[2]) - 1) * beat : 0) + (m[3] ? Number(m[3]) : 0);
    }
    return Math.round(s * fps) / fps;
  };
  let cursor = 0;
  const clips = edl.clips.map((c, index) => {
    const at = cursor;
    const end = time(c.to);
    if (end <= at) throw new Error(`Clip ${c.id} ends at ${end}, before it starts`);
    cursor = end;
    return { ...c, index, at, end, dur: end - at, frames: Math.round(end * fps) - Math.round(at * fps), speed: 1, in: c.in ?? 0 };
  });
  if (Math.abs(cursor - edl.seconds) > 1e-6) throw new Error(`The clips end at ${cursor} s, not at ${edl.seconds} s`);
  const timed = (list) => (list ?? []).map((x) => ({ ...x, at: time(x.at), ...(x.to !== undefined ? { to: time(x.to) } : {}), ...(x.until !== undefined ? { until: time(x.until) } : {}) }));
  return { ...edl, clips, stamps: timed(edl.stamps), vo: timed(edl.vo), design: timed(edl.design), time };
}

function ffprobeFrames(file) {
  const r = ffmpegReport(['-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-']);
  return Number((r.match(/frame=\s*(\d+)/g) ?? []).pop()?.replace(/\D/g, '') ?? NaN);
}

// ------------------------------------------------------------------------------------- sound

/** The narration as one stem: each line where the EDL puts it, then the whole brought to its loudness. */
function voiceStem(cut, script) {
  const set = script.voice.use;
  const dir = join(ASSETS, 'vo', set);
  const lines = cut.vo.map((v) => {
    const meta = JSON.parse(readFileSync(join(dir, `${v.id}.json`), 'utf8'));
    return { ...v, file: join(dir, `${v.id}.wav`), from: v.at + meta.from, to: v.at + meta.to, text: meta.text, words: meta.words.map((w) => ({ word: w.word, at: Math.round((v.at + w.start) * 100) / 100 })) };
  });
  lines.forEach((l, i) => {
    if (i && l.from < lines[i - 1].to + 0.15) throw new Error(`Narration ${l.id} starts before ${lines[i - 1].id} has finished`);
    if (l.to > cut.seconds - 0.5) throw new Error(`Narration ${l.id} runs past the end`);
  });
  const raw = join(AUDIO, 'vo-raw.wav');
  // A voice chain as a dubbing mixer would set it: rumble off, evened out, a little presence, a small room.
  const chain = 'highpass=f=75,acompressor=threshold=-22dB:ratio=2.6:attack=6:release=140:makeup=2,equalizer=f=3400:t=q:w=1.1:g=2.5,equalizer=f=220:t=q:w=1:g=-1.5';
  ffmpeg([
    ...lines.flatMap((l) => ['-i', l.file]),
    '-filter_complex',
    `${lines.map((l, i) => `[${i}:a]${chain},adelay=${Math.round(l.at * 1000)}:all=1[v${i}]`).join(';')};${lines.map((_, i) => `[v${i}]`).join('')}amix=inputs=${lines.length}:normalize=0,aformat=channel_layouts=stereo,apad=whole_dur=${cut.seconds},atrim=0:${cut.seconds}[a]`,
    '-map', '[a]', '-ar', String(RATE), '-c:a', 'pcm_f32le', raw,
  ]);
  // The room: two short, quiet reflections so the voice sits in the picture's space instead of on top of it.
  const roomed = join(AUDIO, 'vo-room.wav');
  ffmpeg(['-i', raw, '-af', 'aecho=1:1:43|71:0.14|0.09', '-ar', String(RATE), '-c:a', 'pcm_f32le', roomed]);
  const gain = cut.mix.voLufs - loudness(roomed).integrated;
  const out = join(AUDIO, 'vo.wav');
  ffmpeg(['-i', roomed, '-af', `volume=${gain.toFixed(2)}dB`, '-ar', String(RATE), '-c:a', 'pcm_f32le', out]);
  writeFileSync(join(AUDIO, 'vo.json'), JSON.stringify({ set, voice: script.voice.sets[set].name, model: script.voice.sets[set].model, lines: lines.map(({ id, at, from, to, text, words }) => ({ id, at, from: Math.round(from * 100) / 100, to: Math.round(to * 100) / 100, text, words })) }, null, 1) + '\n');
  return { file: out, lines };
}

/** The sound design as one stem: each sound placed by the moment the EDL names (its start, its loudest point, its end). */
function designStem(cut) {
  const dir = join(ASSETS, 'sfx');
  const facts = JSON.parse(readFileSync(join(dir, 'sfx.json'), 'utf8'));
  const items = cut.design.map((d) => {
    const f = facts[d.id];
    if (!f) throw new Error(`No sound "${d.id}": run "node promo/cinematic/sfx.mjs"`);
    return { ...d, file: join(dir, `${d.id}.mp3`), start: d.at - f[d.align ?? 'startsAt'], seconds: f.seconds };
  });
  const parts = items.map((d, i) => {
    const chain = [];
    const skip = Math.max(0, -d.start);
    if (skip) chain.push(`atrim=start=${skip.toFixed(3)}`, 'asetpts=PTS-STARTPTS');
    const begin = Math.max(0, d.start);
    const length = d.until !== undefined ? d.until - begin : d.seconds - skip;
    if (d.until !== undefined) chain.push(`atrim=end=${length.toFixed(3)}`);
    if (d.fadeIn) chain.push(`afade=t=in:st=0:d=${d.fadeIn}`);
    if (d.fadeOut) chain.push(`afade=t=out:st=${Math.max(0, length - d.fadeOut).toFixed(3)}:d=${d.fadeOut}`);
    chain.push(`volume=${d.gain ?? 0}dB`, 'aformat=sample_fmts=fltp:channel_layouts=stereo', `aresample=${RATE}`, `adelay=${Math.round(begin * 1000)}:all=1`);
    return `[${i}:a]${chain.join(',')}[d${i}]`;
  });
  const out = join(AUDIO, 'design.wav');
  ffmpeg([
    ...items.flatMap((d) => ['-i', d.file]),
    '-filter_complex', `${parts.join(';')};${items.map((_, i) => `[d${i}]`).join('')}amix=inputs=${items.length}:normalize=0,apad=whole_dur=${cut.seconds},atrim=0:${cut.seconds}[a]`,
    '-map', '[a]', '-ar', String(RATE), '-c:a', 'pcm_f32le', out,
  ]);
  return out;
}

async function soundtrack(cut) {
  rmSync(AUDIO, { recursive: true, force: true });
  mkdirSync(AUDIO, { recursive: true });
  const script = readScript();
  const mix = cut.mix;
  // The game's own effects, engine and rooms, from the shots' cue sheets, through the game's mix chain.
  const plan = buildPlan({ clips: cut.clips, seconds: cut.seconds, hits: [], music: null }, join(HERE, 'cues'));
  console.log(plan.notes.join('\n'));
  writeFileSync(join(AUDIO, 'timeline.json'), JSON.stringify({ sfx: plan.sfx, engine: plan.engine, ambience: plan.ambience }, null, 1) + '\n');
  const game = await renderStems(plan, AUDIO);
  if (game.skipped) console.log(`${game.skipped} effects skipped by the game's own rate and voice limits`);
  const vo = voiceStem(cut, script);
  const design = designStem(cut);
  const music = join(ASSETS, 'music', `${script.music.use}.wav`);
  if (!existsSync(music)) throw new Error(`No score at ${music}: run "node promo/cinematic/score.mjs"`);
  const musicGain = mix.musicLufs - loudness(music).integrated;

  // The mix: the score and the effects step back under the voice; everything else at the EDL's levels.
  const st = 'aformat=sample_fmts=fltp:channel_layouts=stereo';
  const d = mix.duck;
  const duck = (label) => `sidechaincompress=threshold=${d.threshold}:ratio=${d.ratio}:attack=${d.attack}:release=${d.release}:makeup=1[${label}]`;
  // The score ridden like a fader: so many dB up or down at the times the EDL gives, straight lines between.
  const ride = mix.musicRide ?? [[0, 0]];
  const rideDb = ride.slice(0, -1).reduceRight((rest, [t0, g0], i) => {
    const [t1, g1] = ride[i + 1];
    return `if(lt(t,${t1}),${g0}+(${g1 - g0})*(t-${t0})/${t1 - t0},${rest})`;
  }, String(ride[ride.length - 1][1]));
  const graph = [
    `[0:a]${st},atrim=0:${cut.seconds},apad=whole_dur=${cut.seconds},volume=${(musicGain + mix.music).toFixed(2)}dB,volume=volume='pow(10,(${rideDb})/20)':eval=frame[m0]`,
    `[1:a]${st},volume=${mix.vo}dB,asplit=4[v][k1][k2][k3]`,
    `[2:a]${st},volume=${mix.sfx}dB[s0]`,
    `[3:a]${st},volume=${mix.engine}dB,highpass=f=70[e]`,
    `[4:a]${st},volume=${mix.ambience}dB[a]`,
    `[5:a]${st},volume=${mix.design}dB[d0]`,
    `[m0][k1]${duck('m')}`,
    `[s0][k2]${duck('s')}`,
    `[d0][k3]${duck('d')}`,
    `[m][v][s][e][a][d]amix=inputs=6:normalize=0[out]`,
  ].join(';');
  const premaster = join(AUDIO, 'mix.wav');
  ffmpeg(['-i', music, '-i', vo.file, '-i', game.files.sfx, '-i', game.files.engine, '-i', game.files.ambience, '-i', design, '-filter_complex', graph, '-map', '[out]', '-c:a', 'pcm_f32le', '-ar', String(RATE), premaster]);
  const out = join(AUDIO, 'master.wav');
  const m = master(premaster, out, { lufs: mix.lufs, truePeak: mix.truePeak, tailFade: mix.tailFade, seconds: cut.seconds });

  // The report: every stem's loudness, how far the score sits under each line of narration, and pictures.
  const lines = ['# Audio report (cinematic cut)', '', `Narration: ${script.voice.sets[script.voice.use].name} (${script.voice.sets[script.voice.use].model}). Score: ${script.music.use}. Master gain into the limiter: ${m.gain.toFixed(2)} dB.`, '', '| Stem | Integrated (LUFS) | True peak (dBTP) |', '| --- | --- | --- |'];
  for (const [name, file] of [['music', music], ['vo', vo.file], ['game effects', game.files.sfx], ['engine', game.files.engine], ['rooms', game.files.ambience], ['sound design', design], ['mix', premaster], ['master', out]]) {
    const l = loudness(file);
    lines.push(`| ${name} | ${l.integrated} | ${l.truePeak} |`);
  }
  // Voice against everything else while each line is spoken, from the mix's own buses.
  const bed = join(AUDIO, 'bed.wav');
  ffmpeg(['-i', music, '-i', vo.file, '-i', game.files.sfx, '-i', game.files.engine, '-i', game.files.ambience, '-i', design, '-filter_complex', graph.replace('[m][v][s][e][a][d]amix=inputs=6', '[v]anullsink;[m][s][e][a][d]amix=inputs=5'), '-map', '[out]', '-c:a', 'pcm_f32le', '-ar', String(RATE), bed]);
  const level = (file, from, to) => {
    const r = ffmpegReport(['-ss', String(from), '-t', String(to - from), '-i', file, '-af', 'astats=metadata=0:measure_perchannel=none', '-f', 'null', '-']);
    return Number((r.match(/RMS level dB:\s+(-?[\d.]+|-inf)/) ?? [])[1]);
  };
  lines.push('', '| Line | From | To | Voice (dB RMS) | Everything else (dB RMS) | Voice above |', '| --- | --- | --- | --- | --- | --- |');
  const margins = [];
  for (const l of vo.lines) {
    const v = level(vo.file, l.from, l.to);
    const b = level(bed, l.from, l.to);
    margins.push(v - b);
    lines.push(`| ${l.id} "${l.text}" | ${l.from.toFixed(2)} | ${l.to.toFixed(2)} | ${v.toFixed(1)} | ${b.toFixed(1)} | ${(v - b).toFixed(1)} dB |`);
  }
  writeFileSync(join(AUDIO, 'report.md'), lines.join('\n') + '\n');
  console.log(lines.slice(4).join('\n'));
  ffmpeg(['-i', out, '-lavfi', 'showspectrumpic=s=1800x600:legend=1:scale=log:fscale=log:start=30:stop=18000', join(AUDIO, 'master-spectrum.png')]);
  ffmpeg(['-i', music, '-i', vo.file, '-i', game.files.sfx, '-i', design, '-filter_complex', '[0:a]showwavespic=s=1800x200:colors=0x5cc8ff[a];[1:a]showwavespic=s=1800x200:colors=0xffffff[b];[2:a]showwavespic=s=1800x200:colors=0xffc45c[c];[3:a]showwavespic=s=1800x200:colors=0xd69cff[d];[a][b][c][d]vstack=inputs=4', '-frames:v', '1', join(AUDIO, 'stems-waves.png')]);
  return { plan, margins };
}

// ----------------------------------------------------------------------------------- picture

function segment(cut, clip) {
  const src = join(OUT, 'shots', `${clip.shot}.mkv`);
  if (!existsSync(src)) throw new Error(`No footage for ${clip.shot}: run "node promo/capture.mjs ${clip.shot}"`);
  const fps = cut.fps;
  const have = ffprobeFrames(src);
  const start = Math.round(clip.in * fps);
  if (start + clip.frames > have) throw new Error(`${clip.id}: needs frames ${start}–${start + clip.frames} of ${clip.shot}, which has ${have}`);
  const chain = [`trim=start_frame=${start}:end_frame=${start + clip.frames}`, 'setpts=PTS-STARTPTS'];
  if (clip.zoom) {
    const z = clip.zoom;
    const n = Math.max(1, clip.frames - 1);
    const zoom = `(${z.from ?? 1}+(${(z.to ?? 1) - (z.from ?? 1)})*min(n,${n})/${n})`;
    chain.push(`scale=w='trunc(${WIDTH}*${zoom})*2':h='trunc(${HEIGHT}*${zoom})*2':eval=frame:flags=bicubic`, `crop=${WIDTH * 2}:${HEIGHT * 2}:x='(iw-${WIDTH * 2})*${z.x ?? 0.5}':y='(ih-${HEIGHT * 2})*${z.y ?? 0.5}'`, `scale=${WIDTH}:${HEIGHT}:flags=lanczos`);
  }
  const grade = GRADES[clip.grade ?? 'none'];
  if (grade) chain.push(grade);
  if (clip.fadeIn) chain.push(`fade=t=in:st=0:d=${clip.fadeIn.seconds}:color=${clip.fadeIn.color ?? 'black'}`);
  if (clip.fadeOut) chain.push(`fade=t=out:st=${(clip.frames / fps - clip.fadeOut.seconds).toFixed(4)}:d=${clip.fadeOut.seconds}:color=${clip.fadeOut.color ?? 'black'}`);
  chain.push('format=yuv420p');
  const out = join(WORK, 'segments', `${String(clip.index).padStart(2, '0')}-${clip.id}.mkv`);
  ffmpeg(['-i', src, '-vf', chain.join(','), '-frames:v', String(clip.frames), '-r', String(fps), '-c:v', 'libx264', '-qp', '0', '-preset', 'veryfast', ...BT709, out]);
  const got = ffprobeFrames(out);
  if (got !== clip.frames) throw new Error(`${clip.id}: ${got} frames, wanted ${clip.frames}`);
  return out;
}

function overlays(cut) {
  const list = cut.stamps.map((s, i) => ({ file: join(CARDS, `stamp-${String(i).padStart(2, '0')}.png`), at: s.at, end: s.to, fadeIn: 0.35, fadeOut: 0.45, slide: 18 }));
  const card = cut.clips.find((c) => c.card === 'title');
  if (card && cut.endCard) {
    const e = cut.endCard;
    for (const [name, delay, fade] of [['scrim', e.scrimAt, 0.7], ['logo', e.logoAt, 0.6], ['tagline', e.taglineAt, 0.5], ['cta', e.ctaAt, 0.5]]) list.push({ file: join(CARDS, `title-${name}.png`), at: card.at + delay, end: cut.seconds, fadeIn: fade, fadeOut: 0, slide: 0 });
  }
  for (const o of list) if (!existsSync(o.file)) throw new Error(`No card ${o.file}: run "node promo/cinematic/cards.mjs"`);
  return list;
}

function assemble(cut, segments, audio, out, uhd = false) {
  const fps = cut.fps;
  const listFile = join(WORK, 'segments', 'list.txt');
  writeFileSync(listFile, segments.map((s) => `file '${s}'`).join('\n') + '\n');
  const over = overlays(cut);
  const inputs = ['-f', 'concat', '-safe', '0', '-i', listFile];
  const graph = [];
  let last = '0:v';
  over.forEach((o, i) => {
    const dur = o.end - o.at;
    inputs.push('-loop', '1', '-framerate', String(fps), '-t', dur.toFixed(4), '-i', o.file);
    const fades = [`fade=t=in:st=0:d=${o.fadeIn}:alpha=1`];
    if (o.fadeOut > 0) fades.push(`fade=t=out:st=${(dur - o.fadeOut).toFixed(4)}:d=${o.fadeOut}:alpha=1`);
    graph.push(`[${i + 1}:v]format=rgba,${fades.join(',')},setpts=PTS+${o.at.toFixed(4)}/TB[c${i}]`);
    // A stamp slides in a few pixels from the left as it comes on.
    const x = o.slide ? `'if(lt(t-${o.at.toFixed(4)},0.5),-${o.slide}*pow(1-(t-${o.at.toFixed(4)})/0.5,2),0)'` : '0';
    graph.push(`[${last}][c${i}]overlay=x=${x}:y=0:eof_action=pass:enable='between(t,${o.at.toFixed(4)},${o.end.toFixed(4)})'[v${i}]`);
    last = `v${i}`;
  });
  graph.push(`[${last}]${uhd ? 'scale=3840:2160:flags=lanczos,' : ''}format=yuv420p[vout]`);
  const e = cut.encode;
  ffmpeg([
    ...inputs, '-i', audio,
    '-filter_complex', graph.join(';'),
    '-map', '[vout]', '-map', `${over.length + 1}:a`,
    '-c:v', 'libx264', '-profile:v', 'high', '-level:v', uhd ? '5.1' : '4.1', '-preset', 'slow', '-crf', String(uhd ? e.crf + 3 : e.crf), '-maxrate', uhd ? '80M' : e.maxrate, '-bufsize', uhd ? '160M' : e.bufsize, '-g', String(fps * 2), '-bf', '2',
    '-pix_fmt', 'yuv420p', '-r', String(fps), ...BT709,
    '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '320k', '-ar', '48000', '-ac', '2',
    '-t', String(cut.seconds), '-movflags', '+faststart', out,
  ]);
}

// ------------------------------------------------------------------------------------ checks

function check(cut, sound) {
  rmSync(QA, { recursive: true, force: true });
  mkdirSync(QA, { recursive: true });
  const fps = cut.fps;
  const probe = ffprobe(MASTER);
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const l = loudness(MASTER);
  const facts = {
    file: MASTER,
    seconds: Number(probe.format.duration),
    frames: ffprobeFrames(MASTER),
    size: `${v.width}x${v.height}`,
    fps: v.avg_frame_rate,
    codec: `${v.codec_name} ${v.profile}`,
    pixFmt: v.pix_fmt,
    videoMbps: Math.round(Number(v.bit_rate) / 1e4) / 100,
    audio: `${a.codec_name} ${a.profile} ${a.channels}ch ${a.sample_rate} Hz ${Math.round(Number(a.bit_rate) / 1000)} kbps`,
    megabytes: Math.round(Number(probe.format.size) / 1e4) / 100,
    lufs: l.integrated,
    loudnessRange: l.range,
    truePeakDb: l.truePeak,
    faststart: spawnSync('head', ['-c', '200', MASTER]).stdout.includes('moov'),
  };
  const fails = [];
  const expect = (ok, what) => ok || fails.push(what);
  expect(facts.frames === cut.seconds * fps, `frames: ${facts.frames}`);
  expect(Math.abs(facts.seconds - cut.seconds) <= 1 / fps + 0.022, `duration: ${facts.seconds}`);
  expect(facts.size === `${WIDTH}x${HEIGHT}`, `size: ${facts.size}`);
  expect(v.codec_name === 'h264' && v.profile === 'High' && v.pix_fmt === 'yuv420p', `codec: ${facts.codec} ${facts.pixFmt}`);
  expect(v.avg_frame_rate === `${fps}/1` && v.avg_frame_rate === v.r_frame_rate, `frame rate: ${v.avg_frame_rate} / ${v.r_frame_rate}`);
  expect(a.codec_name === 'aac' && a.profile === 'LC' && a.channels === 2 && a.sample_rate === '48000', `audio: ${facts.audio}`);
  expect(Math.abs(facts.lufs - cut.mix.lufs) <= 1, `loudness: ${facts.lufs} LUFS`);
  expect(facts.truePeakDb <= -1, `true peak: ${facts.truePeakDb} dBTP`);
  expect(facts.faststart, 'moov atom not at the front');
  const dropouts = scan(MASTER).bad.map((b) => b.frame);
  expect(dropouts.length === 0, `glitched frames in the master: ${dropouts.join(', ')}`);
  facts.glitchedFrames = dropouts.length;
  if (sound) {
    // Every line of narration clear of the bed, and the fight's blasts on their frames.
    facts.voiceAboveBedDb = Math.round(Math.min(...sound.margins) * 10) / 10;
    expect(facts.voiceAboveBedDb >= 6, `narration only ${facts.voiceAboveBedDb} dB above the bed at its closest`);
    const sync = checkSync(MASTER, { fps, plan: sound.plan, sfxStem: join(AUDIO, 'sfx.wav'), qa: QA, ids: ['explosion-large'], cuts: cut.clips.map((c) => c.at) });
    const worst = Math.max(0, ...sync.map((r) => Math.abs(r.soundAfterPictureMs)));
    facts.syncChecked = sync.length;
    facts.syncWorstMs = worst;
    expect(sync.length >= 3, `sync: only ${sync.length} moments to check`);
    expect(worst <= 2000 / fps + 5, `sync: sound and picture ${worst} ms apart`);
  }
  ffmpeg(['-i', MASTER, '-vf', 'fps=1,scale=640:360,tile=6x5:padding=4:color=0x202020', '-q:v', '3', join(QA, 'sheet-%02d.jpg')]);
  writeFileSync(join(QA, 'facts.json'), JSON.stringify({ ...facts, fails }, null, 1) + '\n');
  console.log(facts);
  if (fails.length) console.error(`CHECKS FAILED:\n  ${fails.join('\n  ')}`);
  else console.log('All checks passed.');
  return fails;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = new Set(process.argv.slice(2));
  const cut = loadCut();
  mkdirSync(WORK, { recursive: true });
  let sound = null;
  if (!args.has('--picture')) {
    const { renderCards } = await import('./cards.mjs');
    console.log(`${(await renderCards(cut)).length} cards`);
    sound = await soundtrack(cut);
  }
  rmSync(join(WORK, 'segments'), { recursive: true, force: true });
  mkdirSync(join(WORK, 'segments'), { recursive: true });
  const segments = cut.clips.map((c) => {
    const s = segment(cut, c);
    console.log(`${String(c.index).padStart(2)} ${c.id.padEnd(11)} ${c.at.toFixed(2).padStart(7)} – ${c.end.toFixed(2).padStart(7)}  ${String(c.frames).padStart(4)} frames  ${c.shot} from ${c.in}s`);
    return s;
  });
  const audio = join(AUDIO, 'master.wav');
  assemble(cut, segments, audio, MASTER);
  console.log(`Wrote ${MASTER}`);
  if (args.has('--uhd')) {
    const uhd = MASTER.replace('.mp4', '-2160p.mp4');
    assemble(cut, segments, audio, uhd, true);
    console.log(`Wrote ${uhd}`);
  }
  rmSync(join(WORK, 'segments'), { recursive: true, force: true });
  if (check(cut, sound).length) process.exit(1);
}
