// A contact sheet of part of a captured shot, for choosing in-points.
//   node promo/peek.mjs <shot> <from seconds> <to seconds> [frames between tiles = 6] [columns = 6]
import { join } from 'node:path';
import { FPS, OUT } from './lib/harness.mjs';
import { ffmpeg, framePattern } from './lib/media.mjs';

const [shot, from = '0', to = '3', step = '6', cols = '6'] = process.argv.slice(2);
const start = Math.round(Number(from) * FPS);
const count = Math.ceil(((Number(to) - Number(from)) * FPS) / Number(step));
const rows = Math.ceil(count / Number(cols));
const out = join(OUT, 'sheets', `peek-${shot}-${from}-${to}.jpg`);
ffmpeg(['-framerate', '1', '-start_number', String(start), '-i', framePattern(join(OUT, 'frames', shot)).pattern, '-vf', `select='not(mod(n\\,${step}))',scale=640:-1,tile=${cols}x${rows}:padding=4:color=0x202020`, '-frames:v', '1', '-q:v', '3', out]);
console.log(out);
