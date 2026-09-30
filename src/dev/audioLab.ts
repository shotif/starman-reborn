import { AudioEngine } from '../audio/AudioEngine.ts';
import type { AmbienceRoom, AudioVolumes, EngineSoundState, MusicMood, SfxId, SfxOptions } from '../audio/types.ts';
import { AMBIENCE, AMBIENCE_ROOMS } from '../audio/ambienceSpecs.ts';
import { MOODS, MUSIC_MOODS } from '../audio/moods.ts';
import { SFX_IDS, SFX_SPECS } from '../audio/sfxSpecs.ts';
import { measure, renderAmbience, renderBurst, renderEngine, renderMood, renderSfx } from '../audio/offline.ts';
import type { LevelReport } from '../audio/offline.ts';

/** Dev-only audition page for the procedural audio engine (served at /dev/audio.html). */

type Child = Node | string;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
}

function slider(label: string, value: number, min: number, max: number, step: number, onInput: (v: number) => void): HTMLLabelElement {
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  const out = h('output', {}, value.toFixed(2));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = v.toFixed(2);
    onInput(v);
  });
  return h('label', { class: 'slider' }, h('span', {}, label), input, out);
}

function toggle(label: string, initial: boolean, onChange: (on: boolean) => void): HTMLButtonElement {
  const b = h('button', { type: 'button', 'aria-pressed': String(initial) }, label);
  let on = initial;
  b.classList.toggle('on', on);
  b.addEventListener('click', () => {
    on = !on;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    onChange(on);
  });
  return b;
}

const audio = new AudioEngine();
const root = document.getElementById('lab') ?? document.body;

// Like the game: any gesture unlocks.
const unlock = (): void => void audio.unlock();
for (const type of ['pointerup', 'touchend', 'keydown'] as const) window.addEventListener(type, unlock, { passive: true });
document.addEventListener('visibilitychange', () => audio.setSuspended(document.hidden));

// ---- header ----
const badge = h('span', { class: 'badge locked', id: 'state' }, 'locked');
const unlockBtn = h('button', { type: 'button', class: 'primary', id: 'unlock' }, 'Unlock audio');
unlockBtn.addEventListener('click', unlock);
root.append(
  h(
    'header',
    {},
    h('h1', {}, 'Audio Lab'),
    badge,
    unlockBtn,
    toggle('Mute', false, (on) => audio.setMuted(on)),
    toggle('Suspend', false, (on) => audio.setSuspended(on)),
  ),
);

// ---- mixer ----
const vols: AudioVolumes = audio.getVolumes();
const setVol = (k: keyof AudioVolumes) => (v: number) => {
  vols[k] = v;
  audio.setVolumes(vols);
};
root.append(
  h(
    'section',
    {},
    h('h2', {}, 'Mixer'),
    h('div', { class: 'row' }, slider('Master', vols.master, 0, 1, 0.01, setVol('master')), slider('Music', vols.music, 0, 1, 0.01, setVol('music')), slider('SFX', vols.sfx, 0, 1, 0.01, setVol('sfx'))),
  ),
);

// ---- music ----
const moodButtons = new Map<MusicMood, HTMLButtonElement>();
const moodNote = h('p', { class: 'note' }, 'Pick a mood. Moods crossfade over ~3 s.');
const moodGrid = h('div', { class: 'grid' });
for (const mood of MUSIC_MOODS) {
  const def = MOODS[mood];
  const b = h('button', { type: 'button', 'data-mood': mood }, mood, h('small', {}, `${def.tempo} bpm · ${def.beatsPerBar}/4`));
  b.addEventListener('click', () => {
    audio.setMusic(mood);
    moodNote.textContent = def.character;
  });
  moodButtons.set(mood, b);
  moodGrid.append(b);
}
root.append(
  h(
    'section',
    {},
    h('h2', {}, 'Music'),
    moodGrid,
    moodNote,
    h('div', { class: 'row', style: 'margin-top:10px' }, slider('Combat', 0, 0, 1, 0.01, (v) => audio.setCombatIntensity(v))),
  ),
);

// ---- station ambience and local radio ----
const roomButtons = new Map<AmbienceRoom | null, HTMLButtonElement>();
const roomNote = h('p', { class: 'note' }, 'Room beds crossfade over ~1.5 s, as when walking between rooms while docked.');
const roomGrid = h('div', { class: 'grid' });
for (const room of [null, ...AMBIENCE_ROOMS] as const) {
  const b = h('button', { type: 'button', 'data-room': room ?? 'off' }, room ?? 'off', h('small', {}, room ? `${AMBIENCE[room].events.length} event kinds` : 'no ambience'));
  b.addEventListener('click', () => {
    audio.setAmbience(room);
    roomNote.textContent = room ? AMBIENCE[room].character : 'Ambience off (as in flight).';
  });
  roomButtons.set(room, b);
  roomGrid.append(b);
}
root.append(
  h(
    'section',
    {},
    h('h2', {}, 'Station ambience and radio'),
    roomGrid,
    roomNote,
    h('div', { class: 'row', style: 'margin-top:10px' }, slider('Radio traffic', 0, 0, 1, 0.01, (v) => audio.setRadio(v))),
    h('p', { class: 'note' }, 'Local radio: silent below 0.30; a core system (Sol) is 1.00. The comm blip is radio-blip under Sound effects.'),
  ),
);

// ---- sfx ----
const sfxOpts: Required<SfxOptions> = { volume: 1, pan: 0, pitch: 1 };
const sfxGrid = h('div', { class: 'grid' });
for (const id of SFX_IDS) {
  const b = h('button', { type: 'button', 'data-sfx': id }, id, h('small', {}, `${SFX_SPECS[id].dur.toFixed(2)} s`));
  b.addEventListener('click', () => audio.play(id, sfxOpts));
  sfxGrid.append(b);
}
const rapid = h('button', { type: 'button' }, 'Rapid fire ×20');
rapid.addEventListener('click', () => {
  for (let i = 0; i < 20; i++) setTimeout(() => audio.play(i % 4 === 3 ? 'laser-mk2' : 'laser', { ...sfxOpts, pan: Math.sin(i) * 0.6 }), i * 55);
});
const barrage = h('button', { type: 'button' }, 'Explosion barrage');
barrage.addEventListener('click', () => {
  for (let i = 0; i < 12; i++) setTimeout(() => audio.play(i % 3 === 0 ? 'explosion-large' : 'explosion-small', { pan: Math.cos(i) * 0.8 }), i * 90);
});
root.append(
  h(
    'section',
    {},
    h('h2', {}, 'Sound effects'),
    h(
      'div',
      { class: 'row', style: 'margin-bottom:10px' },
      slider('Volume', 1, 0, 1, 0.01, (v) => (sfxOpts.volume = v)),
      slider('Pan', 0, -1, 1, 0.01, (v) => (sfxOpts.pan = v)),
      slider('Pitch', 1, 0.5, 2, 0.01, (v) => (sfxOpts.pitch = v)),
    ),
    sfxGrid,
    h('div', { class: 'row', style: 'margin-top:10px' }, rapid, barrage),
  ),
);

// ---- engine ----
const engineState: EngineSoundState = { throttle: 0.3, speed: 0.2, boost: false, cruise: false, lane: false };
let flying = false;
root.append(
  h(
    'section',
    {},
    h('h2', {}, 'Engine'),
    h(
      'div',
      { class: 'row' },
      toggle('Flying', false, (on) => (flying = on)),
      toggle('Boost', false, (on) => (engineState.boost = on)),
      toggle('Cruise', false, (on) => (engineState.cruise = on)),
      toggle('Lane', false, (on) => (engineState.lane = on)),
    ),
    h(
      'div',
      { class: 'row', style: 'margin-top:10px' },
      slider('Throttle', engineState.throttle, 0, 1, 0.01, (v) => (engineState.throttle = v)),
      slider('Speed', engineState.speed, 0, 1, 0.01, (v) => (engineState.speed = v)),
    ),
    h('p', { class: 'note' }, 'setEngine() is called every animation frame while "Flying" is on, as the game does.'),
  ),
);

// ---- offline analysis ----
const results = h('tbody');
const status = h('p', { class: 'note' }, 'Renders through the live mix chain in an OfflineAudioContext (default volumes).');
type Report = Record<string, LevelReport>;

function show(title: string, report: Report): void {
  results.append(h('tr', {}, h('th', { colspan: '6' }, title)));
  for (const [name, r] of Object.entries(report)) {
    const num = (text: string): HTMLTableCellElement => h('td', { class: 'num' }, text);
    const peak = h('td', { class: r.peak >= 1 ? 'num bad' : 'num' }, r.peakDb.toFixed(1));
    results.append(
      h('tr', {}, h('td', {}, name), peak, num(r.rmsDb.toFixed(1)), num(String(r.clipped)), num(r.audible.toFixed(2)), num(String(Math.round(r.brightness)))),
    );
  }
}

async function analyseMoods(seconds = 16, intensity = 0): Promise<Report> {
  const out: Report = {};
  for (const mood of MUSIC_MOODS) out[mood] = measure(await renderMood(mood, { seconds, intensity }), 3);
  return out;
}

async function analyseSfx(): Promise<Report> {
  const out: Report = {};
  for (const id of SFX_IDS) out[id] = measure(await renderSfx(id));
  return out;
}

async function analyseBursts(): Promise<Report> {
  return {
    'laser ×20 @50ms': measure(await renderBurst('laser', 20, 0.05)),
    'laser-mk2 ×20 @50ms': measure(await renderBurst('laser-mk2', 20, 0.05)),
    'laser-enemy ×20 @40ms': measure(await renderBurst('laser-enemy', 20, 0.04)),
    'explosion-small ×10 @60ms': measure(await renderBurst('explosion-small', 10, 0.06)),
    'explosion-large ×4 @150ms': measure(await renderBurst('explosion-large', 4, 0.15)),
    'hit-hull ×16 @30ms': measure(await renderBurst('hit-hull', 16, 0.03)),
  };
}

async function analyseEngine(): Promise<Report> {
  const states: Record<string, EngineSoundState> = {
    idle: { throttle: 0, speed: 0, boost: false, cruise: false, lane: false },
    'full throttle': { throttle: 1, speed: 1, boost: false, cruise: false, lane: false },
    boost: { throttle: 1, speed: 1, boost: true, cruise: false, lane: false },
    cruise: { throttle: 1, speed: 1, boost: false, cruise: true, lane: false },
    lane: { throttle: 0.5, speed: 1, boost: false, cruise: false, lane: true },
  };
  const out: Report = {};
  for (const [name, s] of Object.entries(states)) out[name] = measure(await renderEngine(s, { seconds: 3 }), 1);
  return out;
}

async function analyseAmbience(seconds = 20): Promise<Report> {
  const out: Report = {};
  for (const room of AMBIENCE_ROOMS) out[room] = measure(await renderAmbience(room, { seconds }), 3);
  out['radio (busy) 60 s'] = measure(await renderAmbience(null, { seconds: 60, radio: 1 }), 1);
  return out;
}

async function run(title: string, job: () => Promise<Report>): Promise<void> {
  status.textContent = `Rendering ${title}…`;
  const t0 = performance.now();
  show(title, await job());
  status.textContent = `${title} rendered in ${((performance.now() - t0) / 1000).toFixed(1)} s.`;
}

const jobs: [string, () => Promise<Report>][] = [
  ['Moods', () => analyseMoods()],
  ['Moods + combat 1.0', () => analyseMoods(16, 1)],
  ['SFX', analyseSfx],
  ['Bursts', analyseBursts],
  ['Engine', analyseEngine],
  ['Ambience', () => analyseAmbience()],
];
const jobRow = h('div', { class: 'row' });
for (const [title, job] of jobs) {
  const b = h('button', { type: 'button' }, title);
  b.addEventListener('click', () => void run(title, job));
  jobRow.append(b);
}
root.append(
  h(
    'section',
    {},
    h('h2', {}, 'Offline level analysis'),
    jobRow,
    status,
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h('tr', {}, ...['Render', 'Peak dBFS', 'RMS dBFS', 'Clipped', 'Audible s', 'Bright Hz'].map((label) => h('th', {}, label))),
      ),
      results,
    ),
  ),
);

const stats = h('section', { id: 'stats' });
root.append(stats);

// ---- frame loop: engine updates + status readout ----
let lastStats = 0;
const frame = (now: number): void => {
  audio.setEngine(flying ? engineState : null);
  if (now - lastStats > 250) {
    lastStats = now;
    const s = audio.debugStats();
    badge.textContent = audio.state;
    badge.className = `badge ${audio.state}`;
    unlockBtn.hidden = audio.state === 'running';
    for (const [mood, b] of moodButtons) b.classList.toggle('on', audio.currentMood === mood);
    for (const [room, b] of roomButtons) b.classList.toggle('on', audio.currentAmbience === room);
    stats.textContent =
      `context ${s.contextState} · ${s.sampleRate} Hz · base latency ${(s.baseLatency * 1000).toFixed(1)} ms · ` +
      `scheduler ${s.schedulerRunning ? 'on' : 'off'} · music voices ${s.musicVoices} · sfx voices ${s.sfxVoices} · ` +
      `engine ${s.engineActive ? 'on' : 'off'} · combat ${s.combatIntensity.toFixed(2)} · ` +
      `ambience ${s.ambienceRoom ?? 'off'} (${s.ambienceVoices} voices) · radio ${s.radio.toFixed(2)}`;
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

/** Automation hook (used by the headless check). */
const api = {
  audio,
  sfxIds: SFX_IDS,
  moods: MUSIC_MOODS,
  analyseMoods,
  analyseSfx,
  analyseBursts,
  analyseEngine,
  analyseAmbience,
  play: (id: SfxId, opts?: SfxOptions) => audio.play(id, opts),
};
(window as unknown as { __audioLab: typeof api }).__audioLab = api;
