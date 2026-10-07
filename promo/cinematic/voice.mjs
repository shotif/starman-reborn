// The cinematic trailer's voice-over, from ElevenLabs text-to-speech.
//
//   node promo/cinematic/voice.mjs [<set> …]      the sets named (default: the one script.json uses)
//   node promo/cinematic/voice.mjs --all          every set in script.json
//   node promo/cinematic/voice.mjs --audition     one file with every generated set reading the first three lines
//
// Each line of script.json is asked for on its own, with the lines either side as context, and
// comes back with the time of every character, so the edit can place picture on a word. Each line
// is then transcribed back (speech-to-text) and compared with the script: nobody listens here.
// Out: promo/cinematic/assets/vo/<set>/<id>.wav and <id>.json, and set.json. Kept local (git ignores assets/).
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { credits, eleven, elevenJson } from '../lib/eleven.mjs';
import { ffmpeg, ffmpegReport } from '../lib/media.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ASSETS = join(HERE, 'assets');
const RATE = 48_000;

export const readScript = () => JSON.parse(readFileSync(join(HERE, 'script.json'), 'utf8'));

/** Raw 16-bit mono PCM as a WAV file. */
function wav(pcm, rate = RATE) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

/** A number under a thousand in words, as the script writes them ("27" is "twenty seven"). */
function spelled(n) {
  const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ` ${ones[n % 10]}` : '');
  return `${ones[Math.floor(n / 100)]} hundred` + (n % 100 ? ` ${spelled(n % 100)}` : '');
}

/** The words of a sentence for comparing script with transcript: lower case, no punctuation, numbers spelled out, no "and" in numbers. */
const words = (s) =>
  s
    .toLowerCase()
    .replace(/\b\d{1,3}\b/g, (d) => spelled(Number(d)))
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/'/g, '')
    .replace(/\bhundred and\b/g, 'hundred')
    .split(/\s+/)
    .filter(Boolean);

/** Words and their times from the character alignment. */
function wordTimes(alignment) {
  const out = [];
  let cur = null;
  alignment.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = null;
    } else {
      cur ??= { word: '', start: alignment.character_start_times_seconds[i], end: 0 };
      cur.word += ch;
      cur.end = alignment.character_end_times_seconds[i];
    }
  });
  if (cur) out.push(cur);
  return out;
}

async function transcribe(file) {
  for (const model of ['scribe_v2', 'scribe_v1']) {
    try {
      const form = new FormData();
      form.set('model_id', model);
      form.set('language_code', 'en');
      form.set('file', new Blob([readFileSync(file)], { type: 'audio/wav' }), 'line.wav');
      return (await elevenJson('/v1/speech-to-text', { method: 'POST', body: form })).text;
    } catch (e) {
      if (model === 'scribe_v1') throw e;
    }
  }
  return '';
}

/** First and last moments above −45 dB of the peak: where the voice actually is in the file. */
function voiced(file) {
  const r = ffmpegReport(['-i', file, '-af', 'silencedetect=noise=-42dB:d=0.08', '-f', 'null', '-']);
  const dur = Number((r.match(/Duration: (\d+):(\d+):([\d.]+)/) ?? []).slice(1).reduce((a, x) => a * 60 + Number(x), 0));
  const starts = [...r.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...r.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const head = starts[0] !== undefined && starts[0] < 0.02 ? (ends[0] ?? 0) : 0;
  const tail = starts.length && (ends.length < starts.length || ends[ends.length - 1] >= dur - 0.02) ? starts[starts.length - 1] : dur;
  return { duration: dur, from: Math.max(0, head), to: Math.min(dur, tail) };
}

async function generate(name, script) {
  const set = script.voice.sets[name];
  if (!set) throw new Error(`No voice set "${name}" in script.json`);
  const dir = join(ASSETS, 'vo', name);
  mkdirSync(dir, { recursive: true });
  const lines = script.voice.lines;
  const context = set.model === 'eleven_multilingual_v2';
  const report = [];
  for (const [i, line] of lines.entries()) {
    const body = { text: line.text, model_id: set.model, voice_settings: set.settings, seed: script.voice.seed + i };
    // The lines either side, so each is spoken as part of the whole (models that take context).
    if (context) {
      if (i > 0) body.previous_text = lines.slice(Math.max(0, i - 2), i).map((l) => l.text).join(' ');
      if (i < lines.length - 1) body.next_text = lines[i + 1].text;
    }
    const res = await elevenJson(`/v1/text-to-speech/${set.voiceId}/with-timestamps`, { method: 'POST', body, query: { output_format: `pcm_${RATE}` } });
    const file = join(dir, `${line.id}.wav`);
    writeFileSync(file, wav(Buffer.from(res.audio_base64, 'base64')));
    const times = wordTimes(res.alignment);
    const heard = await transcribe(file);
    const ok = words(heard).join(' ') === words(line.text).join(' ');
    const v = voiced(file);
    writeFileSync(join(dir, `${line.id}.json`), JSON.stringify({ id: line.id, text: line.text, heard, ok, ...v, words: times }, null, 1) + '\n');
    report.push({ id: line.id, seconds: Math.round((v.to - v.from) * 100) / 100, file: Math.round(v.duration * 100) / 100, ok, heard: ok ? undefined : heard });
    console.log(`${name} ${line.id}  ${(v.to - v.from).toFixed(2)} s  ${ok ? 'as written' : `HEARD: ${heard}`}`);
  }
  writeFileSync(join(dir, 'set.json'), JSON.stringify({ set: name, ...set, generated: new Date().toISOString(), lines: report }, null, 1) + '\n');
  return report;
}

function audition(script) {
  const sets = Object.keys(script.voice.sets).filter((s) => existsSync(join(ASSETS, 'vo', s, '01.wav')));
  if (!sets.length) throw new Error('No voice sets generated yet');
  const inputs = [];
  const parts = [];
  let n = 0;
  for (const s of sets) {
    for (const id of ['01', '02', '03', '12', '13', '14']) {
      inputs.push('-i', join(ASSETS, 'vo', s, `${id}.wav`));
      parts.push(`[${n}:a]apad=pad_dur=${id === '14' ? 1.6 : 0.45}[p${n}]`);
      n++;
    }
  }
  const out = join(ASSETS, 'vo', 'audition.mp3');
  ffmpeg([...inputs, '-filter_complex', `${parts.join(';')};${Array.from({ length: n }, (_, i) => `[p${i}]`).join('')}concat=n=${n}:v=0:a=1,loudnorm=I=-16:TP=-1.5[a]`, '-map', '[a]', '-ar', '48000', '-b:a', '192k', out]);
  console.log(`${out}\n  in order: ${sets.join(', ')} (each reads lines 1–3 and 12–14)`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const script = readScript();
  if (args.includes('--audition')) {
    audition(script);
  } else if (args.includes('--check')) {
    // The transcripts already taken, compared with the script again (no calls).
    for (const name of Object.keys(script.voice.sets)) {
      const dir = join(ASSETS, 'vo', name);
      if (!existsSync(join(dir, 'set.json'))) continue;
      const bad = script.voice.lines.filter((l) => {
        const j = JSON.parse(readFileSync(join(dir, `${l.id}.json`), 'utf8'));
        return words(j.heard).join(' ') !== words(l.text).join(' ');
      });
      console.log(`${name.padEnd(10)} ${bad.length ? `NOT AS WRITTEN: ${bad.map((l) => l.id).join(', ')}` : 'every line as written'}`);
    }
  } else {
    const names = args.includes('--all') ? Object.keys(script.voice.sets) : args.length ? args : [script.voice.use];
    const before = await credits();
    for (const name of names) await generate(name, script);
    const after = await credits();
    console.log(`Credits used: ${after.used - before.used} (${after.left.toLocaleString('en')} left)`);
  }
}
void eleven;
