import { defineConfig, devices } from '@playwright/test';

const AUTH_FILE = 'output/playwright/.auth/user.json';
const LOCAL_CORS_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 3,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    actionTimeout: 10000,
    navigationTimeout: 30000,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_FILE,
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'bun run dev:full',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV ?? 'development',
      CORS_ORIGIN: process.env.CORS_ORIGIN ?? LOCAL_CORS_ORIGINS,
      E2E_TEST_MODE: '1',
    },
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
