import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5175', ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
  webServer: {
    command: 'pnpm build:web && node e2e/start-test-server.mjs',
    port: 5175,
    reuseExistingServer: false,
    timeout: 120_000,
    // 讓 start-test-server 收到 SIGTERM 後清掉暫存資料夾（預設是 SIGKILL）
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
