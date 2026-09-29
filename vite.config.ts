import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `--mode https` serves dev/preview over a self-signed certificate so phones on
// the same network can open the game (see README "Testing on real devices").
export default defineConfig(({ mode }) => ({
  // Relative asset paths so the static build works from any sub-path
  // (GitHub Pages project sites, file servers, tunnels).
  base: './',
  plugins: mode === 'https' ? [basicSsl({ name: 'starman-reborn-dev' })] : [],
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 800,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
}));
