import { buildApp } from './app';
import type { Vision } from './mcp';
import { DesignStore } from './store';

const store = new DesignStore({
  dataDir: process.env.BEADS_DATA_DIR ?? 'data',
  configDir: process.env.BEADS_CONFIG_DIR ?? 'config',
});
store.load();
const port = Number(process.env.PORT ?? 5174);
const app = buildApp(store, { vision: (process.env.BEADS_VISION as Vision) ?? 'auto' });
await app.listen({ port, host: '127.0.0.1' });
console.log(`🫘 Bead Studio: http://localhost:${port}  (MCP: http://localhost:${port}/mcp)`);
