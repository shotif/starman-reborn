// The edit decision list (promo/edl.json), read into seconds and frames.
//
// Times in the EDL are seconds, or beats of the music written "b12" or "b12.5" (the trailer is cut
// to the title theme's beat: 68 to the minute, so its 17 bars last exactly 60 seconds).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROMO } from './harness.mjs';

export function loadEdl(path = join(PROMO, 'edl.json')) {
  const edl = JSON.parse(readFileSync(path, 'utf8'));
  const beat = 60 / edl.music.tempo;
  const fps = edl.fps;
  /** Seconds from a number or a "b…" beat, on a frame. */
  const time = (v) => {
    const s = typeof v === 'string' && v.startsWith('b') ? Number(v.slice(1)) * beat : Number(v);
    if (!Number.isFinite(s)) throw new Error(`Bad time in the EDL: ${JSON.stringify(v)}`);
    return Math.round(s * fps) / fps;
  };
  const frames = (seconds) => Math.round(seconds * fps);
  let cursor = 0;
  const clips = edl.clips.map((c, i) => {
    const at = c.at === undefined ? cursor : time(c.at);
    const end = c.to !== undefined ? time(c.to) : at + time(c.dur);
    if (Math.abs(at - cursor) > 1e-6) throw new Error(`Clip ${i} (${c.id}) starts at ${at} but the one before ends at ${cursor}`);
    cursor = end;
    const speed = c.speed ?? 1;
    return { ...c, index: i, at, end, dur: end - at, frames: frames(end) - frames(at), speed, in: c.in ?? 0 };
  });
  const seconds = edl.seconds;
  if (Math.abs(cursor - seconds) > 1e-6) throw new Error(`The clips end at ${cursor} s, not at ${seconds} s`);
  const captions = (edl.captions ?? []).map((c) => ({ ...c, at: time(c.at), end: c.to !== undefined ? time(c.to) : time(c.at) + time(c.dur) }));
  const hits = (edl.hits ?? []).map((h) => ({ ...h, at: time(h.at) + (h.offset ?? 0) }));
  const intensity = (edl.music.intensity ?? []).map(([t, v]) => [time(t), v]);
  return { ...edl, beat, bar: beat * edl.music.beatsPerBar, clips, captions, hits, music: { ...edl.music, intensity }, time, frames };
}
