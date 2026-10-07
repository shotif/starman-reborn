// Builds the trailer's soundtrack from the game's own audio engine (src/audio), offline.
//
//   node promo/audio.mjs            stems, mix and master into promo/out/audio/, with a report
//   node promo/audio.mjs --seeds 12 the title theme rendered for seeds 1…12, with a table of how each plays
//
// Nothing is recorded: every sound is rendered again, faster than real time, through the game's mix
// chain (MixGraph: buses, reverb, limiter) in OfflineAudioContexts, in the same headless browser the
// picture is captured in. Four stems:
//   music     the EDL's mood on the game's MusicPlayer, its combat layer following the EDL's intensity
//   sfx       every sound the game asked for in the shots used (promo/cues/*.json), where the edit puts it,
//             and the EDL's hits and risers (the game's own effects, placed on cuts)
//   engine    the ship's engine, from the same cue sheets
//   ambience  the stations' room beds, for the docked shots
// The stems are mixed and mastered with ffmpeg to −14 LUFS integrated, true peak under −1 dBTP.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, OUT, PROMO, chromePath, ensureServer } from './lib/harness.mjs';
import { ffmpeg, ffmpegReport } from './lib/media.mjs';
import { loadEdl } from './lib/timeline.mjs';

const RATE = 48_000;
const DIR = join(OUT, 'audio');
/** Effects with a chord or pitched tones of their own, written in C: a tone up puts them in the theme's D. */
const IN_KEY = { 'jump-exit': 2 ** (2 / 12), 'lane-enter': 2 ** (2 / 12), 'lane-exit': 2 ** (2 / 12) };

/** Runs in the page: renders the stems of a plan and returns each as base64 WAV (16-bit PCM would clip a hot stem, so 32-bit float). */
async function renderInPage(plan) {
  const { MixGraph, DEFAULT_VOLUMES } = await import('/src/audio/graph.ts');
  const { MusicPlayer, LOOKAHEAD } = await import('/src/audio/music.ts');
  const { SfxPlayer } = await import('/src/audio/sfx.ts');
  const { EngineSound } = await import('/src/audio/engineSound.ts');
  const { AmbiencePlayer, AMBIENCE_LOOKAHEAD } = await import('/src/audio/ambience.ts');

  // The effects' small random detunes come from Math.random: seeded here, so a render repeats.
  const seeded = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const offline = (seconds) => {
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * plan.rate), plan.rate);
    const graph = new MixGraph(ctx);
    graph.apply(DEFAULT_VOLUMES, false, 0, 0.001);
    return { ctx, graph };
  };
  /** Steps a render: `each(t)` runs with the context suspended at t, every `step` seconds. */
  const stepped = (ctx, seconds, step, each) => {
    for (let i = 1; i * step < seconds; i++) {
      const at = i * step;
      void ctx.suspend(at).then(() => {
        each(at);
        void ctx.resume();
      });
    }
  };
  const wav = (buf, from = 0, seconds = buf.duration - from) => {
    const start = Math.round(from * buf.sampleRate);
    const n = Math.min(buf.length - start, Math.round(seconds * buf.sampleRate));
    const ch = buf.numberOfChannels;
    const out = new DataView(new ArrayBuffer(44 + n * ch * 4));
    const text = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    text(0, 'RIFF');
    out.setUint32(4, 36 + n * ch * 4, true);
    text(8, 'WAVEfmt ');
    out.setUint32(16, 16, true);
    out.setUint16(20, 3, true); // IEEE float
    out.setUint16(22, ch, true);
    out.setUint32(24, buf.sampleRate, true);
    out.setUint32(28, buf.sampleRate * ch * 4, true);
    out.setUint16(32, ch * 4, true);
    out.setUint16(34, 32, true);
    text(36, 'data');
    out.setUint32(40, n * ch * 4, true);
    const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
    for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 4) out.setFloat32(o, data[c][start + i], true);
    const bytes = new Uint8Array(out.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };

  const stems = {};

  if (plan.music) {
    const m = plan.music;
    // The mood's first bar starts 0.05 s after it is asked for; the pre-roll puts a bar line on the trailer's first frame.
    const lead = m.prerollBars * m.bar - 0.05;
    const total = lead + plan.seconds + 0.5;
    const { ctx, graph } = offline(total);
    const music = new MusicPlayer(ctx, graph.music, m.seed);
    music.setMood(m.mood, 0.5, 0);
    const points = m.intensity.map(([t, v]) => [t + lead, v]);
    const due = (t) => {
      while (points.length && points[0][0] <= t) music.setIntensity(points.shift()[1], Math.max(t, 0));
    };
    due(0);
    music.scheduleUntil(LOOKAHEAD);
    stepped(ctx, total, 0.05, (t) => {
      due(t + 0.05);
      music.scheduleUntil(t + LOOKAHEAD);
    });
    stems.music = wav(await ctx.startRendering(), lead, plan.seconds);
  }

  if (plan.sfx) {
    Math.random = seeded(plan.seed ?? 7);
    const total = plan.seconds + 0.5;
    const { ctx, graph } = offline(total);
    const sfx = new SfxPlayer(ctx, graph.sfx);
    const events = [...plan.sfx].sort((a, b) => a.t - b.t);
    const skipped = [];
    const due = (until) => {
      while (events.length && events[0].t < until) {
        const e = events.shift();
        if (!sfx.play(e.id, e.opts ?? {}, Math.max(0, e.t))) skipped.push(e);
      }
    };
    const step = 0.02;
    due(step);
    stepped(ctx, total, step, (t) => due(t + step));
    stems.sfx = wav(await ctx.startRendering(), 0, plan.seconds);
    stems.sfxSkipped = skipped.length;
  }

  if (plan.engine) {
    const total = plan.seconds + 0.5;
    const { ctx, graph } = offline(total);
    const engine = new EngineSound(ctx, graph.sfx.dry);
    const events = [...plan.engine].sort((a, b) => a.t - b.t);
    const due = (until) => {
      let last;
      while (events.length && events[0].t < until) last = events.shift();
      if (last) engine.update(last.state);
    };
    const step = 0.02;
    due(step);
    stepped(ctx, total, step, (t) => due(t + step));
    stems.engine = wav(await ctx.startRendering(), 0, plan.seconds);
  }

  if (plan.ambience) {
    const total = plan.seconds + 0.5;
    const { ctx, graph } = offline(total);
    const scape = new AmbiencePlayer(ctx, graph.sfx, plan.seed ?? 7);
    const events = [...plan.ambience].sort((a, b) => a.t - b.t);
    const due = (until, now) => {
      while (events.length && events[0].t < until) scape.setRoom(events.shift().room, now);
    };
    const step = 0.05;
    due(step, 0);
    scape.scheduleUntil(AMBIENCE_LOOKAHEAD);
    stepped(ctx, total, step, (t) => {
      due(t + step, t);
      scape.scheduleUntil(t + AMBIENCE_LOOKAHEAD);
    });
    stems.ambience = wav(await ctx.startRendering(), 0, plan.seconds);
  }
  return stems;
}

/** A page on the dev server (nothing of the game runs: only its audio modules are imported). */
async function withPage(fn) {
  const server = await ensureServer();
  const browser = await chromium.launch({ headless: true, executablePath: chromePath() });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('[page error]', e.message));
    await page.goto(`${BASE}/?test=1`);
    return await fn(page);
  } finally {
    await browser.close();
    server?.kill();
  }
}

/** Renders a plan's stems (see buildPlan) and writes each as <dir>/<name>.wav; returns their paths. */
export async function renderStems(plan, dir) {
  const stems = await withPage((page) => page.evaluate(renderInPage, plan));
  mkdirSync(dir, { recursive: true });
  const files = {};
  for (const name of ['music', 'sfx', 'engine', 'ambience']) {
    if (!stems[name]) continue;
    files[name] = join(dir, `${name}.wav`);
    writeFileSync(files[name], Buffer.from(stems[name], 'base64'));
  }
  return { files, skipped: stems.sfxSkipped ?? 0 };
}

/**
 * Masters a mix: gain into a limiter that works at four times the sample rate (so it holds the true
 * peak), the gain found by trial until the integrated loudness is on target; then the fade at the end.
 */
export function master(premaster, out, { lufs, truePeak, tailFade, seconds }) {
  const stereo = 'aformat=sample_fmts=fltp:channel_layouts=stereo';
  const ceiling = 10 ** (truePeak / 20);
  let gain = lufs - loudness(premaster).integrated;
  let got;
  for (let pass = 0; pass < 8; pass++) {
    ffmpeg([
      '-i', premaster,
      '-af', `${stereo},volume=${gain.toFixed(2)}dB,aresample=${RATE * 4},alimiter=limit=${ceiling.toFixed(4)}:attack=2:release=60:level=false,aresample=${RATE},afade=t=out:st=${seconds - tailFade}:d=${tailFade},apad=whole_dur=${seconds},atrim=0:${seconds}`,
      '-ar', String(RATE), '-c:a', 'pcm_s24le', out,
    ]);
    got = loudness(out);
    console.log(`master pass ${pass + 1}: gain ${gain.toFixed(2)} dB → ${got.integrated} LUFS, true peak ${got.truePeak} dBTP`);
    if (Math.abs(got.integrated - lufs) <= 0.1) break;
    gain += lufs - got.integrated;
  }
  return { gain, ...got };
}

/** Integrated loudness, range and true peak of a file (EBU R128). */
export function loudness(file) {
  const report = ffmpegReport(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const tail = report.slice(report.lastIndexOf('Summary:'));
  const num = (re) => Number((tail.match(re) ?? [])[1]);
  return { integrated: num(/I:\s+(-?[\d.]+) LUFS/), range: num(/LRA:\s+(-?[\d.]+) LU/), truePeak: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

function stats(file) {
  const report = ffmpegReport(['-i', file, '-af', 'astats=metadata=0:measure_perchannel=none', '-f', 'null', '-']);
  const num = (label) => Number((report.match(new RegExp(`${label}:\\s+(-?[\\d.]+|-inf)`)) ?? [])[1]);
  return { peakDb: num('Peak level dB'), rmsDb: num('RMS level dB'), clipped: num('Number of samples') ? undefined : undefined, flat: num('Flat factor') };
}

const save = (name, base64) => {
  mkdirSync(DIR, { recursive: true });
  const path = join(DIR, `${name}.wav`);
  writeFileSync(path, Buffer.from(base64, 'base64'));
  return path;
};

/** The render plan: where the edit puts every sound of the shots it uses. */
/**
 * `cuesDir` is where the shots' cue sheets are; an EDL without `music.mood` (the cinematic cut, whose
 * score is not the game's) gets no music stem, and its effects are left in the pitch the game plays them at.
 */
export function buildPlan(edl, cuesDir = join(PROMO, 'cues')) {
  const inKey = edl.music?.mood ? IN_KEY : {};
  const sfx = [];
  const engine = [];
  const ambience = [];
  const notes = [];
  for (const clip of edl.clips) {
    const sound = clip.sound ?? {};
    const path = clip.shot ? join(cuesDir, `${clip.shot}.json`) : null;
    if (!path || sound === false) {
      engine.push({ t: clip.at, state: null });
      ambience.push({ t: clip.at, room: null });
      continue;
    }
    if (!existsSync(path)) throw new Error(`No cue sheet for ${clip.shot}: capture it first`);
    const sheet = JSON.parse(readFileSync(path, 'utf8'));
    // Sheets from before the recorder took a frame off its stamps (see Recorder.finish) are a frame late.
    if (sheet.clock !== 'frame-start') for (const cue of sheet.cues) cue.t = Math.max(0, cue.t - 1 / sheet.fps);
    const from = clip.in;
    const to = clip.in + clip.dur * clip.speed;
    const place = (t) => clip.at + (t - from) / clip.speed;
    let used = 0;
    // The engine and the room as they stood when the clip begins, then their changes inside it.
    let engineState = null;
    let room = null;
    for (const cue of sheet.cues) {
      if (cue.t >= from) break;
      if (cue.kind === 'engine') engineState = cue.state;
      if (cue.kind === 'ambience') room = cue.room;
    }
    engine.push({ t: clip.at, state: sound.engine === false ? null : engineState });
    ambience.push({ t: clip.at, room: sound.ambience === false ? null : (sound.room ?? room) });
    for (const cue of sheet.cues) {
      if (cue.t < from || cue.t >= to) continue;
      if (cue.kind === 'sfx' && sound.sfx !== false && !(sound.mute ?? []).includes(cue.id)) {
        const opts = { ...cue.opts };
        if (inKey[cue.id]) opts.pitch = (opts.pitch ?? 1) * inKey[cue.id];
        if (sound.gain !== undefined) opts.volume = Math.min(1, (opts.volume ?? 1) * sound.gain);
        sfx.push({ t: place(cue.t), id: cue.id, opts, clip: clip.id });
        used++;
      } else if (cue.kind === 'engine' && sound.engine !== false) engine.push({ t: place(cue.t), state: cue.state });
      else if (cue.kind === 'ambience' && sound.ambience !== false) ambience.push({ t: place(cue.t), room: cue.room });
    }
    notes.push(`${clip.id.padEnd(14)} ${clip.shot.padEnd(12)} ${String(used).padStart(3)} effects`);
  }
  for (const h of edl.hits ?? []) {
    const opts = { volume: h.volume ?? 1, pan: h.pan ?? 0, pitch: h.pitch ?? inKey[h.id] ?? 1 };
    sfx.push({ t: h.at, id: h.id, opts, clip: 'hit' });
  }
  const m = edl.music;
  return {
    rate: RATE,
    seconds: edl.seconds,
    seed: 7,
    music: m?.mood ? { mood: m.mood, seed: m.seed, bar: edl.bar, prerollBars: m.prerollBars ?? 2, intensity: m.intensity } : null,
    sfx,
    engine,
    ambience,
    notes,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const seedsAt = args.indexOf('--seeds');
  const edl = loadEdl();
  if (seedsAt >= 0) {
    // The theme for a run of seeds: how loud each bar is, to choose one that opens well and keeps moving.
    const count = Number(args[seedsAt + 1] ?? 8);
    const m = edl.music;
    await withPage(async (page) => {
      for (let seed = 1; seed <= count; seed++) {
        const stems = await page.evaluate(renderInPage, { rate: RATE, seconds: edl.seconds, music: { mood: m.mood, seed, bar: edl.bar, prerollBars: m.prerollBars ?? 2, intensity: [] } });
        const file = save(`seed-${seed}`, stems.music);
        const report = ffmpegReport(['-i', file, '-af', `asetnsamples=${Math.round(edl.bar * RATE)},astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`, '-f', 'null', '-']);
        const bars = [...report.matchAll(/RMS_level=(-?[\d.]+)/g)].map((x) => Math.round(Number(x[1])));
        console.log(`seed ${String(seed).padStart(2)}  bars (dB RMS): ${bars.slice(0, 17).join(' ')}`);
      }
    });
    process.exit(0);
  }

  const plan = buildPlan(edl);
  console.log(plan.notes.join('\n'));
  console.log(`${plan.sfx.length} effects, ${plan.engine.length} engine changes, ${plan.ambience.length} room changes`);
  writeFileSync(join(PROMO, 'cues', 'timeline.json'), JSON.stringify({ sfx: plan.sfx, engine: plan.engine, ambience: plan.ambience, music: plan.music }, null, 1) + '\n');
  const stems = await withPage((page) => page.evaluate(renderInPage, plan));
  if (stems.sfxSkipped) console.log(`${stems.sfxSkipped} effects skipped by the game's own rate and voice limits`);
  const files = {};
  for (const name of ['music', 'sfx', 'engine', 'ambience']) files[name] = save(name, stems[name]);

  // The mix: the stems at the EDL's levels, the music ducked a little under the effects.
  const mix = edl.mix;
  const db = (x) => `${x}dB`;
  const stereo = 'aformat=sample_fmts=fltp:channel_layouts=stereo';
  const graph = [
    // The theme is mostly pad and drone, dark for small speakers: a little off the bottom and a lift on top.
    `[0:a]${stereo},highpass=f=40,bass=g=${mix.musicLow}:f=140:w=0.7,treble=g=${mix.musicHigh}:f=2200:w=0.6,volume=${db(mix.music)}[m]`,
    `[1:a]${stereo},volume=${db(mix.sfx)},asplit[s][sc]`,
    `[2:a]${stereo},volume=${db(mix.engine)},highpass=f=70[e]`,
    `[3:a]${stereo},volume=${db(mix.ambience)}[a]`,
    `[m][sc]sidechaincompress=threshold=${mix.duck.threshold}:ratio=${mix.duck.ratio}:attack=8:release=260:makeup=1[md]`,
    `[md][s][e][a]amix=inputs=4:normalize=0[out]`,
  ].join(';');
  const premaster = join(DIR, 'mix.wav');
  ffmpeg(['-i', files.music, '-i', files.sfx, '-i', files.engine, '-i', files.ambience, '-filter_complex', graph, '-map', '[out]', '-c:a', 'pcm_f32le', '-ar', String(RATE), premaster]);

  // The master: gain into a limiter (working at four times the sample rate, so it holds the true
  // peak), the gain found by trial until the loudness is on target; then the fade at the very end.
  const master = join(DIR, 'master.wav');
  const ceiling = 10 ** (mix.truePeak / 20);
  const fadeOut = `afade=t=out:st=${edl.seconds - mix.tailFade}:d=${mix.tailFade}`;
  let gain = mix.lufs - loudness(premaster).integrated;
  let got;
  for (let pass = 0; pass < 8; pass++) {
    ffmpeg([
      '-i', premaster,
      '-af', `${stereo},volume=${gain.toFixed(2)}dB,aresample=${RATE * 4},alimiter=limit=${ceiling.toFixed(4)}:attack=2:release=60:level=false,aresample=${RATE},${fadeOut},apad=whole_dur=${edl.seconds},atrim=0:${edl.seconds}`,
      '-ar', String(RATE), '-c:a', 'pcm_s24le', master,
    ]);
    got = loudness(master);
    console.log(`master pass ${pass + 1}: gain ${gain.toFixed(2)} dB → ${got.integrated} LUFS, true peak ${got.truePeak} dBTP`);
    if (Math.abs(got.integrated - mix.lufs) <= 0.1) break;
    gain += mix.lufs - got.integrated;
  }

  // The report: levels of every stem and the master, and pictures to look at.
  const lines = ['# Audio report', '', `Target: ${mix.lufs} LUFS integrated, true peak ≤ ${mix.truePeak} dBTP. Master gain into the limiter: ${gain.toFixed(2)} dB.`, '', '| File | Integrated (LUFS) | Range (LU) | True peak (dBTP) | Peak (dBFS) | RMS (dBFS) |', '| --- | --- | --- | --- | --- | --- |'];
  for (const [name, file] of [...Object.entries(files), ['mix', premaster], ['master', master]]) {
    const l = loudness(file);
    const s = stats(file);
    lines.push(`| ${name} | ${l.integrated} | ${l.range} | ${l.truePeak} | ${s.peakDb} | ${s.rmsDb} |`);
  }
  ffmpeg(['-i', master, '-lavfi', 'showspectrumpic=s=1800x600:legend=1:scale=log:fscale=log:start=30:stop=18000', join(DIR, 'master-spectrum.png')]);
  ffmpeg(['-i', master, '-lavfi', 'showwavespic=s=1800x400:split_channels=1:colors=0x5cc8ff|0xffc45c', join(DIR, 'master-waves.png')]);
  ffmpeg(['-i', files.music, '-i', files.sfx, '-i', files.engine, '-i', files.ambience, '-filter_complex', '[0:a]showwavespic=s=1800x200:colors=0x5cc8ff[a];[1:a]showwavespic=s=1800x200:colors=0xffc45c[b];[2:a]showwavespic=s=1800x200:colors=0x8fe08f[c];[3:a]showwavespic=s=1800x200:colors=0xd69cff[d];[a][b][c][d]vstack=inputs=4', '-frames:v', '1', join(DIR, 'stems-waves.png')]);
  writeFileSync(join(DIR, 'report.md'), lines.join('\n') + '\n');
  console.log(lines.slice(4).join('\n'));
}
