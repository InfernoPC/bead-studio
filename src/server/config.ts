import type { Vision } from './mcp';

export type ServerConfig = { port: number; vision: Vision; allowedHosts: string[]; dataDir: string; configDir: string };

const VISIONS: Vision[] = ['auto', 'on', 'off'];

/** 讀取並驗證環境變數；不合法時丟出說明清楚的錯誤 */
export function parseEnv(env: Record<string, string | undefined>): ServerConfig {
  const rawPort = env.PORT ?? '5174';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT 必須是 1–65535 的整數（目前是 "${rawPort}"）`);
  }
  const vision = (env.BEADS_VISION ?? 'auto') as Vision;
  if (!VISIONS.includes(vision)) throw new Error(`BEADS_VISION 必須是 ${VISIONS.join('|')}（目前是 "${vision}"）`);
  return {
    port, vision,
    allowedHosts: (env.BEADS_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean),
    dataDir: env.BEADS_DATA_DIR ?? 'data',
    configDir: env.BEADS_CONFIG_DIR ?? 'config',
  };
}
