import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { bootFilesPlugin, systemCount } from './scripts/bootFiles.ts';

// `--mode https` serves dev/preview over a self-signed certificate so phones on
// the same network can open the game (see README "Testing on real devices").
export default defineConfig(({ mode }) => ({
  // Relative asset paths so the static build works from any sub-path
  // (GitHub Pages project sites, file servers, tunnels).
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify((process.env.GITHUB_SHA ?? '').slice(0, 7) || 'local'),
    // The loading title counts the systems before the sky data has arrived.
    __SYSTEM_COUNT__: JSON.stringify(systemCount()),
  },
  plugins: [bootFilesPlugin(), ...(mode === 'https' ? [basicSsl({ name: 'starman-reborn-dev' })] : [])],
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // three.js changes rarely: keep it in its own long-cached chunk.
        manualChunks(id: string) {
          if (id.includes('node_modules/three/examples/jsm/postprocessing')) return 'three-post';
          if (id.includes('node_modules/three/examples')) return 'three-addons';
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
}));
