// ffmpeg and ffprobe for the trailer's tooling: the binaries the promo package installs
// (PROMO_FFMPEG / PROMO_FFPROBE, or ones on the PATH, take their place if set or if those are missing).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);

function find(env, pkg, pick, fallback) {
  if (process.env[env]) return process.env[env];
  try {
    const path = pick(require(pkg));
    if (path && existsSync(path)) return path;
  } catch {
    // Not installed: use the PATH.
  }
  return fallback;
}

export const FFMPEG = find('PROMO_FFMPEG', 'ffmpeg-static', (m) => m, 'ffmpeg');
export const FFPROBE = find('PROMO_FFPROBE', 'ffprobe-static', (m) => m.path, 'ffprobe');

/** Runs ffmpeg quietly and throws with its own words if it fails. The last argument is the output file. */
export function ffmpeg(args, { quiet = true } = {}) {
  const out = args[args.length - 1];
  if (typeof out === 'string' && !out.startsWith('-') && out !== 'pipe:1') mkdirSync(dirname(out), { recursive: true });
  const r = spawnSync(FFMPEG, ['-hide_banner', '-y', ...(quiet ? ['-loglevel', 'error'] : []), ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}):\n${(r.stderr ?? '').slice(-4000)}\nargs: ${args.join(' ')}`);
  return r;
}

/** Runs ffmpeg for what it prints on stderr (ebur128, astats, volumedetect). */
export function ffmpegReport(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}):\n${(r.stderr ?? '').slice(-4000)}`);
  return r.stderr;
}

export function ffprobe(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

/** A shot's frame files as an ffmpeg pattern, and how many there are. */
export function framePattern(dir) {
  const first = readdirSync(dir).find((f) => /^\d{5,6}\.(png|jpg)$/.test(f));
  if (!first) throw new Error(`No frames in ${dir}`);
  const ext = first.slice(first.lastIndexOf('.'));
  return { pattern: `${dir}/%0${first.length - ext.length}d${ext}`, ext, count: readdirSync(dir).filter((f) => f.endsWith(ext)).length };
}
