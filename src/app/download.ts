/**
 * The first load (docs/TEST_RECORD.md): the build lists the files the game needs beyond the
 * loading title (scripts/bootFiles.ts writes them into index.html), and the loading title fetches
 * them itself so it can show how much has arrived. They land in the browser's cache, so the game's
 * own imports that follow are served from there.
 */
export interface BootFile {
  /** Relative to the page, as the build wrote it. */
  url: string;
  /** Its size as served before compression: what a reader of the response body counts. */
  bytes: number;
}

export const BOOT_FILES_ID = 'boot-files';

/** The list from the page, or none (the dev server has no list: the bar just sweeps). */
export function parseBootFiles(text: string | null | undefined): BootFile[] {
  if (!text) return [];
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (f): f is BootFile =>
        typeof f === 'object' && f !== null && typeof f.url === 'string' && f.url.length > 0 && Number.isFinite(f.bytes) && f.bytes > 0,
    );
  } catch {
    return [];
  }
}

/** Fetches every file at once, reporting the share of all their bytes that has arrived (0–1). */
export async function downloadAll(
  files: readonly BootFile[],
  onProgress: (fraction: number) => void,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): Promise<void> {
  const total = files.reduce((sum, f) => sum + f.bytes, 0);
  if (total === 0) return;
  let arrived = 0;
  const report = () => onProgress(Math.min(1, arrived / total));
  await Promise.all(
    files.map(async (file) => {
      const res = await fetchFn(file.url);
      if (!res.ok) throw new Error(`${file.url}: HTTP ${res.status}`);
      let counted = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          // Never let one file count for more than it should, if the list is out of date.
          const add = Math.min(value.byteLength, file.bytes - counted);
          counted += value.byteLength;
          if (add > 0) {
            arrived += add;
            report();
          }
        }
      } else {
        await res.arrayBuffer();
      }
      // A file smaller than listed (or read without a stream) still finishes its share.
      if (counted < file.bytes) {
        arrived += file.bytes - counted;
        report();
      }
    }),
  );
}
