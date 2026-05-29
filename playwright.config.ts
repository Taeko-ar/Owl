import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/e2e/spec',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }], ['allure-playwright']],

  projects: [
    {
      name: 'vite-preview',
      testIgnore: ['**/tauri-native.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4173',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
      },
    },
    {
      name: 'tauri-native',
      testMatch: ['**/tauri-native.spec.ts'],
      use: {
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
      },
    },
  ],

  webServer: (process.env.CI || process.env.PLAYWRIGHT_PROJECT === 'tauri-native') ? undefined : {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
