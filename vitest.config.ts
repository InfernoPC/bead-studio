import { defineConfig } from 'vitest/config';

// vite.config.ts 的 root 是 src/web，測試要從專案根目錄找
export default defineConfig({ test: { root: '.' } });
