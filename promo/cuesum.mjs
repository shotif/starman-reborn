// Prints a shot's cue sheet in brief: every effect the game asked for and when (for choosing in-points).
//   node promo/cuesum.mjs <shot> [<shot> …]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROMO } from './lib/harness.mjs';

const QUIET = new Set(['radio-blip', 'ui-click', 'target-lock']);
for (const shot of process.argv.slice(2)) {
  const sheet = JSON.parse(readFileSync(join(PROMO, 'cues', `${shot}.json`), 'utf8'));
  const counts = {};
  for (const c of sheet.cues) if (c.kind === 'sfx') counts[c.id] = (counts[c.id] ?? 0) + 1;
  console.log(`\n${shot}: ${sheet.seconds} s, ${sheet.cues.length} cues  ${Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(' ')}`);
  if (sheet.notes.length) console.log('  notes: ' + sheet.notes.map((n) => `${n.t.toFixed(2)} ${n.label}`).join(' | '));
  const line = [];
  for (const c of sheet.cues) {
    if (c.kind === 'sfx' && !QUIET.has(c.id) && !/^laser/.test(c.id) && !/^hit-/.test(c.id)) line.push(`${c.t.toFixed(2)} ${c.id}`);
    else if (c.kind === 'music') line.push(`${c.t.toFixed(2)} ♪${c.mood}`);
    else if (c.kind === 'intensity') line.push(`${c.t.toFixed(2)} ⚔${c.value}`);
  }
  console.log('  ' + line.join(' | '));
}
