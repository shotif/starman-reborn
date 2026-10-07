// Captures shots for the trailer.
//
//   node promo/capture.mjs <shot> [<shot> …]     full capture into promo/out/frames/<shot>/
//   node promo/capture.mjs --preview <shot> …    one frame in 20 into promo/out/preview/<shot>/, with a contact sheet
//   node promo/capture.mjs --list                the shots there are
//   node promo/capture.mjs --all [--jobs 3]      every shot the edit uses (promo/edl.json), a few browsers at a time
//
// Each shot runs in its own browser on a new save, so shots never depend on one another.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, PROMO, Recorder, ensureServer, open } from './lib/harness.mjs';
import { ffmpeg, framePattern } from './lib/media.mjs';
import { scan } from './scan.mjs';
import { SHOTS } from './shots.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const [, value] = args.splice(i, 2);
  return value;
};

const preview = flag('--preview');
const all = flag('--all');
const jobs = Number(option('--jobs', 3));
const every = Number(option('--every', 20));

if (flag('--list')) {
  for (const [name, shot] of Object.entries(SHOTS)) console.log(`${name.padEnd(18)} ${shot.about}`);
  process.exit(0);
}

/** A contact sheet of a shot's frames: promo/out/sheets/<name>.jpg (every `step`th frame, `cols` across). */
export function contactSheet(dir, name, { step = 1, cols = 6, width = 480 } = {}) {
  const { pattern, count } = framePattern(dir);
  const picked = Math.ceil(count / step);
  const rows = Math.ceil(picked / cols);
  const out = join(OUT, 'sheets', `${name}.jpg`);
  ffmpeg(['-framerate', '1', '-i', pattern, '-vf', `select='not(mod(n\\,${step}))',scale=${width}:-1,tile=${cols}x${rows}:padding=4:color=0x202020`, '-frames:v', '1', '-q:v', '3', out]);
  return out;
}

async function capture(name) {
  const shot = SHOTS[name];
  if (!shot) throw new Error(`No shot called "${name}" (see --list)`);
  const session = await open({ layout: shot.layout ?? 'hud' });
  try {
    const rec = new Recorder(session, name, { halfRate: !!shot.halfRate, every: preview ? every : 1 });
    await shot.run(session, rec);
    if (rec.count === 0) throw new Error(`${name}: nothing recorded`);
    if (!rec.finished) await rec.finish();
    const sheet = preview ? contactSheet(rec.dir, name, { cols: 5, width: 640 }) : contactSheet(rec.dir, name, { step: 15, cols: 6 });
    if (sheet) console.log(`[${name}] sheet ${sheet}`);
    if (!preview) {
      // No frame with part of the picture gone dark for that frame alone.
      const { bad } = scan(name);
      if (bad.length) {
        console.error(`[${name}] GLITCHED FRAMES: ${bad.map((b) => `${b.frame} (${b.t} s)`).join(', ')}`);
        process.exitCode = 1;
      } else console.log(`[${name}] no glitched frames`);
    }
  } finally {
    await session.close();
  }
}

if (all || args.length > 1) {
  // Several shots: each in a process of its own, `jobs` at a time, against one dev server.
  const server = await ensureServer();
  const edl = all ? JSON.parse(readFileSync(join(PROMO, 'edl.json'), 'utf8')) : null;
  // Every shot the edit draws on: its clips, the end card's plate and the silent loop.
  const names = edl ? [...new Set([...edl.clips.map((c) => c.shot ?? c.plate), edl.loop?.shot].filter((s) => s && SHOTS[s]))] : args;
  const queue = [...names];
  const failed = [];
  const worker = async () => {
    for (let name = queue.shift(); name; name = queue.shift()) {
      const code = await new Promise((done) => {
        const child = spawn(process.execPath, [new URL(import.meta.url).pathname, ...(preview ? ['--preview', '--every', String(every)] : []), name], { stdio: 'inherit' });
        child.on('exit', done);
      });
      if (code !== 0) failed.push(name);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, names.length) }, worker));
  server?.kill();
  if (failed.length) {
    console.error(`Failed: ${failed.join(', ')}`);
    process.exit(1);
  }
} else if (args.length === 1) {
  await capture(args[0]);
} else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 8).join('\n'));
}
