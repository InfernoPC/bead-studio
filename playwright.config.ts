import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5175', ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
  // 所有 spec 共用一個伺服器：shell.spec 要先在空狀態下執行，其他 spec 之後才建立作品
  projects: [
    { name: 'empty-server', testMatch: /shell\.spec\.ts$/ },
    { name: 'editor', testIgnore: /shell\.spec\.ts$/, dependencies: ['empty-server'] },
  ],
  webServer: {
    command: 'pnpm build:web && node e2e/start-test-server.mjs',
    port: 5175,
    reuseExistingServer: false,
    timeout: 120_000,
    // 讓 start-test-server 收到 SIGTERM 後清掉暫存資料夾（預設是 SIGKILL）
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
