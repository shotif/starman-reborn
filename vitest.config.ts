import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Some checks walk the whole world (every dock's prices, every rival's career); on a busy
    // machine they run past Vitest's five-second default, so every test gets half a minute.
    testTimeout: 30_000,
    // Sol's real sky is fetched on demand in the game (docs/PROCGEN.md §50); the tests install it first.
    setupFiles: ['tests/setup/sky.ts'],
  },
});
