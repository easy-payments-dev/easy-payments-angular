import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4201';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
  // Prefer an already-running `ng serve` during local smoke; CI can set webServer.
  webServer: process.env.SMOKE_START_SERVER
    ? {
        command: 'npx ng serve --port 4201 --host 127.0.0.1 --configuration=development',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      }
    : undefined,
});
