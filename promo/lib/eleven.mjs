// ElevenLabs for the cinematic trailer's voice-over and music.
//
// The key and the data-residency host are read from promo/.env (ELEVENLABS_API_KEY,
// ELEVENLABS_API_BASE), which git ignores, or from the environment. The key is only ever sent to
// that host as the `xi-api-key` header; nothing here prints it or writes it anywhere.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function env() {
  const out = { ...process.env };
  const file = join(PROMO, '.env');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m && out[m[1]] === undefined) out[m[1]] = m[2];
    }
  }
  return out;
}

const { ELEVENLABS_API_KEY: KEY, ELEVENLABS_API_BASE: BASE = 'https://api.elevenlabs.io' } = env();

export const hasKey = () => !!KEY;
export const apiBase = () => BASE;

/** A call to the API. `body` is sent as JSON; a FormData is sent as it is. Returns the Response. */
export async function eleven(path, { method = 'GET', body, query } = {}) {
  if (!KEY) throw new Error('No ELEVENLABS_API_KEY: put it in promo/.env (see promo/README.md)');
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const form = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(url, {
    method: body && method === 'GET' ? 'POST' : method,
    headers: { 'xi-api-key': KEY, ...(body && !form ? { 'content-type': 'application/json' } : {}) },
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 600);
    throw new Error(`ElevenLabs ${res.status} on ${url.pathname}: ${text}`);
  }
  return res;
}

export const elevenJson = async (path, opts) => (await eleven(path, opts)).json();

/** Credits used and left on the account. */
export async function credits() {
  const s = await elevenJson('/v1/user/subscription');
  return { tier: s.tier, used: s.character_count, limit: s.character_limit, left: s.character_limit - s.character_count, resets: s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000).toISOString().slice(0, 10) : null };
}
