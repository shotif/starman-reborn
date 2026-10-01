import './ui/styles/base.css';
import { startGame } from './app/loader.ts';

/**
 * Offline play after one visit (a stretch goal): production builds over HTTPS or on localhost,
 * never in test runs. Once the game is up, so the files are already in the browser's cache, the
 * service worker is given the page and every file of the build to keep (public/sw.js).
 */
function keepForOffline(): void {
  if (
    !import.meta.env.PROD ||
    !('serviceWorker' in navigator) ||
    (location.protocol !== 'https:' && location.hostname !== 'localhost') ||
    new URLSearchParams(location.search).has('test')
  ) {
    return;
  }
  let files: string[] = [];
  try {
    files = JSON.parse(document.getElementById('offline-files')?.textContent ?? '[]') as string[];
  } catch {
    // Without the list the worker still keeps what passes through it.
  }
  const urls = [new URL('./', location.href).href, ...files.map((f) => new URL(f, location.href).href)];
  navigator.serviceWorker
    .register('./sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then((registration) => registration.active?.postMessage({ type: 'keep', urls }))
    .catch(() => {
      // Offline caching is optional; the game works without it.
    });
}

// The loading title first; the game arrives behind it (src/app/loader.ts).
void startGame().then((started) => {
  if (started) keepForOffline();
});
