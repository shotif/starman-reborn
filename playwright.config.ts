import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run against the production build (`vite preview`).
 * Headless Chromium renders WebGL 2 through SwiftShader (software), so frame rates in CI are low;
 * tests use the `?test=1` hooks to speed up travel where the journey allows it.
 */
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 15 * 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    launchOptions: { args: GL_ARGS },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /screenshots\.spec\.ts/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'touch',
      testIgnore: /screenshots\.spec\.ts/,
      use: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 },
    },
    {
      name: 'screenshots',
      testMatch: /screenshots\.spec\.ts/,
    },
  ],
});
