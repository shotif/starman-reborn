// The cinematic trailer's score, from ElevenLabs' music model.
//
//   node promo/cinematic/music.mjs [<candidate> …]   compose the candidates named (default: the one script.json uses)
//   node promo/cinematic/music.mjs --all             every candidate in script.json
//   node promo/cinematic/music.mjs --analyse         measure the candidates already made (no calls)
//
// The score is asked for as a plan of sections with fixed lengths (script.json), so the edit knows
// where each section falls before a note exists. Nobody listens here: each candidate is measured
// instead (loudness section by section, where it peaks, its tempo) and drawn (waveform, spectrum).
// Out: promo/cinematic/assets/music/<candidate>.mp3, .wav, .json and .png. Kept local.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { credits, eleven } from '../lib/eleven.mjs';
import { FFMPEG, ffmpeg } from '../lib/media.mjs';
import { ASSETS, readScript } from './voice.mjs';

const DIR = join(ASSETS, 'music');
const RATE = 11_025;

/** Mono samples of a file at 11 kHz. */
function samples(file, filter = 'anull') {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-af', filter, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
}

const db = (x) => Math.round(20 * Math.log10(Math.max(x, 1e-6)) * 10) / 10;

/** Loudness through the piece, section by section, and its tempo. */
export function analyse(file, plan, filter) {
  const x = samples(file, filter);
  const seconds = x.length / RATE;
  const rms = (from, to) => {
    const a = Math.max(0, Math.round(from * RATE));
    const b = Math.min(x.length, Math.round(to * RATE));
    let sum = 0;
    for (let i = a; i < b; i++) sum += x[i] * x[i];
    return Math.sqrt(sum / Math.max(1, b - a));
  };
  const perSecond = Array.from({ length: Math.floor(seconds) }, (_, s) => db(rms(s, s + 1)));
  let t = 0;
  const sections = plan.sections.map((s) => {
    const from = t;
    t += s.duration_ms / 1000;
    return { name: s.section_name, from, to: t, rmsDb: db(rms(from, t)), firstSecondDb: db(rms(from, from + 1)), lastSecondDb: db(rms(t - 1, t)) };
  });
  // The loudest tenth of a second: the hit.
  let peakAt = 0;
  let peak = 0;
  for (let s = 0; s + 0.1 < seconds; s += 0.02) {
    const v = rms(s, s + 0.1);
    if (v > peak) {
      peak = v;
      peakAt = s;
    }
  }
  // Tempo: the lag at which the onset envelope (rises in energy, 10 ms hops) best repeats, 60–180 BPM.
  const hop = Math.round(RATE / 100);
  const env = [];
  for (let i = 0; i + hop < x.length; i += hop) {
    let sum = 0;
    for (let k = i; k < i + hop; k++) sum += x[k] * x[k];
    env.push(Math.sqrt(sum / hop));
  }
  const flux = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? v)));
  const tempoIn = (from, to) => {
    const a = Math.round(from * 100);
    const b = Math.min(flux.length, Math.round(to * 100));
    let best = 0;
    let bestLag = 0;
    for (let lag = 33; lag <= 100; lag++) {
      let sum = 0;
      for (let i = a; i + lag < b; i++) sum += flux[i] * flux[i + lag];
      // A little bias toward the middle, as lags of two beats score as well as one.
      if (sum > best) {
        best = sum;
        bestLag = lag;
      }
    }
    return bestLag ? Math.round((6000 / bestLag) * 10) / 10 : null;
  };
  /** The strongest onsets in a span: candidate hits to cut on. */
  const onsets = (from, to, n = 6) => {
    const a = Math.round(from * 100);
    const b = Math.min(flux.length, Math.round(to * 100));
    const picks = [];
    for (let i = a + 1; i < b - 1; i++) if (flux[i] > flux[i - 1] && flux[i] >= flux[i + 1]) picks.push({ t: i / 100, v: flux[i] });
    return picks.sort((p, q) => q.v - p.v).slice(0, n).sort((p, q) => p.t - q.t).map((p) => Math.round(p.t * 100) / 100);
  };
  return { seconds: Math.round(seconds * 100) / 100, peakAt: Math.round(peakAt * 100) / 100, peakDb: db(peak), overallDb: db(rms(0, seconds)), sections: sections.map((s) => ({ ...s, bpm: tempoIn(s.from, s.to), hits: onsets(s.from, s.to) })), perSecond };
}

async function compose(name, script) {
  const m = script.music;
  const c = m.candidates[name];
  if (!c) throw new Error(`No music candidate "${name}" in script.json`);
  mkdirSync(DIR, { recursive: true });
  const body = { model_id: c.model ?? m.model, composition_plan: c.plan ?? m.plan, seed: c.seed };
  if (body.model_id === 'music_v1') body.respect_sections_durations = true;
  const res = await eleven('/v1/music', { method: 'POST', body, query: { output_format: 'mp3_48000_320' } });
  const mp3 = join(DIR, `${name}.mp3`);
  writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
  return mp3;
}

function measure(name, script) {
  const mp3 = join(DIR, `${name}.mp3`);
  const wav = join(DIR, `${name}.wav`);
  ffmpeg(['-i', mp3, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', wav]);
  const a = analyse(wav, script.music.candidates[name].plan ?? script.music.plan);
  writeFileSync(join(DIR, `${name}.json`), JSON.stringify(a, null, 1) + '\n');
  ffmpeg(['-i', wav, '-filter_complex', '[0:a]asplit[a][b];[a]showwavespic=s=1800x300:colors=0x5cc8ff[w];[b]showspectrumpic=s=1800x500:legend=0:scale=log:fscale=log:start=30:stop=16000[s];[w][s]vstack', '-frames:v', '1', join(DIR, `${name}.png`)]);
  console.log(`\n${name}: ${a.seconds} s, overall ${a.overallDb} dB RMS, loudest moment at ${a.peakAt} s (${a.peakDb} dB)`);
  for (const s of a.sections) console.log(`  ${String(s.from).padStart(3)}–${String(s.to).padEnd(3)} ${s.name.padEnd(12)} ${String(s.rmsDb).padStart(6)} dB  (starts ${s.firstSecondDb}, ends ${s.lastSecondDb})  ~${s.bpm} BPM  hits ${s.hits.join(' ')}`);
  console.log('  per second: ' + a.perSecond.map((v) => Math.round(v)).join(' '));
  return a;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const script = readScript();
  const only = args.filter((a) => !a.startsWith('--'));
  const names = args.includes('--all') || (args.includes('--analyse') && !only.length) ? Object.keys(script.music.candidates) : only.length ? only : [script.music.use];
  if (!args.includes('--analyse')) {
    const before = await credits();
    for (const name of names) console.log(`composed ${await compose(name, script)}`);
    const after = await credits();
    console.log(`Credits used: ${after.used - before.used} (${after.left.toLocaleString('en')} left)`);
  }
  for (const name of names) if (existsSync(join(DIR, `${name}.mp3`))) measure(name, script);
}
