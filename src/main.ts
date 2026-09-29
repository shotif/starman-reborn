import './ui/styles/base.css';
import { boot } from './app/boot.ts';

boot();

// Offline support (stretch goal): production builds over HTTPS or localhost, never in test runs.
if (
  import.meta.env.PROD &&
  'serviceWorker' in navigator &&
  (location.protocol === 'https:' || location.hostname === 'localhost') &&
  !new URLSearchParams(location.search).has('test')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline caching is optional; the game works without it.
    });
  });
}
