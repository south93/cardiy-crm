import { defineConfig, devices } from '@playwright/test';

const GARAGE_PORT = Number(process.env.GARAGE_PORT ?? 3000);
const API_PORT = Number(process.env.API_PORT ?? 4000);

/**
 * Test giao diện đầu cuối: chạy API + web garage bản build, rồi bấm thử bằng Chromium.
 * Cần build trước: pnpm build
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${GARAGE_PORT}`,
    trace: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @cardiy/api start',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @cardiy/garage start',
      url: `http://localhost:${GARAGE_PORT}`,
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      timeout: 60_000,
    },
  ],
});
