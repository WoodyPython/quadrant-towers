import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node apps/server/dist/index.js',
    url: 'http://127.0.0.1:3100/health/ready',
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '3100',
      LOG_LEVEL: 'warn',
    },
  },
});
