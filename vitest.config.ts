import { defineConfig } from 'vitest/config';

// vite.config.ts 的 root 是 src/web，測試要從專案根目錄找；e2e/ 由 Playwright 執行
export default defineConfig({ test: { root: '.', exclude: ['e2e/**', 'node_modules/**'] } });
