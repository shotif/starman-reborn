// "The Stars Are Real": the cinematic cut's score, written here and synthesised from nothing.
//
//   node promo/cinematic/score.mjs            render the stems and the mixed score
//   node promo/cinematic/score.mjs --measure  measure the score already rendered (no rendering)
//
// This stands in for a generated score: ElevenLabs' music model is not offered on the EU data
// centre this project's key belongs to. The piece follows the same plan of eight sections
// (script.json's music.plan, as bars at 90 beats a minute: 45 bars, 120 seconds), so a generated
// track made to that plan can take its place: put it in assets/music/ and name it in script.json.
//
// D minor, 4/4, 90 BPM. One theme (A–D–C–B♭ | A–F–G, then A–D–F–D | E–C–D), first on a piano, then
// horns, then full brass. Every sound is built in an OfflineAudioContext from oscillators, noise
// and filters, with a synthetic hall for reverb. No samples. Four stems are rendered (pads,
// melody, rhythm, percussion) and mixed with ffmpeg.
// Out: promo/cinematic/assets/music/score-own.wav (+ stems, .json, .png). Kept local.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromePath } from '../lib/harness.mjs';
import { ffmpeg } from '../lib/media.mjs';
import { analyse } from './music.mjs';
import { ASSETS, readScript } from './voice.mjs';

const DIR = join(ASSETS, 'music');
const RATE = 48_000;
export const BPM = 90;
export const BAR = (60 / BPM) * 4;
/** The sections, in bars: the same eight as script.json's plan. */
export const SECTIONS = [
  ['Void', 5],
  ['First light', 8],
  ['Outbound', 6],
  ['Trade winds', 5],
  ['Battle', 6],
  ['Stillness', 5],
  ['Collapse', 5],
  ['Afterglow', 5],
];
export const SECONDS = SECTIONS.reduce((a, [, bars]) => a + bars, 0) * BAR;

/** Runs in the page: renders one stem into window.__pcm (interleaved stereo float) and returns its length. */
async function renderStem({ group, rate, seconds, bpm, seed }) {
  const ctx = new OfflineAudioContext(2, Math.ceil((seconds + 2) * rate), rate);
  const beat = 60 / bpm;
  const bar = beat * 4;
  /** The time of a beat of a bar, both counted from one. */
  const T = (b, bt = 1) => (b - 1) * bar + (bt - 1) * beat;
  let rs = seed >>> 0;
  const rnd = () => (rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296;
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  const N = (name) => {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
    return 12 * (Number(m[3]) + 1) + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  };
  /** A little unevenness in time and force, as players have. */
  const human = (t, amount = 0.006) => Math.max(0, t + (rnd() * 2 - 1) * amount);
  const vary = (v, amount = 0.08) => v * (1 + (rnd() * 2 - 1) * amount);

  // ------------------------------------------------------------------ the hall
  const hall = (len, tau, dark) => {
    const n = Math.round(len * rate);
    const buf = ctx.createBuffer(2, n, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let y = 0;
      const pre = Math.round(0.018 * rate);
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / rate;
        // Darker as it dies: a one-pole low-pass whose corner falls with time.
        const k = Math.exp(-2 * Math.PI * Math.max(900, dark * Math.exp(-t / 1.3)) / rate);
        y = (1 - k) * (rnd() * 2 - 1) + k * y;
        d[i] = y * Math.exp(-t / tau) * (t < 0.08 ? t / 0.08 : 1);
      }
      // A few early reflections.
      for (const [ms, g] of [[11, 0.5], [23, 0.35], [37, 0.3], [53, 0.22]]) d[Math.round(((ms + c * 3) / 1000) * rate)] += g * 0.6;
    }
    return buf;
  };
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const rev = ctx.createConvolver();
  rev.buffer = group === 'perc' ? hall(5.5, 0.95, 7000) : hall(4.2, 0.72, 9000);
  const revOut = ctx.createGain();
  revOut.gain.value = 0.5;
  rev.connect(revOut).connect(out);
  /** A bus: so much straight to the output, so much to the hall. */
  const bus = (dry, wet) => {
    const g = ctx.createGain();
    const d = ctx.createGain();
    d.gain.value = dry;
    const w = ctx.createGain();
    w.gain.value = wet;
    g.connect(d).connect(out);
    g.connect(w).connect(rev);
    return g;
  };

  const noiseBuf = ctx.createBuffer(1, rate * 3, rate);
  {
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
  }
  const noise = (t, dur) => {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.start(t, rnd() * 2.5);
    s.stop(t + dur);
    return s;
  };
  const filt = (type, freq, q = 0.7) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  };
  const pan = (v) => {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, v));
    return p;
  };
  const drive = (amount) => {
    const w = ctx.createWaveShaper();
    const c = new Float32Array(1025);
    for (let i = 0; i < 1025; i++) c[i] = Math.tanh(((i - 512) / 512) * amount) / Math.tanh(amount);
    w.curve = c;
    w.oversample = '2x';
    return w;
  };

  // ------------------------------------------------------------------ the instruments
  /** Sustained strings (or any pad): detuned saws either side, a slow bow, vibrato once the note has settled. */
  const pad = (dest, midi, t, dur, level, o = {}) => {
    const { attack = 0.9, release = 1.6, cutoff = 1900, voices = 3, spread = 0.75, vib = 5, wave = 'sawtooth', hp = 90, trem = 0 } = o;
    const hold = Math.max(dur, attack + 0.05);
    const end = t + hold + release;
    const lp = filt('lowpass', cutoff * 0.45, 0.5);
    lp.frequency.setValueAtTime(cutoff * 0.45, t);
    lp.frequency.linearRampToValueAtTime(cutoff, t + attack);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, t + hold);
    g.gain.linearRampToValueAtTime(0, end);
    let tail = lp.connect(filt('highpass', hp)).connect(g);
    if (trem) {
      // Tremolo: the bow shivering.
      const tg = ctx.createGain();
      tg.gain.value = 1 - trem / 2;
      const l = ctx.createOscillator();
      l.frequency.value = 8.5 + rnd();
      const lg = ctx.createGain();
      lg.gain.value = trem / 2;
      l.connect(lg).connect(tg.gain);
      l.start(t);
      l.stop(end + 0.1);
      tail = tail.connect(tg);
    }
    tail.connect(dest);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.7 + rnd() * 0.9;
    const lfoG = ctx.createGain();
    lfoG.gain.setValueAtTime(0, t);
    lfoG.gain.linearRampToValueAtTime(vib, t + attack + 0.5);
    lfo.connect(lfoG);
    lfo.start(t);
    lfo.stop(end + 0.1);
    for (let i = 0; i < voices * 2; i++) {
      const osc = ctx.createOscillator();
      osc.type = wave;
      osc.frequency.value = hz(midi);
      osc.detune.value = (rnd() * 2 - 1) * 10 + (i % 2 ? 5 : -5);
      lfoG.connect(osc.detune);
      const og = ctx.createGain();
      og.gain.value = 1 / (voices * 2);
      osc.connect(og).connect(pan((i % 2 ? 1 : -1) * spread * (0.35 + 0.65 * rnd()))).connect(lp);
      osc.start(t);
      osc.stop(end + 0.1);
    }
  };
  /** A short bowed note (spiccato): the ostinato's voice. */
  const spicc = (dest, midi, t, level, len = 0.1, where = 0) => {
    const f = hz(midi);
    const lp = filt('lowpass', Math.min(9000, f * 9), 1.1);
    lp.frequency.setValueAtTime(Math.min(9000, f * 9), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 2.2), t + len * 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.006);
    g.gain.exponentialRampToValueAtTime(level * 0.001, t + len * 2.3);
    lp.connect(g).connect(pan(where)).connect(dest);
    for (const cents of [-8, 0, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = cents + (rnd() * 2 - 1) * 3;
      const og = ctx.createGain();
      og.gain.value = 0.34;
      osc.connect(og).connect(lp);
      osc.start(t);
      osc.stop(t + len * 2.5);
    }
    const bow = noise(t, 0.04);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(level * 0.22, t);
    bg.gain.exponentialRampToValueAtTime(level * 0.002, t + 0.035);
    bow.connect(filt('bandpass', 3400, 1)).connect(bg).connect(g);
  };
  /** Horns, and with `bright` up, trumpets and trombones: saws through a filter that opens with the breath. */
  const brass = (dest, midi, t, dur, level, o = {}) => {
    const { bright = 1, attack = 0.07, release = 0.22, where = 0, voices = 3, edge = 0 } = o;
    const f = hz(midi);
    const open = Math.min(9000, (700 + f * 2.2) * bright);
    const lp = filt('lowpass', 250 + f * 0.5, 1.1);
    lp.frequency.setValueAtTime(250 + f * 0.5, t);
    lp.frequency.linearRampToValueAtTime(open, t + attack + 0.03);
    lp.frequency.setTargetAtTime(open * 0.7, t + attack + 0.05, 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setTargetAtTime(level * 0.82, t + attack, 0.5);
    g.gain.setValueAtTime(level * 0.82, t + Math.max(dur, attack + 0.02));
    g.gain.linearRampToValueAtTime(0, t + Math.max(dur, attack + 0.02) + release);
    const end = t + Math.max(dur, attack) + release + 0.05;
    let chain = lp;
    if (edge) chain = lp.connect(drive(1 + edge * 2.5));
    chain.connect(g).connect(pan(where)).connect(dest);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.1;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(4, t + 0.6);
    lfo.connect(lg);
    lfo.start(t);
    lfo.stop(end);
    for (let i = 0; i < voices; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = (i - (voices - 1) / 2) * 6 + (rnd() * 2 - 1) * 2;
      lg.connect(osc.detune);
      const og = ctx.createGain();
      og.gain.value = 0.9 / voices;
      osc.connect(og).connect(lp);
      osc.start(t);
      osc.stop(end);
    }
  };
  /** A wordless choir: saws and breath through the three formants of "ah". */
  const choir = (dest, midi, t, dur, level, o = {}) => {
    const { attack = 0.7, release = 1.4, where = 0 } = o;
    const hold = Math.max(dur, attack + 0.05);
    const end = t + hold + release;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, t + hold);
    g.gain.linearRampToValueAtTime(0, end);
    g.connect(pan(where)).connect(dest);
    const src = ctx.createGain();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.3 + rnd() * 0.5;
    const lg = ctx.createGain();
    lg.gain.value = 9;
    lfo.connect(lg);
    lfo.start(t);
    lfo.stop(end);
    for (const cents of [-11, -3, 4, 12]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz(midi);
      osc.detune.value = cents;
      lg.connect(osc.detune);
      const og = ctx.createGain();
      og.gain.value = 0.25;
      osc.connect(og).connect(src);
      osc.start(t);
      osc.stop(end);
    }
    const breath = noise(t, end - t);
    const bg = ctx.createGain();
    bg.gain.value = 0.05;
    breath.connect(bg).connect(src);
    for (const [freq, q, gain] of [[730, 6, 1], [1090, 8, 0.5], [2440, 10, 0.28]]) {
      const fg = ctx.createGain();
      fg.gain.value = gain;
      src.connect(filt('bandpass', freq, q)).connect(fg).connect(g);
    }
    const body = ctx.createGain();
    body.gain.value = 0.35;
    src.connect(filt('lowpass', 520, 0.7)).connect(body).connect(g);
  };
  const pianoWave = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.5, 0.28, 0.16, 0.09, 0.05, 0.025]));
  /** A felt piano: a struck harmonic tone that darkens as it rings. */
  const piano = (dest, midi, t, level, dur = 3) => {
    const f = hz(midi);
    const tau = 0.75 + Math.max(0, 84 - midi) * 0.035;
    const lp = filt('lowpass', Math.min(8000, f * 7), 0.6);
    lp.frequency.setValueAtTime(Math.min(8000, f * (4 + 5 * level)), t);
    lp.frequency.setTargetAtTime(f * 2.2, t + 0.01, 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.004, tau);
    g.gain.setTargetAtTime(0, t + dur, 0.12);
    lp.connect(g).connect(pan((midi - 66) / 40)).connect(dest);
    for (const cents of [-1.6, 1.4]) {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(pianoWave);
      osc.frequency.value = f;
      osc.detune.value = cents;
      const og = ctx.createGain();
      og.gain.value = 0.5;
      osc.connect(og).connect(lp);
      osc.start(t);
      osc.stop(t + dur + 1);
    }
    const thump = noise(t, 0.03);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(level * 0.16, t);
    tg.gain.exponentialRampToValueAtTime(level * 0.001, t + 0.025);
    thump.connect(filt('lowpass', 1100, 0.7)).connect(tg).connect(g);
  };
  /** A far-off bell. */
  const bell = (dest, midi, t, level, where = 0) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, 1.1);
    g.connect(pan(where)).connect(dest);
    for (const [ratio, gain] of [[1, 1], [2.76, 0.32], [5.4, 0.1]]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = hz(midi) * ratio;
      const og = ctx.createGain();
      og.gain.value = gain;
      osc.connect(og).connect(g);
      osc.start(t);
      osc.stop(t + 6);
    }
  };
  /** The floor: a sine, and a little of the octave above so small speakers find it. */
  const sub = (dest, midi, t, dur, level, attack = 1.5, release = 2.5) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, t + Math.max(dur, attack));
    g.gain.linearRampToValueAtTime(0, t + Math.max(dur, attack) + release);
    g.connect(dest);
    for (const [mul, type, gain] of [[1, 'sine', 1], [2, 'triangle', 0.22], [3, 'sine', 0.06]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz(midi) * mul;
      const og = ctx.createGain();
      og.gain.value = gain;
      osc.connect(og).connect(g);
      osc.start(t);
      osc.stop(t + Math.max(dur, attack) + release + 0.1);
    }
  };
  /** A big drum: a skin that drops in pitch as it is struck, and the slap of the stick. */
  const taiko = (dest, t, level, low = false) => {
    for (const [side, late] of [[-0.22, 0], [0.24, 0.007]]) {
      const at = t + late;
      const f0 = (low ? 92 : 128) * (1 + (rnd() * 2 - 1) * 0.03);
      const f1 = low ? 37 : 51;
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(f0, at);
      osc.frequency.exponentialRampToValueAtTime(f1, at + 0.09);
      osc.frequency.exponentialRampToValueAtTime(f1 * 0.86, at + 1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level * 0.6, at + 0.003);
      g.gain.exponentialRampToValueAtTime(level * 0.0008, at + (low ? 1.7 : 0.95));
      osc.connect(g).connect(pan(side)).connect(dest);
      osc.start(at);
      osc.stop(at + (low ? 1.8 : 1));
      const slap = noise(at, 0.09);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(level * 0.42, at);
      sg.gain.exponentialRampToValueAtTime(level * 0.001, at + 0.07);
      const sf = filt('lowpass', 1500, 0.8);
      sf.frequency.setValueAtTime(1500, at);
      sf.frequency.exponentialRampToValueAtTime(280, at + 0.07);
      slap.connect(sf).connect(sg).connect(pan(side)).connect(dest);
    }
  };
  const snare = (dest, t, level) => {
    const n = noise(t, 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(level * 0.001, t + 0.11);
    n.connect(filt('bandpass', 1900, 0.8)).connect(g).connect(dest);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(205, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.06);
    const og = ctx.createGain();
    og.gain.setValueAtTime(level * 0.5, t);
    og.gain.exponentialRampToValueAtTime(level * 0.001, t + 0.07);
    osc.connect(og).connect(dest);
    osc.start(t);
    osc.stop(t + 0.1);
  };
  const crash = (dest, t, level, dur = 3.2) => {
    const n = noise(t, dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.004, dur / 4.5);
    n.connect(filt('highpass', 3200, 0.5)).connect(filt('lowpass', 11000, 0.5)).connect(g).connect(dest);
  };
  /** A cymbal or noise swell that grows until it is cut off. */
  const swell = (dest, t, dur, level, from = 2500, to = 7000) => {
    const n = noise(t, dur + 0.05);
    const f = filt('bandpass', from, 0.7);
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level * 0.004, t);
    g.gain.exponentialRampToValueAtTime(level, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
    n.connect(f).connect(g).connect(dest);
  };
  /** A riser: a cluster of saws climbing an octave under the swell. */
  const riser = (dest, midi, t, dur, level) => {
    const lp = filt('lowpass', 300, 1.5);
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(5000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level * 0.01, t);
    g.gain.exponentialRampToValueAtTime(level, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
    lp.connect(g).connect(dest);
    for (const cents of [-18, -6, 5, 17]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(hz(midi), t);
      osc.frequency.exponentialRampToValueAtTime(hz(midi + 12), t + dur);
      osc.detune.value = cents;
      const og = ctx.createGain();
      og.gain.value = 0.25;
      osc.connect(og).connect(lp);
      osc.start(t);
      osc.stop(t + dur + 0.1);
    }
  };
  /** The blow under a hit: a sine falling out of hearing. */
  const boom = (dest, t, level, dur = 4) => {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(72, t);
    osc.frequency.exponentialRampToValueAtTime(27, t + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.005);
    g.gain.setTargetAtTime(0, t + 0.05, dur / 4);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.5);
    const thud = noise(t, 0.6);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(level * 0.7, t);
    tg.gain.exponentialRampToValueAtTime(level * 0.001, t + 0.5);
    thud.connect(filt('lowpass', 240, 0.7)).connect(tg).connect(dest);
  };
  /** Low brass overblown: the trailer's "braam". */
  const braam = (dest, midi, t, level, dur = 3) => {
    const lp = filt('lowpass', 160, 1.4);
    lp.frequency.setValueAtTime(160, t);
    lp.frequency.exponentialRampToValueAtTime(1500, t + 0.22);
    lp.frequency.setTargetAtTime(420, t + 0.25, dur / 3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.04);
    g.gain.setTargetAtTime(0, t + 0.3, dur / 3.2);
    const growl = ctx.createOscillator();
    growl.frequency.value = 27;
    const gg = ctx.createGain();
    gg.gain.value = level * 0.18;
    growl.connect(gg).connect(g.gain);
    growl.start(t);
    growl.stop(t + dur + 1);
    const pre = ctx.createGain();
    pre.gain.value = 0.9;
    pre.connect(drive(3)).connect(lp).connect(g).connect(dest);
    for (const [semi, gain] of [[0, 1], [7, 0.5], [-12, 0.8], [12, 0.35]]) {
      for (const cents of [-22, -7, 6, 19]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = hz(midi + semi);
        osc.detune.value = cents;
        const og = ctx.createGain();
        og.gain.value = gain * 0.12;
        osc.connect(og).connect(pan(cents / 30)).connect(pre);
        osc.start(t);
        osc.stop(t + dur + 1);
      }
    }
  };

  // ------------------------------------------------------------------ the piece
  const CH = {
    Dm: ['D2', 'D3', 'A3', 'D4', 'F4', 'A4'],
    Bb: ['Bb1', 'Bb2', 'F3', 'Bb3', 'D4', 'F4'],
    F: ['F2', 'F3', 'C4', 'F4', 'A4', 'C5'],
    C: ['C2', 'C3', 'G3', 'C4', 'E4', 'G4'],
    Gm: ['G1', 'G2', 'D3', 'G3', 'Bb3', 'D4'],
    A: ['A1', 'A2', 'E3', 'A3', 'C#4', 'E4'],
    As: ['A1', 'A2', 'E3', 'A3', 'D4', 'E4'],
    D: ['D2', 'D3', 'A3', 'D4', 'F#4', 'A4'],
  };
  // The theme, as [note, beat, beats long]: four bars and their answer.
  const THEME_A = [[['A4', 1, 3], ['D5', 4, 1]], [['C5', 1, 2], ['Bb4', 3, 2]], [['A4', 1, 3], ['F4', 4, 1]], [['G4', 1, 4]]];
  const THEME_B = [[['A4', 1, 3], ['D5', 4, 1]], [['F5', 1, 2], ['D5', 3, 2]], [['E5', 1, 3], ['C5', 4, 1]], [['D5', 1, 4]]];
  const S = { void: 1, light: 6, outbound: 14, trade: 20, battle: 25, still: 31, collapse: 36, hit: 41, end: 46 };

  if (group === 'pads') {
    const strings = bus(0.7, 0.6);
    const high = bus(0.45, 0.9);
    const voices = bus(0.6, 0.75);
    const floor = bus(1, 0.05);
    const chord = (name, b, bars, level, o = {}, from = 1, to = 5) => {
      for (const n of CH[name].slice(from, to + 1)) pad(strings, N(n), human(T(b), 0.02), bars * bar - (o.gap ?? 0.15), vary(level), o);
    };
    // Void: the floor, an open fifth far down, a shimmer far up.
    sub(floor, N('D1'), 0.2, T(S.outbound) - 0.2, 0.035, 5, 4);
    pad(strings, N('D2'), T(2, 3), T(S.light) - T(2, 3) + 2, 0.05, { attack: 5, cutoff: 900, vib: 2 });
    pad(strings, N('A2'), T(3, 1), T(S.light) - T(3, 1) + 2, 0.045, { attack: 5, cutoff: 1000, vib: 2 });
    pad(high, N('A5'), T(1, 3), T(S.light) - T(1, 3), 0.045, { attack: 5, cutoff: 5200, trem: 0.5, hp: 600 });
    pad(high, N('D5'), T(1, 1), T(S.light) - T(1, 1), 0.03, { attack: 4, cutoff: 3000, trem: 0.3, hp: 400 });
    pad(high, N('D6'), T(3, 3), T(S.light) - T(3, 3), 0.032, { attack: 5, cutoff: 6000, trem: 0.5, hp: 800 });
    // First light: strings come in under the piano's third bar and grow.
    ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'C', 'Dm'].forEach((c, i) => {
      if (i >= 2) chord(c, S.light + i, 1, 0.03 + 0.008 * i, { attack: 1.1, cutoff: 1300 + 120 * i }, 1, 4);
    });
    // Outbound: full chords, the bass walking with them, a line climbing over the last two bars.
    ['Dm', 'Bb', 'F', 'C', 'Bb', 'C'].forEach((c, i) => {
      chord(c, S.outbound + i, 1, 0.075 + 0.006 * i, { attack: 0.5, cutoff: 2100 });
      sub(floor, N(CH[c][0]) + 12, T(S.outbound + i), bar - 0.3, 0.07, 0.15, 0.3);
    });
    [['D5', 18, 1], ['E5', 18, 3], ['F5', 19, 1], ['G5', 19, 3]].forEach(([n, b, bt]) => pad(high, N(n), T(b, bt), beat * 2, 0.045, { attack: 0.35, cutoff: 4200, hp: 300, release: 0.6 }));
    // Trade winds: held chords over the ostinato, an A held high as the tension comes on.
    ['Dm', 'Dm', 'Bb', 'Bb', 'A'].forEach((c, i) => {
      chord(c, S.trade + i, 1, 0.07 + 0.012 * i, { attack: 0.4, cutoff: 2300 + 250 * i });
      sub(floor, N(CH[c][0]) + 12, T(S.trade + i), bar - 0.2, 0.08, 0.1, 0.25);
    });
    pad(high, N('A5'), T(22), bar * 3 - 0.1, 0.05, { attack: 2.5, cutoff: 5200, trem: 0.6, hp: 500, release: 0.1 });
    // Battle: everything, with a choir on the chords.
    ['Dm', 'Bb', 'F', 'C', 'Dm', 'A'].forEach((c, i) => {
      chord(c, S.battle + i, 1, 0.13, { attack: 0.12, cutoff: 3600, release: i === 5 ? 0.12 : 0.5, gap: i === 5 ? 0.02 : 0.15 });
      for (const n of CH[c].slice(2, 6)) choir(voices, N(n) + (i % 2 ? 0 : 0), T(S.battle + i), bar - 0.1, 0.085, { attack: 0.18, release: i === 5 ? 0.1 : 0.5, where: (rnd() * 2 - 1) * 0.7 });
      sub(floor, N(CH[c][0]) + 12, T(S.battle + i), bar - 0.1, 0.12, 0.03, 0.15);
    });
    // Stillness: thin high air, far away.
    ['Dm', 'Bb', 'F', 'Gm', 'As'].forEach((c, i) => {
      for (const n of CH[c].slice(2, 5)) pad(strings, N(n) + 12, T(S.still + i) + (i ? 0 : beat * 2), bar * (i ? 1 : 0.5) + 0.6, 0.03, { attack: 1.4, release: 2, cutoff: 2400, hp: 260, vib: 3 });
      sub(floor, N(CH[c][0]) + 12, T(S.still + i) + (i ? 0 : beat * 2), bar, 0.025, 1, 1.2);
    });
    // Collapse: the chords climb and swell, choir and strings together, to the hit.
    ['Dm', 'Bb', 'Gm', 'A', 'A'].forEach((c, i) => {
      const level = 0.07 + 0.03 * i;
      const last = i === 4;
      chord(c, S.collapse + i, 1, level, { attack: 0.5, cutoff: 2400 + 500 * i, release: last ? 0.05 : 0.6, gap: last ? 0 : 0.1 });
      for (const n of CH[c].slice(2, 6)) choir(voices, N(n) + (i >= 2 ? 12 : 0), T(S.collapse + i), bar - (last ? 0 : 0.1), level * 0.9, { attack: 0.5, release: last ? 0.05 : 0.6, where: (rnd() * 2 - 1) * 0.7 });
      sub(floor, N(CH[c][0]) + 12, T(S.collapse + i), bar - 0.05, 0.09 + 0.02 * i, 0.2, last ? 0.03 : 0.3);
    });
    pad(high, N('A5'), T(39), bar * 2 - 0.02, 0.09, { attack: 3.5, cutoff: 6500, trem: 0.7, hp: 500, release: 0.04 });
    pad(high, N('E6'), T(40), bar - 0.02, 0.07, { attack: 2.2, cutoff: 7000, trem: 0.7, hp: 700, release: 0.04 });
    // The hit: one D minor chord, struck and let go.
    for (const n of CH.Dm) pad(strings, N(n), T(S.hit), 0.5, 0.2, { attack: 0.02, release: 1.4, cutoff: 4200 });
    for (const n of CH.Dm.slice(2)) choir(voices, N(n), T(S.hit), 0.5, 0.14, { attack: 0.03, release: 1.6 });
    sub(floor, N('D1'), T(S.hit), 3, 0.16, 0.01, 5);
    // Afterglow: D major, very quietly.
    for (const n of CH.D.slice(1, 6)) pad(strings, N(n), T(42, 3), T(S.end) - T(42, 3) - 3.2, 0.036, { attack: 2.6, release: 3.6, cutoff: 1500, vib: 3 });
    pad(high, N('A5'), T(43), T(S.end) - T(43) - 3, 0.012, { attack: 3, release: 3.2, cutoff: 5000, trem: 0.4, hp: 600 });
    sub(floor, N('D1'), T(42, 3), T(S.end) - T(42, 3) - 3.5, 0.03, 3, 3.5);
  }

  if (group === 'melody') {
    const keys = bus(0.8, 0.55);
    const far = bus(0.35, 1);
    const horns = bus(0.7, 0.6);
    const trumpets = bus(0.8, 0.45);
    const play = (theme, b0, each) => theme.forEach((notes, i) => notes.forEach(([n, bt, len]) => each(N(n), T(b0 + i, bt), len * beat)));
    // Void: three bells, a long way off.
    bell(far, N('D5'), T(3, 1), 0.1, -0.3);
    bell(far, N('A5'), T(4, 3), 0.08, 0.35);
    bell(far, N('F5'), T(5, 3), 0.07, 0);
    // First light: the theme on a piano, a broken chord under it.
    const left = { Dm: ['D2', 'A2', 'D3', 'F3'], Bb: ['Bb1', 'F2', 'Bb2', 'D3'], F: ['F2', 'C3', 'F3', 'A3'], C: ['C2', 'G2', 'C3', 'E3'] };
    ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'C', 'Dm'].forEach((c, i) => {
      [0, 1, 2, 3, 2, 3, 2, 1].forEach((k, e) => piano(keys, N(left[c][k]), human(T(S.light + i, 1 + e / 2)), vary(e === 0 ? 0.11 : 0.06), beat * 1.5));
    });
    play(THEME_A, S.light, (m, t, d) => piano(keys, m, human(t), vary(0.2), d + 0.6));
    play(THEME_B, S.light + 4, (m, t, d) => piano(keys, m, human(t), vary(0.23), d + 0.6));
    // Outbound: horns take the theme, an octave down.
    play(THEME_A, S.outbound, (m, t, d) => {
      brass(horns, m - 12, human(t, 0.01), d - 0.06, 0.3, { where: -0.25, bright: 1.15 });
      brass(horns, m - 12, human(t, 0.014), d - 0.06, 0.2, { where: 0.3, bright: 1 });
    });
    // …and swell over the two bars that climb.
    [['Bb3', 18], ['D4', 18], ['C4', 19], ['E4', 19], ['G4', 19]].forEach(([n, b]) => brass(horns, N(n), T(b), bar - 0.1, b === 19 ? 0.17 : 0.13, { attack: 0.9, where: (rnd() * 2 - 1) * 0.5 }));
    // Trade winds: horn swells on each chord, growing; the dominant is trumpets.
    ['Dm', 'Dm', 'Bb', 'Bb', 'A'].forEach((c, i) => {
      for (const n of CH[c].slice(2, 5)) brass(horns, N(n), T(S.trade + i), bar - 0.12, 0.07 + 0.03 * i, { attack: 0.7, bright: 1 + 0.12 * i, where: (rnd() * 2 - 1) * 0.5 });
    });
    for (const n of ['A3', 'C#4', 'E4', 'A4']) brass(trumpets, N(n), T(24), bar - 0.03, 0.14, { attack: 1.8, bright: 1.9, release: 0.03, edge: 0.4, where: (rnd() * 2 - 1) * 0.5 });
    // Battle: the theme in full brass, in a soldier's rhythm, with stabs off the beat.
    const march = [
      [['A4', 1, 1.5], ['A4', 2.5, 0.5], ['D5', 3, 2]],
      [['C5', 1, 1.5], ['D5', 2.5, 0.5], ['Bb4', 3, 2]],
      [['A4', 1, 1.5], ['C5', 2.5, 0.5], ['F5', 3, 2]],
      [['E5', 1, 1.5], ['D5', 2.5, 0.5], ['C5', 3, 1], ['E5', 4, 1]],
      [['F5', 1, 1.5], ['E5', 2.5, 0.5], ['D5', 3, 2]],
      [['A4', 1, 1], ['C#5', 2, 1], ['E5', 3, 1], ['A5', 4, 0.95]],
    ];
    play(march, S.battle, (m, t, d) => {
      brass(trumpets, m, human(t, 0.008), d - 0.08, 0.3, { bright: 2.1, edge: 0.6, attack: 0.045, where: 0.2 });
      brass(trumpets, m - 12, human(t, 0.008), d - 0.08, 0.26, { bright: 1.7, edge: 0.5, attack: 0.05, where: -0.25 });
    });
    ['Dm', 'Bb', 'F', 'C', 'Dm', 'A'].forEach((c, i) => {
      for (const bt of [2.5, 4.5]) for (const n of CH[c].slice(1, 4)) brass(horns, N(n), human(T(S.battle + i, bt), 0.008), 0.16, 0.2, { bright: 1.8, attack: 0.03, release: 0.08, edge: 0.5, where: (rnd() * 2 - 1) * 0.6 });
      brass(horns, N(CH[c][0]) + 12, T(S.battle + i), bar - 0.1, 0.22, { bright: 1.5, edge: 0.7, attack: 0.05, where: 0 });
    });
    // Stillness: the theme again on the piano, alone, with gaps in it.
    [['A4', 32, 1, 3], ['D5', 32, 4, 1.4], ['C5', 33, 1, 2], ['Bb4', 33, 3, 2.2], ['A4', 34, 1, 3], ['G4', 34, 4, 1.4], ['A4', 35, 1, 4]].forEach(([n, b, bt, len]) => piano(keys, N(n), human(T(b, bt)), vary(0.24), len * beat + 1));
    [['D3', 32], ['Bb2', 33], ['G2', 34], ['A2', 35]].forEach(([n, b]) => piano(keys, N(n), human(T(b)), 0.1, bar));
    // Collapse: brass in long notes, climbing.
    [['A4', 36, 1, 4], ['Bb4', 37, 1, 2], ['D5', 37, 3, 2], ['D5', 38, 1, 2], ['G5', 38, 3, 2], ['E5', 39, 1, 4], ['E5', 40, 1, 2], ['A5', 40, 3, 2]].forEach(([n, b, bt, len], i) => {
      const level = 0.2 + 0.02 * i;
      const last = b === 40 && bt === 3;
      brass(trumpets, N(n), T(b, bt), len * beat - (last ? 0 : 0.06), level, { bright: 1.8 + 0.08 * i, edge: 0.5, attack: 0.09, release: last ? 0.03 : 0.2, where: 0.2 });
      brass(horns, N(n) - 12, T(b, bt), len * beat - (last ? 0 : 0.06), level * 0.9, { bright: 1.5, edge: 0.4, attack: 0.1, release: last ? 0.03 : 0.2, where: -0.3 });
    });
    ['Dm', 'Bb', 'Gm', 'A', 'A'].forEach((c, i) => brass(horns, N(CH[c][0]) + 12, T(S.collapse + i), bar - (i === 4 ? 0 : 0.06), 0.2 + 0.03 * i, { bright: 1.4 + 0.1 * i, edge: 0.7, attack: 0.08, release: i === 4 ? 0.03 : 0.2 }));
    // The hit.
    for (const n of ['D3', 'A3', 'D4', 'F4', 'A4', 'D5']) brass(trumpets, N(n), T(S.hit), 0.35, 0.3, { bright: 2.3, edge: 0.8, attack: 0.02, release: 0.5, where: (rnd() * 2 - 1) * 0.6 });
    // Afterglow: the theme's first step, three notes, and the major third it never had.
    [['A4', 43, 1], ['D5', 43, 3], ['F#5', 44, 1]].forEach(([n, b, bt]) => piano(keys, N(n), T(b, bt), 0.15, 6));
    piano(keys, N('D3'), T(44, 3), 0.1, 6);
    bell(far, N('D6'), T(45, 1), 0.03, 0.2);
  }

  if (group === 'rhythm') {
    const section = bus(0.85, 0.32);
    const low = bus(0.95, 0.12);
    const eighths = (c, b, level) => {
      const [, r] = CH[c];
      const seq = [0, 7, 12, 7, 0, 7, 12, 7];
      seq.forEach((semi, e) => spicc(section, N(r) + semi, human(T(b, 1 + e / 2), 0.005), vary(level * (e % 4 === 0 ? 1.15 : 0.85)), 0.11, e % 2 ? 0.25 : -0.25));
    };
    const sixteenths = (c, b, level, grow = 0) => {
      const [, r] = CH[c];
      const seq = [0, 0, 12, 0, 7, 0, 12, 0];
      for (let s = 0; s < 16; s++) {
        const accent = s % 4 === 0 ? 1.2 : s % 2 === 0 ? 0.95 : 0.72;
        spicc(section, N(r) + seq[s % 8], human(T(b, 1 + s / 4), 0.004), vary(level * accent * (1 + (grow * s) / 16)), 0.075, s % 2 ? 0.3 : -0.3);
        // The violas double the accents an octave up.
        if (s % 4 === 0) spicc(section, N(r) + 12 + (s % 8 ? 7 : 0), human(T(b, 1 + s / 4), 0.004), vary(level * 0.5), 0.08, 0.5);
      }
    };
    const pulse = (c, b, level) => {
      for (let e = 0; e < 8; e++) {
        const m = N(CH[c][0]) + 12;
        spicc(low, m, human(T(b, 1 + e / 2), 0.004), vary(level * (e % 2 ? 0.75 : 1)), 0.13, 0);
        sub(low, m, T(b, 1 + e / 2), 0.12, level * 0.5, 0.008, 0.1);
      }
    };
    ['Dm', 'Bb', 'F', 'C', 'Bb', 'C'].forEach((c, i) => eighths(c, S.outbound + i, 0.18 + 0.015 * i));
    ['Dm', 'Dm', 'Bb', 'Bb', 'A'].forEach((c, i) => {
      sixteenths(c, S.trade + i, 0.14 + 0.03 * i, i === 4 ? 0.5 : 0);
      pulse(c, S.trade + i, 0.13 + 0.02 * i);
    });
    ['Dm', 'Bb', 'F', 'C', 'Dm', 'A'].forEach((c, i) => {
      sixteenths(c, S.battle + i, 0.26, i === 5 ? 0.4 : 0);
      pulse(c, S.battle + i, 0.24);
    });
    ['Dm', 'Bb', 'Gm', 'A', 'A'].forEach((c, i) => {
      sixteenths(c, S.collapse + i, 0.11 + 0.03 * i, i === 4 ? 0.6 : 0);
      pulse(c, S.collapse + i, 0.14 + 0.03 * i);
    });
    // The climb: the strings walk up the scale in octaves, a note to a beat.
    ['D4', 'E4', 'F4', 'G4', 'A4', 'Bb4', 'C5', 'D5', 'D5', 'E5', 'F5', 'G5'].forEach((n, i) => {
      for (const up of [0, 12]) pad(section, N(n) + up, T(S.collapse, 1 + i), beat - 0.04, 0.05 + 0.006 * i, { attack: 0.08, release: 0.1, cutoff: 3800, voices: 2, vib: 3 });
    });
  }

  if (group === 'perc') {
    const drums = bus(0.9, 0.42);
    const metal = bus(0.6, 0.5);
    const big = bus(0.9, 0.6);
    const grid = (b, velocities, level, lowOn = [0, 8]) => velocities.forEach((v, s) => v && taiko(drums, human(T(b, 1 + s / 4), 0.004), vary(level * v), lowOn.includes(s)));
    const roll = (t0, dur, per, from, to) => {
      const n = Math.round(dur / per);
      for (let i = 0; i < n; i++) {
        const k = i / Math.max(1, n - 1);
        taiko(drums, t0 + i * per + (rnd() * 2 - 1) * 0.003, from + (to - from) * k * k, i % 4 === 0);
      }
    };
    const hit = (t, level, note = 'D1') => {
      taiko(drums, t, level * 0.7, true);
      taiko(drums, t + 0.011, level * 0.55, true);
      taiko(drums, t + 0.02, level * 0.5, false);
      boom(big, t, level * 0.4);
      braam(big, N(note) + 12, t, level * 0.36, 3.2);
      crash(metal, t, level * 0.16, 3.6);
    };
    // Outbound: a soft drum on one and three, a pick-up from the third bar.
    for (let i = 0; i < 6; i++) {
      taiko(drums, T(S.outbound + i), 0.2 + 0.015 * i, true);
      taiko(drums, T(S.outbound + i, 3), 0.13 + 0.015 * i, false);
      if (i >= 2) taiko(drums, T(S.outbound + i, 4.5), 0.1 + 0.015 * i, false);
    }
    swell(metal, T(19), bar, 0.06);
    roll(T(19, 3), beat * 2, beat / 4, 0.05, 0.22);
    // Trade winds: the pattern fills in bar by bar, then rolls into the battle.
    grid(20, [1, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0], 0.3);
    grid(21, [1, 0, 0, 0, 0, 0, 0.6, 0, 0.8, 0, 0, 0, 0.7, 0, 0, 0], 0.32);
    grid(22, [1, 0, 0, 0, 0, 0, 0.6, 0, 0.8, 0, 0, 0, 0.7, 0, 0.6, 0], 0.35);
    grid(23, [1, 0, 0.5, 0, 0, 0, 0.7, 0, 0.9, 0, 0.5, 0, 0.8, 0, 0.7, 0.5], 0.38);
    roll(T(24), beat * 2, beat / 2, 0.3, 0.42);
    roll(T(24, 3), beat * 2, beat / 4, 0.3, 0.6);
    for (let s = 0; s < 16; s++) snare(drums, T(24, 3) + (s * beat) / 8, 0.03 + 0.012 * s);
    swell(metal, T(23), bar * 2, 0.12);
    riser(big, N('D3'), T(23), bar * 2, 0.1);
    // Battle.
    hit(T(S.battle), 0.95);
    for (let i = 0; i < 6; i++) {
      const b = S.battle + i;
      if (i === 5) {
        grid(b, [1, 0, 0, 0.6, 0, 0, 0.8, 0, 1, 0, 0.6, 0.6, 0.9, 0.7, 0.9, 1], 0.6);
        for (let s = 0; s < 16; s++) snare(drums, T(b, 3) + (s * beat) / 8, 0.04 + 0.012 * s);
        swell(metal, T(b), bar, 0.12);
      } else {
        grid(b, [i ? 1 : 0, 0, 0, 0.6, 0, 0, 0.8, 0, 1, 0, 0.5, 0, 0.9, 0, 0.7, 0.5], 0.55);
        snare(drums, T(b, 2), 0.14);
        snare(drums, T(b, 4), 0.16);
        if (i === 2 || i === 4) crash(metal, T(b), 0.1, 2.4);
        if (i === 4) braam(big, N('D2'), T(b), 0.34, 2.6);
      }
    }
    // The last blow of the battle, then nothing.
    hit(T(S.still), 0.8);
    // Stillness: a roll that can barely be heard, coming up under its last bar.
    roll(T(35), bar, beat / 4, 0.02, 0.1);
    swell(metal, T(35), bar, 0.035);
    // Collapse: beats, then halves of beats, then quarters, with the braams growing.
    braam(big, N('D2'), T(36), 0.3, 3);
    braam(big, N('G1') + 12, T(38), 0.38, 3);
    braam(big, N('A1') + 12, T(39), 0.42, 3);
    braam(big, N('A1') + 12, T(40), 0.5, 2.6);
    grid(36, [1, 0, 0, 0, 0.8, 0, 0, 0, 0.9, 0, 0, 0, 0.8, 0, 0, 0], 0.45);
    grid(37, [1, 0, 0, 0, 0.8, 0, 0, 0, 0.9, 0, 0.6, 0, 0.9, 0, 0.7, 0], 0.5);
    grid(38, [1, 0, 0.6, 0, 0.8, 0, 0.6, 0, 0.9, 0, 0.7, 0, 0.9, 0, 0.8, 0], 0.55);
    grid(39, [1, 0, 0.7, 0, 0.9, 0, 0.7, 0.5, 1, 0, 0.7, 0.5, 0.9, 0.6, 0.8, 0.6], 0.6);
    roll(T(40), bar, beat / 4, 0.45, 0.95);
    for (let s = 0; s < 32; s++) snare(drums, T(40) + (s * beat) / 8, 0.03 + 0.008 * s);
    swell(metal, T(39), bar * 2, 0.2, 2200, 9000);
    riser(big, N('A2'), T(38), bar * 3, 0.16);
    // The hit.
    hit(T(S.hit), 1.15);
    boom(big, T(S.hit), 0.35, 6);
  }

  const buf = await ctx.startRendering();
  const n = Math.round(seconds * rate);
  const pcm = new Float32Array(n * 2);
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    pcm[i * 2] = l[i];
    pcm[i * 2 + 1] = r[i];
    peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
  }
  window.__pcm = new Uint8Array(pcm.buffer);
  return { bytes: window.__pcm.length, peak };
}

function wavHeader(bytes, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + bytes, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 8, 28);
  h.writeUInt16LE(8, 32);
  h.writeUInt16LE(32, 34);
  h.write('data', 36);
  h.writeUInt32LE(bytes, 40);
  return h;
}

/** The stems' levels in the mix, in dB. */
const MIX = { pads: 0, melody: 1.5, rhythm: -1, perc: 1 };

export async function render() {
  mkdirSync(DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chromePath() });
  try {
    const page = await browser.newPage();
    for (const group of Object.keys(MIX)) {
      const started = Date.now();
      const { bytes, peak } = await page.evaluate(renderStem, { group, rate: RATE, seconds: SECONDS + 1.5, bpm: BPM, seed: 90210 });
      const parts = [wavHeader(bytes, RATE)];
      const step = 6 * 1024 * 1024;
      for (let at = 0; at < bytes; at += step) {
        const b64 = await page.evaluate(([a, b]) => {
          const view = window.__pcm.subarray(a, b);
          let s = '';
          for (let i = 0; i < view.length; i += 0x8000) s += String.fromCharCode(...view.subarray(i, i + 0x8000));
          return btoa(s);
        }, [at, Math.min(bytes, at + step)]);
        parts.push(Buffer.from(b64, 'base64'));
      }
      writeFileSync(join(DIR, `score-own-${group}.wav`), Buffer.concat(parts));
      console.log(`${group.padEnd(7)} rendered in ${((Date.now() - started) / 1000).toFixed(1)} s, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`);
    }
  } finally {
    await browser.close();
  }
  return mix();
}

/** The four stems into one: levels, a little glue, and the peaks held under −1 dBFS. */
export function mix() {
  const names = Object.keys(MIX);
  const out = join(DIR, 'score-own.wav');
  ffmpeg([
    ...names.flatMap((g) => ['-i', join(DIR, `score-own-${g}.wav`)]),
    '-filter_complex',
    `${names.map((g, i) => `[${i}:a]volume=${MIX[g]}dB[s${i}]`).join(';')};${names.map((_, i) => `[s${i}]`).join('')}amix=inputs=${names.length}:normalize=0,highpass=f=26,acompressor=threshold=-12dB:ratio=1.7:attack=30:release=300:makeup=1,alimiter=limit=0.89:attack=4:release=90:level=false[a]`,
    '-map', '[a]', '-ar', String(RATE), '-c:a', 'pcm_s24le', out,
  ]);
  return out;
}

export function measure() {
  const plan = { sections: SECTIONS.map(([section_name, bars]) => ({ section_name, duration_ms: bars * BAR * 1000 })) };
  const report = {};
  for (const name of ['score-own', ...Object.keys(MIX).map((g) => `score-own-${g}`)]) {
    const file = join(DIR, `${name}.wav`);
    if (!existsSync(file)) continue;
    const a = analyse(file, plan);
    // And without the bottom two octaves, which carry most of the level and little of the loudness.
    const above = analyse(file, plan, 'highpass=f=160');
    report[name] = a;
    console.log(`${name.padEnd(18)} ${a.sections.map((s) => String(Math.round(s.rmsDb)).padStart(4)).join(' ')}   peak ${a.peakDb} dB at ${a.peakAt} s`);
    console.log(`${'  above 160 Hz'.padEnd(18)} ${above.sections.map((s) => String(Math.round(s.rmsDb)).padStart(4)).join(' ')}`);
  }
  console.log(`${''.padEnd(18)} ${SECTIONS.map(([n]) => n.slice(0, 4).padStart(4)).join(' ')}   (dB RMS by section)`);
  const whole = report['score-own'];
  if (whole) {
    writeFileSync(join(DIR, 'score-own.json'), JSON.stringify(whole, null, 1) + '\n');
    console.log('per second: ' + whole.perSecond.map((v) => Math.round(v)).join(' '));
    ffmpeg(['-i', join(DIR, 'score-own.wav'), '-filter_complex', '[0:a]asplit[a][b];[a]showwavespic=s=1800x300:colors=0x5cc8ff[w];[b]showspectrumpic=s=1800x500:legend=0:scale=log:fscale=log:start=30:stop=16000[s];[w][s]vstack', '-frames:v', '1', join(DIR, 'score-own.png')]);
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.argv.includes('--measure')) await render();
  measure();
}
void readScript;
