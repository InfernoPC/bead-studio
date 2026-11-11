import { buildApp } from './app';
import { parseEnv, type ServerConfig } from './config';
import { DesignStore } from './store';

let cfg: ServerConfig;
try {
  cfg = parseEnv(process.env);
} catch (e) {
  console.error(`設定錯誤：${(e as Error).message}`);
  process.exit(1);
}
const store = new DesignStore({ dataDir: cfg.dataDir, configDir: cfg.configDir });
store.load();
const app = buildApp(store, { vision: cfg.vision, allowedHosts: cfg.allowedHosts });
await app.listen({ port: cfg.port, host: '127.0.0.1' });
console.log(`🫘 Bead Studio: http://localhost:${cfg.port}  (MCP: http://localhost:${cfg.port}/mcp)`);
