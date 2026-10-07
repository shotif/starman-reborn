// Trailer sound design for the cinematic cut, from ElevenLabs' sound-effects model: impacts,
// risers, a pass-by, a drone. (The game's own effects still voice everything the game does.)
//
//   node promo/cinematic/sfx.mjs [<id> …]   make the sounds named (default: all in script.json not made yet)
//   node promo/cinematic/sfx.mjs --measure  measure the ones made (no calls)
//
// Each sound is measured as it arrives: how long it is, where it is loudest and where it starts,
// so the edit can put an impact's blow or a riser's end on a frame without anyone hearing it.
// Out: promo/cinematic/assets/sfx/<id>.mp3 and sfx.json. Kept local.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { credits, eleven } from '../lib/eleven.mjs';
import { FFMPEG } from '../lib/media.mjs';
import { ASSETS, readScript } from './voice.mjs';

const DIR = join(ASSETS, 'sfx');
const RATE = 11_025;

function measure(file) {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
  const hop = Math.round(RATE / 50);
  const env = [];
  for (let i = 0; i + hop <= x.length; i += hop) {
    let sum = 0;
    for (let k = i; k < i + hop; k++) sum += x[k] * x[k];
    env.push(Math.sqrt(sum / hop));
  }
  const peak = Math.max(...env);
  const at = (i) => Math.round((i / 50) * 100) / 100;
  const loudest = env.indexOf(peak);
  const starts = env.findIndex((v) => v > peak * 0.2);
  let ends = env.length - 1;
  while (ends > 0 && env[ends] < peak * 0.05) ends--;
  return { seconds: at(env.length), startsAt: at(starts), loudestAt: at(loudest), fadesBy: at(ends), peakDb: Math.round(20 * Math.log10(peak) * 10) / 10 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const sounds = readScript().sfx.sounds;
  mkdirSync(DIR, { recursive: true });
  const only = args.filter((a) => !a.startsWith('--'));
  if (!args.includes('--measure')) {
    const before = await credits();
    for (const [id, s] of Object.entries(sounds)) {
      const file = join(DIR, `${id}.mp3`);
      if (only.length ? !only.includes(id) : existsSync(file)) continue;
      const res = await eleven('/v1/sound-generation', { method: 'POST', body: { text: s.text, duration_seconds: s.seconds, prompt_influence: s.influence ?? 0.5 }, query: { output_format: 'mp3_44100_192' } });
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      console.log(`made ${id}`);
    }
    const after = await credits();
    console.log(`Credits used: ${after.used - before.used} (${after.left.toLocaleString('en')} left)`);
  }
  const report = {};
  for (const id of Object.keys(sounds)) {
    const file = join(DIR, `${id}.mp3`);
    if (!existsSync(file)) continue;
    report[id] = measure(file);
    console.log(id.padEnd(8), JSON.stringify(report[id]));
  }
  writeFileSync(join(DIR, 'sfx.json'), JSON.stringify(report, null, 1) + '\n');
}
